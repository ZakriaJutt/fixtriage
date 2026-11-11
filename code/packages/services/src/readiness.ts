// /readyz (TRD 5.1, 8.9): database, queue, storage, and the age of the oldest due escalation step, outbox row,
// dispatch check and job. Fails above 60 s so a running but stuck worker is visible to the external monitor.
import { healthCounts, oldestDue } from '@fixtriage/db';
import { checkTimezoneData } from '@fixtriage/platform';
import type { Deps } from './context';

export const READY_MAX_AGE_SECONDS = 60;

export interface Readiness {
  ok: boolean;
  checks: Record<string, { ok: boolean; age_seconds?: number | null }>;
}

export async function readiness(deps: Pick<Deps, 'database' | 'clock' | 'storage'>): Promise<Readiness> {
  const now = deps.clock.now();
  const checks: Readiness['checks'] = {};
  try {
    await deps.database.pool.query('select 1');
    checks.database = { ok: true };
    const oldest = await oldestDue(deps.database, now);
    for (const [k, v] of Object.entries(oldest)) {
      const age = v ? Math.round((now.getTime() - new Date(v).getTime()) / 1000) : null;
      checks[k] = { ok: age === null || age <= READY_MAX_AGE_SECONDS, age_seconds: age };
    }
    checks.queue = { ok: checks.due_jobs?.ok ?? false };
    // TRD 6.3 probe.run: a failed or unanswered platform probe makes readiness fail.
    const p = await deps.database.pool.query('select sent_at, received_at, ok from probe_runs order by sent_at desc limit 1');
    const last = p.rows[0] as { sent_at: Date; received_at: Date | null; ok: boolean | null } | undefined;
    const probeFailed = !!last && (last.ok === false || (last.received_at === null && now.getTime() - new Date(last.sent_at).getTime() > 5 * 60_000));
    checks.probe = { ok: !probeFailed };
    // B1-001: a dead job means some request may never be processed; B1-004: an unrouted message awaits an operator.
    const hc = await healthCounts(deps.database);
    checks.dead_jobs = { ok: hc.deadJobs === 0 };
    checks.unrouted_inbound = { ok: hc.unrouted === 0 };
    // B1-011: a stored message with no request (and no keyword or vendor-reply reason) beyond the age bound means a
    // tenant's report may be lost with its job; red until the request exists, whatever happened to the job.
    const orphanAge = hc.oldestWithoutRequest ? Math.round((now.getTime() - new Date(hc.oldestWithoutRequest).getTime()) / 1000) : null;
    checks.inbound_without_request = { ok: orphanAge === null || orphanAge <= READY_MAX_AGE_SECONDS, age_seconds: orphanAge };
  } catch {
    checks.database = { ok: false };
  }
  checks.tzdata = { ok: checkTimezoneData().ok }; // B1-008
  try {
    checks.storage = { ok: await deps.storage.ping() };
  } catch {
    checks.storage = { ok: false };
  }
  return { ok: Object.values(checks).every((c) => c.ok), checks };
}
