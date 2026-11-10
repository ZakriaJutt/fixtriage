// IT-06 worker restart mid-escalation; IT-07 both channels to Level 1 fail -> Level 2 at once (EP-4);
// IT-08 simultaneous keypress and link acknowledgement -> one wins.
import { beforeEach, describe, expect, it } from 'vitest';
import { processOutbox, tickEscalations } from '@fixtriage/services';
import { call, drain, harness, pagesTo, q, resetData, runFor, seedAccount, seedOperators, sms, twilioPost, type Harness, type Seeded } from '../../../test/helpers';

let h: Harness;
let s: Seeded;
const MIN = 60_000;
beforeEach(async () => {
  await resetData();
  await seedOperators();
  h = harness('2027-02-04T09:10:00Z'); // Thu 02:10 local
  h.classifier.mode = 'down';
  s = await seedAccount(h.deps.database);
});

async function steps(): Promise<string[]> {
  const r = await q<{ level: number; attempt: number; target_role: string; due_at: Date }>('select level, attempt, target_role, due_at from escalation_steps order by due_at, level, target_role');
  return r.map((x) => `L${x.level}.${x.attempt}${x.target_role === 'oncall' ? '' : ':' + x.target_role}`);
}

describe('IT-06 worker restart', () => {
  it('worker down for 90 s across the Level 2 due time: Level 2 paged once, nothing skipped or doubled', async () => {
    await sms(h, s, s.tenants['204'].mobile, 'no heat since last night, 2 kids');
    await drain(h.deps);
    await runFor(h, 4 * MIN); // worker alive until 4:00
    h.clock.advance(90_000); // worker dead 4:00-5:30 (no ticks)
    // two worker tasks restart at once (production runs two): row locks keep the step single
    await Promise.all([tickEscalations(h.deps), tickEscalations(h.deps)]);
    await processOutbox(h.deps);
    await runFor(h, 30_000);
    expect(await steps()).toEqual(['L1.1', 'L1.2', 'L2.1']);
    expect(pagesTo(h, s.phones.sam)).toHaveLength(2);
    const lateness = await q<{ late: number }>(`select extract(epoch from started_at - due_at)::int as late from escalation_steps where level = 2`);
    expect(lateness[0]!.late).toBeLessThanOrEqual(90);
  });
});

describe('IT-07 double delivery failure', () => {
  it('Level 1 SMS undelivered and call failed: Level 2 paged immediately', async () => {
    await sms(h, s, s.tenants['204'].mobile, 'water through the ceiling');
    await drain(h.deps);
    const l1 = h.messaging.sentTo(s.phones.lee);
    expect(l1.map((m) => m.channel).sort()).toEqual(['sms', 'voice']);
    h.clock.advance(20_000);
    const sid = l1.find((m) => m.channel === 'sms')!.providerMessageId;
    const call1 = l1.find((m) => m.channel === 'voice')!.providerMessageId;
    expect((await twilioPost(h, '/webhooks/twilio/status', { MessageSid: sid, MessageStatus: 'undelivered' })).status).toBe(200);
    expect(pagesTo(h, s.phones.sam)).toHaveLength(0);
    await twilioPost(h, '/webhooks/twilio/status', { CallSid: call1, CallStatus: 'failed' });
    await processOutbox(h.deps);
    expect(pagesTo(h, s.phones.sam)).toHaveLength(2);
    const [st] = await q<{ result: string }>(`select result from escalation_steps where level = 1 and attempt = 1`);
    expect(st!.result).toBe('delivery_failed');
    const [l2] = await q<{ due_at: Date }>(`select due_at from escalation_steps where level = 2`);
    expect(new Date(l2!.due_at).getTime() - Date.parse('2027-02-04T09:10:00Z')).toBe(20_000);
  });
  it('an unanswered call alone is not a delivery failure (TRD 6.2)', async () => {
    await sms(h, s, s.tenants['204'].mobile, 'water through the ceiling');
    await drain(h.deps);
    const l1 = h.messaging.sentTo(s.phones.lee);
    await twilioPost(h, '/webhooks/twilio/status', { CallSid: l1.find((m) => m.channel === 'voice')!.providerMessageId, CallStatus: 'no-answer' });
    await twilioPost(h, '/webhooks/twilio/status', { MessageSid: l1.find((m) => m.channel === 'sms')!.providerMessageId, MessageStatus: 'undelivered' });
    await processOutbox(h.deps);
    expect(pagesTo(h, s.phones.sam)).toHaveLength(0);
  });
});

describe('IT-08 simultaneous acknowledgement', () => {
  it('keypress and link POST within 100 ms: one acknowledgement, the second gets "already acknowledged"', async () => {
    await sms(h, s, s.tenants['204'].mobile, 'flooding in the bathroom');
    await drain(h.deps);
    const lee = h.messaging.sentTo(s.phones.lee);
    const link = lee.find((m) => m.channel === 'sms')!.body.match(/\/a\/([A-Za-z0-9_-]+)/)![1]!;
    const callSid = lee.find((m) => m.channel === 'voice')!.providerMessageId;
    const voice = twilioPost(h, '/webhooks/twilio/voice-ack', { CallSid: callSid, Digits: '1' });
    await new Promise((r) => setTimeout(r, 30));
    const web = call(h, 'POST', `/a/${link}`);
    const [v, w] = await Promise.all([voice, web]);
    const vt = await v.text();
    const wj = w.status;
    const acks = await q<{ acknowledged_by: string; acknowledged_via: string }>(`select acknowledged_by, acknowledged_via from escalations where state = 'acknowledged'`);
    expect(acks).toHaveLength(1);
    expect(acks[0]!.acknowledged_by).toBe(s.lee);
    const outcomes = [vt.includes('already') ? 'second' : 'first', wj === 409 ? 'second' : 'first'].sort();
    expect(outcomes).toEqual(['first', 'second']);
    // tenant told once
    await processOutbox(h.deps);
    expect(h.messaging.sentTo(s.tenants['204'].mobile).filter((m) => m.body.startsWith('A manager has your report'))).toHaveLength(1);
  });
});
