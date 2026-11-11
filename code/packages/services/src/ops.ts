// Operator actions on dead jobs (fix round 2; reviewer note on round 2): `/readyz` stays red while any job is dead,
// so an operator must be able to retry or clear it. Role `operator` only, anti-forgery token, reason required, audited
// in the job's account. Clearing a job never leaves a request undecided: the decision sweep still covers it (B1-001).
import { and, eq, resolvers, tables } from '@fixtriage/db';
import { sha256 } from '@fixtriage/platform';
import { timingSafeEqual } from 'node:crypto';
import { audit, ConflictError, NotFoundError, withAccount, type Deps } from './context';
import { AuthError } from './staff';

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
  if (stateChanging) {
    const got = csrfHeader ? sha256(csrfHeader) : null;
    if (!got || got.length !== s.csrf_token_hash.length || !timingSafeEqual(got, s.csrf_token_hash)) throw new AuthError('csrf');
  }
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

/** `requeue`: back to `queued` with attempts reset, due now. `dismiss`: state `dismissed`. */
export async function actOnDeadJob(deps: Deps, op: OperatorPrincipal, input: { jobId: string; action: 'requeue' | 'dismiss'; reason: string }): Promise<{ state: string }> {
  if (!input.reason || input.reason.trim().length < 3) throw new ConflictError('reason_required');
  const r = await deps.database.pool.query('select account_id from dead_jobs where id = $1', [input.jobId]);
  const accountId = r.rows[0]?.account_id as string | undefined;
  if (!accountId) throw new NotFoundError('dead_job');
  return withAccount(deps.database, accountId, async (tx) => {
    const now = deps.clock.now();
    const next = input.action === 'requeue' ? 'queued' : 'dismissed';
    const upd = await tx
      .update(tables.jobs)
      .set(input.action === 'requeue' ? { state: next, attempts: 0, runAt: now, lastError: null } : { state: next, finishedAt: now })
      .where(and(eq(tables.jobs.id, input.jobId), eq(tables.jobs.state, 'dead')))
      .returning({ id: tables.jobs.id, kind: tables.jobs.kind });
    if (!upd[0]) throw new NotFoundError('dead_job');
    await audit(tx, { accountId, actorKind: 'operator', actorId: op.operatorId, action: `job.${input.action}`, objectType: 'job', objectId: input.jobId, after: { state: next, kind: upd[0].kind }, reason: input.reason }, now);
    return { state: next };
  });
}
