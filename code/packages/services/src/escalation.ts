// Escalation state machine (EP-2..EP-7, EP-11; schema.md 6 T3, T4, T6; IT-06, IT-07, IT-08, IT-19).
// Steps are database rows with due times, advanced by a polling tick; never in-memory timers (AD-03).
import {
  EP,
  ESCALATION_POLICY_VERSION,
  planSteps,
  renderAcknowledged,
  renderOutcomeReminder,
  renderPageSms,
  renderPageVoice,
  renderStillTrying,
  pickContacts,
  type CompanionRole,
  type PlannedStep,
  type TargetRole,
} from '@fixtriage/core';
import { and, eq, inArray, isNull, poll, sql, tables, type Tx } from '@fixtriage/db';
import { newCapabilityToken, publicUrl } from '@fixtriage/platform';
import { audit, ConflictError, loadAccount, NotFoundError, withAccount, type Deps } from './context';
import { enqueueOutbound } from './outbox';
import { nextVendorFor } from './dispatch';
import { tenantChannelFor } from './tenant';

export type Trigger = 'new_incident' | 'uncertain_timeout' | 'no_outcome' | 'dispatch_failed' | 'new_unit_report';
export interface Companion {
  role: CompanionRole;
  userId: string;
}

const ACK_TOKEN_TTL_MS = 24 * 3600 * 1000; // TRD 8.1

/** T6: start (or reopen) the escalation for an incident. A second concurrent start is a no-op (partial unique index). */
export async function startEscalation(
  tx: Tx,
  deps: Deps,
  accountId: string,
  incidentId: string,
  trigger: Trigger,
  opts: { dispatchId?: string; requestId?: string; companions?: Companion[] } = {},
): Promise<string | null> {
  const now = deps.clock.now();
  const inserted = await tx
    .insert(tables.escalations)
    .values({
      accountId,
      incidentId,
      trigger,
      dispatchId: opts.dispatchId ?? null,
      requestId: opts.requestId ?? null,
      startedAt: now,
      nextDueAt: now,
      companions: opts.companions ?? [],
      policyVersion: ESCALATION_POLICY_VERSION,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: tables.escalations.id });
  const id = inserted[0]?.id ?? null;
  if (!id) return null;
  // EP-11: the incident returns to `open` whenever an escalation is (re)opened; a previous outcome no longer stands.
  await tx
    .update(tables.incidents)
    .set({ state: 'open', outcome: null, outcomeBy: null, outcomeAt: null, updatedAt: now, version: sql`${tables.incidents.version} + 1` })
    .where(and(eq(tables.incidents.id, incidentId), inArray(tables.incidents.state, ['open', 'acknowledged', 'outcome_recorded'])));
  await audit(tx, { accountId, actorKind: 'system', action: 'escalation.started', objectType: 'escalation', objectId: id, after: { trigger, incident_id: incidentId, dispatch_id: opts.dispatchId ?? null } }, now);
  await advanceEscalation(tx, deps, accountId, id);
  return id;
}

/** EP-11: reopen with the previous acknowledger (and, for FD-3, the approver) paged together with Level 1. */
export async function reopenEscalation(tx: Tx, deps: Deps, accountId: string, incidentId: string, trigger: Exclude<Trigger, 'new_incident' | 'uncertain_timeout'>, opts: { dispatchId?: string; requestId?: string; approverUserId?: string } = {}): Promise<string | null> {
  const [prev] = await tx
    .select({ acknowledgedBy: tables.escalations.acknowledgedBy })
    .from(tables.escalations)
    .where(and(eq(tables.escalations.incidentId, incidentId), eq(tables.escalations.state, 'acknowledged')))
    .orderBy(sql`${tables.escalations.acknowledgedAt} desc`)
    .limit(1);
  const companions: Companion[] = [];
  if (opts.approverUserId) companions.push({ role: 'approver', userId: opts.approverUserId });
  if (prev?.acknowledgedBy && prev.acknowledgedBy !== opts.approverUserId) companions.push({ role: 'previous_acknowledger', userId: prev.acknowledgedBy });
  // The acknowledged escalation's own outcome timers stop; the new escalation carries the incident from here.
  await tx.update(tables.escalations).set({ nextDueAt: null }).where(and(eq(tables.escalations.incidentId, incidentId), eq(tables.escalations.state, 'acknowledged')));
  return startEscalation(tx, deps, accountId, incidentId, trigger, { ...opts, companions });
}

interface IncidentView {
  id: string;
  tier: string;
  hazardClass: string;
  address: string | null;
  units: string[];
  reportCount: number;
  cannotText: boolean;
  propertyId: string | null;
}

export async function incidentView(tx: Tx, incidentId: string): Promise<IncidentView> {
  const r = await tx.execute(sql`
    select i.id, i.tier, i.hazard_class, i.property_id, p.street_address,
      (select count(*)::int from requests r where r.incident_id = i.id and r.incident_link_state in ('own','suggested','confirmed')) as report_count,
      (select coalesce(array_agg(distinct u.label order by u.label), '{}') from requests r join units u on u.id = r.unit_id
        where r.incident_id = i.id and r.incident_link_state in ('own','suggested','confirmed')) as units,
      (select bool_or(r.cannot_text) from requests r where r.incident_id = i.id and r.incident_link_state in ('own','suggested','confirmed')) as cannot_text
    from incidents i left join properties p on p.id = i.property_id where i.id = ${incidentId}`);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new NotFoundError('incident');
  return {
    id: String(row.id),
    tier: String(row.tier),
    hazardClass: String(row.hazard_class),
    address: (row.street_address as string | null) ?? null,
    units: (row.units as string[]) ?? [],
    reportCount: Number(row.report_count),
    cannotText: Boolean(row.cannot_text),
    propertyId: (row.property_id as string | null) ?? null,
  };
}

/** Who holds a level now (EP-1). Level 3 falls back to the account owner. */
export async function onCallAt(tx: Tx, level: 1 | 2 | 3, at: Date): Promise<{ userId: string; mobile: string | null } | null> {
  const r = await tx.execute(sql`
    select u.id, u.mobile from oncall_shifts s join users u on u.id = s.user_id
    where s.level = ${level} and s.starts_at <= ${at} and s.ends_at > ${at} and u.disabled_at is null limit 1`);
  const row = r.rows[0] as { id: string; mobile: string | null } | undefined;
  if (row) return { userId: row.id, mobile: row.mobile };
  if (level === 3) {
    const o = await tx.execute(sql`select id, mobile from users where role = 'owner' and disabled_at is null order by created_at limit 1`);
    const ow = o.rows[0] as { id: string; mobile: string | null } | undefined;
    if (ow) return { userId: ow.id, mobile: ow.mobile };
  }
  return null;
}

type EscalationRow = typeof tables.escalations.$inferSelect;

async function lockEscalation(tx: Tx, id: string, skipLocked: boolean): Promise<EscalationRow | null> {
  const r = await tx.execute(sql`select id from escalations where id = ${id} for update ${skipLocked ? sql`skip locked` : sql``}`);
  if (!r.rows[0]) return null;
  const [row] = await tx.select().from(tables.escalations).where(eq(tables.escalations.id, id));
  return row ?? null;
}

async function existingSteps(tx: Tx, escalationId: string): Promise<Array<PlannedStep & { id: string; result: string | null; targetUserId: string | null }>> {
  const rows = await tx.select().from(tables.escalationSteps).where(eq(tables.escalationSteps.escalationId, escalationId));
  return rows.map((s) => ({ id: s.id, cycle: s.cycle, level: s.level as 1 | 2 | 3 | 4, attempt: s.attempt, role: s.targetRole as TargetRole, dueAt: s.dueAt.getTime(), result: s.result, targetUserId: s.targetUserId }));
}

/** Inserts one step with its page (voice + SMS, EP-2). Returns false when the step already existed. */
async function createStep(tx: Tx, deps: Deps, esc: EscalationRow, p: PlannedStep): Promise<{ created: boolean; noTarget: boolean }> {
  const now = deps.clock.now();
  let targetUserId: string | null = null;
  let targetOperatorId: string | null = null;
  let phone: string | null = null;
  if (p.role === 'oncall') {
    const who = await onCallAt(tx, p.level as 1 | 2 | 3, now);
    targetUserId = who?.userId ?? null;
    phone = who?.mobile ?? null;
  } else if (p.role === 'operator_primary' || p.role === 'operator_backup') {
    const rank = p.role === 'operator_primary' ? 1 : 2;
    const [op] = await tx.select().from(tables.operators).where(and(eq(tables.operators.level4Rank, rank), isNull(tables.operators.disabledAt)));
    targetOperatorId = op?.id ?? null;
    phone = op?.mobile ?? null;
  } else {
    const c = (esc.companions as Companion[]).find((x) => x.role === p.role);
    if (c) {
      const [u] = await tx.select().from(tables.users).where(eq(tables.users.id, c.userId));
      targetUserId = u && !u.disabledAt ? u.id : null;
      phone = u?.mobile ?? null;
    }
  }
  const noTarget = phone === null;
  const inserted = await tx
    .insert(tables.escalationSteps)
    .values({
      accountId: esc.accountId,
      escalationId: esc.id,
      cycle: p.cycle,
      level: p.level,
      attempt: p.attempt,
      targetRole: p.role,
      targetUserId,
      targetOperatorId,
      dueAt: new Date(p.dueAt),
      startedAt: now,
      result: noTarget ? 'no_target' : null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: tables.escalationSteps.id });
  const stepId = inserted[0]?.id;
  if (!stepId) return { created: false, noTarget: false };
  if (noTarget) {
    await audit(tx, { accountId: esc.accountId, actorKind: 'system', action: 'escalation.step_no_target', objectType: 'escalation_step', objectId: stepId, after: { level: p.level, role: p.role } }, now);
    return { created: true, noTarget: true };
  }
  const view = await incidentView(tx, esc.incidentId);
  let ackUrl: string | null = null;
  if (targetUserId) {
    const tok = newCapabilityToken();
    await tx.insert(tables.capabilityTokens).values({ accountId: esc.accountId, purpose: 'ack', tokenHash: tok.hash, escalationStepId: stepId, userId: targetUserId, expiresAt: new Date(now.getTime() + ACK_TOKEN_TTL_MS), createdAt: now });
    ackUrl = publicUrl(deps.publicBaseUrl, `/a/${tok.token}`);
  }
  let failedDispatch: { nextVendorName: string | null } | undefined;
  if (esc.trigger === 'dispatch_failed' && esc.dispatchId) failedDispatch = { nextVendorName: (await nextVendorFor(tx, esc.dispatchId))?.name ?? null };
  const params = { tier: view.tier, hazardClass: view.hazardClass, address: view.address, units: view.units, reportCount: view.reportCount, ackUrl, failedDispatch, cannotText: view.cannotText };
  await enqueueOutbound(tx, { accountId: esc.accountId, purpose: 'page_voice', channel: 'voice', to: phone!, rendered: renderPageVoice(params), dedupeKey: `page:${stepId}:voice`, at: now, escalationStepId: stepId });
  await enqueueOutbound(tx, { accountId: esc.accountId, purpose: 'page_sms', channel: 'sms', to: phone!, rendered: renderPageSms(params), dedupeKey: `page:${stepId}:sms`, at: new Date(now.getTime() + 1), escalationStepId: stepId });
  await audit(tx, { accountId: esc.accountId, actorKind: 'system', action: 'escalation.page', objectType: 'escalation_step', objectId: stepId, after: { cycle: p.cycle, level: p.level, attempt: p.attempt, role: p.role } }, now);
  return { created: true, noTarget: false };
}

/** Starts the next level now (EP-4, or a level with nobody to page). Only within cycle 1, Levels 1-3. */
async function startNextLevelNow(tx: Tx, deps: Deps, esc: EscalationRow, level: number): Promise<void> {
  if (level >= 4) return;
  const steps = await existingSteps(tx, esc.id);
  const next = level + 1;
  const role: TargetRole = next === 4 ? 'operator_primary' : 'oncall';
  if (steps.some((s) => s.cycle === 1 && s.level === next && s.attempt === 1 && s.role === role)) return;
  const r = await createStep(tx, deps, esc, { cycle: 1, level: next as 2 | 3 | 4, attempt: 1, role, dueAt: deps.clock.now().getTime() });
  await tx.update(tables.escalations).set({ currentLevel: next }).where(eq(tables.escalations.id, esc.id));
  if (r.noTarget) await startNextLevelNow(tx, deps, esc, next);
}

/** T3: create every due step (none skipped, none doubled), send EP-6 / EP-7 notices, set next_due_at. */
export async function advanceEscalation(tx: Tx, deps: Deps, accountId: string, escalationId: string, opts: { skipLocked?: boolean } = {}): Promise<void> {
  const esc = await lockEscalation(tx, escalationId, opts.skipLocked ?? false);
  if (!esc) return;
  const now = deps.clock.now();
  const account = await loadAccount(tx, accountId);
  if (esc.state === 'paging') {
    for (let guard = 0; guard < 8; guard++) {
      const steps = await existingSteps(tx, esc.id);
      const plan = planSteps({
        startedAt: esc.startedAt.getTime(),
        ackTimeoutSeconds: account.ackTimeoutSeconds,
        existing: steps,
        operatorEngagedAt: esc.operatorEngagedAt?.getTime() ?? null,
        companions: (esc.companions as Companion[]).map((c) => c.role),
        now: now.getTime(),
      });
      if (plan.due.length === 0) break;
      for (const p of plan.due) {
        const r = await createStep(tx, deps, esc, p);
        if (p.cycle === 1 && p.level > esc.currentLevel) {
          esc.currentLevel = p.level;
          await tx.update(tables.escalations).set({ currentLevel: p.level }).where(eq(tables.escalations.id, esc.id));
        }
        if (r.noTarget && p.cycle === 1 && p.role === 'oncall' && p.attempt === 1) await startNextLevelNow(tx, deps, esc, p.level);
      }
    }
    const noticeDue = esc.startedAt.getTime() + EP.tenantNoticeSeconds * 1000;
    if (!esc.tenantNoticeSentAt && now.getTime() >= noticeDue) {
      await notifyTenants(tx, deps, accountId, esc.incidentId, 'still_trying', esc.id);
      await tx.update(tables.escalations).set({ tenantNoticeSentAt: now }).where(eq(tables.escalations.id, esc.id));
      esc.tenantNoticeSentAt = now;
    }
    const steps = await existingSteps(tx, esc.id);
    const plan = planSteps({ startedAt: esc.startedAt.getTime(), ackTimeoutSeconds: account.ackTimeoutSeconds, existing: steps, operatorEngagedAt: esc.operatorEngagedAt?.getTime() ?? null, companions: (esc.companions as Companion[]).map((c) => c.role), now: now.getTime() });
    const candidates = [plan.nextDueAt, esc.tenantNoticeSentAt ? null : noticeDue].filter((x): x is number => x !== null);
    await tx.update(tables.escalations).set({ nextDueAt: candidates.length ? new Date(Math.min(...candidates)) : null, updatedAt: now }).where(eq(tables.escalations.id, esc.id));
    return;
  }
  // Acknowledged: EP-7 reminder at 30 min, EP-11a reopen at 45 min, unless an outcome was recorded.
  const [inc] = await tx.select().from(tables.incidents).where(eq(tables.incidents.id, esc.incidentId));
  if (!inc || inc.outcome || inc.state !== 'acknowledged' || !esc.acknowledgedAt) {
    await tx.update(tables.escalations).set({ nextDueAt: null }).where(eq(tables.escalations.id, esc.id));
    return;
  }
  const ackAt = esc.acknowledgedAt.getTime();
  const reminderAt = ackAt + EP.outcomeReminderSeconds * 1000;
  const reopenAt = ackAt + EP.outcomeReopenSeconds * 1000;
  if (now.getTime() >= reopenAt) {
    await tx.update(tables.escalations).set({ nextDueAt: null }).where(eq(tables.escalations.id, esc.id));
    await reopenEscalation(tx, deps, accountId, esc.incidentId, 'no_outcome');
    return;
  }
  if (now.getTime() >= reminderAt && !esc.outcomeReminderSentAt && esc.acknowledgedBy) {
    const [u] = await tx.select().from(tables.users).where(eq(tables.users.id, esc.acknowledgedBy));
    if (u?.mobile) {
      const view = await incidentView(tx, esc.incidentId);
      await enqueueOutbound(tx, { accountId, purpose: 'tenant_update', channel: 'sms', to: u.mobile, rendered: renderOutcomeReminder({ address: view.address, hazardClass: view.hazardClass, incidentUrl: publicUrl(deps.publicBaseUrl, `/incidents/${esc.incidentId}`) }), dedupeKey: `outcome_reminder:${esc.id}`, at: now });
    }
    await tx.update(tables.escalations).set({ outcomeReminderSentAt: now }).where(eq(tables.escalations.id, esc.id));
    esc.outcomeReminderSentAt = now;
  }
  await tx.update(tables.escalations).set({ nextDueAt: new Date(esc.outcomeReminderSentAt ? reopenAt : reminderAt), updatedAt: now }).where(eq(tables.escalations.id, esc.id));
}

/** Tenant notices for every report on the incident (EP-6 "still trying", acknowledgement). Respects STOP (FD-7). */
async function notifyTenants(tx: Tx, deps: Deps, accountId: string, incidentId: string, kind: 'still_trying' | 'acknowledged', escalationId: string): Promise<void> {
  const now = deps.clock.now();
  const reqs = await tx.select().from(tables.requests).where(and(eq(tables.requests.incidentId, incidentId), inArray(tables.requests.incidentLinkState, ['own', 'suggested', 'confirmed'])));
  const account = await loadAccount(tx, accountId);
  for (const r of reqs) {
    const ch = await tenantChannelFor(tx, r.id, now);
    if (!ch) continue;
    let property: { emergencyContactPhone: string | null; gasEmergencyPhone: string | null } | null = null;
    if (r.unitId) {
      const p = await tx.execute(sql`select p.emergency_contact_phone, p.gas_emergency_phone from units u join properties p on p.id = u.property_id where u.id = ${r.unitId}`);
      const row = p.rows[0] as { emergency_contact_phone: string | null; gas_emergency_phone: string | null } | undefined;
      if (row) property = { emergencyContactPhone: row.emergency_contact_phone, gasEmergencyPhone: row.gas_emergency_phone };
    }
    const contacts = pickContacts(account, property);
    const rendered = kind === 'still_trying' ? renderStillTrying(contacts) : renderAcknowledged();
    await enqueueOutbound(tx, { accountId, purpose: 'tenant_update', channel: ch.channel, to: ch.to, rendered, dedupeKey: `${kind}:${escalationId}:${r.id}`, at: now, requestId: r.id });
  }
}

/** One pass of `escalation.tick` (every 15 s) over due escalations of every account. */
export async function tickEscalations(deps: Deps, limit = 100): Promise<number> {
  const due = await poll(deps.database, 'due_escalations', deps.clock.now(), limit);
  for (const d of due) await withAccount(deps.database, d.account_id, (tx) => advanceEscalation(tx, deps, d.account_id, d.id, { skipLocked: true }));
  return due.length;
}

/** EP-4: when both channels of a step failed delivery, the next level is paged at once. */
export async function onPageChannelFailed(tx: Tx, deps: Deps, accountId: string, stepId: string): Promise<void> {
  const msgs = await tx.select({ status: tables.outboundMessages.status }).from(tables.outboundMessages).where(eq(tables.outboundMessages.escalationStepId, stepId));
  const bothFailed = msgs.length >= 2 && msgs.every((m) => m.status === 'failed' || m.status === 'undelivered');
  if (!bothFailed) return;
  const [step] = await tx.select().from(tables.escalationSteps).where(eq(tables.escalationSteps.id, stepId));
  if (!step) return;
  await tx.update(tables.escalationSteps).set({ result: 'delivery_failed' }).where(and(eq(tables.escalationSteps.id, stepId), isNull(tables.escalationSteps.result)));
  const esc = await lockEscalation(tx, step.escalationId, false);
  if (!esc || esc.state !== 'paging' || step.cycle !== 1 || step.level >= 4) return;
  await audit(tx, { accountId, actorKind: 'system', action: 'escalation.level_failed', objectType: 'escalation_step', objectId: stepId, after: { level: step.level } }, deps.clock.now());
  await startNextLevelNow(tx, deps, esc, step.level);
  await advanceEscalation(tx, deps, accountId, esc.id);
}

export type AckVia = 'voice' | 'link' | 'app' | 'operator_relay';
export type AckResult = { ok: true; escalationId: string } | { ok: false; reason: 'already_acknowledged' | 'version_conflict' | 'user_disabled' };

/** T4: one acknowledgement wins; a concurrent second gets "already acknowledged" (IT-08). Only a person of the account acknowledges (EP-5). */
export async function acknowledge(
  tx: Tx,
  deps: Deps,
  accountId: string,
  input: { escalationId: string; userId: string; via: AckVia; stepId?: string | null; expectedVersion?: number; relayedByOperatorId?: string },
): Promise<AckResult> {
  const now = deps.clock.now();
  // Security round item 1: a disabled user's link, keypress, app call or relayed acceptance never ends paging (EP-5:
  // only a person of the account acknowledges, and a disabled user no longer acts for it). The escalation goes on.
  const [who] = await tx.select({ disabledAt: tables.users.disabledAt }).from(tables.users).where(eq(tables.users.id, input.userId));
  if (!who || who.disabledAt) {
    await audit(tx, { accountId, actorKind: 'user', actorId: input.userId, action: 'escalation.ack_refused', objectType: 'escalation', objectId: input.escalationId, after: { via: input.via, reason: 'user_disabled' } }, now);
    return { ok: false, reason: 'user_disabled' };
  }
  const updated = await tx
    .update(tables.escalations)
    .set({
      state: 'acknowledged',
      acknowledgedBy: input.userId,
      acknowledgedVia: input.via,
      relayedByOperatorId: input.via === 'operator_relay' ? input.relayedByOperatorId ?? null : null,
      acknowledgedAt: now,
      nextDueAt: new Date(now.getTime() + EP.outcomeReminderSeconds * 1000),
      updatedAt: now,
      version: sql`${tables.escalations.version} + 1`,
    })
    .where(and(eq(tables.escalations.id, input.escalationId), eq(tables.escalations.state, 'paging'), ...(input.expectedVersion !== undefined ? [eq(tables.escalations.version, input.expectedVersion)] : [])))
    .returning({ id: tables.escalations.id, incidentId: tables.escalations.incidentId });
  const row = updated[0];
  if (!row) {
    const [cur] = await tx.select({ state: tables.escalations.state }).from(tables.escalations).where(eq(tables.escalations.id, input.escalationId));
    if (!cur) throw new NotFoundError('escalation');
    return { ok: false, reason: cur.state === 'acknowledged' ? 'already_acknowledged' : 'version_conflict' };
  }
  await tx
    .update(tables.escalationSteps)
    .set({ result: sql`case when ${tables.escalationSteps.id} = ${input.stepId ?? null}::uuid then 'acknowledged' else 'superseded' end`, updatedAt: now })
    .where(and(eq(tables.escalationSteps.escalationId, row.id), isNull(tables.escalationSteps.result)));
  await tx.update(tables.incidents).set({ state: 'acknowledged', updatedAt: now, version: sql`${tables.incidents.version} + 1` }).where(and(eq(tables.incidents.id, row.incidentId), eq(tables.incidents.state, 'open')));
  await notifyTenants(tx, deps, accountId, row.incidentId, 'acknowledged', row.id);
  await audit(tx, { accountId, actorKind: input.via === 'operator_relay' ? 'operator' : 'user', actorId: input.via === 'operator_relay' ? input.relayedByOperatorId ?? null : input.userId, action: 'escalation.acknowledged', objectType: 'escalation', objectId: row.id, after: { via: input.via, acknowledged_by: input.userId } }, now);
  return { ok: true, escalationId: row.id };
}

/** EP-5: an operator response records "engaged" and stops operator re-pages; it does not end the escalation. */
export async function operatorEngaged(tx: Tx, deps: Deps, accountId: string, escalationId: string, operatorId: string): Promise<void> {
  const now = deps.clock.now();
  await tx.update(tables.escalations).set({ operatorEngagedBy: operatorId, operatorEngagedAt: now, updatedAt: now }).where(and(eq(tables.escalations.id, escalationId), isNull(tables.escalations.operatorEngagedAt)));
  await audit(tx, { accountId, actorKind: 'operator', actorId: operatorId, action: 'escalation.operator_engaged', objectType: 'escalation', objectId: escalationId }, now);
  await advanceEscalation(tx, deps, accountId, escalationId);
}

export async function paging(tx: Tx, incidentId: string): Promise<EscalationRow | null> {
  const [e] = await tx.select().from(tables.escalations).where(and(eq(tables.escalations.incidentId, incidentId), eq(tables.escalations.state, 'paging')));
  return e ?? null;
}

/** EP-7: the acknowledger (or another person of the account) records the outcome; outcome timers stop. */
export async function recordOutcome(tx: Tx, deps: Deps, accountId: string, input: { incidentId: string; userId: string; outcome: 'vendor_dispatched' | 'handled_by_phone' | 'attending'; expectedVersion?: number }): Promise<{ version: number }> {
  const now = deps.clock.now();
  const [exists] = await tx.select({ id: tables.incidents.id }).from(tables.incidents).where(eq(tables.incidents.id, input.incidentId));
  if (!exists) throw new NotFoundError('incident');
  const r = await tx
    .update(tables.incidents)
    .set({ outcome: input.outcome, outcomeBy: input.userId, outcomeAt: now, state: 'outcome_recorded', updatedAt: now, version: sql`${tables.incidents.version} + 1` })
    .where(and(eq(tables.incidents.id, input.incidentId), eq(tables.incidents.state, 'acknowledged'), ...(input.expectedVersion !== undefined ? [eq(tables.incidents.version, input.expectedVersion)] : [])))
    .returning({ version: tables.incidents.version });
  if (!r[0]) throw new ConflictError('incident_not_acknowledged_or_version_conflict');
  await tx.update(tables.escalations).set({ nextDueAt: null }).where(and(eq(tables.escalations.incidentId, input.incidentId), eq(tables.escalations.state, 'acknowledged')));
  await audit(tx, { accountId, actorKind: 'user', actorId: input.userId, action: 'incident.outcome', objectType: 'incident', objectId: input.incidentId, after: { outcome: input.outcome } }, now);
  return r[0];
}

