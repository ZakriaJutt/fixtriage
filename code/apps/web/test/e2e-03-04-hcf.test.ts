// E2E-03 (HCF sequence) and E2E-04 (chain exhausted to the operators), run at API/service level with provider fakes.
// The browser half of these end-to-end tests (S-05, S-06 screens) does not exist in B1 and was not run.
import { beforeEach, describe, expect, it } from 'vitest';
import { operatorEngaged, operatorRelayAck, sha256Hex, withAccount } from '@fixtriage/services';
import { tables } from '@fixtriage/db';
import { call, drain, harness, OPERATOR_PHONES, pagesTo, q, resetData, runFor, seedAccount, seedOperators, seedSession, sms, staffCall, type Harness, type Seeded } from '../../../test/helpers';

let h: Harness;
let s: Seeded;
let ops: { primary: string; backup: string };
const MIN = 60_000;
const T0 = Date.parse('2027-02-04T09:10:00Z'); // Thu 02:10 local
beforeEach(async () => {
  await resetData();
  ops = await seedOperators();
  h = harness(new Date(T0).toISOString());
  h.classifier.mode = 'down';
  s = await seedAccount(h.deps.database);
});

const minutesOf = (phone: string) => pagesTo(h, phone).filter((m) => m.channel === 'voice');

describe('E2E-03 HCF: 02:10 no heat, model down, Level 1 silent', () => {
  it('safety reply; Level 2 acknowledges by link at about 5 min; outcome recorded; dispatch approved', async () => {
    const tenant = s.tenants['204'].mobile;
    await sms(h, s, tenant, 'no heat since last night, 2 kids');
    await drain(h.deps);
    const safety = h.messaging.sentTo(tenant)[0]!;
    expect(safety.body).toContain('911');
    expect(safety.body).toContain('+18006639911');
    expect(safety.body).toContain('The office is closed now');
    expect(minutesOf(s.phones.lee)).toHaveLength(1);
    await runFor(h, 5 * MIN + 15_000);
    expect(minutesOf(s.phones.lee)).toHaveLength(2); // 0 and 2 min
    const samSms = pagesTo(h, s.phones.sam).find((m) => m.channel === 'sms')!;
    expect(samSms.body).toMatch(/URGENT: no heat at 1\d\d Example Street \(204\); 1 report/);
    expect(samSms.body).not.toContain('Tenant 204');
    const token = samSms.body.match(/\/a\/([A-Za-z0-9_-]+)/)![1]!;
    const view = await (await call(h, 'GET', `/a/${token}`)).json();
    expect(view).toMatchObject({ hazardClass: 'no_heat', tier: 'urgent', acknowledged: false });
    expect(JSON.stringify(view)).not.toMatch(/Tenant|\+1604/);
    expect((await call(h, 'POST', `/a/${token}`)).status).toBe(200);
    await drain(h.deps);
    const [esc] = await q<{ acknowledged_by: string; acknowledged_via: string; acknowledged_at: Date }>(`select acknowledged_by, acknowledged_via, acknowledged_at from escalations`);
    expect(esc).toMatchObject({ acknowledged_by: s.sam, acknowledged_via: 'link' });
    expect((new Date(esc!.acknowledged_at).getTime() - T0) / MIN).toBeCloseTo(5.25, 1);
    expect(h.messaging.sentTo(tenant).some((m) => m.body === 'A manager has your report and will contact you.')).toBe(true);
    // no Level 3 page after acknowledgement
    await runFor(h, 10 * MIN);
    expect(pagesTo(h, s.phones.owner)).toHaveLength(0);

    const [inc] = await q<{ id: string; version: number }>('select id, version from incidents');
    const session = await seedSession(s.sam);
    // Work order draft (drafting is T-2.3.6 and not in B1): created directly, then approved through the API with its hash.
    const woId = await withAccount(h.deps.database, s.accountId, async (tx) => {
      const [wo] = await tx.insert(tables.workOrders).values({ accountId: s.accountId, incidentId: inc!.id, unitId: s.units['204'], trade: 'heating', tier: 'urgent', summary: 'No heat, unit 204' }).returning();
      return wo!.id;
    });
    const text = 'Emergency: no heat at unit 204. Please confirm with YES within 10 minutes.';
    const res = await staffCall(h, 'POST', `/api/work-orders/${woId}/approve-dispatch`, session, { vendor_id: s.vendors.heatA, body: text, body_sha256: sha256Hex(text), version: 1 }, { 'idempotency-key': 'k-approve-1' });
    expect(res.status).toBe(200);
    // double POST with the same key: one dispatch (IT-11 part)
    const again = await staffCall(h, 'POST', `/api/work-orders/${woId}/approve-dispatch`, session, { vendor_id: s.vendors.heatA, body: text, body_sha256: sha256Hex(text), version: 1 }, { 'idempotency-key': 'k-approve-1' });
    expect(again.status).toBe(200);
    await drain(h.deps);
    expect(h.messaging.sentTo(s.vendorPhones.heatA).map((m) => m.body)).toEqual([text]);
    const [after] = await q<{ outcome: string; outcome_by: string; state: string }>('select outcome, outcome_by, state from incidents');
    expect(after).toMatchObject({ outcome: 'vendor_dispatched', outcome_by: s.sam, state: 'outcome_recorded' });
  });
  it('outcome recorded through the API stops the EP-7 reminder and EP-11a reopen', async () => {
    await sms(h, s, s.tenants['204'].mobile, 'no heat');
    await drain(h.deps);
    const session = await seedSession(s.lee);
    const [inc] = await q<{ id: string }>('select id from incidents');
    expect((await staffCall(h, 'POST', `/api/incidents/${inc!.id}/ack`, session, {})).status).toBe(200);
    expect((await staffCall(h, 'POST', `/api/incidents/${inc!.id}/outcome`, session, { outcome: 'handled_by_phone' })).status).toBe(200);
    await runFor(h, 50 * MIN);
    expect(await q(`select id from escalations`)).toHaveLength(1);
    expect(h.messaging.sentTo(s.phones.lee).filter((m) => m.body.startsWith('Reminder'))).toHaveLength(0);
  });
  it('no outcome: reminder at 30 min, escalation reopened at 45 min with the acknowledger paged with Level 1 (EP-7, EP-11a)', async () => {
    await sms(h, s, s.tenants['204'].mobile, 'no heat');
    await drain(h.deps);
    const session = await seedSession(s.sam);
    const [inc] = await q<{ id: string }>('select id from incidents');
    await staffCall(h, 'POST', `/api/incidents/${inc!.id}/ack`, session, {});
    await runFor(h, 31 * MIN);
    expect(h.messaging.sentTo(s.phones.sam).filter((m) => m.body.startsWith('Reminder'))).toHaveLength(1);
    const before = pagesTo(h, s.phones.sam).length;
    await runFor(h, 15 * MIN);
    const escs = await q<{ trigger: string; state: string }>('select trigger, state from escalations order by created_at');
    expect(escs).toEqual([{ trigger: 'new_incident', state: 'acknowledged' }, { trigger: 'no_outcome', state: 'paging' }]);
    expect(pagesTo(h, s.phones.sam).length).toBeGreaterThan(before); // previous acknowledger paged
    const [st] = await q<{ state: string }>('select state from incidents');
    expect(st!.state).toBe('open');
  });
});

describe('E2E-04 chain exhausted to the operators', () => {
  it('primary operator at 15, backup at 20; EP-6 at 15; "engaged" does not stop Levels 1-3 re-pages; relay ends it with Lee as acknowledger', async () => {
    const tenant = s.tenants['305'].mobile;
    await sms(h, s, tenant, 'burst pipe, water everywhere');
    await drain(h.deps);
    await runFor(h, 31 * MIN);
    expect(minutesOf(OPERATOR_PHONES.primary).length).toBeGreaterThanOrEqual(1);
    const firstAt = async (role: string) => {
      const [r] = await q<{ m: number }>(`select min(extract(epoch from due_at - $1::timestamptz) / 60)::float as m from escalation_steps where target_role = $2`, [new Date(T0), role]);
      return r!.m;
    };
    expect(await firstAt('operator_primary')).toBe(15);
    expect(await firstAt('operator_backup')).toBe(20);
    const ep6 = h.messaging.sentTo(tenant).filter((m) => m.body.startsWith('We are still trying'));
    expect(ep6).toHaveLength(1);
    expect(ep6[0]!.body).toContain('911');
    // Levels 1-3 re-paged at 30 min
    const l1At = await q<{ m: number }>(`select (extract(epoch from due_at - $1::timestamptz) / 60)::float as m from escalation_steps where target_role = 'oncall' and level = 1 order by due_at`, [new Date(T0)]);
    expect(l1At.map((x) => x.m)).toEqual([0, 2, 30]);

    // 31 min: backup operator clicks "I am on it"
    const [esc] = await q<{ id: string }>('select id from escalations');
    await withAccount(h.deps.database, s.accountId, (tx) => operatorEngaged(tx, h.deps, s.accountId, esc!.id, ops.backup));
    const opPagesAtEngage = minutesOf(OPERATOR_PHONES.primary).length + minutesOf(OPERATOR_PHONES.backup).length;
    await runFor(h, 15 * MIN); // to 46 min
    const [still] = await q<{ state: string }>('select state from escalations');
    expect(still!.state).toBe('paging');
    const l1After = await q<{ m: number }>(`select (extract(epoch from due_at - $1::timestamptz) / 60)::float as m from escalation_steps where target_role = 'oncall' and level = 1 order by due_at`, [new Date(T0)]);
    expect(l1After.map((x) => x.m)).toEqual([0, 2, 30, 45]);
    expect(minutesOf(OPERATOR_PHONES.primary).length + minutesOf(OPERATOR_PHONES.backup).length).toBe(opPagesAtEngage);

    // "Accepted by phone" for Lee, relayed by the backup operator
    const r = await withAccount(h.deps.database, s.accountId, (tx) => operatorRelayAck(tx, h.deps, s.accountId, { escalationId: esc!.id, operatorId: ops.backup, accountUserId: s.lee }));
    expect(r.ok).toBe(true);
    const [done] = await q<{ state: string; acknowledged_by: string; acknowledged_via: string; relayed_by_operator_id: string; operator_engaged_by: string }>('select state, acknowledged_by, acknowledged_via, relayed_by_operator_id, operator_engaged_by from escalations');
    expect(done).toEqual({ state: 'acknowledged', acknowledged_by: s.lee, acknowledged_via: 'operator_relay', relayed_by_operator_id: ops.backup, operator_engaged_by: ops.backup });
  });
});
