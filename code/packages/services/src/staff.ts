// Staff actions and capability links (TRD 5.1, 8.1; UR-6; EP-5, EP-7; IT-08, IT-21).
import { and, eq, inArray, resolvers, sql, tables, type Tx } from '@fixtriage/db';
import { sha256 } from '@fixtriage/platform';
import { timingSafeEqual } from 'node:crypto';
import { tierRank, type Tier } from '@fixtriage/core';
import { audit, ConflictError, ForbiddenError, NotFoundError, withAccount, type Deps } from './context';
import { acknowledge, incidentView, operatorEngaged, paging, startEscalation, type AckResult } from './escalation';

export interface StaffPrincipal {
  userId: string;
  accountId: string;
  role: 'owner' | 'manager';
}

export class AuthError extends Error {
  override name = 'AuthError';
  constructor(public readonly code: 'no_session' | 'csrf') {
    super(code);
  }
}

/** Anti-forgery token: the custom header must match the hash stored with the session (V3.5.1). */
export function checkCsrf(stored: Buffer, header: string | null): void {
  const got = header ? sha256(header) : null;
  if (!got || got.length !== stored.length || !timingSafeEqual(got, stored)) throw new AuthError('csrf');
}

/** Keeps an active session inside the 8-hour inactivity limit (V7.3.1); the database writes at most once a minute. */
export async function touchSession(deps: Pick<Deps, 'database'>, token: string): Promise<void> {
  await deps.database.pool.query('select auth_touch_session($1)', [sha256(token)]);
}

/** Session check; state-changing requests also need the anti-forgery token in a custom header (V3.5.1, IT-21). */
export async function authenticate(deps: Pick<Deps, 'database'>, sessionToken: string | null, csrfHeader: string | null, stateChanging: boolean): Promise<StaffPrincipal> {
  if (!sessionToken) throw new AuthError('no_session');
  const s = await resolvers.session(deps.database, sha256(sessionToken));
  if (!s || !s.user_id || !s.account_id) throw new AuthError('no_session');
  if (stateChanging) checkCsrf(s.csrf_token_hash, csrfHeader);
  await touchSession(deps, sessionToken);
  return { userId: s.user_id, accountId: s.account_id, role: s.role as 'owner' | 'manager' };
}

/** Stores the first response for an Idempotency-Key and replays it (TRD 5.1). */
export async function withIdempotency(tx: Tx, accountId: string, key: string | null, route: string, fn: () => Promise<{ status: number; body: unknown }>): Promise<{ status: number; body: unknown; replayed: boolean }> {
  if (!key) return { ...(await fn()), replayed: false };
  const [prev] = await tx.select().from(tables.idempotencyKeys).where(and(eq(tables.idempotencyKeys.accountId, accountId), eq(tables.idempotencyKeys.key, key), eq(tables.idempotencyKeys.route, route)));
  if (prev) return { status: prev.responseStatus, body: prev.responseBody, replayed: true };
  const res = await fn();
  await tx.insert(tables.idempotencyKeys).values({ accountId, key, route, responseStatus: res.status, responseBody: res.body as object });
  return { ...res, replayed: false };
}

/** POST /api/incidents/:id/ack from the app (EP-5: a person of the account). */
export async function ackIncidentFromApp(tx: Tx, deps: Deps, p: StaffPrincipal, incidentId: string, expectedVersion?: number): Promise<AckResult> {
  const [inc] = await tx.select({ id: tables.incidents.id }).from(tables.incidents).where(eq(tables.incidents.id, incidentId));
  if (!inc) throw new NotFoundError('incident');
  const esc = await paging(tx, incidentId);
  if (!esc) return { ok: false, reason: 'already_acknowledged' };
  return acknowledge(tx, deps, p.accountId, { escalationId: esc.id, userId: p.userId, via: 'app', ...(expectedVersion !== undefined ? { expectedVersion } : {}) });
}

/** UR-6: only a signed-in owner or manager lowers a tier, with a reason; audited. A paging escalation is acknowledged by that person first. */
export async function downgradeIncident(tx: Tx, deps: Deps, p: StaffPrincipal, input: { incidentId: string; tier: Tier; reason: string; expectedVersion: number }): Promise<{ version: number }> {
  if (p.role !== 'owner' && p.role !== 'manager') throw new ForbiddenError('role');
  if (!input.reason || input.reason.trim().length < 3) throw new ConflictError('reason_required');
  const now = deps.clock.now();
  await tx.execute(sql`select id from incidents where id = ${input.incidentId} for update`);
  const [inc] = await tx.select().from(tables.incidents).where(eq(tables.incidents.id, input.incidentId));
  if (!inc) throw new NotFoundError('incident');
  if (inc.version !== input.expectedVersion) throw new ConflictError('version_conflict');
  if (!(tierRank(input.tier) < tierRank(inc.tier as Tier))) throw new ConflictError('not_lower');
  const esc = await paging(tx, inc.id);
  if (esc) await acknowledge(tx, deps, p.accountId, { escalationId: esc.id, userId: p.userId, via: 'app' });
  const reqs = await tx.select().from(tables.requests).where(and(eq(tables.requests.incidentId, inc.id), inArray(tables.requests.incidentLinkState, ['own', 'suggested', 'confirmed'])));
  for (const r of reqs) {
    if (tierRank(r.tier as Tier) <= tierRank(input.tier)) continue;
    await tx.insert(tables.classifications).values({ accountId: p.accountId, requestId: r.id, kind: 'human', proposedTier: input.tier, status: 'ok', actorUserId: p.userId, reason: input.reason, createdAt: now });
    await tx.update(tables.requests).set({ tier: input.tier, tierSource: 'human', updatedAt: now, version: sql`${tables.requests.version} + 1` }).where(eq(tables.requests.id, r.id));
  }
  const [u] = await tx
    .update(tables.incidents)
    .set({ tier: input.tier, state: 'downgraded', downgradeReason: input.reason, outcome: 'downgraded', outcomeBy: p.userId, outcomeAt: now, updatedAt: now, version: sql`${tables.incidents.version} + 1` })
    .where(eq(tables.incidents.id, inc.id))
    .returning({ version: tables.incidents.version });
  if (!u) throw new ConflictError('version_conflict');
  await tx.update(tables.escalations).set({ nextDueAt: null }).where(and(eq(tables.escalations.incidentId, inc.id), eq(tables.escalations.state, 'acknowledged')));
  await audit(tx, { accountId: p.accountId, actorKind: 'user', actorId: p.userId, action: 'incident.downgraded', objectType: 'incident', objectId: inc.id, before: { tier: inc.tier }, after: { tier: input.tier }, reason: input.reason }, now);
  return u;
}

/** GET /a/:token: minimal data only (street address, hazard class, tier; TRD 8.1). */
export async function describeAckToken(deps: Deps, token: string): Promise<{ address: string | null; hazardClass: string; tier: string; acknowledged: boolean } | null> {
  const cap = await resolvers.capability(deps.database, sha256(token));
  if (!cap || cap.purpose !== 'ack' || !cap.escalation_step_id || cap.expires_at.getTime() <= deps.clock.now().getTime()) return null;
  return withAccount(deps.database, cap.account_id, async (tx) => {
    const [step] = await tx.select().from(tables.escalationSteps).where(eq(tables.escalationSteps.id, cap.escalation_step_id!));
    if (!step) return null;
    const [esc] = await tx.select().from(tables.escalations).where(eq(tables.escalations.id, step.escalationId));
    const v = await incidentView(tx, esc!.incidentId);
    return { address: v.address, hazardClass: v.hazardClass, tier: v.tier, acknowledged: esc!.state === 'acknowledged' };
  });
}

/** POST /a/:token: acknowledges as the person that step paged (MH-06). */
export async function ackByToken(deps: Deps, token: string): Promise<AckResult | null> {
  const cap = await resolvers.capability(deps.database, sha256(token));
  // A used or revoked link (security round item 1: disabling a user revokes their links) never acts.
  if (!cap || cap.purpose !== 'ack' || !cap.escalation_step_id || !cap.user_id || cap.used_at || cap.expires_at.getTime() <= deps.clock.now().getTime()) return null;
  return withAccount(deps.database, cap.account_id, async (tx) => {
    const [step] = await tx.select().from(tables.escalationSteps).where(eq(tables.escalationSteps.id, cap.escalation_step_id!));
    if (!step) return null;
    const r = await acknowledge(tx, deps, cap.account_id, { escalationId: step.escalationId, userId: cap.user_id!, via: 'link', stepId: step.id });
    await tx.update(tables.capabilityTokens).set({ usedAt: deps.clock.now() }).where(eq(tables.capabilityTokens.tokenHash, sha256(token)));
    return r;
  });
}

/** POST /webhooks/twilio/voice-ack: "1" acknowledges the step that placed the call; an operator's "1" records "engaged". */
export async function ackByVoice(deps: Deps, callSid: string, digits: string): Promise<AckResult | { ok: true; engaged: true } | null> {
  if (digits.trim() !== '1') return null;
  const ob = await resolvers.outbound(deps.database, callSid);
  if (!ob) return null;
  return withAccount(deps.database, ob.account_id, async (tx) => {
    const [m] = await tx.select().from(tables.outboundMessages).where(eq(tables.outboundMessages.id, ob.outbound_message_id));
    if (!m?.escalationStepId || m.purpose !== 'page_voice') return null;
    const [step] = await tx.select().from(tables.escalationSteps).where(eq(tables.escalationSteps.id, m.escalationStepId));
    if (!step) return null;
    if (step.targetOperatorId) {
      await operatorEngaged(tx, deps, ob.account_id, step.escalationId, step.targetOperatorId);
      return { ok: true as const, engaged: true as const };
    }
    if (!step.targetUserId) return null;
    return acknowledge(tx, deps, ob.account_id, { escalationId: step.escalationId, userId: step.targetUserId, via: 'voice', stepId: step.id });
  });
}

/** EP-5: the operator records that a named person of the account accepted by phone; that person is the acknowledger. */
export async function operatorRelayAck(tx: Tx, deps: Deps, accountId: string, input: { escalationId: string; operatorId: string; accountUserId: string }): Promise<AckResult> {
  const [u] = await tx.select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.id, input.accountUserId));
  if (!u) throw new NotFoundError('user');
  return acknowledge(tx, deps, accountId, { escalationId: input.escalationId, userId: u.id, via: 'operator_relay', relayedByOperatorId: input.operatorId });
}

/** DU-5 / HI-13 "Separate problem": the suggested request becomes its own incident with its own escalation. Reports are never deleted. */
export async function rejectSuggestion(tx: Tx, deps: Deps, accountId: string, input: { requestId: string; userId: string }): Promise<{ incidentId: string }> {
  const now = deps.clock.now();
  const [r] = await tx.select().from(tables.requests).where(eq(tables.requests.id, input.requestId));
  if (!r) throw new NotFoundError('request');
  if (r.incidentLinkState !== 'suggested' && r.incidentLinkState !== 'confirmed') throw new ConflictError('not_linked');
  const [old] = await tx.select().from(tables.incidents).where(eq(tables.incidents.id, r.incidentId!));
  const [inc] = await tx
    .insert(tables.incidents)
    .values({ accountId, propertyId: old?.propertyId ?? null, hazardClass: old?.hazardClass ?? 'unknown', tier: r.tier, createdAt: now, updatedAt: now })
    .returning({ id: tables.incidents.id });
  await tx.update(tables.requests).set({ incidentId: inc!.id, incidentLinkState: 'own', updatedAt: now, version: sql`${tables.requests.version} + 1` }).where(eq(tables.requests.id, r.id));
  await audit(tx, { accountId, actorKind: 'user', actorId: input.userId, action: 'incident.suggestion_rejected', objectType: 'request', objectId: r.id, before: { incident_id: r.incidentId }, after: { incident_id: inc!.id } }, now);
  await startEscalation(tx, deps, accountId, inc!.id, 'new_incident', { requestId: r.id });
  return { incidentId: inc!.id };
}

/** DU-4(d): only a human marks an incident building-wide. */
export async function markBuildingWide(tx: Tx, deps: Deps, accountId: string, input: { incidentId: string; userId: string }): Promise<void> {
  const now = deps.clock.now();
  const r = await tx.update(tables.incidents).set({ buildingWide: true, buildingWideSetBy: input.userId, updatedAt: now, version: sql`${tables.incidents.version} + 1` }).where(eq(tables.incidents.id, input.incidentId)).returning({ id: tables.incidents.id });
  if (!r[0]) throw new NotFoundError('incident');
  await audit(tx, { accountId, actorKind: 'user', actorId: input.userId, action: 'incident.building_wide', objectType: 'incident', objectId: input.incidentId }, now);
}
