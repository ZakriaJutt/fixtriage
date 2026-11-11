// B2 sign-in end to end (T-2.1.3; TRD 8.1, 8.7): invitation mailed over SMTP and read back from Mailpit, password plus
// TOTP enrolment, sign-in, code and link reuse refused, expiry, rotation, sign-out, rate limit, reset through Mailpit,
// disable, owner re-enrolment of a manager, operator sign-in and cross-account refusal. Synthetic data only.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { base32Encode, hashPassword, newTotpSecret, seal, setLogSink } from '@fixtriage/platform';
import { inviteFirstOwner, SIGN_IN_POLICY } from '@fixtriage/services';
import { AUTH_FUNCTIONS, sql, tables, withAccount } from '@fixtriage/db';
import { harness, owner, q, resetData, seedAccount, seedSession, staffCall, TEST_TOTP_KEY, type Harness, type Seeded } from './helpers';
import { authPost, codeFor, deleteMailTo, mailCount, mailTo, sessionFrom, smtpMailer, tokenFromMail, uniqueEmail } from './b2-helpers';

const PASSWORD = 'maple court boiler 2027';
const used: string[] = [];
let h: Harness;
let A: Seeded;
let B: Seeded;
let ownerA: { cookie: string; csrf: string };

beforeEach(async () => {
  await resetData();
  h = harness('2027-03-01T18:00:00Z', { mailer: smtpMailer() });
  A = await seedAccount(h.deps.database, 1);
  B = await seedAccount(h.deps.database, 2);
  ownerA = await seedSession(A.ownerId); // test shortcut for the inviting owner only; every other session below is real
});
afterAll(async () => deleteMailTo(used));

function email(tag: string): string {
  const e = uniqueEmail(tag);
  used.push(e);
  return e;
}

/** Owner invites; the invitee reads the mail in Mailpit, sets a password, scans the secret and confirms with a code. */
async function enrol(tag: string, role: 'manager' | 'owner' = 'manager', client = '198.51.100.10') {
  const to = email(tag);
  const inv = await staffCall(h, 'POST', '/api/settings/users', ownerA, { email: to, display_name: `Test ${tag}`, role });
  expect(inv.status).toBe(201);
  const userId = ((await inv.json()) as { user_id: string }).user_id;
  const mail = await mailTo(to);
  const token = tokenFromMail(mail.text, 'enrol');
  const start = await authPost(h, '/auth/enrol/start', { token, password: PASSWORD }, { client });
  expect(start.status).toBe(200);
  const { secret, otpauth_uri } = (await start.json()) as { secret: string; otpauth_uri: string };
  expect(otpauth_uri).toMatch(/^otpauth:\/\/totp\/FixTriage%3A/);
  const conf = await authPost(h, '/auth/enrol/confirm', { token, code: codeFor(secret, h) }, { client });
  expect(conf.status).toBe(200);
  const body = (await conf.json()) as { recovery_codes: string[]; role: string };
  return { email: to, userId, secret, token, session: sessionFrom(conf), recoveryCodes: body.recovery_codes, mail };
}

const signIn = (e: string, code: string, opts: { password?: string; client?: string; cookie?: string } = {}) =>
  authPost(h, '/auth/sign-in', { email: e, password: opts.password ?? PASSWORD, code }, { client: opts.client ?? '198.51.100.20', ...(opts.cookie ? { cookie: opts.cookie } : {}) });

describe('B2 sign-in through Mailpit', () => {
  it('invitation mail arrives over SMTP; enrolment sets password and TOTP, returns 10 recovery codes and a secure session', async () => {
    const u = await enrol('invite');
    expect(u.mail.subject).toMatch(/invited/);
    expect(u.mail.text).toContain('https://app.fixtriage.example/enrol#token=');
    expect(u.recoveryCodes).toHaveLength(10);
    const sc = u.session.setCookies.find((c) => c.startsWith('__Host-ft_session='))!;
    for (const attr of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax', 'Max-Age=604800']) expect(sc).toContain(attr);
    expect(sc).not.toMatch(/Domain=/i);
    const [row] = await q<{ password_hash: string; totp_secret_enc: Buffer; totp_confirmed_at: Date }>('select password_hash, totp_secret_enc, totp_confirmed_at from users where id = $1', [u.userId]);
    expect(row!.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(row!.totp_secret_enc.includes(Buffer.from(u.secret))).toBe(false); // stored encrypted
    expect(row!.totp_confirmed_at).not.toBeNull();
    // The session works on a staff route: an unknown incident is "not found", not "no session".
    expect((await staffCall(h, 'GET', `/api/incidents/${randomUUID()}`, u.session)).status).toBe(404);
    expect((await staffCall(h, 'GET', `/api/incidents/${randomUUID()}`, null)).status).toBe(401);
    // Tokens stored hashed only.
    const [s] = await q<{ n: number }>('select count(*)::int n from sessions where user_id = $1', [u.userId]);
    expect(s!.n).toBe(1);
    expect(JSON.stringify(await q('select token_hash, csrf_token_hash from sessions where user_id = $1', [u.userId]))).not.toContain(u.session.cookie.split('=')[1]!);
  });

  it('an enrolment link is refused once used and after 72 hours; a weak or common password is refused', async () => {
    const u = await enrol('reuse');
    expect((await authPost(h, '/auth/enrol/start', { token: u.token, password: PASSWORD })).status).toBe(410);
    const to = email('expiry');
    await staffCall(h, 'POST', '/api/settings/users', ownerA, { email: to, display_name: 'Exp', role: 'manager' });
    const token = tokenFromMail((await mailTo(to)).text, 'enrol');
    const short = await authPost(h, '/auth/enrol/start', { token, password: 'short pw' });
    expect(short.status).toBe(422);
    expect(((await short.json()) as { error: { message: string } }).error.message).toBe('too_short');
    expect((await authPost(h, '/auth/enrol/start', { token, password: 'password1234' })).status).toBe(422);
    h.clock.advance(SIGN_IN_POLICY.inviteTtlMs + 1000);
    expect((await authPost(h, '/auth/enrol/start', { token, password: PASSWORD })).status).toBe(410);
    // An invited user who never enrolled cannot sign in.
    expect((await signIn(to, '000000')).status).toBe(401);
  });

  it('password plus TOTP signs in; the same code is refused the second time; a wrong factor gets one generic answer', async () => {
    const u = await enrol('signin');
    h.clock.advance(60_000);
    const code = codeFor(u.secret, h);
    const ok = await signIn(u.email, code);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { role: string }).role).toBe('manager');
    const replay = await signIn(u.email, code);
    expect(replay.status).toBe(401);
    const bodies = [await replay.json(), await (await signIn(u.email, codeFor(u.secret, h, 1), { password: 'wrong password here' })).json(), await (await signIn(email('nobody'), '123456')).json()] as Array<{ error: { code: string; message: string } }>;
    for (const b of bodies) expect([b.error.code, b.error.message]).toEqual(['invalid_credentials', 'email, password or code not accepted']);
  });

  it('a recovery code signs in once and is refused the second time', async () => {
    const u = await enrol('recovery');
    const rc = u.recoveryCodes[0]!;
    expect((await signIn(u.email, rc)).status).toBe(200);
    expect((await signIn(u.email, rc)).status).toBe(401);
    expect((await signIn(u.email, u.recoveryCodes[1]!.replace('-', '').toLowerCase())).status).toBe(200);
  });

  it('a new session token is issued at every sign-in and the presented one is revoked (rotation)', async () => {
    const u = await enrol('rotate');
    h.clock.advance(60_000);
    const r = await signIn(u.email, codeFor(u.secret, h), { cookie: u.session.cookie });
    expect(r.status).toBe(200);
    const s2 = sessionFrom(r);
    expect(s2.cookie).not.toBe(u.session.cookie);
    expect((await staffCall(h, 'GET', `/api/incidents/${randomUUID()}`, u.session)).status).toBe(401);
    expect((await staffCall(h, 'GET', `/api/incidents/${randomUUID()}`, s2)).status).toBe(404);
  });

  it('sign-out needs the anti-forgery token, ends the session server-side and clears the cookies', async () => {
    const u = await enrol('signout');
    expect((await authPost(h, '/auth/sign-out', {}, { cookie: u.session.cookie })).status).toBe(403);
    const out = await authPost(h, '/auth/sign-out', {}, { cookie: u.session.cookie, csrf: u.session.csrf });
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie().every((c) => c.includes('Max-Age=0'))).toBe(true);
    expect((await staffCall(h, 'GET', `/api/incidents/${randomUUID()}`, u.session)).status).toBe(401);
    const [s] = await q<{ revoked_at: Date | null }>('select revoked_at from sessions where user_id = $1', [u.userId]);
    expect(s!.revoked_at).not.toBeNull();
  });

  it('sessions end after 8 hours without activity and after 7 days in all; activity keeps a session alive', async () => {
    const u = await enrol('expiry-session');
    await owner((c) => c.query(`update sessions set last_seen_at = now() - interval '7 hours' where user_id = $1`, [u.userId]));
    expect((await staffCall(h, 'GET', `/api/incidents/${randomUUID()}`, u.session)).status).toBe(404); // touches last_seen_at
    const [t] = await q<{ fresh: boolean }>(`select last_seen_at > now() - interval '1 minute' as fresh from sessions where user_id = $1`, [u.userId]);
    expect(t!.fresh).toBe(true);
    await owner((c) => c.query(`update sessions set last_seen_at = now() - interval '8 hours 1 minute' where user_id = $1`, [u.userId]));
    expect((await staffCall(h, 'GET', `/api/incidents/${randomUUID()}`, u.session)).status).toBe(401);
    const v = await enrol('expiry-absolute');
    await owner((c) => c.query(`update sessions set expires_at = now() - interval '1 second' where user_id = $1`, [v.userId]));
    expect((await staffCall(h, 'GET', `/api/incidents/${randomUUID()}`, v.session)).status).toBe(401);
  });

  it('five failed sign-ins lock the email for 15 minutes, even with the right password and code (429 with Retry-After)', async () => {
    const u = await enrol('ratelimit');
    h.clock.advance(60_000);
    const codes: number[] = [];
    for (let i = 0; i < SIGN_IN_POLICY.perEmailFailures; i++) codes.push((await signIn(u.email, '000000', { password: 'not the password!' })).status);
    expect(codes).toEqual([401, 401, 401, 401, 429]);
    const locked = await signIn(u.email, codeFor(u.secret, h));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(800);
    // The per-client limit also trips for one address spraying many emails.
    const statuses: number[] = [];
    for (let i = 0; i < SIGN_IN_POLICY.perClientAttempts + 1; i++) statuses.push((await signIn(`spray-${i}@example.test`, '000000', { client: '203.0.113.9' })).status);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
  });

  it('reset: link through Mailpit, still needs a TOTP or recovery code, ends old sessions; link reuse and expiry refused', async () => {
    const u = await enrol('reset');
    expect((await authPost(h, '/auth/reset/request', { email: u.email })).status).toBe(202);
    const mail = await mailTo(u.email, { count: 2 });
    expect(mail.subject).toMatch(/reset/);
    const token = tokenFromMail(mail.text, 'reset');
    const NEW = 'granville tap washer 31';
    h.clock.advance(60_000);
    expect((await authPost(h, '/auth/reset/complete', { token, code: '000000', password: NEW })).status).toBe(401); // no factor, no reset
    expect((await authPost(h, '/auth/reset/complete', { token, code: codeFor(u.secret, h), password: NEW })).status).toBe(204);
    expect((await staffCall(h, 'GET', `/api/incidents/${randomUUID()}`, u.session)).status).toBe(401); // old session ended
    expect((await authPost(h, '/auth/reset/complete', { token, code: u.recoveryCodes[0]!, password: NEW })).status).toBe(410); // reused
    h.clock.advance(60_000);
    expect((await signIn(u.email, codeFor(u.secret, h), { password: PASSWORD })).status).toBe(401);
    expect((await signIn(u.email, codeFor(u.secret, h), { password: NEW })).status).toBe(200);
    // Expired link.
    await authPost(h, '/auth/reset/request', { email: u.email });
    const t2 = tokenFromMail((await mailTo(u.email, { count: 3 })).text, 'reset');
    h.clock.advance(SIGN_IN_POLICY.resetTtlMs + 1000);
    expect((await authPost(h, '/auth/reset/complete', { token: t2, code: u.recoveryCodes[0]!, password: NEW })).status).toBe(410);
    // Unknown address: same answer, no mail.
    const ghost = email('ghost');
    expect((await authPost(h, '/auth/reset/request', { email: ghost })).status).toBe(202);
    await new Promise((r) => setTimeout(r, 300));
    expect(await mailCount(ghost)).toBe(0);
  });

  it('a pre-session auth route refuses a non-JSON body (login CSRF)', async () => {
    const r = await authPost(h, '/auth/sign-in', { email: 'x@example.test', password: PASSWORD, code: '123456' }, { contentType: 'application/x-www-form-urlencoded' });
    expect(r.status).toBe(401);
  });

  it('disable ends the user\'s sessions and sign-in; refused for an on-call user and for a manager', async () => {
    const u = await enrol('disable');
    const mgr = await enrol('disable-mgr');
    expect((await staffCall(h, 'POST', `/api/settings/users/${u.userId}/disable`, mgr.session)).status).toBe(403); // owner only (schema.md 4)
    expect((await staffCall(h, 'POST', `/api/settings/users/${A.lee}/disable`, ownerA)).status).toBe(409); // on call: EP-9
    const d = await staffCall(h, 'POST', `/api/settings/users/${u.userId}/disable`, ownerA);
    expect(d.status).toBe(200);
    expect(((await d.json()) as { revokedSessions: number }).revokedSessions).toBe(1);
    expect((await staffCall(h, 'GET', `/api/incidents/${randomUUID()}`, u.session)).status).toBe(401);
    h.clock.advance(60_000);
    expect((await signIn(u.email, codeFor(u.secret, h))).status).toBe(401);
  });

  it('a manager cannot invite; the owner re-enrols a manager: old factor and sessions stop, a new link arrives in Mailpit', async () => {
    const m = await enrol('reenrol');
    expect((await staffCall(h, 'POST', '/api/settings/users', m.session, { email: email('x'), display_name: 'X', role: 'manager' })).status).toBe(403);
    expect((await staffCall(h, 'POST', `/api/settings/users/${m.userId}/reenrol`, ownerA)).status).toBe(202);
    expect((await staffCall(h, 'GET', `/api/incidents/${randomUUID()}`, m.session)).status).toBe(401);
    h.clock.advance(60_000);
    expect((await signIn(m.email, codeFor(m.secret, h))).status).toBe(401);
    expect((await signIn(m.email, m.recoveryCodes[2]!)).status).toBe(401);
    const mail = await mailTo(m.email, { count: 2 });
    expect(mail.subject).toMatch(/authenticator again/);
    const token = tokenFromMail(mail.text, 'enrol');
    const start = (await (await authPost(h, '/auth/enrol/start', { token, password: PASSWORD })).json()) as { secret: string };
    expect((await authPost(h, '/auth/enrol/confirm', { token, code: codeFor(start.secret, h) })).status).toBe(200);
    // The owner's own factor is never reset by an owner.
    expect((await staffCall(h, 'POST', `/api/settings/users/${A.ownerId}/reenrol`, ownerA)).status).toBe(403);
  });

  it('cross-account: A\'s session cannot reach B\'s users; revoke-sessions with B\'s user ID changes nothing', async () => {
    const u = await enrol('cross');
    const bSession = await seedSession(B.lee);
    for (const path of [`/api/settings/users/${B.sam}/disable`, `/api/settings/users/${B.sam}/reenrol`]) expect((await staffCall(h, 'POST', path, ownerA)).status).toBe(404);
    const n = await withAccount(h.deps.database, A.accountId, async (tx) => (await tx.execute(sql`select auth_revoke_user_sessions(${B.lee}) as n`)).rows[0] as { n: number });
    expect(n.n).toBe(0);
    expect((await staffCall(h, 'GET', `/api/incidents/${randomUUID()}`, bSession)).status).toBe(404); // B's session still live
    expect((await staffCall(h, 'GET', `/api/incidents/${randomUUID()}`, u.session)).status).toBe(404);
  });

  it('first owner of a new account: invited by an operator, enrolled through Mailpit, then signs in', async () => {
    const accountId = randomUUID();
    await withAccount(h.deps.database, accountId, (tx) => tx.insert(tables.accounts).values({ id: accountId, name: 'Example Realty New', businessHours: {}, plan: 'pilot', status: 'onboarding' }));
    const to = email('first-owner');
    await inviteFirstOwner(h.deps, accountId, { email: to, displayName: 'New Owner', operatorId: randomUUID() });
    const token = tokenFromMail((await mailTo(to)).text, 'enrol');
    const start = (await (await authPost(h, '/auth/enrol/start', { token, password: PASSWORD })).json()) as { secret: string };
    const c = await authPost(h, '/auth/enrol/confirm', { token, code: codeFor(start.secret, h) });
    expect(((await c.json()) as { role: string }).role).toBe('owner');
    h.clock.advance(30_000);
    expect((await signIn(to, codeFor(start.secret, h))).status).toBe(200);
    await expect(inviteFirstOwner(h.deps, accountId, { email: email('second'), displayName: 'Two', operatorId: randomUUID() })).rejects.toThrow(/owner_exists/);
  });

  it('operator signs in with password and TOTP through the same route and reaches /ops; a staff session cannot', async () => {
    const secret = newTotpSecret();
    const opId = randomUUID();
    const opEmail = 'op-b2@fixtriage.example';
    await owner(async (c) => c.query('insert into operators (id, email, display_name, mobile, level4_rank, password_hash, totp_secret_enc) values ($1, $2, $3, $4, 1, $5, $6)', [opId, opEmail, 'Primary Operator', '+16045559901', await hashPassword(PASSWORD), seal(TEST_TOTP_KEY, secret)]));
    const code = codeFor(base32Encode(secret), h);
    const r = await signIn(opEmail, code);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { kind: string }).kind).toBe('operator');
    const s = sessionFrom(r);
    expect((await staffCall(h, 'GET', '/ops/jobs/dead', s)).status).toBe(200);
    expect((await signIn(opEmail, code)).status).toBe(401); // replay
    const u = await enrol('not-operator');
    expect((await staffCall(h, 'GET', '/ops/jobs/dead', u.session)).status).toBe(403);
  });

  it('auth logs carry no email addresses, codes or tokens', async () => {
    const lines: string[] = [];
    setLogSink((l) => lines.push(l), 'debug');
    let u: Awaited<ReturnType<typeof enrol>>;
    try {
      u = await enrol('logs');
      await signIn(u.email, '000000');
      await authPost(h, '/auth/reset/request', { email: u.email });
    } finally {
      setLogSink((l) => process.stdout.write(l + '\n'), 'warn');
    }
    const all = lines.join('');
    expect(all).toContain('auth.sign_in_failed');
    expect(all).not.toContain(u!.email);
    expect(all).not.toContain(u!.token);
    expect(all).not.toContain(u!.secret);
  });

  it('schema.md 4: the application role has no grant on sessions or auth_throttle; the auth_* writers are SECURITY DEFINER', async () => {
    for (const t of ['sessions', 'auth_throttle']) {
      await expect(h.deps.database.pool.query(`select * from ${t} limit 1`)).rejects.toThrow(/permission denied/);
      await expect(h.deps.database.pool.query(`delete from ${t}`)).rejects.toThrow(/permission denied/);
    }
    const fns = await q<{ proname: string; prosecdef: boolean }>(`select proname, prosecdef from pg_proc where proname like 'auth\\_%'`);
    expect(fns.map((f) => f.proname).sort()).toEqual([...AUTH_FUNCTIONS].sort());
    expect(fns.every((f) => f.prosecdef)).toBe(true);
    // A session cannot be created for an invited user who has not enrolled.
    const to = email('noenrol');
    const r = await staffCall(h, 'POST', '/api/settings/users', ownerA, { email: to, display_name: 'N', role: 'manager' });
    const id = ((await r.json()) as { user_id: string }).user_id;
    await expect(h.deps.database.pool.query('select auth_create_session($1, null, $2, $3)', [id, Buffer.alloc(32, 1), Buffer.alloc(32, 2)])).rejects.toThrow(/not eligible/);
  });
});
