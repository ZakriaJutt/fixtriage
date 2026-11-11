// Regression tests for review fixtriage-b1-round2.md: B1-003 residue (burst variants, safety-candidate floor) and the
// operator route that clears or retries dead jobs so /readyz can return to green.
import { beforeEach, describe, expect, it } from 'vitest';
import { readiness } from '@fixtriage/services';
import { drain, harness, owner, pagesTo, q, resetData, seedAccount, seedOperators, seedOperatorSession, seedSession, sms, staffCall, type Harness, type Seeded } from '../../../test/helpers';

let h: Harness;
let s: Seeded;
let ops: { primary: string; backup: string };
const NIGHT = '2027-02-04T06:30:00Z'; // Wed 23:30 local
const DAY = '2027-02-03T22:00:00Z'; // Wed 15:00 local
async function fresh(iso: string) {
  await resetData();
  ops = await seedOperators();
  h = harness(iso);
  h.deps.classifyTimeoutMs = 50;
  s = await seedAccount(h.deps.database);
  h.classifier.answer = { tier: 'routine', trade: 'plumbing', confidence: 0.95, missingFields: [] };
}
const reqs = () => q<{ tier: string; tier_source: string; incident_id: string | null }>('select tier, tier_source, incident_id from requests order by created_at');

describe('B1-003 residue: burst variants reach urgent by rules (rule set v3)', () => {
  beforeEach(() => fresh(NIGHT));
  it.each(['pipe bursted under the sink', 'the pipe has bursted', 'pipes busted', 'water main broke'])('"%s" after hours with model routine 0.95: urgent and paged', async (text) => {
    await sms(h, s, s.tenants['204'].mobile, text);
    await drain(h.deps);
    expect((await reqs())[0]).toMatchObject({ tier: 'urgent', tier_source: 'rule' });
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
  });
});

describe('safety candidate: a model "routine" cannot suppress it after hours', () => {
  beforeEach(() => fresh(NIGHT));
  it.each(['something weird with the gas meter', 'small leak under the sink', 'heat is kinda weak tonight'])('"%s" (no rule tier) at 23:30, model routine 0.95: uncertain and Level 1 paged', async (text) => {
    await sms(h, s, s.tenants['204'].mobile, text);
    await drain(h.deps);
    const [r] = await reqs();
    expect(r).toMatchObject({ tier: 'uncertain', tier_source: 'uncertainty' });
    expect(r!.incident_id).not.toBeNull();
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
    expect(await q(`select reason from classifications where kind = 'rule'`)).toEqual([{ reason: 'safety_candidate' }]);
  });
  it('the same text in business hours may be decided routine by the model (no after-hours floor)', async () => {
    h.clock.set(DAY);
    await sms(h, s, s.tenants['204'].mobile, 'small leak under the sink');
    await drain(h.deps);
    expect((await reqs())[0]!.tier).toBe('routine');
  });
  it('a non-candidate routine text after hours is still decided by the model and pages nobody', async () => {
    await sms(h, s, s.tenants['204'].mobile, 'the cabinet door in my kitchen is loose');
    await drain(h.deps);
    expect((await reqs())[0]!.tier).toBe('routine');
    expect(pagesTo(h, s.phones.lee)).toHaveLength(0);
  });
});

describe('operator route for dead jobs', () => {
  beforeEach(() => fresh(NIGHT));
  async function deadJob(): Promise<string> {
    await sms(h, s, s.tenants['204'].mobile, 'no heat');
    await drain(h.deps);
    const [j] = await q<{ id: string }>(`select id from jobs where kind = 'classify'`);
    await owner((c) => c.query(`update jobs set state = 'dead', last_error = 'Error' where id = $1`, [j!.id]));
    expect((await readiness(h.deps)).checks.dead_jobs!.ok).toBe(false);
    return j!.id;
  }
  it('staff and anonymous callers are refused; an operator without the anti-forgery token is refused', async () => {
    const id = await deadJob();
    const staff = await seedSession(s.ownerId);
    expect((await staffCall(h, 'GET', '/ops/jobs/dead', staff)).status).toBe(403);
    expect((await staffCall(h, 'POST', `/ops/jobs/${id}/dismiss`, staff, { reason: 'test' })).status).toBe(403);
    expect((await staffCall(h, 'GET', '/ops/jobs/dead', null)).status).toBe(401);
    const op = await seedOperatorSession(ops.primary);
    expect((await staffCall(h, 'POST', `/ops/jobs/${id}/dismiss`, op, { reason: 'test' }, { omitCsrf: '1' })).status).toBe(403);
    expect((await q(`select state from jobs where id = $1`, [id]))[0]).toEqual({ state: 'dead' });
  });
  it('an operator lists, requeues with a reason (audited) and /readyz returns to green', async () => {
    const id = await deadJob();
    const op = await seedOperatorSession(ops.primary);
    const list = await (await staffCall(h, 'GET', '/ops/jobs/dead', op)).json();
    expect(list.jobs.map((j: { id: string }) => j.id)).toEqual([id]);
    expect(Object.keys(list.jobs[0]).sort()).toEqual(['account_id', 'attempts', 'created_at', 'id', 'kind', 'last_error']);
    expect((await staffCall(h, 'POST', `/ops/jobs/${id}/requeue`, op, { reason: '' })).status).toBe(409);
    expect((await staffCall(h, 'POST', `/ops/jobs/${id}/requeue`, op, { reason: 'model provider recovered' })).status).toBe(200);
    expect((await readiness(h.deps)).checks.dead_jobs!.ok).toBe(true);
    const [a] = await q<{ actor_kind: string; actor_id: string; reason: string }>(`select actor_kind, actor_id, reason from audit_events where action = 'job.requeue'`);
    expect(a).toEqual({ actor_kind: 'operator', actor_id: ops.primary, reason: 'model provider recovered' });
    await drain(h.deps);
    expect((await q(`select state from jobs where id = $1`, [id]))[0]).toEqual({ state: 'done' });
  });
  it('dismiss clears it too; acting on a job that is not dead is not found', async () => {
    const id = await deadJob();
    const op = await seedOperatorSession(ops.backup);
    expect((await staffCall(h, 'POST', `/ops/jobs/${id}/dismiss`, op, { reason: 'duplicate of a done job' })).status).toBe(200);
    expect((await q(`select state from jobs where id = $1`, [id]))[0]).toEqual({ state: 'dismissed' });
    expect((await readiness(h.deps)).checks.dead_jobs!.ok).toBe(true);
    expect((await staffCall(h, 'POST', `/ops/jobs/${id}/requeue`, op, { reason: 'again' })).status).toBe(404);
  });
});
