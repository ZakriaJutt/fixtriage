// Regression tests for review fixtriage-b1-round3.md: B1-011 (an inbound message is never lost with its dead job;
// /readyz covers stored messages without a request) and the B1-003 round-3 net (EP-10a URGENT prompt and reply).
import { beforeEach, describe, expect, it } from 'vitest';
import { tables } from '@fixtriage/db';
import { approveDispatch, materialiseRequest, processDueJobs, processOutbox, readiness, sha256Hex, withAccount } from '@fixtriage/services';
import { drain, harness, owner, pagesTo, q, resetData, runFor, seedAccount, seedOperators, seedOperatorSession, seedSession, sms, staffCall, type Harness, type Seeded } from '../../../test/helpers';

let h: Harness;
let s: Seeded;
let ops: { primary: string; backup: string };
const MIN = 60_000;
const NIGHT = '2027-02-04T06:30:00Z'; // Wed 23:30 local
const DAY = '2027-02-03T22:00:00Z'; // Wed 15:00 local
async function fresh(iso: string) {
  await resetData();
  ops = await seedOperators();
  h = harness(iso);
  h.deps.classifyTimeoutMs = 50;
  s = await seedAccount(h.deps.database);
  h.classifier.answer = { tier: 'routine', trade: 'general', confidence: 0.99, missingFields: [] };
}
const reqs = () => q<{ id: string; tier: string; tier_source: string; incident_id: string | null }>('select id, tier, tier_source, incident_id from requests order by created_at');
const tenant = () => s.tenants['204'].mobile;
async function killJob(kind: string): Promise<string> {
  await owner((c) => c.query(`update jobs set state = 'dead', attempts = 5, last_error = 'Error' where kind = $1 and state = 'queued'`, [kind]));
  const [j] = await q<{ id: string }>(`select id from jobs where kind = $1 and state = 'dead'`, [kind]);
  return j!.id;
}
async function dismiss(id: string) {
  const op = await seedOperatorSession(ops.primary);
  return staffCall(h, 'POST', `/ops/jobs/${id}/dismiss`, op, { reason: 'cleared in test' });
}

describe('B1-011: dismissing a dead intake or classify job materialises the request first', () => {
  it('23:30 "gas smell in the hallway", intake job dead, operator dismisses: request life_safety, Level 1 paged, /readyz green', async () => {
    await fresh(NIGHT);
    h.classifier.mode = 'down';
    await sms(h, s, tenant(), 'gas smell in the hallway');
    await processOutbox(h.deps);
    const id = await killJob('intake.process');
    expect(await reqs()).toEqual([]);
    const res = await dismiss(id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; request_id: string };
    expect(body.state).toBe('dismissed');
    const [r] = await reqs();
    expect(body.request_id).toBe(r!.id);
    expect(r).toMatchObject({ tier: 'life_safety', tier_source: 'rule' });
    expect(r!.incident_id).not.toBeNull();
    await runFor(h, 2 * MIN);
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
    const ready = await readiness(h.deps);
    expect(ready.checks.dead_jobs!.ok).toBe(true);
    expect(ready.checks.inbound_without_request!.ok).toBe(true);
    const [a] = await q<{ after: { request_id: string; materialised: string } }>(`select after from audit_events where action = 'job.dismiss'`);
    expect(a!.after).toMatchObject({ request_id: r!.id, materialised: 'intake' });
  });

  it('after hours, a message with no rule hit and the model down: decided uncertain on dismissal and paged at once', async () => {
    await fresh(NIGHT);
    h.classifier.mode = 'down';
    await sms(h, s, tenant(), 'my landlord reference letter please');
    const id = await killJob('intake.process');
    expect((await dismiss(id)).status).toBe(200);
    expect((await reqs())[0]).toMatchObject({ tier: 'uncertain', tier_source: 'uncertainty' });
    await drain(h.deps);
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
  });

  it('a dead classify job of a pending request: dismissal decides it uncertain at once (no 30 s wait) and pages after hours', async () => {
    await fresh(NIGHT);
    h.classifier.mode = 'down';
    await sms(h, s, tenant(), 'my landlord reference letter please');
    await processDueJobs(h.deps); // intake only (safety loop); the classify job is still queued
    expect((await reqs())[0]).toMatchObject({ tier_source: 'pending', incident_id: null });
    const id = await killJob('classify');
    expect((await dismiss(id)).status).toBe(200);
    expect((await reqs())[0]!.tier).toBe('uncertain');
    await drain(h.deps);
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
  });

  it('business hours: dismissal opens an uncertain request that pages Level 1 at 15 minutes (EP-8)', async () => {
    await fresh(DAY);
    await sms(h, s, tenant(), 'can someone fix the blinds');
    const id = await killJob('intake.process');
    expect((await dismiss(id)).status).toBe(200);
    expect((await reqs())[0]).toMatchObject({ tier: 'uncertain', tier_source: 'uncertainty' });
    await runFor(h, 10 * MIN, { jobs: false });
    expect(pagesTo(h, s.phones.lee)).toHaveLength(0);
    await runFor(h, 6 * MIN, { jobs: false });
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
  });

  it('if the intake keeps failing, a minimal request is created from the rules alone and pages', async () => {
    await fresh(NIGHT);
    await sms(h, s, tenant(), 'gas smell in the hallway');
    const [m] = await q<{ id: string }>('select id from inbound_messages');
    const out = await withAccount(h.deps.database, s.accountId, (tx) =>
      materialiseRequest(tx, h.deps, s.accountId, m!.id, async () => {
        throw new Error('IntakeBroken');
      }),
    );
    expect(out.via).toBe('minimal');
    expect((await reqs())[0]).toMatchObject({ tier: 'life_safety', tier_source: 'rule' });
    await drain(h.deps, { jobs: false });
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
  });
});

describe('B1-011: /readyz stays red while a stored message has no request', () => {
  it('a job cleared outside the route (no materialisation): red after 60 s, green once the request exists', async () => {
    await fresh(NIGHT);
    await sms(h, s, tenant(), 'gas smell in the hallway');
    await owner((c) => c.query(`update jobs set state = 'dismissed' where kind = 'intake.process'`));
    expect((await readiness(h.deps)).checks.inbound_without_request!.ok).toBe(true); // within the bound
    h.clock.advance(61_000);
    const red = await readiness(h.deps);
    expect(red.ok).toBe(false);
    expect(red.checks.inbound_without_request).toMatchObject({ ok: false });
    const [m] = await q<{ id: string }>('select id from inbound_messages');
    await withAccount(h.deps.database, s.accountId, (tx) => materialiseRequest(tx, h.deps, s.accountId, m!.id));
    expect((await readiness(h.deps)).checks.inbound_without_request!.ok).toBe(true);
  });

  it('carrier keywords and a vendor dispatch reply have no request and do not turn /readyz red', async () => {
    await fresh('2027-02-04T09:30:00Z');
    h.classifier.mode = 'down';
    await sms(h, s, tenant(), 'pipe burst under the sink');
    await drain(h.deps);
    const session = await seedSession(s.sam);
    const [inc] = await q<{ id: string }>('select id from incidents');
    expect((await staffCall(h, 'POST', `/api/incidents/${inc!.id}/ack`, session, {})).status).toBe(200);
    const TEXT = 'Emergency: burst pipe at unit 204. Reply YES within 10 minutes.';
    await withAccount(h.deps.database, s.accountId, async (tx) => {
      const [wo] = await tx.insert(tables.workOrders).values({ accountId: s.accountId, incidentId: inc!.id, unitId: s.units['204'], trade: 'plumbing', tier: 'urgent', summary: 'Burst pipe' }).returning();
      return approveDispatch(tx, h.deps, s.accountId, { workOrderId: wo!.id, vendorId: s.vendors.plumbA, body: TEXT, bodySha256: sha256Hex(TEXT), userId: s.sam, expectedVersion: 1 });
    });
    await drain(h.deps);
    await sms(h, s, s.vendorPhones.plumbA, 'YES');
    await sms(h, s, s.tenants['305'].mobile, 'STOP');
    await sms(h, s, s.tenants['305'].mobile, 'HELP');
    await runFor(h, 2 * MIN);
    expect(await q(`select handled_as from inbound_messages where from_address = $1`, [s.vendorPhones.plumbA])).toEqual([{ handled_as: 'vendor_reply' }]);
    expect((await readiness(h.deps)).checks.inbound_without_request!.ok).toBe(true);
  });
});

describe('EP-10a URGENT net (lead ruling pending owner confirmation)', () => {
  const prompts = () => h.messaging.sentTo(tenant()).filter((m) => m.body.includes('reply URGENT'));
  beforeEach(() => fresh(NIGHT));

  it('the first after-hours message gets the safety reply carrying the URGENT line; a later one gets the fixed prompt', async () => {
    await sms(h, s, tenant(), 'the blinds in the bedroom are broken');
    await drain(h.deps);
    const first = h.messaging.sentTo(tenant());
    expect(first.find((m) => m.body.includes('911'))!.body).toContain('If this is an emergency (flood, no heat, gas, fire, no power, locked out), reply URGENT');
    await runFor(h, 5 * MIN);
    await sms(h, s, tenant(), 'also the closet door is off its track');
    await drain(h.deps);
    expect(prompts()).toHaveLength(2);
    const [o] = await q<{ template_id: string }>(`select template_id from outbound_messages where purpose = 'urgent_prompt'`);
    expect(o!.template_id).toBe('tenant.urgent_prompt');
    expect(pagesTo(h, s.phones.lee)).toHaveLength(0); // model routine, no candidate: nobody paged yet
  });

  it('no prompt when the message already pages, or in business hours', async () => {
    await sms(h, s, tenant(), 'the blinds in the bedroom are broken');
    await drain(h.deps);
    await sms(h, s, tenant(), 'and now there is no heat');
    await drain(h.deps);
    expect(await q(`select count(*)::int as n from outbound_messages where purpose = 'urgent_prompt'`)).toEqual([{ n: 0 }]);
    await fresh(DAY);
    await sms(h, s, tenant(), 'the blinds in the bedroom are broken');
    await sms(h, s, tenant(), 'also the closet door is off its track');
    await drain(h.deps);
    expect(await q(`select count(*)::int as n from outbound_messages where purpose = 'urgent_prompt'`)).toEqual([{ n: 0 }]);
  });

  it('a tenant who sent STOP gets no prompt by SMS and is still paged as cannot-text (FD-7)', async () => {
    await sms(h, s, tenant(), 'STOP');
    await drain(h.deps);
    await sms(h, s, tenant(), 'the blinds in the bedroom are broken');
    await drain(h.deps);
    await sms(h, s, tenant(), 'also the closet door is off its track');
    await drain(h.deps);
    expect(await q(`select count(*)::int as n from outbound_messages where purpose = 'urgent_prompt' and channel = 'sms'`)).toEqual([{ n: 0 }]);
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
  });

  it.each(['URGENT', 'urgent', 'Urgent!', 'urgent.', '  URGENT  ', 'urgnet', 'URGANT', 'its urgent', 'yes urgent please', 'EMERGENCY', 'emergancy'])(
    'a reply "%s" after the model said routine pages Level 1 at once as urgent',
    async (reply) => {
      await sms(h, s, tenant(), 'the blinds in the bedroom are broken');
      await drain(h.deps);
      expect((await reqs())[0]!.tier).toBe('routine');
      expect(pagesTo(h, s.phones.lee)).toHaveLength(0);
      await runFor(h, 3 * MIN);
      await sms(h, s, tenant(), reply);
      await drain(h.deps);
      const [r] = await reqs();
      expect(r).toMatchObject({ tier: 'urgent', tier_source: 'rule' });
      expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
    },
  );

  it('a reply URGENT after the 30-minute threading window opens a new urgent request and pages', async () => {
    await sms(h, s, tenant(), 'the blinds in the bedroom are broken');
    await drain(h.deps);
    await runFor(h, 40 * MIN);
    await sms(h, s, tenant(), 'URGENT');
    await drain(h.deps);
    const rs = await reqs();
    expect(rs).toHaveLength(2);
    expect(rs[1]).toMatchObject({ tier: 'urgent', tier_source: 'rule' });
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
  });
});
