// IT-09 forward-only status and unknown IDs; IT-18 STOP then a message at 23:00; IT-20 second unit's report pages.
import { beforeEach, describe, expect, it } from 'vitest';
import { processOutbox, retryPendingStatusEvents, withAccount } from '@fixtriage/services';
import { eq, tables } from '@fixtriage/db';
import { drain, harness, pagesTo, q, resetData, runFor, seedAccount, seedOperators, seedSession, sms, staffCall, twilioPost, type Harness, type Seeded } from '../../../test/helpers';

let h: Harness;
let s: Seeded;
const MIN = 60_000;
beforeEach(async () => {
  await resetData();
  await seedOperators();
  h = harness('2027-02-04T06:00:00Z'); // Wed 23:00 local
  h.classifier.mode = 'down';
  s = await seedAccount(h.deps.database);
});

describe('IT-09 delivery status events', () => {
  it('failed then delivered stays failed (recorded); a status for an unknown ID is stored and applied when the ID appears', async () => {
    await sms(h, s, s.tenants['204'].mobile, 'cabinet hinge is loose');
    await processOutbox(h.deps);
    const reply = h.messaging.sentTo(s.tenants['204'].mobile)[0]!;
    await twilioPost(h, '/webhooks/twilio/status', { MessageSid: reply.providerMessageId, MessageStatus: 'failed' });
    const r = await twilioPost(h, '/webhooks/twilio/status', { MessageSid: reply.providerMessageId, MessageStatus: 'delivered' });
    expect(await r.json()).toEqual({ result: 'recorded' });
    const [m] = await q<{ status: string }>('select status from outbound_messages where provider_message_id = $1', [reply.providerMessageId]);
    expect(m!.status).toBe('failed');
    const evs = await q<{ after: { status: string; applied: boolean } }>(`select after from audit_events where action = 'outbound.status' order by created_at`);
    expect(evs.map((e) => e.after)).toEqual([{ status: 'failed', applied: true }, { status: 'delivered', applied: false }]);

    const early = await twilioPost(h, '/webhooks/twilio/status', { MessageSid: 'SMnotyetknown0001', MessageStatus: 'delivered' });
    expect(await early.json()).toEqual({ result: 'stored_unknown' });
    expect(await q('select id from pending_status_events')).toHaveLength(1);
    // the ID becomes known (e.g. the send result committed after the callback)
    await withAccount(h.deps.database, s.accountId, (tx) => tx.update(tables.outboundMessages).set({ providerMessageId: 'SMnotyetknown0001', status: 'sent', statusRank: 2 }).where(eq(tables.outboundMessages.purpose, 'notice')));
    expect(await retryPendingStatusEvents(h.deps)).toBe(1);
    const [n] = await q<{ status: string }>(`select status from outbound_messages where purpose = 'notice'`);
    expect(n!.status).toBe('delivered');
    expect(await q('select id from pending_status_events')).toHaveLength(0);
  });
});

describe('IT-18 tenant who sent STOP', () => {
  it('no text attempted; safety reply by email; needs-triage "cannot be texted"; Level 1 paged; START restores texting', async () => {
    const tenant = s.tenants['204'];
    await sms(h, s, tenant.mobile, 'STOP');
    h.messaging.blockedSms.add(tenant.mobile); // what the carrier does (error 21610)
    await drain(h.deps);
    expect(h.messaging.attempts.filter((m) => m.to === tenant.mobile)).toHaveLength(0);
    h.clock.advance(5 * MIN);
    await sms(h, s, tenant.mobile, 'sink dripping');
    await drain(h.deps);
    expect(h.messaging.attempts.filter((m) => m.to === tenant.mobile)).toHaveLength(0);
    const email = h.messaging.sentTo(tenant.email!);
    expect(email).toHaveLength(1);
    expect(email[0]!.channel).toBe('email');
    expect(email[0]!.body).toContain('911');
    const [r] = await q<{ cannot_text: boolean; incident_id: string | null }>('select cannot_text, incident_id from requests');
    expect(r!.cannot_text).toBe(true);
    expect(r!.incident_id).not.toBeNull();
    const leePage = pagesTo(h, s.phones.lee).find((m) => m.channel === 'sms')!;
    expect(leePage.body).toContain('Tenant cannot be texted: phone the tenant.');
    // pages to staff unaffected; acknowledgement notice to the tenant goes by email, not SMS
    const session = await seedSession(s.lee);
    await staffCall(h, 'POST', `/api/incidents/${r!.incident_id}/ack`, session, {});
    await drain(h.deps);
    expect(h.messaging.attempts.filter((m) => m.to === tenant.mobile)).toHaveLength(0);
    expect(h.messaging.sentTo(tenant.email!).map((m) => m.body)).toContain('A manager has your report and will contact you.');
    // START restores texting
    h.clock.advance(40 * MIN);
    await sms(h, s, tenant.mobile, 'START');
    h.messaging.blockedSms.delete(tenant.mobile);
    h.clock.advance(1 * MIN);
    await sms(h, s, tenant.mobile, 'also the hallway light is out');
    await drain(h.deps);
    expect(h.messaging.sentTo(tenant.mobile).some((m) => m.body.includes('911'))).toBe(true);
  });
  it('an opted-out sender with no email still gets a request in needs-triage and a page; no text is attempted', async () => {
    const t = s.tenants['305'];
    await sms(h, s, t.mobile, 'stop');
    h.clock.advance(MIN);
    await sms(h, s, t.mobile, 'my blinds are broken');
    await drain(h.deps);
    expect(h.messaging.attempts.filter((m) => m.to === t.mobile)).toHaveLength(0);
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(0);
  });
});

describe('IT-20 a second unit reports the same problem after acknowledgement', () => {
  it('unit 305 linked as suggested and the escalation reopened; "separate problem" gives its own incident; after building-wide, unit 406 attaches without a page', async () => {
    await sms(h, s, s.tenants['204'].mobile, 'pipe burst in the bathroom');
    await drain(h.deps);
    const session = await seedSession(s.sam);
    const [inc] = await q<{ id: string }>('select id from incidents');
    await staffCall(h, 'POST', `/api/incidents/${inc!.id}/ack`, session, {}); // acknowledged by Sam, no outcome
    await runFor(h, 10 * MIN);
    const leeBefore = pagesTo(h, s.phones.lee).length;
    const samBefore = pagesTo(h, s.phones.sam).length;
    await sms(h, s, s.tenants['305'].mobile, 'pipe burst');
    await drain(h.deps);
    const [r305] = await q<{ id: string; incident_id: string; incident_link_state: string }>(`select r.id, r.incident_id, r.incident_link_state from requests r where r.unit_id = $1`, [s.units['305']]);
    expect(r305).toMatchObject({ incident_id: inc!.id, incident_link_state: 'suggested' });
    const escs = await q<{ trigger: string; state: string; request_id: string | null }>('select trigger, state, request_id from escalations order by created_at');
    expect(escs[1]).toEqual({ trigger: 'new_unit_report', state: 'paging', request_id: r305!.id });
    expect(pagesTo(h, s.phones.lee).length).toBeGreaterThan(leeBefore); // Level 1
    expect(pagesTo(h, s.phones.sam).length).toBeGreaterThan(samBefore); // previous acknowledger
    const leePage = pagesTo(h, s.phones.lee).filter((m) => m.channel === 'sms').pop()!;
    expect(leePage.body).toContain('(204, 305); 2 reports');
    expect(h.messaging.sentTo(s.tenants['305'].mobile).some((m) => m.body.includes('911'))).toBe(true);

    // "Separate problem" (HI-13): its own incident with its own escalation
    const { rejectSuggestion } = await import('@fixtriage/services');
    await withAccount(h.deps.database, s.accountId, (tx) => rejectSuggestion(tx, h.deps, s.accountId, { requestId: r305!.id, userId: s.sam }));
    const [own] = await q<{ incident_id: string; incident_link_state: string }>(`select incident_id, incident_link_state from requests where id = $1`, [r305!.id]);
    expect(own!.incident_link_state).toBe('own');
    expect(own!.incident_id).not.toBe(inc!.id);
    expect(await q(`select id from escalations where incident_id = $1 and state = 'paging'`, [own!.incident_id])).toHaveLength(1);

    // the original incident is acknowledged again and marked building-wide; unit 406 attaches without a page
    await staffCall(h, 'POST', `/api/incidents/${inc!.id}/ack`, session, {});
    const { markBuildingWide } = await import('@fixtriage/services');
    await withAccount(h.deps.database, s.accountId, (tx) => markBuildingWide(tx, h.deps, s.accountId, { incidentId: inc!.id, userId: s.sam }));
    await drain(h.deps);
    const pagesBefore = h.messaging.sent.filter((m) => m.body.startsWith('FixTriage') || m.channel === 'voice').length;
    const escBefore = (await q('select id from escalations')).length;
    await sms(h, s, s.tenants['406'].mobile, 'burst pipe');
    await drain(h.deps);
    expect(h.messaging.sent.filter((m) => m.body.startsWith('FixTriage') || m.channel === 'voice').length).toBe(pagesBefore);
    expect((await q('select id from escalations')).length).toBe(escBefore);
    expect(h.messaging.sentTo(s.tenants['406'].mobile).some((m) => m.body.includes('911'))).toBe(true);
    expect(await q(`select id from audit_events where action = 'incident.link_suggested.attach_building_wide'`)).toHaveLength(1);
  });
});
