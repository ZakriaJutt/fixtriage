// Security fixes after the B2 review (items 1-5 of the coordinator's list). Each test was written first and run
// against fa65c09, where it failed (recorded in verification section 8.6), then the code was fixed.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { FakeMailer, type MailMessage } from '@fixtriage/platform';
import * as services from '@fixtriage/services';

// Expected policy values written down here (not imported), so the file also ran meaningfully before the fix.
const P = { perClientAttempts: 30, perLinkCodeAttempts: 5, perAccountCodeAttempts: 20, freeFailures: 5, maxDelayS: 30 };
const settleBackground: () => Promise<void> = (services as { settleBackground?: () => Promise<void> }).settleBackground ?? (async () => undefined);
import { route } from '../apps/web/src/handlers';
import { CSRF_HEADER, SESSION_COOKIE } from '../apps/web/src/handlers';
import { call, drain, harness, owner, q, resetData, runFor, seedAccount, seedOperators, seedSession, sms, staffCall, twilioPost, type Harness, type Seeded } from './helpers';
import { authPost, codeFor, deleteMailTo, mailTo, sessionFrom, smtpMailer, tokenFromMail, uniqueEmail } from './b2-helpers';

const PASSWORD = 'maple court boiler 2027';
const used: string[] = [];
let h: Harness;
let A: Seeded;
let B: Seeded;
let ownerA: { cookie: string; csrf: string };

beforeEach(async () => {
  await resetData();
  await seedOperators();
  h = harness('2027-02-04T06:30:00Z', { mailer: smtpMailer() }); // 22:30 in Vancouver: after hours
  A = await seedAccount(h.deps.database, 1);
  B = await seedAccount(h.deps.database, 2);
  ownerA = await seedSession(A.ownerId);
});
afterAll(async () => {
  await settleBackground();
  await deleteMailTo(used);
});

function email(tag: string): string {
  const e = uniqueEmail(tag);
  used.push(e);
  return e;
}

async function invite(tag: string, role: 'manager' | 'owner' = 'manager'): Promise<{ email: string; userId: string; token: string }> {
  const to = email(tag);
  const r = await staffCall(h, 'POST', '/api/settings/users', ownerA, { email: to, display_name: `Test ${tag}`, role });
  expect(r.status).toBe(202);
  const [u] = await q<{ id: string }>('select id from users where email = $1', [to]);
  return { email: to, userId: u!.id, token: tokenFromMail((await mailTo(to)).text, 'enrol') };
}

async function enrol(tag: string, role: 'manager' | 'owner' = 'manager') {
  const i = await invite(tag, role);
  const start = (await (await authPost(h, '/auth/enrol/start', { token: i.token, password: PASSWORD })).json()) as { secret: string };
  const conf = await authPost(h, '/auth/enrol/confirm', { token: i.token, code: codeFor(start.secret, h) });
  expect(conf.status).toBe(200);
  return { ...i, secret: start.secret, session: sessionFrom(conf), recoveryCodes: ((await conf.json()) as { recovery_codes: string[] }).recovery_codes };
}

const signIn = (e: string, code: string, opts: { password?: string; client?: string } = {}) => authPost(h, '/auth/sign-in', { email: e, password: opts.password ?? PASSWORD, code }, { client: opts.client ?? '198.51.100.20' });

async function pageLee(): Promise<{ link: string; callSid: string }> {
  await sms(h, A, A.tenants['204'].mobile, 'water pouring through the ceiling');
  await drain(h.deps);
  const lee = h.messaging.sentTo(A.phones.lee);
  return { link: lee.find((m) => m.channel === 'sms')!.body.match(/\/a\/([A-Za-z0-9_-]+)/)![1]!, callSid: lee.find((m) => m.channel === 'voice')!.providerMessageId };
}

describe('item 1: a disabled user cannot acknowledge', () => {
  it('link and voice keypress of a disabled user are refused; the escalation keeps paging the next level', async () => {
    const { link, callSid } = await pageLee();
    await owner((c) => c.query('update users set disabled_at = now() where id = $1', [A.lee]));
    const r = await call(h, 'POST', `/a/${link}`);
    expect(r.status).toBe(403);
    const v = await twilioPost(h, '/webhooks/twilio/voice-ack', { CallSid: callSid, Digits: '1' });
    expect(await v.text()).toContain('Not acknowledged');
    const [e] = await q<{ state: string }>('select state from escalations where account_id = $1', [A.accountId]);
    expect(e!.state).toBe('paging');
    await runFor(h, 6 * 60_000);
    expect(h.messaging.sentTo(A.phones.sam).length).toBeGreaterThan(0); // Level 2 paged
    const [aud] = await q<{ n: number }>(`select count(*)::int n from audit_events where account_id = $1 and action = 'escalation.ack_refused'`, [A.accountId]);
    expect(aud!.n).toBe(2);
  });

  it('disabling a user revokes their outstanding acknowledgement links', async () => {
    const { link } = await pageLee();
    await owner((c) => c.query('delete from oncall_shifts where user_id = $1', [A.lee])); // off the roster, so disable is allowed
    expect((await staffCall(h, 'POST', `/api/settings/users/${A.lee}/disable`, ownerA)).status).toBe(200);
    const [open] = await q<{ n: number }>('select count(*)::int n from capability_tokens where user_id = $1 and used_at is null', [A.lee]);
    expect(open!.n).toBe(0);
    expect((await call(h, 'POST', `/a/${link}`)).status).toBe(404);
  });
});

describe('item 2: client address and link guessing', () => {
  it('a rotating X-Forwarded-For from one direct peer does not escape the per-client limit', async () => {
    const st: number[] = [];
    for (let i = 0; i <= P.perClientAttempts; i++) st.push((await authPost(h, '/auth/sign-in', { email: `x${i}@example.test`, password: 'wrong wrong wrong', code: '000000' }, { client: '203.0.113.5', xff: `198.18.${i}.1` })).status);
    expect(st.at(-1)).toBe(429);
  });

  it('without the header, two different peers do not share one bucket', async () => {
    for (let i = 0; i < P.perClientAttempts; i++) await authPost(h, '/auth/sign-in', { email: `y${i}@example.test`, password: 'wrong wrong wrong', code: '000000' }, { client: '203.0.113.6' });
    expect((await authPost(h, '/auth/sign-in', { email: 'z@example.test', password: 'wrong wrong wrong', code: '000000' }, { client: '203.0.113.6' })).status).toBe(429);
    expect((await authPost(h, '/auth/sign-in', { email: 'z@example.test', password: 'wrong wrong wrong', code: '000000' }, { client: '203.0.113.7' })).status).toBe(401);
  });

  it('behind a configured trusted proxy the right-most untrusted hop is the client; a spoofed left hop is ignored', async () => {
    h.deps.trustedProxies = ['10.0.0.1'];
    const st: number[] = [];
    for (let i = 0; i <= P.perClientAttempts; i++) st.push((await authPost(h, '/auth/sign-in', { email: `w${i}@example.test`, password: 'wrong wrong wrong', code: '000000' }, { client: '10.0.0.1', xff: `198.18.${i}.9, 198.51.100.77` })).status);
    expect(st.at(-1)).toBe(429);
    expect((await authPost(h, '/auth/sign-in', { email: 'v@example.test', password: 'wrong wrong wrong', code: '000000' }, { client: '10.0.0.1', xff: '198.51.100.78' })).status).toBe(401);
  });

  it('wrong codes burn an enrolment link after five tries, even if the sixth code is right', async () => {
    const i = await invite('burn-enrol');
    const start = (await (await authPost(h, '/auth/enrol/start', { token: i.token, password: PASSWORD })).json()) as { secret: string };
    for (let k = 0; k < P.perLinkCodeAttempts; k++) expect((await authPost(h, '/auth/enrol/confirm', { token: i.token, code: '000000' }, { client: `198.51.100.${k + 30}` })).status).toBe(401);
    expect((await authPost(h, '/auth/enrol/confirm', { token: i.token, code: codeFor(start.secret, h) })).status).toBe(410);
  });

  it('wrong codes burn a reset link after five tries', async () => {
    const u = await enrol('burn-reset');
    await authPost(h, '/auth/reset/request', { email: u.email });
    await settleBackground();
    const token = tokenFromMail((await mailTo(u.email, { count: 2 })).text, 'reset');
    h.clock.advance(60_000);
    for (let k = 0; k < P.perLinkCodeAttempts; k++) expect((await authPost(h, '/auth/reset/complete', { token, code: '000000', password: 'granville tap washer 31' }, { client: `198.51.100.${k + 40}` })).status).toBe(401);
    expect((await authPost(h, '/auth/reset/complete', { token, code: codeFor(u.secret, h), password: 'granville tap washer 31' })).status).toBe(410);
  });

  it('wrong link codes across links of one account hit a per-account limit', async () => {
    const links: string[] = [];
    for (let k = 0; k < 5; k++) {
      const i = await invite(`acct-limit-${k}`);
      await authPost(h, '/auth/enrol/start', { token: i.token, password: PASSWORD });
      links.push(i.token);
    }
    const st: number[] = [];
    for (const t of links) for (let k = 0; k < 4; k++) st.push((await authPost(h, '/auth/enrol/confirm', { token: t, code: '000000' }, { client: `198.51.100.${st.length + 50}` })).status);
    expect(st.slice(0, P.perAccountCodeAttempts).every((s) => s === 401)).toBe(true);
    expect((await authPost(h, '/auth/enrol/confirm', { token: links[4]!, code: '000000' }, { client: '198.51.100.99' })).status).toBe(429);
  });
});

describe('items 3 and 4: atomic counting and no lock-out of staff', () => {
  it('concurrent wrong sign-ins for one email: only the free attempts are verified, the rest are refused', async () => {
    const u = await enrol('concurrent');
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => signIn(u.email, '000000', { password: 'not the password!', client: `198.51.100.${100 + i}` })));
    const counts = res.reduce<Record<number, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
    expect(counts[401]).toBe(P.freeFailures);
    expect(counts[429]).toBe(20 - P.freeFailures);
  });

  it('wrong passwords from rotating addresses delay but never lock out: the manager signs in after the capped delay', async () => {
    const u = await enrol('rotate');
    h.clock.advance(60_000);
    let last = 0;
    for (let i = 0; i < 40; i++) {
      const r = await signIn(u.email, '000000', { password: 'guess guess guess', client: `198.18.0.${i}` });
      if (r.status === 429) expect(Number(r.headers.get('retry-after'))).toBeLessThanOrEqual(P.maxDelayS);
      else expect(r.status).toBe(401);
      h.clock.advance(1000);
      last = r.status;
    }
    expect([401, 429]).toContain(last);
    h.clock.advance(P.maxDelayS * 1000);
    expect((await signIn(u.email, codeFor(u.secret, h), { client: '198.51.100.250' })).status).toBe(200);
  });
});

describe('item 5: minors', () => {
  it('recovery codes are stored with a salted slow hash (V6.5.2)', async () => {
    const u = await enrol('rc-hash');
    const rows = await q<{ code_phc: string }>('select code_phc from recovery_codes where user_id = $1', [u.userId]);
    expect(rows).toHaveLength(10);
    for (const r of rows) expect(r.code_phc).toMatch(/^\$argon2id\$v=19\$/);
    expect(new Set(rows.map((r) => r.code_phc.split('$')[4])).size).toBe(10); // a salt per code
    expect((await signIn(u.email, u.recoveryCodes[3]!)).status).toBe(200);
  });

  it('/auth/reset/request answers at once and identically whether or not the account exists; mail is sent in the background', async () => {
    const u = await enrol('reset-timing');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = new FakeMailer();
    const sent: MailMessage[] = [];
    h.deps.mailer = { send: async (m) => (await gate, sent.push(m), slow.send(m)) };
    const timed = async (e: string) => {
      const t = Date.now();
      const r = await Promise.race([authPost(h, '/auth/reset/request', { email: e }), new Promise<null>((res) => setTimeout(() => res(null), 2000))]);
      return { r, ms: Date.now() - t };
    };
    const known = await timed(u.email);
    const unknown = await timed(email('ghost'));
    expect(known.r).not.toBeNull();
    expect(unknown.r).not.toBeNull();
    expect([known.r!.status, await known.r!.text()]).toEqual([unknown.r!.status, await unknown.r!.text()]);
    expect(sent).toHaveLength(0);
    release();
    await settleBackground();
    expect(sent.map((m) => m.to)).toEqual([u.email]);
  });

  it('inviting an address that belongs to another account or an operator looks the same as a new invitation', async () => {
    const fresh = await staffCall(h, 'POST', '/api/settings/users', ownerA, { email: email('fresh'), display_name: 'F', role: 'manager' });
    const other = await staffCall(h, 'POST', '/api/settings/users', ownerA, { email: `sam-${B.accountId}@example.test`, display_name: 'S', role: 'manager' });
    const op = await staffCall(h, 'POST', '/api/settings/users', ownerA, { email: 'op1@fixtriage.example', display_name: 'O', role: 'manager' });
    const shape = async (r: Response) => [r.status, await r.text()];
    used.push(`sam-${B.accountId}@example.test`, 'op1@fixtriage.example'); // the notices sent instead of invitations
    await settleBackground();
    const want = await shape(fresh);
    expect(await shape(other)).toEqual(want);
    expect(await shape(op)).toEqual(want);
    const [n] = await q<{ n: number }>(`select count(*)::int n from users where account_id = $1 and email in ($2, 'op1@fixtriage.example')`, [A.accountId, `sam-${B.accountId}@example.test`]);
    expect(n!.n).toBe(0);
    // The same address already in the inviting owner's own account is still reported (that is the owner's own data).
    expect((await staffCall(h, 'POST', '/api/settings/users', ownerA, { email: `lee-${A.accountId}@example.test`, display_name: 'L', role: 'manager' })).status).toBe(409);
  });

  it('two owners disabling each other at the same time leave one enabled owner', async () => {
    const second = randomUUID();
    await owner((c) => c.query(`insert into users (id, account_id, email, display_name, role, password_hash) values ($1, $2, $3, 'Second Owner', 'owner', 'x')`, [second, A.accountId, `owner2-${A.accountId}@example.test`]));
    const s2 = await seedSession(second);
    await owner((c) => c.query('delete from oncall_shifts where user_id = $1', [A.ownerId])); // otherwise EP-9 refuses first
    const [r1, r2] = await Promise.all([staffCall(h, 'POST', `/api/settings/users/${second}/disable`, ownerA), staffCall(h, 'POST', `/api/settings/users/${A.ownerId}/disable`, s2)]);
    const st = [r1.status, r2.status].sort();
    expect(st[0]).toBe(200);
    expect([401, 409]).toContain(st[1]); // the loser is refused (last owner) or already signed out (its owner was disabled)
    const [n] = await q<{ n: number }>(`select count(*)::int n from users where account_id = $1 and role = 'owner' and disabled_at is null`, [A.accountId]);
    expect(n!.n).toBe(1);
  });

  it('V3.5.1: every state-changing staff, operator and sign-out route refuses a request without the anti-forgery header', async () => {
    const staffS = await seedSession(A.ownerId);
    const keys = Object.keys(h.handlers).filter((k) => k.startsWith('POST /api/') || k.startsWith('POST /ops/') || k === 'POST /auth/sign-out');
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const k of keys) {
      const path = k.slice(5).replace(/:id/g, randomUUID());
      const req = new Request(`http://internal${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: staffS.cookie }, body: '{}' });
      const r = await call(h, 'POST', path, req);
      expect([k, r.status]).toEqual([k, 403]);
      const wrong = new Request(`http://internal${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: staffS.cookie, [CSRF_HEADER]: 'x'.repeat(43) }, body: '{}' });
      expect([k, (await call(h, 'POST', path, wrong)).status]).toEqual([k, 403]);
    }
    expect(route(h.handlers, 'POST', '/auth/sign-out')).not.toBeNull();
    expect(SESSION_COOKIE).toBe('__Host-ft_session');
  });
});
