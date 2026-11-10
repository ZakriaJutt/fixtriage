// IT-01: one stored message per provider ID. IT-02: safety reply within 60 s with the model down and the classify
// queue paused; sender window and rule-hit resend (MH-02, AD-05, DU-1).
import { beforeEach, describe, expect, it } from 'vitest';
import { drain, harness, q, resetData, seedAccount, sms, type Harness, type Seeded } from '../../../test/helpers';
import { processOutbox } from '@fixtriage/services';

let h: Harness;
let s: Seeded;
beforeEach(async () => {
  await resetData();
  h = harness('2027-02-03T22:00:00Z'); // Wed 15:00 local, business hours
  s = await seedAccount(h.deps.database);
});

describe('IT-01 idempotent ingest', () => {
  it('same Twilio payload twice 50 ms apart: one row, one safety reply, both 200', async () => {
    const sid = 'SMdupe000000000000000000000000001';
    const first = sms(h, s, s.tenants['204'].mobile, 'kitchen tap dripping', { sid });
    await new Promise((r) => setTimeout(r, 50));
    const second = sms(h, s, s.tenants['204'].mobile, 'kitchen tap dripping', { sid });
    const [a, b] = await Promise.all([first, second]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const rows = await q('select id from inbound_messages where provider_message_id = $1', [sid]);
    expect(rows).toHaveLength(1);
    const replies = await q(`select id from outbound_messages where purpose = 'safety_reply'`);
    expect(replies).toHaveLength(1);
    await drain(h.deps);
    expect(await q(`select id from requests`)).toHaveLength(1);
  });
  it('a forged webhook (bad signature) is refused and stores nothing', async () => {
    const { route } = await import('../src/handlers');
    const r = route(h.handlers, 'POST', '/webhooks/twilio/sms')!;
    const res = await r.handler(new Request('http://x/webhooks/twilio/sms', { method: 'POST', headers: { 'x-twilio-signature': 'forged' }, body: new URLSearchParams({ MessageSid: 'SMx', From: '+16045550142', To: s.smsNumber, Body: 'hi' }).toString() }), {});
    expect(res.status).toBe(403);
    expect(await q('select id from inbound_messages')).toHaveLength(0);
  });
});

describe('IT-02 safety reply independent of the model', () => {
  it('first reply within 60 s; none at 10 min; again at 20 min on a rule hit; again at 3 h', async () => {
    h.classifier.mode = 'down';
    const from = s.tenants['305'].mobile;
    const t0 = h.clock.now().getTime();
    await sms(h, s, from, 'there is a weird noise from the dishwasher');
    // classify queue paused: only the outbox runs.
    h.clock.advance(5_000);
    await processOutbox(h.deps);
    const replies = () => h.messaging.sent.filter((m) => m.to === from && m.body.includes('911'));
    expect(replies()).toHaveLength(1);
    const [row] = await q<{ created_at: Date }>(`select created_at from outbound_messages where purpose = 'safety_reply'`);
    expect(new Date(row!.created_at).getTime() - t0).toBeLessThanOrEqual(60_000);

    h.clock.set(t0 + 10 * 60_000);
    await sms(h, s, from, 'ok thanks');
    await processOutbox(h.deps);
    expect(replies()).toHaveLength(1);

    h.clock.set(t0 + 20 * 60_000);
    await sms(h, s, from, 'I smell gas');
    await processOutbox(h.deps);
    expect(replies()).toHaveLength(2);

    h.clock.set(t0 + 3 * 3600_000);
    await sms(h, s, from, 'still noisy');
    await processOutbox(h.deps);
    expect(replies()).toHaveLength(3);
    expect(h.classifier.calls).toBe(0); // the classify queue never ran
  });
  it('the purpose notice (with STOP line) is a separate second message, once per sender', async () => {
    const from = s.tenants['204'].mobile;
    await sms(h, s, from, 'hello');
    h.clock.advance(31 * 60_000);
    await sms(h, s, from, 'hello again');
    await processOutbox(h.deps);
    const toTenant = h.messaging.sent.filter((m) => m.to === from);
    expect(toTenant.map((m) => (m.body.includes('911') ? 'safety' : m.body.includes('STOP') ? 'notice' : 'other'))).toEqual(['safety', 'notice', 'safety']);
  });
});
