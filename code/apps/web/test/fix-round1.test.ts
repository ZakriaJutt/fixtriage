// Regression tests for review fixtriage-b1-round1.md (B1-001 .. B1-009). Each case failed before the fix.
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { tables, withAccount } from '@fixtriage/db';
import { checkTimezoneData } from '@fixtriage/platform';
import { afterHours, ingestInbound, processClassifyJobs, processDueJobs, processOutbox, readiness, sweepUndecided, type Deps } from '@fixtriage/services';
import { safetyPass, startWorker } from '../../worker/src/worker';
import { drain, harness, owner, pagesTo, q, resetData, runFor, seedAccount, seedOperators, sms, twilioPost, call, type Harness, type Seeded } from '../../../test/helpers';

let h: Harness;
let s: Seeded;
const MIN = 60_000;
const NIGHT = '2027-02-04T06:30:00Z'; // Wed 23:30 local
const DAY = '2027-02-03T22:00:00Z'; // Wed 15:00 local
async function fresh(iso: string) {
  await resetData();
  await seedOperators();
  h = harness(iso);
  h.deps.classifyTimeoutMs = 50;
  s = await seedAccount(h.deps.database);
}
const reqs = () => q<{ tier: string; tier_source: string; incident_id: string | null }>('select tier, tier_source, incident_id from requests order by created_at');

describe('B1-001 / B1-006: an undecided after-hours request always escalates', () => {
  beforeEach(() => fresh(NIGHT));
  it.each([12, Number.POSITIVE_INFINITY, 1.5, -1])('model confidence %s is malformed: uncertain, Level 1 paged, no dead job', async (confidence) => {
    h.classifier.answer = { tier: 'routine', trade: 'general', confidence, missingFields: [] };
    await sms(h, s, s.tenants['204'].mobile, 'the cabinet door in my kitchen is loose');
    await runFor(h, 2 * MIN);
    const [r] = await reqs();
    expect(r).toMatchObject({ tier: 'uncertain', tier_source: 'uncertainty' });
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
    expect(await q(`select id from jobs where state = 'dead'`)).toHaveLength(0);
  });
  it('the classify job never runs (died, dead or stuck): the 30 s decision deadline makes it uncertain and pages', async () => {
    await sms(h, s, s.tenants['204'].mobile, 'the cabinet door in my kitchen is loose');
    await processDueJobs(h.deps); // intake only
    await owner((c) => c.query(`update jobs set state = 'dead' where kind = 'classify'`));
    h.clock.advance(31_000);
    await sweepUndecided(h.deps);
    await processOutbox(h.deps);
    const [r] = await reqs();
    expect(r).toMatchObject({ tier: 'uncertain', tier_source: 'uncertainty' });
    expect(r!.incident_id).not.toBeNull();
    expect(pagesTo(h, s.phones.lee).length).toBe(2);
    const ready = await readiness(h.deps);
    expect(ready.ok).toBe(false);
    expect(ready.checks.dead_jobs!.ok).toBe(false);
  });
  it('before the deadline nothing is decided by the sweep; a stuck sweep makes /readyz red', async () => {
    await sms(h, s, s.tenants['204'].mobile, 'the cabinet door in my kitchen is loose');
    await processDueJobs(h.deps);
    h.clock.advance(20_000);
    await sweepUndecided(h.deps);
    expect((await reqs())[0]!.tier_source).toBe('pending');
    h.clock.advance(100_000); // sweep never ran: undecided item 90 s overdue
    const ready = await readiness(h.deps);
    expect(ready.checks.due_undecided!.ok).toBe(false);
  });
  it('business hours: undecided becomes uncertain at 30 s and pages Level 1 at 15 min (EP-8)', async () => {
    h.clock.set(DAY);
    await sms(h, s, s.tenants['204'].mobile, 'the cabinet door in my kitchen is loose');
    await processDueJobs(h.deps);
    await owner((c) => c.query(`update jobs set state = 'done' where kind = 'classify'`)); // model never answers
    h.clock.advance(31_000);
    await sweepUndecided(h.deps);
    await processOutbox(h.deps);
    expect((await reqs())[0]).toMatchObject({ tier: 'uncertain', incident_id: null });
    expect(pagesTo(h, s.phones.lee)).toHaveLength(0);
    await runFor(h, 15 * MIN, { jobs: false });
    const [esc] = await q<{ trigger: string }>('select trigger from escalations');
    expect(esc!.trigger).toBe('uncertain_timeout');
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
  });
});

describe('B1-002: safety replies and pages never wait behind model calls', () => {
  beforeEach(() => fresh(NIGHT));
  it('a backlog of classify jobs on a model that ignores AbortSignal does not delay the gas reply or the page', async () => {
    let calls = 0;
    h.deps.classifier = { provider: 'fake', model: 'ignores-abort', promptVersion: 'p0', classify: () => { calls++; return new Promise(() => {}); } };
    for (let i = 0; i < 8; i++) await sms(h, s, `+1604555${3000 + i}`, 'the cabinet door is loose');
    await processDueJobs(h.deps); // intake jobs: 8 classify jobs queued
    const modelRunner = processClassifyJobs(h.deps, { concurrency: 2, hardTimeoutMs: 1_500 }); // runs alongside, not awaited
    await sms(h, s, s.tenants['305'].mobile, 'gas smell in the hallway');
    const t0 = Date.now();
    await safetyPass(h.deps, { lastTick: 0, lastWatch: 0 }, { tickMs: 15_000, dispatchWatchMs: 30_000 }, Date.now());
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(2_000);
    const toTenant = h.messaging.sentTo(s.tenants['305'].mobile);
    expect(toTenant.some((m) => m.body.includes('911') && m.body.includes('gas'))).toBe(true);
    expect(pagesTo(h, s.phones.lee).some((m) => m.body.includes('LIFE_SAFETY'))).toBe(true);
    // the model runner itself returns within its hard timeout even though the client never settles
    const t1 = Date.now();
    await modelRunner;
    expect(Date.now() - t1).toBeLessThan(10_000);
    expect(calls).toBeGreaterThan(0);
  }, 30_000);
  it('processDueJobs never runs a model job', async () => {
    h.classifier.mode = 'hang';
    await sms(h, s, s.tenants['204'].mobile, 'cabinet loose');
    await processDueJobs(h.deps);
    await processDueJobs(h.deps);
    expect(h.classifier.calls).toBe(0);
    await processClassifyJobs(h.deps);
    expect(h.classifier.calls).toBe(2);
  });
});

describe('B1-003: emergency phrasings page by rules even when the model says routine', () => {
  beforeEach(() => fresh(NIGHT));
  it.each(['my heat doesnt work', "my heat doesn't work", 'gass smell', 'my neighbour fell and cant get up', 'window smashed cant secure unit', 'water heater leaking everywhere', 'furnace won t start'])(
    '"%s" at 23:30 with model routine 0.95 is paged',
    async (text) => {
      h.classifier.answer = { tier: 'routine', trade: 'general', confidence: 0.95, missingFields: [] };
      await sms(h, s, s.tenants['204'].mobile, text);
      await drain(h.deps);
      const [r] = await reqs();
      expect(['urgent', 'life_safety']).toContain(r!.tier);
      expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
    },
  );
});

describe('B1-004: messages to an unknown destination are stored and alerted', () => {
  beforeEach(() => fresh(NIGHT));
  it('email to the account address in another case is routed', async () => {
    const r = await ingestInbound(h.deps, { provider: 'postmark', kind: 'email', providerMessageId: `pm-${randomUUID()}`, to: s.emailAddress.toUpperCase(), from: 't204@example.test', body: 'gas smell in the hallway', mediaCount: 0, receivedAt: h.clock.now(), correlationId: 'c' });
    expect(r.status).toBe('stored'); // also: a malformed correlation ID is replaced, never fatal
  });
  it('SMS to an unknown number: recorded (metadata only), /readyz red, Twilio answered 200', async () => {
    const res = await twilioPost(h, '/webhooks/twilio/sms', { MessageSid: 'SMunrouted0001', From: s.tenants['204'].mobile, To: '+16045559999', Body: 'gas smell', NumMedia: '0' });
    expect(res.status).toBe(200);
    const rows = await q<Record<string, unknown>>('select * from unrouted_inbound');
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(['cleared_at', 'cleared_by_operator_id', 'created_at', 'id', 'kind', 'provider', 'provider_message_id', 'received_at', 'to_address']);
    const ready = await readiness(h.deps);
    expect(ready.checks.unrouted_inbound!.ok).toBe(false);
    // a provider retry of the same message does not duplicate it
    await twilioPost(h, '/webhooks/twilio/sms', { MessageSid: 'SMunrouted0001', From: s.tenants['204'].mobile, To: '+16045559999', Body: 'gas smell', NumMedia: '0' });
    expect(await q('select id from unrouted_inbound')).toHaveLength(1);
  });
  it('Postmark to an unknown address: recorded and answered 503 so that Postmark retries', async () => {
    const { POSTMARK_SECRET } = await import('../../../test/helpers');
    const req = new Request('http://internal/webhooks/postmark/inbound', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': POSTMARK_SECRET }, body: JSON.stringify({ MessageID: 'pm-unrouted-1', From: 'x@example.test', To: 'nobody@in.fixtriage.example', TextBody: 'hello' }) });
    const res = await call(h, 'POST', '/webhooks/postmark/inbound', req);
    expect(res.status).toBe(503);
    expect(await q(`select kind from unrouted_inbound`)).toEqual([{ kind: 'email' }]);
  });
});

describe('B1-005: building-wide never suppresses a life_safety report', () => {
  beforeEach(() => fresh(NIGHT));
  it('acknowledged building-wide fire; unit 305 reports smoke 5 min later: escalation reopened, Level 1 paged', async () => {
    h.classifier.mode = 'down';
    await sms(h, s, s.tenants['204'].mobile, 'there is a fire in the hallway');
    await drain(h.deps);
    const [inc] = await q<{ id: string }>('select id from incidents');
    const [esc] = await q<{ id: string }>('select id from escalations');
    const { acknowledge, markBuildingWide } = await import('@fixtriage/services');
    await withAccount(h.deps.database, s.accountId, (tx) => acknowledge(tx, h.deps, s.accountId, { escalationId: esc!.id, userId: s.lee, via: 'app' }));
    await withAccount(h.deps.database, s.accountId, (tx) => markBuildingWide(tx, h.deps, s.accountId, { incidentId: inc!.id, userId: s.lee }));
    const before = pagesTo(h, s.phones.lee).length;
    h.clock.advance(5 * MIN);
    await sms(h, s, s.tenants['305'].mobile, 'fire alarm and smoke on our floor');
    await drain(h.deps);
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(before);
    expect((await q<{ trigger: string }>(`select trigger from escalations where state = 'paging'`))[0]!.trigger).toBe('new_unit_report');
  });
});

describe('B1-007: the worker checks in only after completed loop passes', () => {
  it('a stuck safety loop stops the check-ins', async () => {
    await fresh(NIGHT);
    const checkIns: number[] = [];
    let block: (() => void) | null = null;
    const deps: Deps = { ...h.deps, messaging: { ...h.messaging, send: () => new Promise((_, rej) => (block = () => rej(new Error('released')))), lookup: async () => null } as never };
    const w = startWorker(deps, { pollMs: 20, tickMs: 15_000, dispatchWatchMs: 30_000, checkInMs: 30, monitor: { checkIn: async () => void checkIns.push(Date.now()) } });
    await new Promise((r) => setTimeout(r, 300));
    expect(checkIns.length).toBeGreaterThan(0);
    await sms(h, s, s.tenants['204'].mobile, 'hello'); // its safety reply makes the outbox send hang
    await new Promise((r) => setTimeout(r, 400));
    const n = checkIns.length;
    await new Promise((r) => setTimeout(r, 800));
    expect(checkIns.length).toBe(n); // silent while stuck: the external monitor will alert
    (block as (() => void) | null)?.();
    await w.stop();
  }, 30_000);
});

describe('B1-008: tz database guard', () => {
  it('this runtime passes; older tzdata or a UTC-8 winter offset fails', () => {
    expect(checkTimezoneData().ok).toBe(true);
    expect(checkTimezoneData('2025b').ok).toBe(false);
    expect(checkTimezoneData('2026e', () => -480).ok).toBe(false);
  });
});

describe('B1-009: account calendars are validated on write and evaluated defensively', () => {
  beforeEach(() => fresh(NIGHT));
  it('an unknown time zone or malformed business hours is refused by the database', async () => {
    const bad = async (patch: Record<string, unknown>) =>
      withAccount(h.deps.database, s.accountId, (tx) => tx.update(tables.accounts).set(patch as never));
    await expect(bad({ timezone: 'Mars/Olympus_Mons' })).rejects.toThrow();
    await expect(bad({ businessHours: { mon: [['17:00', '09:00']] } })).rejects.toThrow();
    await expect(bad({ businessHours: { funday: [] } })).rejects.toThrow();
    await expect(bad({ businessHours: { mon: [['09:00', '17:00']] } })).resolves.toBeDefined();
  });
  it('a calendar that cannot be evaluated counts as after hours', () => {
    const acc = { id: s.accountId, name: 'x', ackTimeoutSeconds: 300, emergencyContactPhone: null, gasEmergencyPhone: '+18006639911', calendar: { timezone: 'Nowhere/Invalid', hours: {}, holidays: [] } };
    expect(afterHours(acc, new Date())).toBe(true);
  });
});

describe('B1-001: the view due_undecided mirrors the EP constants', () => {
  it('30 s decision deadline and 15 min triage timer', async () => {
    const { EP } = await import('@fixtriage/core');
    const [v] = await q<{ d: string }>(`select pg_get_viewdef('due_undecided') as d`);
    expect(EP.decisionDeadlineSeconds).toBe(30);
    expect(EP.uncertainTriageSeconds).toBe(900);
    expect(v!.d).toContain("'00:00:30'");
    expect(v!.d).toContain("'00:15:00'");
  });
});
