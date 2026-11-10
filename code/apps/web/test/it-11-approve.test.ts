// IT-11: a draft edited in another tab -> approving with the old hash or old version is refused ("reload");
// a double POST produces a single dispatch (FD-1, TRD 5.1 approve-dispatch).
import { beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex, withAccount } from '@fixtriage/services';
import { tables } from '@fixtriage/db';
import { harness, q, resetData, seedAccount, seedSession, staffCall, type Harness, type Seeded } from '../../../test/helpers';

let h: Harness;
let s: Seeded;
let wo: string;
beforeEach(async () => {
  await resetData();
  h = harness('2027-02-03T22:00:00Z');
  s = await seedAccount(h.deps.database);
  const [r] = await q<{ id: string }>(`insert into requests (account_id, tier, tier_source, after_hours, opened_at) values ($1, 'routine', 'model', false, now()) returning id`, [s.accountId]);
  wo = await withAccount(h.deps.database, s.accountId, async (tx) => (await tx.insert(tables.workOrders).values({ accountId: s.accountId, requestId: r!.id, unitId: s.units['204'], trade: 'plumbing', tier: 'routine', summary: 'Tap drips' }).returning())[0]!.id);
});

describe('IT-11 approve dispatch', () => {
  it('old hash refused; old version refused; double POST gives one dispatch', async () => {
    const session = await seedSession(s.lee);
    const shown = 'Please fix the dripping kitchen tap in unit 204.';
    const edited = 'Please fix the dripping kitchen tap in unit 204 (tenant home after 5).';
    const path = `/api/work-orders/${wo}/approve-dispatch`;
    const stale = await staffCall(h, 'POST', path, session, { vendor_id: s.vendors.plumbA, body: edited, body_sha256: sha256Hex(shown), version: 1 });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe('body_changed_reload');
    const oldVersion = await staffCall(h, 'POST', path, session, { vendor_id: s.vendors.plumbA, body: shown, body_sha256: sha256Hex(shown), version: 0 });
    expect(oldVersion.status).toBe(409);
    const body = { vendor_id: s.vendors.plumbA, body: shown, body_sha256: sha256Hex(shown), version: 1 };
    const [a, b] = await Promise.all([staffCall(h, 'POST', path, session, body, { 'idempotency-key': 'dbl-1' }), staffCall(h, 'POST', path, session, body, { 'idempotency-key': 'dbl-1' })]);
    expect([a.status, b.status].filter((x) => x === 200).length).toBeGreaterThanOrEqual(1);
    const third = await staffCall(h, 'POST', path, session, body, { 'idempotency-key': 'dbl-1' });
    expect(third.status).toBe(200);
    expect(await q('select id from dispatches')).toHaveLength(1);
    expect(await q(`select id from outbound_messages where purpose = 'dispatch'`)).toHaveLength(1);
  });
});
