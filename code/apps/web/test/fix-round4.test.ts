// Regression tests for review fixtriage-b1-round4.md: B1-012 (HELP and other intercepted keywords are never
// consumed; only STOP is) and the B1-003 net (an undelivered URGENT line escalates the request; never silent).
import { describe, expect, it } from 'vitest';
import { readiness } from '@fixtriage/services';
import { drain, harness, owner, pagesTo, q, resetData, runFor, seedAccount, seedOperators, sms, type Harness, type Seeded } from '../../../test/helpers';

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
  h.classifier.answer = { tier: 'routine', trade: 'general', confidence: 0.99, missingFields: [] };
}
const reqs = () => q<{ tier: string; tier_source: string; cannot_text: boolean; incident_id: string | null }>('select tier, tier_source, cannot_text, incident_id from requests order by created_at');

describe('B1-012: HELP is never consumed as a carrier keyword', () => {
  it('first message "HELP" at 23:30: request uncertain, safety reply sent, Level 1 paged within 1 minute', async () => {
    await fresh(NIGHT);
    await sms(h, s, s.tenants['204'].mobile, 'HELP');
    await runFor(h, 1 * MIN);
    expect(await q('select keyword from inbound_messages')).toEqual([{ keyword: 'help' }]);
    expect((await reqs())[0]).toMatchObject({ tier: 'uncertain', tier_source: 'uncertainty' });
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
    expect(h.messaging.sentTo(s.tenants['204'].mobile).some((m) => m.body.includes('911'))).toBe(true);
    expect(await q(`select reason from classifications where kind = 'rule'`)).toEqual([{ reason: 'help_keyword' }]);
  });

  it.each(['help', 'HELP!', 'HELP!!!', 'Help me', 'please help', 'INFO', 'sos'])('"%s" as the reply to a routine message after hours pages at once', async (reply) => {
    await fresh(NIGHT);
    await sms(h, s, s.tenants['204'].mobile, 'the blinds in the bedroom are broken');
    await drain(h.deps);
    expect(pagesTo(h, s.phones.lee)).toHaveLength(0);
    await runFor(h, 2 * MIN);
    await sms(h, s, s.tenants['204'].mobile, reply);
    await drain(h.deps);
    expect((await reqs())[0]!.tier).toBe('uncertain');
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
  });

  it('business hours: HELP is uncertain and pages Level 1 at 15 minutes (EP-8)', async () => {
    await fresh(DAY);
    await sms(h, s, s.tenants['204'].mobile, 'HELP');
    await runFor(h, 10 * MIN);
    expect((await reqs())[0]).toMatchObject({ tier: 'uncertain' });
    expect(pagesTo(h, s.phones.lee)).toHaveLength(0);
    await runFor(h, 6 * MIN);
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
  });

  it('START records the opt-in and still creates a request; STOP keeps the existing design (no request)', async () => {
    await fresh(DAY);
    await sms(h, s, s.tenants['204'].mobile, 'STOP');
    await drain(h.deps);
    expect(await reqs()).toEqual([]);
    await sms(h, s, s.tenants['204'].mobile, 'START');
    await drain(h.deps);
    expect(await reqs()).toHaveLength(1);
    expect(await q(`select action from audit_events where action like 'tenant.sms_opt_%' order by created_at`)).toEqual([{ action: 'tenant.sms_opt_out' }, { action: 'tenant.sms_opt_in' }]);
    h.clock.advance(2 * MIN);
    expect((await readiness(h.deps)).checks.inbound_without_request!.ok).toBe(true);
  });

  it('/readyz turns red when a HELP row has no request after 60 s', async () => {
    await fresh(NIGHT);
    await sms(h, s, s.tenants['204'].mobile, 'HELP');
    await owner((c) => c.query(`update jobs set state = 'dismissed' where kind = 'intake.process'`));
    h.clock.advance(61_000);
    expect((await readiness(h.deps)).checks.inbound_without_request!.ok).toBe(false);
  });
});

describe('B1-003 net: an undelivered URGENT line escalates the request (failing fake provider)', () => {
  const tenant305 = () => s.tenants['305'].mobile; // no email on file
  async function expectEscalated() {
    const [r] = await reqs();
    expect(r).toMatchObject({ tier: 'uncertain', tier_source: 'uncertainty', cannot_text: true });
    expect(r!.incident_id).not.toBeNull();
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
    expect((await q(`select count(*)::int as n from audit_events where action = 'request.urgent_line_undelivered'`))[0]).toEqual({ n: 1 });
  }

  it('after-hours safety reply (first message) rejected by the carrier every time: uncertain, cannot-text, paged', async () => {
    await fresh(NIGHT);
    h.messaging.script((r) => r.body.includes('reply URGENT'), 'reject', 50);
    await sms(h, s, tenant305(), 'the blinds in the bedroom are broken');
    await runFor(h, 5 * MIN);
    await expectEscalated();
    expect((await q(`select count(*)::int as n from audit_events where action = 'tenant.unreachable'`))[0]).toEqual({ n: 1 });
  });

  it('tenant.urgent_prompt (second message) rejected every time: the routine request is raised and paged', async () => {
    await fresh(NIGHT);
    h.messaging.script((r) => r.body.startsWith('We received your message. The office is closed now.'), 'reject', 50);
    await sms(h, s, tenant305(), 'the dryer is noisy');
    await runFor(h, 5 * MIN);
    expect((await reqs())[0]!.tier).toBe('routine');
    expect(pagesTo(h, s.phones.lee)).toHaveLength(0);
    await sms(h, s, tenant305(), 'the blinds in the bedroom are broken');
    await runFor(h, 5 * MIN);
    await expectEscalated();
  });

  it('number blocked at the provider (invalid or opted out at the carrier, 21610): escalated on the first failure', async () => {
    await fresh(NIGHT);
    h.messaging.blockedSms.add(tenant305());
    await sms(h, s, tenant305(), 'the blinds in the bedroom are broken');
    await drain(h.deps);
    await expectEscalated();
  });

  it('a delivery-status "undelivered" after "sent" escalates too', async () => {
    await fresh(NIGHT);
    await sms(h, s, tenant305(), 'the blinds in the bedroom are broken');
    await drain(h.deps);
    expect(pagesTo(h, s.phones.lee)).toHaveLength(0);
    const m = h.messaging.sentTo(tenant305()).find((x) => x.body.includes('reply URGENT'))!;
    const { applyDeliveryStatus } = await import('@fixtriage/services');
    await applyDeliveryStatus(h.deps, m.providerMessageId, 'undelivered');
    await drain(h.deps);
    await expectEscalated();
  });

  it('business hours: a failed standard safety reply keeps FD-5 (unreachable flag) and is not an URGENT-line escalation', async () => {
    await fresh(DAY);
    h.messaging.blockedSms.add(tenant305());
    await sms(h, s, tenant305(), 'the blinds in the bedroom are broken');
    await drain(h.deps);
    expect((await q(`select count(*)::int as n from audit_events where action = 'request.urgent_line_undelivered'`))[0]).toEqual({ n: 0 });
  });
});
