// Job runner over view `due_jobs` (replaces pg-boss in B1; AD-02 keeps PostgreSQL as the only store).
import { eq, poll, sql, tables } from '@fixtriage/db';
import { withCorrelation } from '@fixtriage/platform';
import { MODEL_JOB_KINDS, serviceLog, withAccount, type Deps, type JobKind } from './context';
import { CLASSIFY_TOTAL_MS, runClassifyJob } from './classify';
import { runIntakeJob, triageTimeout } from './intake';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;

/**
 * Safety loop jobs (intake, triage timeout). Model jobs are excluded unless asked for by kind: they run in
 * processClassifyJobs, which the worker drives in a separate loop (B1-002), so a slow or hung model never delays the
 * outbox (safety replies, pages) or the escalation tick.
 */
export async function processDueJobs(deps: Deps, opts: { kinds?: JobKind[]; limit?: number } = {}): Promise<number> {
  const due = await poll(deps.database, 'due_jobs', deps.clock.now(), opts.limit ?? 50, opts.kinds ? { include: opts.kinds } : { exclude: MODEL_JOB_KINDS });
  return runJobs(deps, due, opts.kinds);
}

/** Hard upper bound on one classify job enforced by the runner (TRD 6.3 budget 20 s plus margin). */
export const CLASSIFY_JOB_HARD_MS = CLASSIFY_TOTAL_MS + 5_000;

/** Classify runner: own concurrency, each job raced against a hard timeout the runner enforces (B1-002). */
export async function processClassifyJobs(deps: Deps, opts: { concurrency?: number; limit?: number; hardTimeoutMs?: number } = {}): Promise<number> {
  const due = await poll(deps.database, 'due_jobs', deps.clock.now(), opts.limit ?? 20, { include: MODEL_JOB_KINDS });
  const conc = Math.max(1, opts.concurrency ?? 4);
  let n = 0;
  for (let i = 0; i < due.length; i += conc) {
    const batch = due.slice(i, i + conc);
    const results = await Promise.all(batch.map((d) => runJobs(deps, [d], MODEL_JOB_KINDS, opts.hardTimeoutMs ?? CLASSIFY_JOB_HARD_MS)));
    n += results.reduce((a, b) => a + b, 0);
  }
  return n;
}

async function runJobs(deps: Deps, due: Array<{ id: string; account_id: string }>, kinds?: JobKind[], hardTimeoutMs?: number): Promise<number> {
  const opts = { kinds };
  let n = 0;
  for (const d of due) {
    const now = deps.clock.now();
    const job = await withAccount(deps.database, d.account_id, async (tx) => {
      const r = await tx.execute(sql`select id, kind, payload, attempts, correlation_id from jobs where id = ${d.id} and state = 'queued' and run_at <= ${now} for update skip locked`);
      const row = r.rows[0] as { id: string; kind: JobKind; payload: Record<string, string>; attempts: number; correlation_id: string } | undefined;
      if (!row || (opts.kinds && !opts.kinds.includes(row.kind))) return null;
      await tx.update(tables.jobs).set({ attempts: row.attempts + 1, runAt: new Date(now.getTime() + LEASE_MS) }).where(eq(tables.jobs.id, row.id));
      return row;
    });
    if (!job) continue;
    try {
      const work = withCorrelation(job.correlation_id, async () => {
        if (job.kind === 'intake.process') await runIntakeJob(deps, d.account_id, job.payload.inboundId!);
        else if (job.kind === 'classify') await runClassifyJob(deps, d.account_id, job.payload.inboundId!, job.payload.requestId!);
        else if (job.kind === 'triage.timeout') await withAccount(deps.database, d.account_id, (tx) => triageTimeout(tx, deps, d.account_id, job.payload.requestId!));
      });
      if (hardTimeoutMs) {
        let t: NodeJS.Timeout | undefined;
        await Promise.race([work, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error('JobHardTimeout')), hardTimeoutMs)))]).finally(() => clearTimeout(t));
      } else await work;
      await withAccount(deps.database, d.account_id, (tx) => tx.update(tables.jobs).set({ state: 'done', finishedAt: deps.clock.now() }).where(eq(tables.jobs.id, job.id)));
      n++;
    } catch (e) {
      const dead = job.attempts + 1 >= MAX_ATTEMPTS;
      serviceLog.error('job.failed', { job_id: job.id, kind: job.kind, dead, error: e instanceof Error ? e.name : 'unknown' });
      await withAccount(deps.database, d.account_id, (tx) =>
        tx.update(tables.jobs).set({ state: dead ? 'dead' : 'queued', lastError: e instanceof Error ? e.name : 'error', runAt: new Date(deps.clock.now().getTime() + 5_000 * (job.attempts + 1)) }).where(eq(tables.jobs.id, job.id)),
      );
    }
  }
  return n;
}
