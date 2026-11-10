// IT-12 failed emergency dispatch reopens the escalation; IT-13 unknown send status: pages re-sent, dispatches not;
// IT-19 vendor silent 10 min at 02:30, approver asleep: chain up to the operators; acknowledgement; EP-11a after 45 min.
import { beforeEach, describe, expect, it } from 'vitest';
import { approveDispatch, processOutbox, sha256Hex, withAccount } from '@fixtriage/services';
import { tables } from '@fixtriage/db';
import { drain, harness, OPERATOR_PHONES, pagesTo, q, resetData, runFor, seedAccount, seedOperators, seedSession, sms, staffCall, twilioPost, type Harness, type Seeded } from '../../../test/helpers';

let h: Harness;
let s: Seeded;
const MIN = 60_000;
const T0 = Date.parse('2027-02-04T09:30:00Z'); // Thu 02:30 local
beforeEach(async () => {
  await resetData();
  await seedOperators();
  h = harness(new Date(T0).toISOString());
  h.classifier.mode = 'down';
  s = await seedAccount(h.deps.database);
});

const TEXT = 'Emergency: burst pipe at unit 204. Reply YES within 10 minutes.';

/** An acknowledged burst-pipe incident with an approved emergency dispatch to Alpha Plumbing, approved by Sam. */
async function emergencyDispatched(): Promise<{ incidentId: string; dispatchId: string }> {
  await sms(h, s, s.tenants['204'].mobile, 'pipe burst under the sink');
  await drain(h.deps);
  const session = await seedSession(s.sam);
  const [inc] = await q<{ id: string }>('select id from incidents');
  expect((await staffCall(h, 'POST', `/api/incidents/${inc!.id}/ack`, session, {})).status).toBe(200);
  const r = await withAccount(h.deps.database, s.accountId, async (tx) => {
    const [wo] = await tx.insert(tables.workOrders).values({ accountId: s.accountId, incidentId: inc!.id, unitId: s.units['204'], trade: 'plumbing', tier: 'urgent', summary: 'Burst pipe' }).returning();
    return approveDispatch(tx, h.deps, s.accountId, { workOrderId: wo!.id, vendorId: s.vendors.plumbA, body: TEXT, bodySha256: sha256Hex(TEXT), userId: s.sam, expectedVersion: 1 });
  });
  await drain(h.deps);
  return { incidentId: inc!.id, dispatchId: r.dispatchId };
}

describe('IT-12 emergency dispatch undelivered', () => {
  it('reopens with trigger dispatch_failed; approver and Level 1 paged with the next vendor drafted; nothing to vendor 2', async () => {
    const { dispatchId } = await emergencyDispatched();
    const vendorMsg = h.messaging.sentTo(s.vendorPhones.plumbA)[0]!;
    const samBefore = pagesTo(h, s.phones.sam).length;
    const leeBefore = pagesTo(h, s.phones.lee).length;
    h.clock.advance(60_000);
    await twilioPost(h, '/webhooks/twilio/status', { MessageSid: vendorMsg.providerMessageId, MessageStatus: 'undelivered' });
    await processOutbox(h.deps);
    const escs = await q<{ trigger: string; state: string; dispatch_id: string | null }>('select trigger, state, dispatch_id from escalations order by created_at');
    expect(escs[1]).toEqual({ trigger: 'dispatch_failed', state: 'paging', dispatch_id: dispatchId });
    const samNew = pagesTo(h, s.phones.sam).slice(samBefore);
    const leeNew = pagesTo(h, s.phones.lee).slice(leeBefore);
    expect(samNew.length).toBe(2);
    expect(leeNew.length).toBe(2);
    expect(samNew.find((m) => m.channel === 'sms')!.body).toContain('Review next vendor: Beta Plumbing');
    expect(h.messaging.sentTo(s.vendorPhones.plumbB)).toHaveLength(0);
    expect(await q(`select id from outbound_messages where purpose = 'dispatch'`)).toHaveLength(1);
    // a second failure event for the same dispatch does not open a second escalation (unique per dispatch)
    await twilioPost(h, '/webhooks/twilio/status', { MessageSid: vendorMsg.providerMessageId, MessageStatus: 'failed' });
    expect(await q(`select id from escalations`)).toHaveLength(2);
  });
});

describe('IT-13 provider timeout on send', () => {
  it('a page whose send result is unknown and not found by lookup is sent again', async () => {
    h.messaging.script((r) => r.channel === 'sms' && r.to === s.phones.lee, 'timeout_then_lost');
    await sms(h, s, s.tenants['204'].mobile, 'no heat');
    await drain(h.deps);
    const [m] = await q<{ status: string }>(`select status from outbound_messages where purpose = 'page_sms'`);
    expect(m!.status).toBe('unknown');
    h.clock.advance(11_000);
    await processOutbox(h.deps); // lookup: not found -> back to pending
    await processOutbox(h.deps); // re-sent
    expect(h.messaging.sentTo(s.phones.lee).filter((x) => x.channel === 'sms')).toHaveLength(1);
    expect(h.messaging.attempts.filter((x) => x.channel === 'sms' && x.to === s.phones.lee)).toHaveLength(2);
  });
  it('a page whose send timed out but reached the provider is reconciled by lookup, not duplicated', async () => {
    h.messaging.script((r) => r.channel === 'sms' && r.to === s.phones.lee, 'timeout');
    await sms(h, s, s.tenants['204'].mobile, 'no heat');
    await drain(h.deps);
    h.clock.advance(11_000);
    await processOutbox(h.deps);
    const [m] = await q<{ status: string; provider_message_id: string | null }>(`select status, provider_message_id from outbound_messages where purpose = 'page_sms'`);
    expect(m!.status).toBe('sent');
    expect(m!.provider_message_id).not.toBeNull();
    expect(h.messaging.attempts.filter((x) => x.channel === 'sms' && x.to === s.phones.lee)).toHaveLength(1);
  });
  it('a dispatch whose send result is unknown is NOT re-sent and is shown as "delivery unknown"', async () => {
    h.messaging.script((r) => r.to === s.vendorPhones.plumbA, 'timeout_then_lost');
    await emergencyDispatched();
    h.clock.advance(11_000);
    await processOutbox(h.deps);
    await processOutbox(h.deps);
    expect(h.messaging.attempts.filter((x) => x.to === s.vendorPhones.plumbA)).toHaveLength(1);
    const [m] = await q<{ status: string; next_attempt_at: Date | null }>(`select status, next_attempt_at from outbound_messages where purpose = 'dispatch'`);
    expect(m).toEqual({ status: 'unknown', next_attempt_at: null });
    expect(await q(`select id from audit_events where action = 'dispatch.delivery_unknown'`)).toHaveLength(1);
  });
});

describe('IT-19 02:30 emergency dispatch, vendor silent', () => {
  it('approver and Level 1 at 0 and 2 min, Level 2 at 5, Level 3 at 10, operators from 15; Level 2 acknowledges; no outcome in 45 min reopens again', async () => {
    // the approver is Lee here so that the companion page is distinct from Level 2 (Sam)
    await sms(h, s, s.tenants['204'].mobile, 'pipe burst under the sink');
    await drain(h.deps);
    const leeSession = await seedSession(s.lee);
    const [inc] = await q<{ id: string }>('select id from incidents');
    await staffCall(h, 'POST', `/api/incidents/${inc!.id}/ack`, leeSession, {});
    const woId = await withAccount(h.deps.database, s.accountId, async (tx) => (await tx.insert(tables.workOrders).values({ accountId: s.accountId, incidentId: inc!.id, unitId: s.units['204'], trade: 'plumbing', tier: 'urgent', summary: 'Burst pipe' }).returning())[0]!.id);
    await staffCall(h, 'POST', `/api/work-orders/${woId}/approve-dispatch`, leeSession, { vendor_id: s.vendors.plumbA, body: TEXT, body_sha256: sha256Hex(TEXT), version: 1 });
    await drain(h.deps);
    const tDispatch = h.clock.now().getTime();
    await runFor(h, 10 * MIN + 30_000); // vendor silent: dispatch.watch fires at 10 min
    const [esc2] = await q<{ id: string; started_at: Date }>(`select id, started_at from escalations where trigger = 'dispatch_failed'`);
    expect(esc2).toBeDefined();
    const tFail = new Date(esc2!.started_at).getTime();
    expect(Math.round((tFail - tDispatch) / 1000)).toBeLessThanOrEqual(10 * 60 + 30);
    await runFor(h, 16 * MIN);
    const st = await q<{ m: number; level: number; role: string }>(
      `select round(extract(epoch from due_at - $1::timestamptz) / 60)::int as m, level, target_role as role from escalation_steps where escalation_id = $2 order by due_at, level, target_role`,
      [new Date(tFail), esc2!.id],
    );
    const sig = st.map((x) => `${x.m}:L${x.level}:${x.role}`);
    expect(sig.slice(0, 8)).toEqual(['0:L1:approver', '0:L1:oncall', '2:L1:approver', '2:L1:oncall', '5:L2:oncall', '7:L2:oncall', '10:L3:oncall', '12:L3:oncall']);
    expect(sig).toContain('15:L4:operator_primary');
    expect(h.messaging.sentTo(s.vendorPhones.plumbB)).toHaveLength(0);
    // Level 2 (Sam) acknowledges by link
    const samSms = pagesTo(h, s.phones.sam).filter((m) => m.channel === 'sms').pop()!;
    expect(samSms.body).toContain('Review next vendor: Beta Plumbing');
    const token = samSms.body.match(/\/a\/([A-Za-z0-9_-]+)/)![1]!;
    const { call } = await import('../../../test/helpers');
    expect((await call(h, 'POST', `/a/${token}`)).status).toBe(200);
    // no outcome (neither next vendor approved nor "phoned") for 45 min: reopened again with trigger no_outcome
    await runFor(h, 46 * MIN);
    const triggers = (await q<{ trigger: string }>('select trigger from escalations order by created_at')).map((x) => x.trigger);
    expect(triggers).toEqual(['new_incident', 'dispatch_failed', 'no_outcome']);
    expect(OPERATOR_PHONES.primary).toBeTruthy();
  });
  it('second case: vendor SMS undelivered starts the same chain at once', async () => {
    const { dispatchId } = await emergencyDispatched();
    const v = h.messaging.sentTo(s.vendorPhones.plumbA)[0]!;
    await twilioPost(h, '/webhooks/twilio/status', { MessageSid: v.providerMessageId, MessageStatus: 'undelivered' });
    const [d] = await q<{ result: string }>('select result from dispatches where id = $1', [dispatchId]);
    expect(d!.result).toBe('undelivered');
    expect(await q(`select id from escalations where trigger = 'dispatch_failed' and state = 'paging'`)).toHaveLength(1);
  });
});
