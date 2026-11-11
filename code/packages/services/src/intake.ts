// Intake: T1 webhook transaction (AD-05, MH-01, MH-02, DU-1, FD-7) and the rule/threading job (T2, DU-2..DU-4).
import {
  appendsToOpenRequest,
  carrierKeyword,
  du4Decision,
  EP,
  evaluateRules,
  maxTier,
  pagesImmediately,
  pickContacts,
  renderPurposeNotice,
  renderSafetyReply,
  ruleFloor,
  CURRENT_RULES,
  suggestsDuplicate,
  tierRank,
  type Tier,
} from '@fixtriage/core';
import { and, eq, inArray, resolvers, sql, tables, type Tx } from '@fixtriage/db';
import { newCorrelationId, publicUrl } from '@fixtriage/platform';
import { advisoryLock, afterHours, audit, enqueueJob, loadAccount, serviceLog, withAccount, type Deps } from './context';
import { handleVendorReply } from './dispatch';
import { paging, reopenEscalation, startEscalation, type Trigger } from './escalation';
import { enqueueOutbound } from './outbox';
import { findTenantContact, smsOptedOut } from './tenant';

export interface InboundInput {
  provider: 'twilio' | 'postmark';
  kind: 'sms' | 'email';
  providerMessageId: string;
  to: string;
  from: string;
  body: string | null;
  mediaCount: number;
  receivedAt: Date;
  correlationId: string;
  raw?: Record<string, unknown>;
}

export type IngestResult = { status: 'stored'; accountId: string; inboundId: string } | { status: 'duplicate' } | { status: 'unrouted' };

/**
 * T1 (schema.md 6): store the message once (DU-1), enqueue the fixed safety reply in the same transaction (AD-05),
 * enqueue the intake job. No model and no classification queue is involved in the safety reply (MH-02).
 */
export async function ingestInbound(deps: Deps, m: InboundInput): Promise<IngestResult> {
  // A malformed correlation ID must never cost the message (it is our own tracing value, replaced if invalid).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.correlationId)) m = { ...m, correlationId: newCorrelationId() };
  const ch = await resolvers.channel(deps.database, m.to);
  if (!ch) {
    // B1-004: never dropped. Metadata only (no sender, no text) in a global table; an uncleared row fails /readyz so
    // the external monitor alerts both operators. The provider keeps the message for retrieval by its ID.
    await deps.database.pool.query(
      'insert into unrouted_inbound (provider, kind, provider_message_id, to_address, received_at) values ($1, $2, $3, $4, $5) on conflict (provider, provider_message_id) do nothing',
      [m.provider, m.kind, m.providerMessageId, m.to, m.receivedAt],
    );
    serviceLog.error('inbound.unrouted_destination', { provider: m.provider });
    return { status: 'unrouted' };
  }
  return withAccount(deps.database, ch.account_id, async (tx) => {
    const now = deps.clock.now();
    const account = await loadAccount(tx, ch.account_id);
    const keyword = m.kind === 'sms' ? carrierKeyword(m.body) : null;
    const contact = await findTenantContact(tx, m.kind, m.from);
    const inserted = await tx
      .insert(tables.inboundMessages)
      .values({
        accountId: ch.account_id,
        channelId: ch.channel_id,
        provider: m.provider,
        providerMessageId: m.providerMessageId,
        fromAddress: m.from,
        body: m.body,
        mediaCount: m.mediaCount,
        keyword,
        receivedAt: m.receivedAt,
        storedAt: now,
        tenantContactId: contact?.id ?? null,
        correlationId: m.correlationId,
        rawPayload: (m.raw ?? null) as object | null,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: tables.inboundMessages.id });
    const inboundId = inserted[0]?.id;
    if (!inboundId) return { status: 'duplicate' } as const;
    await tx.update(tables.channels).set({ lastInboundAt: m.receivedAt }).where(eq(tables.channels.id, ch.channel_id));
    for (let i = 0; i < m.mediaCount; i++) await tx.insert(tables.attachments).values({ accountId: ch.account_id, inboundMessageId: inboundId, idx: i, createdAt: now });

    if (keyword === 'stop' || keyword === 'start') {
      // FD-7: the provider blocks texts after STOP and sends its own opt-out confirmation; we record and show it.
      if (contact) await tx.update(tables.tenantContacts).set({ smsOptedOutAt: keyword === 'stop' ? m.receivedAt : null, updatedAt: now }).where(eq(tables.tenantContacts.id, contact.id));
      await audit(tx, { accountId: ch.account_id, actorKind: 'tenant', action: keyword === 'stop' ? 'tenant.sms_opt_out' : 'tenant.sms_opt_in', objectType: 'inbound_message', objectId: inboundId }, now);
      return { status: 'stored', accountId: ch.account_id, inboundId } as const;
    }
    if (keyword === 'help') return { status: 'stored', accountId: ch.account_id, inboundId } as const; // provider answers HELP

    if (m.kind === 'sms' && (await handleVendorReply(tx, deps, ch.account_id, m.from, m.body, inboundId))) {
      return { status: 'stored', accountId: ch.account_id, inboundId } as const;
    }

    const ah = afterHours(account, m.receivedAt);
    const rules = evaluateRules({ text: m.body, hasMedia: m.mediaCount > 0, afterHours: ah });
    const ruleHit = rules.ruleTier !== null;
    const recent = await tx.execute(sql`
      select 1 from outbound_messages where purpose = 'safety_reply' and to_address in (${m.from}, coalesce(${contact?.email ?? null}::text, ''))
        and created_at > ${new Date(m.receivedAt.getTime() - EP.safetyReplyWindowSeconds * 1000)} and status not in ('failed', 'undelivered') limit 1`);
    const optedOut = m.kind === 'sms' && (await smsOptedOut(tx, m.from, m.receivedAt));
    let safetyReplyId: string | null = null;
    if (ruleHit || recent.rows.length === 0) {
      let property: { emergencyContactPhone: string | null; gasEmergencyPhone: string | null } | null = null;
      if (contact) {
        const p = await tx.execute(sql`select p.emergency_contact_phone, p.gas_emergency_phone from units u join properties p on p.id = u.property_id where u.id = ${contact.unit_id}`);
        const row = p.rows[0] as { emergency_contact_phone: string | null; gas_emergency_phone: string | null } | undefined;
        if (row) property = { emergencyContactPhone: row.emergency_contact_phone, gasEmergencyPhone: row.gas_emergency_phone };
      }
      const rendered = renderSafetyReply({ afterHours: ah, ...pickContacts(account, property) });
      const target = m.kind === 'email' ? { channel: 'email' as const, to: m.from } : !optedOut ? { channel: 'sms' as const, to: m.from } : contact?.email ? { channel: 'email' as const, to: contact.email } : null;
      if (target) {
        safetyReplyId = await enqueueOutbound(tx, { accountId: ch.account_id, purpose: 'safety_reply', channel: target.channel, to: target.to, rendered, dedupeKey: `safety:${inboundId}`, at: now });
        if (target.channel === 'sms') {
          // MH-15: purpose notice with the opt-out line, second message of the first exchange, once per sender.
          await enqueueOutbound(tx, { accountId: ch.account_id, purpose: 'notice', channel: 'sms', to: m.from, rendered: renderPurposeNotice({ accountName: account.name, privacyUrl: publicUrl(deps.publicBaseUrl, '/privacy') }), dedupeKey: `notice:${m.from}`, at: new Date(now.getTime() + 1) });
        }
        await tx.update(tables.inboundMessages).set({ safetyReplyId }).where(eq(tables.inboundMessages.id, inboundId));
      }
    }
    await enqueueJob(tx, ch.account_id, 'intake.process', { inboundId }, `intake:${inboundId}`, now);
    await audit(tx, { accountId: ch.account_id, actorKind: 'provider', action: 'inbound.stored', objectType: 'inbound_message', objectId: inboundId, after: { safety_reply: safetyReplyId !== null, rule_hit: ruleHit, after_hours: ah, opted_out: optedOut } }, now);
    return { status: 'stored', accountId: ch.account_id, inboundId } as const;
  });
}

const hazardOf = (ruleId: string | null) => CURRENT_RULES.find((r) => r.id === ruleId)?.hazardClass ?? 'unknown';

type RequestRow = typeof tables.requests.$inferSelect;

/** What a request's current state demands (EP-3, EP-8, FD-7c). */
export function escalationNeed(r: Pick<RequestRow, 'tier' | 'tierSource' | 'cannotText' | 'afterHours'>): 'now' | 'triage_timer' | 'none' {
  if (pagesImmediately(r.tier as Tier)) return 'now';
  const uncertainDecided = r.tier === 'uncertain' && r.tierSource !== 'pending';
  if (uncertainDecided || r.cannotText) return r.afterHours ? 'now' : 'triage_timer';
  return 'none';
}

/** intake.process job (T2): thread (DU-2), apply rules, then link or open an incident (DU-3, DU-4). */
export async function processIntake(tx: Tx, deps: Deps, accountId: string, inboundId: string): Promise<void> {
  const now = deps.clock.now();
  const [msg] = await tx.select().from(tables.inboundMessages).where(eq(tables.inboundMessages.id, inboundId));
  if (!msg || msg.requestId || msg.keyword) return;
  await advisoryLock(tx, `${accountId}:${msg.fromAddress}`);
  const account = await loadAccount(tx, accountId);
  const ah = afterHours(account, msg.receivedAt);
  const rules = evaluateRules({ text: msg.body, hasMedia: msg.mediaCount > 0, afterHours: ah });
  const floor = ruleFloor(rules);
  const [chan] = await tx.select({ kind: tables.channels.kind }).from(tables.channels).where(eq(tables.channels.id, msg.channelId));
  const cannotText = chan?.kind === 'sms' && (await smsOptedOut(tx, msg.fromAddress, msg.receivedAt));
  const contact = msg.tenantContactId ? (await tx.select().from(tables.tenantContacts).where(eq(tables.tenantContacts.id, msg.tenantContactId)))[0] : undefined;

  // DU-2: same sender, open request opened within 30 minutes.
  const open = await tx.execute(sql`
    select r.id, r.opened_at from requests r
    where r.state <> 'closed' and exists (select 1 from inbound_messages i where i.request_id = r.id and i.from_address = ${msg.fromAddress})
    order by r.opened_at desc limit 1`);
  const openRow = open.rows[0] as { id: string; opened_at: Date } | undefined;
  let request: RequestRow;
  if (openRow && appendsToOpenRequest(new Date(openRow.opened_at).getTime(), msg.receivedAt.getTime())) {
    const [cur] = await tx.select().from(tables.requests).where(eq(tables.requests.id, openRow.id));
    request = cur!;
    await tx.update(tables.inboundMessages).set({ requestId: request.id }).where(eq(tables.inboundMessages.id, inboundId));
    const patch: Partial<RequestRow> = {};
    if (floor !== null && (request.tierSource === 'pending' || tierRank(floor) > tierRank(request.tier as Tier))) {
      patch.tier = request.tierSource === 'pending' ? floor : maxTier(floor, request.tier as Tier);
      patch.tierSource = rules.ruleTier ? 'rule' : 'uncertainty';
    }
    if (cannotText && !request.cannotText) patch.cannotText = true;
    if (Object.keys(patch).length) {
      const [u] = await tx.update(tables.requests).set({ ...patch, updatedAt: now, version: sql`${tables.requests.version} + 1` }).where(eq(tables.requests.id, request.id)).returning();
      request = u!;
    }
    await audit(tx, { accountId, actorKind: 'system', action: 'request.appended', objectType: 'request', objectId: request.id, after: { inbound_id: inboundId, tier: request.tier } }, now);
  } else {
    const [created] = await tx
      .insert(tables.requests)
      .values({
        accountId,
        unitId: contact?.unitId ?? null,
        cannotText,
        tier: floor ?? 'uncertain', // UR-3: never routine by default
        tierSource: rules.ruleTier ? 'rule' : rules.uncertaintyFloor ? 'uncertainty' : 'pending',
        afterHours: ah,
        openedAt: msg.receivedAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    request = created!;
    await tx.update(tables.inboundMessages).set({ requestId: request.id }).where(eq(tables.inboundMessages.id, inboundId));
    await audit(tx, { accountId, actorKind: 'system', action: 'request.opened', objectType: 'request', objectId: request.id, after: { tier: request.tier, tier_source: request.tierSource, cannot_text: cannotText, after_hours: ah } }, now);
  }
  await tx.insert(tables.classifications).values({
    accountId,
    requestId: request.id,
    inboundMessageId: inboundId,
    kind: 'rule',
    ruleSetVersion: rules.ruleSetVersion,
    matchedRule: rules.primaryRule,
    proposedTier: floor,
    status: 'ok',
    reason: rules.uncertaintyReason,
    createdAt: now,
  });
  await enqueueJob(tx, accountId, 'classify', { inboundId, requestId: request.id }, `classify:${inboundId}`, now);
  await applyEscalationNeed(tx, deps, accountId, request, hazardOf(rules.primaryRule), msg.receivedAt);
}

/** After any tier or flag change: open, link or reopen an incident as the rules require. Never lowers anything. */
export async function applyEscalationNeed(tx: Tx, deps: Deps, accountId: string, request: RequestRow, hazardClass: string, receivedAt: Date): Promise<void> {
  const need = escalationNeed(request);
  if (need === 'none') return;
  // EP-8 business-hours timer: the deterministic sweep over view `due_undecided` pages at 15 min (B1-001).
  if (need === 'triage_timer' && !request.incidentId) return;
  await ensureIncident(tx, deps, accountId, request, hazardClass, receivedAt, 'new_incident');
}

/** DU-3/DU-4 and incident creation. Called with the request already at its current tier. */
export async function ensureIncident(tx: Tx, deps: Deps, accountId: string, request: RequestRow, hazardClass: string, receivedAt: Date, trigger: Trigger): Promise<void> {
  const now = deps.clock.now();
  if (request.incidentId) {
    // Already linked: raise the incident tier and apply DU-4c when the incident was acknowledged.
    const [inc] = await tx.select().from(tables.incidents).where(eq(tables.incidents.id, request.incidentId));
    if (!inc) return;
    if (tierRank(request.tier as Tier) > tierRank(inc.tier as Tier)) {
      await tx.update(tables.incidents).set({ tier: request.tier, updatedAt: now, version: sql`${tables.incidents.version} + 1` }).where(eq(tables.incidents.id, inc.id));
      if (inc.state === 'acknowledged' || inc.state === 'outcome_recorded') await reopenEscalation(tx, deps, accountId, inc.id, 'new_unit_report', { requestId: request.id });
      else if (!(await paging(tx, inc.id))) await startEscalation(tx, deps, accountId, inc.id, trigger, { requestId: request.id });
    } else if (inc.state === 'open' && !(await paging(tx, inc.id))) {
      await startEscalation(tx, deps, accountId, inc.id, trigger, { requestId: request.id });
    }
    return;
  }
  let propertyId: string | null = null;
  if (request.unitId) {
    const [u] = await tx.select({ propertyId: tables.units.propertyId }).from(tables.units).where(eq(tables.units.id, request.unitId));
    propertyId = u?.propertyId ?? null;
  }
  if (propertyId && hazardClass !== 'unknown') {
    const cand = await tx.execute(sql`
      select id, created_at, state, tier, building_wide from incidents
      where property_id = ${propertyId} and hazard_class = ${hazardClass} and state in ('open', 'acknowledged')
      order by building_wide desc, created_at desc limit 1`); // DU-4(d): a building-wide flag claims later same-hazard reports
    const c = cand.rows[0] as { id: string; created_at: Date; state: string; tier: Tier; building_wide: boolean } | undefined;
    if (c && suggestsDuplicate(new Date(c.created_at).getTime(), receivedAt.getTime())) {
      const units = await tx.select({ unitId: tables.requests.unitId }).from(tables.requests).where(and(eq(tables.requests.incidentId, c.id), inArray(tables.requests.incidentLinkState, ['own', 'suggested', 'confirmed'])));
      const decision = du4Decision({
        incidentAcknowledged: c.state === 'acknowledged',
        buildingWide: c.building_wide,
        incidentTier: c.tier,
        incidentUnitIds: units.map((u) => u.unitId),
        newUnitId: request.unitId,
        newTier: request.tier as Tier,
      });
      await tx.update(tables.requests).set({ incidentId: c.id, incidentLinkState: 'suggested', updatedAt: now }).where(eq(tables.requests.id, request.id));
      if (tierRank(request.tier as Tier) > tierRank(c.tier)) await tx.update(tables.incidents).set({ tier: request.tier, updatedAt: now }).where(eq(tables.incidents.id, c.id));
      await audit(tx, { accountId, actorKind: 'system', action: `incident.link_suggested.${decision}`, objectType: 'request', objectId: request.id, after: { incident_id: c.id } }, now);
      if (decision === 'reopen') await reopenEscalation(tx, deps, accountId, c.id, 'new_unit_report', { requestId: request.id });
      return;
    }
  }
  const [inc] = await tx
    .insert(tables.incidents)
    .values({ accountId, propertyId, hazardClass, tier: request.tier, createdAt: now, updatedAt: now })
    .returning({ id: tables.incidents.id });
  await tx.update(tables.requests).set({ incidentId: inc!.id, incidentLinkState: 'own', updatedAt: now }).where(eq(tables.requests.id, request.id));
  await audit(tx, { accountId, actorKind: 'system', action: 'incident.opened', objectType: 'incident', objectId: inc!.id, after: { tier: request.tier, hazard_class: hazardClass, request_id: request.id } }, now);
  await startEscalation(tx, deps, accountId, inc!.id, trigger, { requestId: request.id });
}

/** triage.timeout job (EP-8): an `uncertain` (or cannot-text) request nobody triaged in 15 minutes pages Level 1. */
export async function triageTimeout(tx: Tx, deps: Deps, accountId: string, requestId: string): Promise<void> {
  const [r] = await tx.select().from(tables.requests).where(eq(tables.requests.id, requestId));
  if (!r || r.incidentId || r.state === 'closed') return;
  const human = await tx.execute(sql`select 1 from classifications where request_id = ${requestId} and kind = 'human' limit 1`);
  if (human.rows.length) return;
  if (escalationNeed({ ...r, afterHours: true }) !== 'now') return;
  await ensureIncident(tx, deps, accountId, r, 'unknown', r.openedAt, 'uncertain_timeout');
}

/** Exposed for the worker job runner. */
export async function runIntakeJob(deps: Deps, accountId: string, inboundId: string): Promise<void> {
  await withAccount(deps.database, accountId, (tx) => processIntake(tx, deps, accountId, inboundId));
}
