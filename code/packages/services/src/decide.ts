// B1-001: the deterministic backstop for undecided requests, independent of the classify job's fate.
// Runs in the safety loop with the escalation tick over view `due_undecided`:
// - a `pending` request not decided 30 s after receipt (classify budget 20 s plus margin) becomes `uncertain`
//   (UR-3: model error or timeout) and then follows EP-8;
// - an `uncertain` or cannot-text request after hours pages at once; in business hours it pages Level 1 at 15 min.
import { EP } from '@fixtriage/core';
import { sql, poll, tables, eq, type Tx } from '@fixtriage/db';
import { audit, serviceLog, withAccount, type Deps } from './context';
import { ensureIncident, escalationNeed } from './intake';

export const DECISION_DEADLINE_SECONDS = EP.decisionDeadlineSeconds;

export async function decideOverdue(tx: Tx, deps: Deps, accountId: string, requestId: string): Promise<void> {
  const now = deps.clock.now();
  const lock = await tx.execute(sql`select id from requests where id = ${requestId} for update skip locked`);
  if (!lock.rows.length) return;
  let [r] = await tx.select().from(tables.requests).where(eq(tables.requests.id, requestId));
  if (!r || r.incidentId || r.state === 'closed') return;
  if (r.tierSource === 'pending') {
    if (now.getTime() < r.openedAt.getTime() + DECISION_DEADLINE_SECONDS * 1000) return;
    [r] = await tx.update(tables.requests).set({ tier: 'uncertain', tierSource: 'uncertainty', updatedAt: now, version: sql`${tables.requests.version} + 1` }).where(eq(tables.requests.id, requestId)).returning();
    await audit(tx, { accountId, actorKind: 'system', action: 'request.decision_deadline', objectType: 'request', objectId: requestId, after: { tier: 'uncertain' } }, now);
    serviceLog.warn('request.decision_deadline', { request_id: requestId });
  }
  const need = escalationNeed(r!);
  if (need === 'now') await ensureIncident(tx, deps, accountId, r!, 'unknown', r!.openedAt, 'new_incident');
  else if (need === 'triage_timer' && now.getTime() >= r!.openedAt.getTime() + EP.uncertainTriageSeconds * 1000) await ensureIncident(tx, deps, accountId, r!, 'unknown', r!.openedAt, 'uncertain_timeout');
}

/** One pass of the sweep; part of the safety loop (never behind model calls). */
export async function sweepUndecided(deps: Deps, limit = 100): Promise<number> {
  const due = await poll(deps.database, 'due_undecided', deps.clock.now(), limit);
  for (const d of due) await withAccount(deps.database, d.account_id, (tx) => decideOverdue(tx, deps, d.account_id, d.id));
  return due.length;
}
