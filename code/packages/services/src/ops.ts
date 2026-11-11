// Operator actions on dead jobs (fix round 2; reviewer note on round 2): `/readyz` stays red while any job is dead,
// so an operator must be able to retry or clear it. Role `operator` only, anti-forgery token, reason required, audited
// in the job's account. B1-011: an inbound message is never lost with its job. Clearing a dead intake or classify job
// first materialises the request from the stored message and runs the deterministic rules (materialiseRequest); a
// job whose message would still have no request cannot be cleared (409), only requeued.
import { and, eq, resolvers, tables } from '@fixtriage/db';
import { sha256 } from '@fixtriage/platform';
import { audit, ConflictError, NotFoundError, withAccount, type Deps } from './context';
import { materialiseRequest } from './intake';
import { AuthError, checkCsrf, touchSession } from './staff';

export interface OperatorPrincipal {
  operatorId: string;
}

export class OperatorOnlyError extends Error {
  override name = 'OperatorOnlyError';
}

export async function authenticateOperator(deps: Pick<Deps, 'database'>, sessionToken: string | null, csrfHeader: string | null, stateChanging: boolean): Promise<OperatorPrincipal> {
  if (!sessionToken) throw new AuthError('no_session');
  const s = await resolvers.session(deps.database, sha256(sessionToken));
  if (!s) throw new AuthError('no_session');
  if (!s.operator_id || s.role !== 'operator') throw new OperatorOnlyError('operator role required');
  if (stateChanging) checkCsrf(s.csrf_token_hash, csrfHeader);
  await touchSession(deps, sessionToken);
  return { operatorId: s.operator_id };
}

export interface DeadJob {
  id: string;
  account_id: string;
  kind: string;
  attempts: number;
  last_error: string | null;
  created_at: Date;
}

export async function listDeadJobs(deps: Pick<Deps, 'database'>): Promise<DeadJob[]> {
  const r = await deps.database.pool.query('select id, account_id, kind, attempts, last_error, created_at from dead_jobs order by created_at limit 200');
  return r.rows;
}

/**
 * `requeue`: back to `queued` with attempts reset, due now. `dismiss`: for an intake or classify job, the request is
 * materialised first (converted), then the job is `dismissed`; both in one transaction.
 */
export async function actOnDeadJob(deps: Deps, op: OperatorPrincipal, input: { jobId: string; action: 'requeue' | 'dismiss'; reason: string }): Promise<{ state: string; request_id?: string | null }> {
  if (!input.reason || input.reason.trim().length < 3) throw new ConflictError('reason_required');
  const r = await deps.database.pool.query('select account_id from dead_jobs where id = $1', [input.jobId]);
  const accountId = r.rows[0]?.account_id as string | undefined;
  if (!accountId) throw new NotFoundError('dead_job');
  return withAccount(deps.database, accountId, async (tx) => {
    const now = deps.clock.now();
    const next = input.action === 'requeue' ? 'queued' : 'dismissed';
    let materialised: { requestId: string | null; via: string } | null = null;
    if (input.action === 'dismiss') {
      const j = (await tx.select({ kind: tables.jobs.kind, payload: tables.jobs.payload }).from(tables.jobs).where(and(eq(tables.jobs.id, input.jobId), eq(tables.jobs.state, 'dead'))))[0];
      if (!j) throw new NotFoundError('dead_job');
      const inboundId = (j.payload as { inboundId?: string } | null)?.inboundId;
      if ((j.kind === 'intake.process' || j.kind === 'classify') && inboundId) {
        materialised = await materialiseRequest(tx, deps, accountId, inboundId);
        const [left] = await tx.select({ requestId: tables.inboundMessages.requestId, keyword: tables.inboundMessages.keyword, handledAs: tables.inboundMessages.handledAs }).from(tables.inboundMessages).where(eq(tables.inboundMessages.id, inboundId));
        if (left && !left.requestId && left.keyword !== 'stop' && !left.handledAs) throw new ConflictError('inbound_without_request');
      }
    }
    const upd = await tx
      .update(tables.jobs)
      .set(input.action === 'requeue' ? { state: next, attempts: 0, runAt: now, lastError: null } : { state: next, finishedAt: now })
      .where(and(eq(tables.jobs.id, input.jobId), eq(tables.jobs.state, 'dead')))
      .returning({ id: tables.jobs.id, kind: tables.jobs.kind });
    if (!upd[0]) throw new NotFoundError('dead_job');
    await audit(tx, { accountId, actorKind: 'operator', actorId: op.operatorId, action: `job.${input.action}`, objectType: 'job', objectId: input.jobId, after: { state: next, kind: upd[0].kind, ...(materialised ? { request_id: materialised.requestId, materialised: materialised.via } : {}) }, reason: input.reason }, now);
    return materialised ? { state: next, request_id: materialised.requestId } : { state: next };
  });
}
