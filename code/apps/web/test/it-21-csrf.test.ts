// IT-21: a forged cross-site POST (session cookie but no anti-forgery header) to downgrade and approve-dispatch is
// rejected, changes nothing, and the attempt is logged.
import { beforeEach, describe, expect, it } from 'vitest';
import { setLogSink } from '@fixtriage/platform';
import { sha256Hex, withAccount } from '@fixtriage/services';
import { tables } from '@fixtriage/db';
import { drain, harness, q, resetData, seedAccount, seedOperators, seedSession, sms, staffCall, type Harness, type Seeded } from '../../../test/helpers';

let h: Harness;
let s: Seeded;
beforeEach(async () => {
  await resetData();
  await seedOperators();
  h = harness('2027-02-04T06:30:00Z');
  h.classifier.mode = 'down';
  s = await seedAccount(h.deps.database);
});

describe('IT-21 anti-forgery', () => {
  it('rejects forged downgrade and approve-dispatch; no state change; attempt logged', async () => {
    await sms(h, s, s.tenants['204'].mobile, 'no heat');
    await drain(h.deps);
    const [inc] = await q<{ id: string; version: number; tier: string }>('select id, version, tier from incidents');
    const wo = await withAccount(h.deps.database, s.accountId, async (tx) => (await tx.insert(tables.workOrders).values({ accountId: s.accountId, incidentId: inc!.id, trade: 'heating', tier: 'urgent', summary: 'x' }).returning())[0]!.id);
    const session = await seedSession(s.lee);
    const lines: string[] = [];
    setLogSink((l) => lines.push(l), 'warn');
    const text = 'Emergency: no heat';
    const forged = [
      await staffCall(h, 'POST', `/api/incidents/${inc!.id}/downgrade`, session, { tier: 'routine', reason: 'forged', version: inc!.version }, { omitCsrf: '1' }),
      await staffCall(h, 'POST', `/api/work-orders/${wo}/approve-dispatch`, session, { vendor_id: s.vendors.heatA, body: text, body_sha256: sha256Hex(text), version: 1 }, { omitCsrf: '1' }),
      await staffCall(h, 'POST', `/api/incidents/${inc!.id}/downgrade`, session, { tier: 'routine', reason: 'forged', version: inc!.version }, { 'x-csrf-token': 'wrong-token' }),
    ];
    expect(forged.map((r) => r.status)).toEqual([403, 403, 403]);
    const [after] = await q<{ version: number; tier: string; state: string }>('select version, tier, state from incidents');
    expect(after).toMatchObject({ tier: inc!.tier, version: inc!.version });
    expect(await q('select id from dispatches')).toHaveLength(0);
    expect(lines.filter((l) => JSON.parse(l).event === 'auth.rejected' && JSON.parse(l).code === 'csrf')).toHaveLength(3);
    // the genuine request with the header works and is audited with its reason
    const ok = await staffCall(h, 'POST', `/api/incidents/${inc!.id}/downgrade`, session, { tier: 'routine', reason: 'tenant confirmed heat is back', version: inc!.version });
    expect(ok.status).toBe(200);
    const [aud] = await q<{ reason: string }>(`select reason from audit_events where action = 'incident.downgraded'`);
    expect(aud!.reason).toBe('tenant confirmed heat is back');
    const [hc] = await q<{ kind: string; reason: string }>(`select kind, reason from classifications where kind = 'human'`);
    expect(hc).toEqual({ kind: 'human', reason: 'tenant confirmed heat is back' });
  });
  it('no session at all is 401', async () => {
    const r = await staffCall(h, 'GET', '/api/requests/00000000-0000-4000-8000-000000000000', null);
    expect(r.status).toBe(401);
  });
});
