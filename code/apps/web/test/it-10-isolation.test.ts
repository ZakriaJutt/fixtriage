// IT-10: cross-account isolation on every B1 route, job and poll; resolvers return only their listed columns;
// a query on any account table outside withAccount returns nothing. The application role is NOSUPERUSER NOBYPASSRLS.
import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ACCOUNT_TABLES, tables, withAccount } from '@fixtriage/db';
import { advanceEscalation, runClassifyJob, runIntakeJob, triageTimeout } from '@fixtriage/services';
import { storageKey } from '@fixtriage/platform';
import { appDb, drain, harness, owner, q, resetData, seedAccount, seedOperators, seedSession, sms, staffCall, type Harness, type Seeded } from '../../../test/helpers';

let h: Harness;
let A: Seeded;
let B: Seeded;
let bIds: { request: string; incident: string; escalation: string; inbound: string; workOrder: string };
beforeEach(async () => {
  await resetData();
  await seedOperators();
  h = harness('2027-02-04T06:30:00Z');
  h.classifier.mode = 'down';
  A = await seedAccount(h.deps.database, 1);
  B = await seedAccount(h.deps.database, 2);
  await sms(h, A, A.tenants['204'].mobile, 'no heat');
  await sms(h, B, B.tenants['204'].mobile, 'no heat');
  await drain(h.deps);
  const [r] = await q<{ id: string; incident_id: string }>('select id, incident_id from requests where account_id = $1', [B.accountId]);
  const [e] = await q<{ id: string }>('select id from escalations where account_id = $1', [B.accountId]);
  const [i] = await q<{ id: string }>('select id from inbound_messages where account_id = $1', [B.accountId]);
  const wo = await withAccount(h.deps.database, B.accountId, async (tx) => (await tx.insert(tables.workOrders).values({ accountId: B.accountId, incidentId: r!.incident_id, trade: 'heating', tier: 'urgent', summary: 'x' }).returning())[0]!.id);
  bIds = { request: r!.id, incident: r!.incident_id, escalation: e!.id, inbound: i!.id, workOrder: wo };
});

async function snapshotB(): Promise<string> {
  const rows = await q(`select (select count(*) from requests where account_id = $1) r, (select count(*) from incidents where account_id = $1) i,
    (select count(*) from escalations where account_id = $1) e, (select count(*) from escalation_steps where account_id = $1) s,
    (select count(*) from outbound_messages where account_id = $1) o, (select count(*) from dispatches where account_id = $1) d,
    (select string_agg(state || version, ',') from incidents where account_id = $1) iv, (select string_agg(state || version, ',') from escalations where account_id = $1) ev`, [B.accountId]);
  return JSON.stringify(rows[0]);
}

describe('IT-10 cross-account isolation', () => {
  it('every staff route with A\'s session and B\'s IDs answers not found and changes nothing', async () => {
    const session = await seedSession(A.lee);
    const before = await snapshotB();
    const calls: Array<[string, string, unknown]> = [
      ['GET', `/api/requests/${bIds.request}`, undefined],
      ['GET', `/api/incidents/${bIds.incident}`, undefined],
      ['POST', `/api/incidents/${bIds.incident}/ack`, {}],
      ['POST', `/api/incidents/${bIds.incident}/outcome`, { outcome: 'attending' }],
      ['POST', `/api/incidents/${bIds.incident}/downgrade`, { tier: 'routine', reason: 'test reason', version: 1 }],
      ['POST', `/api/work-orders/${bIds.workOrder}/approve-dispatch`, { vendor_id: B.vendors.heatA, body: 'x', body_sha256: '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881', version: 1 }],
    ];
    for (const [m, path, body] of calls) {
      const res = await staffCall(h, m, path, session, body);
      expect(`${m} ${path} -> ${res.status}`).toBe(`${m} ${path} -> 404`);
    }
    expect(await snapshotB()).toBe(before);
  });
  it('jobs run with A\'s account and B\'s IDs do nothing to either account', async () => {
    const before = await snapshotB();
    const aCount = await q(`select count(*)::int c from requests where account_id = $1`, [A.accountId]);
    await runIntakeJob(h.deps, A.accountId, bIds.inbound);
    await runClassifyJob(h.deps, A.accountId, bIds.inbound, bIds.request);
    await withAccount(h.deps.database, A.accountId, (tx) => triageTimeout(tx, h.deps, A.accountId, bIds.request));
    await withAccount(h.deps.database, A.accountId, (tx) => advanceEscalation(tx, h.deps, A.accountId, bIds.escalation));
    expect(await snapshotB()).toBe(before);
    expect(await q(`select count(*)::int c from requests where account_id = $1`, [A.accountId])).toEqual(aCount);
  });
  it('any account table read outside withAccount returns zero rows; writes are refused', async () => {
    const db = appDb();
    for (const t of ACCOUNT_TABLES) {
      const r = await db.pool.query(`select count(*)::int as c from ${t}`);
      expect(`${t}:${r.rows[0].c}`).toBe(`${t}:0`);
    }
    await expect(db.pool.query(`insert into properties (account_id, label, street_address, city) values ($1, 'x', 'y', 'z')`, [A.accountId])).rejects.toThrow(/row-level security/);
    const role = await db.pool.query(`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  it('inside A\'s context, B\'s rows are invisible even by id', async () => {
    const n = await withAccount(h.deps.database, A.accountId, async (tx) => {
      const r = await tx.execute(`select (select count(*) from requests where id = '${bIds.request}') + (select count(*) from incidents where id = '${bIds.incident}') as c` as unknown as never);
      return Number((r.rows[0] as { c: string }).c);
    });
    expect(n).toBe(0);
  });
  it('global and append-only tables: no session read, no audit change', async () => {
    const db = appDb();
    await expect(db.pool.query('select * from sessions')).rejects.toThrow(/permission denied/);
    await expect(withAccount(h.deps.database, A.accountId, (tx) => tx.execute('update audit_events set action = action' as unknown as never))).rejects.toThrow();
  });
  it('resolver functions and poll views return only their listed columns and nothing for crafted inputs', async () => {
    const expected: Record<string, string[]> = {
      resolve_channel: ['account_id', 'channel_id'],
      resolve_session: ['user_id', 'operator_id', 'account_id', 'role', 'expires_at', 'csrf_token_hash'],
      resolve_login: ['user_id', 'operator_id', 'account_id', 'password_hash', 'totp_secret_enc', 'totp_confirmed_at', 'totp_last_step', 'disabled_at'],
      resolve_capability: ['account_id', 'purpose', 'escalation_step_id', 'user_id', 'dispatch_id', 'expires_at', 'used_at'],
      resolve_outbound: ['account_id', 'outbound_message_id'],
    };
    const fns = await owner((c) => c.query(`select p.proname, p.proargnames, p.proargmodes::text[] as proargmodes, p.prosecdef from pg_proc p where p.proname like 'resolve_%'`));
    for (const f of fns.rows as Array<{ proname: string; proargnames: string[]; proargmodes: string[]; prosecdef: boolean }>) {
      const outs = f.proargnames.filter((_, i) => f.proargmodes[i] === 't');
      expect([f.proname, outs]).toEqual([f.proname, expected[f.proname]]);
      expect(f.prosecdef).toBe(true);
    }
    expect(fns.rows.map((r) => r.proname).sort()).toEqual(Object.keys(expected).sort());
    const views: Record<string, string[]> = {
      due_escalations: ['id', 'account_id', 'next_due_at'],
      pending_outbox: ['id', 'account_id', 'created_at', 'next_attempt_at'],
      due_dispatches: ['id', 'account_id', 'confirm_due_at'],
      sweep_accounts: ['id', 'status'],
      due_jobs: ['id', 'account_id', 'run_at', 'kind'],
      due_undecided: ['id', 'account_id', 'due_at'],
      job_health: ['dead_jobs'],
    };
    for (const [v, cols] of Object.entries(views)) {
      const r = await owner((c) => c.query(`select column_name from information_schema.columns where table_name = $1 order by ordinal_position`, [v]));
      expect([v, r.rows.map((x) => x.column_name)]).toEqual([v, cols]);
    }
    const db = appDb();
    const crafted = ["' or 1=1 --", '%', '_', A.smsNumber + '0', ''];
    for (const x of crafted) {
      expect((await db.pool.query('select * from resolve_channel($1)', [x])).rowCount).toBe(0);
      expect((await db.pool.query('select * from resolve_outbound($1)', [x])).rowCount).toBe(0);
      expect((await db.pool.query('select * from resolve_login($1)', [x])).rowCount).toBe(0);
    }
    expect((await db.pool.query('select * from resolve_session($1)', [randomBytes(32)])).rowCount).toBe(0);
    // B1-004: addresses compare case-insensitively and ignore surrounding blanks, and still resolve to the right account only
    const up = await db.pool.query('select account_id from resolve_channel($1)', [` ${A.emailAddress.toUpperCase()} `]);
    expect(up.rows).toEqual([{ account_id: A.accountId }]);
    expect((await db.pool.query('select * from resolve_capability($1)', [randomBytes(32)])).rowCount).toBe(0);
  });
  it('storage keys start with the account id (AD-10); B1 has no storage read path to test', () => {
    expect(storageKey(A.accountId, 'inbound', new Date('2027-02-04T00:00:00Z')).startsWith(`acct/${A.accountId}/`)).toBe(true);
  });
});
