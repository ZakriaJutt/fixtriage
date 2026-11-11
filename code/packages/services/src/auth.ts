// Staff sign-in (TRD 8.1, 8.7; T-2.1.3; MH-14): password plus TOTP for every user and operator, recovery codes,
// sessions in the database (opaque tokens stored hashed), invitations, reset, disable and owner re-enrolment of a
// manager. No magic links and no SMS codes (CLAUDE.md prohibited shortcut 11): emailed links only start enrolment or a
// reset, and a reset still needs a TOTP or recovery code. Database access outside withAccount is limited to
// resolve_login, resolve_capability, resolve_session and the auth_* functions (schema.md 4).
import { and, eq, isNull, resolvers, sql, tables, type Tx } from '@fixtriage/db';
import {
  checkPasswordPolicy,
  dummyPasswordWork,
  hashPassword,
  looksLikeRecoveryCode,
  matchTotp,
  newOpaqueToken,
  newRecoveryCodes,
  newTotpSecret,
  open,
  otpauthUri,
  publicUrl,
  normaliseRecoveryCode,
  seal,
  sha256,
  UNSET_PASSWORD,
  verifyPassword,
  type Mailer,
  type PasswordProblem,
} from '@fixtriage/platform';
import { audit, ConflictError, ForbiddenError, NotFoundError, serviceLog, withAccount, type Deps } from './context';
import { AuthError, type StaffPrincipal } from './staff';

export interface AuthDeps extends Deps {
  mailer: Mailer;
  /** AES-256-GCM key for users.totp_secret_enc and operators.totp_secret_enc. */
  totpKey: Buffer;
}

/**
 * Rate-limit policy (V6.3.1, V6.1.1; TRD 8.1, App-flow S-01). Security round item 4: no hard lock of a sign-in
 * identity, so that nobody can lock the on-call manager out; instead a capped back-off per identity (normalised
 * email, whether or not it exists) plus the per-client limit. Every limit is counted atomically before the
 * credentials are checked (item 3).
 */
export const SIGN_IN_POLICY = {
  /** Sign-in attempts per identity before a wait starts; then 1 s, 2 s, 4 s ... between attempts, at most maxDelayS. */
  freeFailures: 5,
  maxDelayS: 30,
  backoffWindowS: 15 * 60,
  /** All sign-in, reset and enrolment attempts per client address. */
  perClientAttempts: 30,
  perClientWindowS: 15 * 60,
  perClientLockS: 15 * 60,
  /** Reset requests per email (stops mail flooding). */
  perEmailResets: 3,
  perEmailResetWindowS: 60 * 60,
  /** Code attempts on one enrolment or reset link; the link is burned when they are used up (item 2). */
  perLinkCodeAttempts: 5,
  /** Code attempts on all enrolment and reset links of one account per window (item 2). */
  perAccountCodeAttempts: 20,
  perAccountCodeWindowS: 15 * 60,
  inviteTtlMs: 72 * 3600_000,
  resetTtlMs: 30 * 60_000,
} as const;

export class SignInError extends Error {
  override name = 'SignInError';
  constructor(
    public readonly code: 'invalid_credentials' | 'rate_limited' | 'invalid_link' | 'weak_password' | 'invalid_code',
    public readonly retryAfterS = 0,
    public readonly detail?: PasswordProblem,
  ) {
    super(code);
  }
}

const pending = new Set<Promise<unknown>>();

/** Work that must not delay or shape a response (reset mail, notices). Failures are logged, never thrown. */
export function background(p: Promise<unknown>): void {
  const q = p.catch((e: unknown) => serviceLog.error('auth.background_failed', { error: e instanceof Error ? e.name : 'unknown' })).finally(() => pending.delete(q));
  pending.add(q);
}

/** Waits for all background work (tests, graceful shutdown). */
export async function settleBackground(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

const throttleKey = (scope: string, value: string) => sha256(`${scope}:${value.trim().toLowerCase()}`);

/** Fixed-window limit, counted and decided in one locked statement. 0 = go ahead; else seconds to wait. */
async function throttleTake(deps: Deps, key: Buffer, limit: number, windowS: number, lockS: number): Promise<number> {
  const r = await deps.database.pool.query('select auth_throttle_take($1, $2, $3, $4, $5) as s', [key, deps.clock.now(), limit, windowS, lockS]);
  return Number(r.rows[0].s);
}
/** Capped back-off per sign-in identity (item 4). 0 = go ahead; else seconds to wait (at most maxDelayS). */
async function backoffTake(deps: Deps, key: Buffer): Promise<number> {
  const p = SIGN_IN_POLICY;
  const r = await deps.database.pool.query('select auth_backoff_take($1, $2, $3, $4, $5) as s', [key, deps.clock.now(), p.freeFailures, p.maxDelayS, p.backoffWindowS]);
  return Number(r.rows[0].s);
}
async function throttleClear(deps: Deps, key: Buffer): Promise<void> {
  await deps.database.pool.query('select auth_throttle_clear($1)', [key]);
}

/** Per-client attempt counter shared by every unauthenticated auth route. */
async function countClientAttempt(deps: Deps, client: string): Promise<void> {
  const p = SIGN_IN_POLICY;
  const wait = await throttleTake(deps, throttleKey('client', client), p.perClientAttempts, p.perClientWindowS, p.perClientLockS);
  if (wait > 0) throw new SignInError('rate_limited', wait);
}

/**
 * Item 2: a code attempt on an enrolment or reset link counts against the link (burned when used up) and against
 * the account, before the code is checked.
 */
async function countLinkCodeAttempt(deps: Deps, token: string, link: { accountId: string }): Promise<void> {
  const p = SIGN_IN_POLICY;
  const acct = await throttleTake(deps, throttleKey('link-codes-account', link.accountId), p.perAccountCodeAttempts, p.perAccountCodeWindowS, p.perAccountCodeWindowS);
  if (acct > 0) throw new SignInError('rate_limited', acct);
  const ttlS = Math.ceil(Math.max(p.inviteTtlMs, p.resetTtlMs) / 1000);
  const perLink = await throttleTake(deps, throttleKey('link-codes', sha256(token).toString('hex')), p.perLinkCodeAttempts, ttlS, ttlS);
  if (perLink > 0) {
    await withAccount(deps.database, link.accountId, (tx) => tx.update(tables.capabilityTokens).set({ usedAt: deps.clock.now() }).where(and(eq(tables.capabilityTokens.tokenHash, sha256(token)), isNull(tables.capabilityTokens.usedAt))));
    serviceLog.warn('auth.link_burned', { reason: 'code_attempts' });
    throw new SignInError('invalid_link');
  }
}

export interface NewSession {
  token: string;
  csrf: string;
  expiresAt: Date;
}

async function createSession(deps: Deps, principal: { userId: string } | { operatorId: string }): Promise<NewSession> {
  const t = newOpaqueToken();
  const c = newOpaqueToken();
  const r = await deps.database.pool.query('select auth_create_session($1, $2, $3, $4) as e', [
    'userId' in principal ? principal.userId : null,
    'operatorId' in principal ? principal.operatorId : null,
    t.hash,
    c.hash,
  ]);
  return { token: t.token, csrf: c.token, expiresAt: r.rows[0].e as Date };
}

export async function revokeSession(deps: Deps, token: string | null): Promise<void> {
  if (token) await deps.database.pool.query('select auth_revoke_session($1)', [sha256(token)]);
}

async function revokeUserSessions(tx: Tx, userId: string): Promise<number> {
  const r = await tx.execute(sql`select auth_revoke_user_sessions(${userId}) as n`);
  return Number((r.rows[0] as { n: number }).n);
}

/** Accepts a TOTP code once (stores the step) or a recovery code once (marks it used), for a user, inside withAccount. */
async function acceptUserSecondFactor(tx: Tx, deps: AuthDeps, user: { id: string; totpSecretEnc: Buffer | null; totpLastStep: number | null }, code: string): Promise<'totp' | 'recovery' | null> {
  const c = code.trim();
  if (/^\d{6}$/.test(c) && user.totpSecretEnc) {
    const step = matchTotp(open(deps.totpKey, user.totpSecretEnc), c, deps.clock.now(), user.totpLastStep);
    if (step === null) return null;
    const r = await tx
      .update(tables.users)
      .set({ totpLastStep: step })
      .where(and(eq(tables.users.id, user.id), sql`(${tables.users.totpLastStep} is null or ${tables.users.totpLastStep} < ${step})`))
      .returning({ id: tables.users.id });
    return r.length === 1 ? 'totp' : null;
  }
  if (looksLikeRecoveryCode(c)) {
    // V6.5.2: salted Argon2id per code, so every unused code is verified in turn (at most ten).
    const unused = await tx.select({ id: tables.recoveryCodes.id, phc: tables.recoveryCodes.codePhc }).from(tables.recoveryCodes).where(and(eq(tables.recoveryCodes.userId, user.id), isNull(tables.recoveryCodes.usedAt)));
    for (const u of unused) {
      if (!(await verifyPassword(normaliseRecoveryCode(c), u.phc))) continue;
      const r = await tx.update(tables.recoveryCodes).set({ usedAt: deps.clock.now() }).where(and(eq(tables.recoveryCodes.id, u.id), isNull(tables.recoveryCodes.usedAt))).returning({ id: tables.recoveryCodes.id });
      return r.length === 1 ? 'recovery' : null;
    }
    return null;
  }
  return null;
}

export interface SignInResult extends NewSession {
  kind: 'user' | 'operator';
  role: 'owner' | 'manager' | 'operator';
  accountId: string | null;
}

/**
 * POST /auth/sign-in: email, password and a 6-digit code (or a recovery code) in one request, one generic error.
 * A session presented with the request is revoked: a new token is always issued (rotation at sign-in, V7.2.4).
 */
export async function signIn(deps: AuthDeps, input: { email: string; password: string; code: string; client: string; presentedToken?: string | null }): Promise<SignInResult> {
  await countClientAttempt(deps, input.client);
  // Item 3: the attempt is counted (and the wait decided) atomically before the password is checked.
  const emailKey = throttleKey('signin-email', input.email);
  const wait = await backoffTake(deps, emailKey);
  if (wait > 0) {
    serviceLog.warn('auth.sign_in_delayed', { wait_s: wait });
    throw new SignInError('rate_limited', wait);
  }
  const fail = async (): Promise<never> => {
    serviceLog.warn('auth.sign_in_failed', {});
    throw new SignInError('invalid_credentials');
  };
  const r = await deps.database.pool.query('select * from resolve_login($1)', [input.email.trim()]);
  const row = r.rows[0] as { user_id: string | null; operator_id: string | null; account_id: string | null; password_hash: string; totp_secret_enc: Buffer | null; totp_confirmed_at: Date | null; totp_last_step: string | null; disabled_at: Date | null } | undefined;
  if (!row) {
    await dummyPasswordWork(input.password);
    return fail();
  }
  const pwOk = await verifyPassword(input.password, row.password_hash);
  if (!pwOk || row.disabled_at || !row.totp_secret_enc) return fail();
  const lastStep = row.totp_last_step === null ? null : Number(row.totp_last_step);

  let result: Omit<SignInResult, keyof NewSession>;
  let session: NewSession;
  if (row.operator_id) {
    const step = matchTotp(open(deps.totpKey, row.totp_secret_enc), input.code.trim(), deps.clock.now(), lastStep);
    if (step === null) return fail();
    const ok = await deps.database.pool.query('select auth_operator_accept_totp($1, $2) as ok', [row.operator_id, step]);
    if (!ok.rows[0].ok) return fail();
    session = await createSession(deps, { operatorId: row.operator_id });
    result = { kind: 'operator', role: 'operator', accountId: null };
  } else {
    if (!row.totp_confirmed_at || !row.account_id || !row.user_id) return fail();
    const accountId = row.account_id;
    const userId = row.user_id;
    const factor = await withAccount(deps.database, accountId, async (tx) => {
      const f = await acceptUserSecondFactor(tx, deps, { id: userId, totpSecretEnc: row.totp_secret_enc, totpLastStep: lastStep }, input.code);
      if (f) await audit(tx, { accountId, actorKind: 'user', actorId: userId, action: f === 'recovery' ? 'auth.sign_in_recovery_code' : 'auth.sign_in', objectType: 'user', objectId: userId }, deps.clock.now());
      return f;
    });
    if (!factor) return fail();
    session = await createSession(deps, { userId });
    const [u] = await withAccount(deps.database, accountId, (tx) => tx.select({ role: tables.users.role }).from(tables.users).where(eq(tables.users.id, userId)));
    result = { kind: 'user', role: u!.role as 'owner' | 'manager', accountId };
  }
  await throttleClear(deps, emailKey);
  await revokeSession(deps, input.presentedToken ?? null);
  serviceLog.info('auth.sign_in', { kind: result.kind });
  return { ...result, ...session };
}

export async function signOut(deps: Deps, token: string | null): Promise<void> {
  await revokeSession(deps, token);
}

// ---------- Invitations and enrolment ----------

function requireOwner(p: StaffPrincipal): void {
  if (p.role !== 'owner') throw new ForbiddenError('owner role required'); // schema.md 4: users are owner read/write
}

async function issueLink(tx: Tx, deps: AuthDeps, accountId: string, userId: string, purpose: 'invite' | 'reset'): Promise<string> {
  const now = deps.clock.now();
  // One live link per user and purpose: older unused links of the same purpose stop working.
  await tx.update(tables.capabilityTokens).set({ usedAt: now }).where(and(eq(tables.capabilityTokens.userId, userId), eq(tables.capabilityTokens.purpose, purpose), isNull(tables.capabilityTokens.usedAt)));
  const t = newOpaqueToken();
  const ttl = purpose === 'invite' ? SIGN_IN_POLICY.inviteTtlMs : SIGN_IN_POLICY.resetTtlMs;
  await tx.insert(tables.capabilityTokens).values({ accountId, purpose, tokenHash: t.hash, userId, expiresAt: new Date(now.getTime() + ttl), createdAt: now });
  return t.token;
}

/** Link in the URL fragment, so the token never reaches a server log or a Referer header (V14.2.1). */
const linkFor = (deps: Deps, purpose: 'invite' | 'reset', token: string) => publicUrl(deps.publicBaseUrl, `/${purpose === 'invite' ? 'enrol' : 'reset'}#token=${token}`);

async function sendInvite(deps: AuthDeps, email: string, token: string, reenrol: boolean): Promise<void> {
  await deps.mailer.send({
    to: email,
    subject: reenrol ? 'FixTriage: set up your authenticator again' : 'FixTriage: you have been invited',
    text: [
      reenrol ? 'Your FixTriage authenticator was reset by your account owner.' : 'You have been invited to FixTriage.',
      'Open this link to set your password and your authenticator app. It works once and expires in 72 hours:',
      linkFor(deps, 'invite', token),
      'If you did not expect this message, ignore it.',
    ].join('\n\n'),
  });
}

/** POST /api/settings/users: an owner invites a manager or owner. The user exists at once but cannot sign in until enrolled. */
export async function inviteUser(deps: AuthDeps, p: StaffPrincipal, input: { email: string; displayName: string; role: 'owner' | 'manager' }): Promise<{ userId: string | null }> {
  requireOwner(p);
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ConflictError('invalid_email');
  if (!input.displayName.trim()) throw new ConflictError('invalid_name');
  if (input.role !== 'owner' && input.role !== 'manager') throw new ConflictError('invalid_role');
  // Item 5: only this account's own users are reported as "in use". An address used by another account or an operator
  // gets the same answer as a new invitation and a notice to that address instead of an invitation (no user created).
  const elsewhere = await deps.database.pool.query('select user_id, account_id from resolve_login($1)', [email]);
  const row = elsewhere.rows[0] as { user_id: string | null; account_id: string | null } | undefined;
  if (row && row.account_id === p.accountId) throw new ConflictError('email_in_use');
  if (row) {
    await withAccount(deps.database, p.accountId, (tx) => audit(tx, { accountId: p.accountId, actorKind: 'user', actorId: p.userId, action: 'user.invite_address_unavailable', objectType: 'account', objectId: p.accountId }, deps.clock.now()));
    background(
      deps.mailer.send({ to: email, subject: 'FixTriage: an invitation could not be completed', text: 'Someone tried to invite this email address to a FixTriage account. One address can belong to one FixTriage sign-in only, so no invitation was created. If you expected it, ask the sender to use a different address.' }),
    );
    return { userId: null };
  }
  const { userId, token } = await withAccount(deps.database, p.accountId, async (tx) => {
    const now = deps.clock.now();
    const [u] = await tx.insert(tables.users).values({ accountId: p.accountId, email, displayName: input.displayName.trim(), role: input.role, passwordHash: UNSET_PASSWORD, createdAt: now, updatedAt: now }).returning({ id: tables.users.id });
    const token = await issueLink(tx, deps, p.accountId, u!.id, 'invite');
    await audit(tx, { accountId: p.accountId, actorKind: 'user', actorId: p.userId, action: 'user.invited', objectType: 'user', objectId: u!.id, after: { role: input.role } }, now);
    return { userId: u!.id, token };
  });
  await sendInvite(deps, email, token, false);
  return { userId };
}

/** Bootstrap of an account's first owner (TRD 8.1: set up by an operator on a call to the registered office number). */
export async function inviteFirstOwner(deps: AuthDeps, accountId: string, input: { email: string; displayName: string; operatorId: string }): Promise<{ userId: string }> {
  const { userId, token, email } = await withAccount(deps.database, accountId, async (tx) => {
    const now = deps.clock.now();
    const owners = await tx.select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.role, 'owner'));
    if (owners.length) throw new ConflictError('owner_exists');
    const [u] = await tx.insert(tables.users).values({ accountId, email: input.email.trim(), displayName: input.displayName, role: 'owner', passwordHash: UNSET_PASSWORD, createdAt: now, updatedAt: now }).returning({ id: tables.users.id });
    const token = await issueLink(tx, deps, accountId, u!.id, 'invite');
    await audit(tx, { accountId, actorKind: 'operator', actorId: input.operatorId, action: 'user.owner_invited', objectType: 'user', objectId: u!.id }, now);
    return { userId: u!.id, token, email: input.email.trim() };
  });
  await sendInvite(deps, email, token, false);
  return { userId };
}

async function liveLink(deps: Deps, token: string, purpose: 'invite' | 'reset'): Promise<{ accountId: string; userId: string } | null> {
  if (!token || token.length > 100) return null;
  const cap = await resolvers.capability(deps.database, sha256(token));
  if (!cap || cap.purpose !== purpose || !cap.user_id || cap.used_at || cap.expires_at.getTime() <= deps.clock.now().getTime()) return null;
  return { accountId: cap.account_id, userId: cap.user_id };
}

/**
 * Step 1 of enrolment: the invitee sets a password; a new TOTP secret is stored encrypted, not yet confirmed, and
 * returned once as an otpauth URI. Repeating step 1 before confirming replaces the secret.
 */
export async function startEnrolment(deps: AuthDeps, input: { token: string; password: string; client: string }): Promise<{ otpauthUri: string; secret: string }> {
  await countClientAttempt(deps, input.client);
  const link = await liveLink(deps, input.token, 'invite');
  if (!link) throw new SignInError('invalid_link');
  const problem = checkPasswordPolicy(input.password);
  if (problem) throw new SignInError('weak_password', 0, problem);
  const hash = await hashPassword(input.password);
  const secret = newTotpSecret();
  const email = await withAccount(deps.database, link.accountId, async (tx) => {
    const [u] = await tx
      .update(tables.users)
      .set({ passwordHash: hash, totpSecretEnc: seal(deps.totpKey, secret), totpConfirmedAt: null, totpLastStep: null, updatedAt: deps.clock.now() })
      .where(and(eq(tables.users.id, link.userId), isNull(tables.users.disabledAt)))
      .returning({ email: tables.users.email });
    if (!u) throw new SignInError('invalid_link');
    return u.email;
  });
  const uri = otpauthUri('FixTriage', email, secret);
  return { otpauthUri: uri, secret: new URL(uri).searchParams.get('secret')! };
}

/** Step 2: the first code from the authenticator confirms it; the link is used up; recovery codes are shown once; signed in. */
export async function confirmEnrolment(deps: AuthDeps, input: { token: string; code: string; client: string }): Promise<NewSession & { recoveryCodes: string[]; role: 'owner' | 'manager'; accountId: string }> {
  await countClientAttempt(deps, input.client);
  const link = await liveLink(deps, input.token, 'invite');
  if (!link) throw new SignInError('invalid_link');
  await countLinkCodeAttempt(deps, input.token, link);
  const codes = newRecoveryCodes();
  const codePhcs = await Promise.all(codes.map((c) => hashPassword(normaliseRecoveryCode(c))));
  const role = await withAccount(deps.database, link.accountId, async (tx) => {
    const now = deps.clock.now();
    const [u] = await tx.select().from(tables.users).where(eq(tables.users.id, link.userId));
    if (!u || u.disabledAt || !u.totpSecretEnc || u.passwordHash === UNSET_PASSWORD) throw new SignInError('invalid_link');
    const step = matchTotp(open(deps.totpKey, u.totpSecretEnc), input.code.trim(), now, u.totpLastStep);
    if (step === null) throw new SignInError('invalid_code');
    const used = await tx.update(tables.capabilityTokens).set({ usedAt: now }).where(and(eq(tables.capabilityTokens.tokenHash, sha256(input.token)), isNull(tables.capabilityTokens.usedAt))).returning({ id: tables.capabilityTokens.id });
    if (!used.length) throw new SignInError('invalid_link');
    await tx.update(tables.users).set({ totpConfirmedAt: now, totpLastStep: step, updatedAt: now }).where(eq(tables.users.id, u.id));
    await tx.delete(tables.recoveryCodes).where(eq(tables.recoveryCodes.userId, u.id));
    await tx.insert(tables.recoveryCodes).values(codePhcs.map((phc) => ({ accountId: link.accountId, userId: u.id, codePhc: phc, createdAt: now })));
    await audit(tx, { accountId: link.accountId, actorKind: 'user', actorId: u.id, action: 'auth.enrolled', objectType: 'user', objectId: u.id }, now);
    return u.role as 'owner' | 'manager';
  });
  const s = await createSession(deps, { userId: link.userId });
  return { ...s, recoveryCodes: codes, role, accountId: link.accountId };
}

// ---------- Reset (V6.4.3: a reset cannot bypass the second factor) ----------

/**
 * POST /auth/reset/request: the answer is the same and immediate whether or not the account exists (item 5). Only the
 * per-client limit is decided before answering; the lookup, link and mail run in the background.
 */
export async function requestReset(deps: AuthDeps, input: { email: string; client: string }): Promise<void> {
  await countClientAttempt(deps, input.client);
  background(resetInBackground(deps, input.email));
}

async function resetInBackground(deps: AuthDeps, emailIn: string): Promise<void> {
  const input = { email: emailIn };
  const p = SIGN_IN_POLICY;
  if ((await throttleTake(deps, throttleKey('reset-email', input.email), p.perEmailResets, p.perEmailResetWindowS, p.perEmailResetWindowS)) > 0) return;
  const r = await deps.database.pool.query('select user_id, account_id, totp_confirmed_at, disabled_at from resolve_login($1)', [input.email.trim()]);
  const row = r.rows[0] as { user_id: string | null; account_id: string | null; totp_confirmed_at: Date | null; disabled_at: Date | null } | undefined;
  if (!row?.user_id || !row.account_id || !row.totp_confirmed_at || row.disabled_at) return;
  const token = await withAccount(deps.database, row.account_id, (tx) => issueLink(tx, deps, row.account_id!, row.user_id!, 'reset'));
  await deps.mailer.send({
    to: input.email.trim(),
    subject: 'FixTriage: reset your password',
    text: ['Someone asked to reset your FixTriage password.', 'Open this link within 30 minutes. You will still need a code from your authenticator app or a recovery code:', linkFor(deps, 'reset', token), 'If it was not you, ignore this message; your password is unchanged.'].join('\n\n'),
  });
}

/** POST /auth/reset/complete: link + TOTP or recovery code + new password. Ends every session of the user. */
export async function completeReset(deps: AuthDeps, input: { token: string; code: string; password: string; client: string }): Promise<void> {
  await countClientAttempt(deps, input.client);
  const link = await liveLink(deps, input.token, 'reset');
  if (!link) throw new SignInError('invalid_link');
  const problem = checkPasswordPolicy(input.password);
  if (problem) throw new SignInError('weak_password', 0, problem);
  await countLinkCodeAttempt(deps, input.token, link);
  const hash = await hashPassword(input.password);
  await withAccount(deps.database, link.accountId, async (tx) => {
    const now = deps.clock.now();
    const [u] = await tx.select().from(tables.users).where(eq(tables.users.id, link.userId));
    if (!u || u.disabledAt || !u.totpConfirmedAt) throw new SignInError('invalid_link');
    const factor = await acceptUserSecondFactor(tx, deps, u, input.code);
    if (!factor) throw new SignInError('invalid_code');
    const used = await tx.update(tables.capabilityTokens).set({ usedAt: now }).where(and(eq(tables.capabilityTokens.tokenHash, sha256(input.token)), isNull(tables.capabilityTokens.usedAt))).returning({ id: tables.capabilityTokens.id });
    if (!used.length) throw new SignInError('invalid_link');
    await tx.update(tables.users).set({ passwordHash: hash, updatedAt: now }).where(eq(tables.users.id, u.id));
    await revokeUserSessions(tx, u.id);
    await audit(tx, { accountId: link.accountId, actorKind: 'user', actorId: u.id, action: 'auth.password_reset', objectType: 'user', objectId: u.id, after: { factor } }, now);
  });
}

// ---------- Owner actions on users ----------

/** POST /api/settings/users/:id/disable: the user's sessions end at once (V7.4.2). Refused for oneself and the last owner. */
export async function disableUser(deps: AuthDeps, p: StaffPrincipal, userId: string): Promise<{ revokedSessions: number }> {
  requireOwner(p);
  if (userId === p.userId) throw new ConflictError('cannot_disable_self');
  return withAccount(deps.database, p.accountId, async (tx) => {
    const now = deps.clock.now();
    // Item 5: the enabled owners are locked, so two owners cannot disable each other at the same time.
    const owners = await tx.execute(sql`select id from users where role = 'owner' and disabled_at is null for update`);
    const ownerIds = (owners.rows as Array<{ id: string }>).map((r) => r.id);
    if (!ownerIds.includes(p.userId)) throw new AuthError('no_session'); // the acting owner was disabled meanwhile
    const [u] = await tx.select().from(tables.users).where(eq(tables.users.id, userId));
    if (!u) throw new NotFoundError('user');
    if (u.disabledAt) return { revokedSessions: 0 };
    if (u.role === 'owner' && ownerIds.filter((id) => id !== userId).length === 0) throw new ConflictError('last_owner');
    // EP-9: disabling is refused while the user is on a current or future on-call shift (S-14 AC).
    const shifts = await tx.select({ id: tables.oncallShifts.id }).from(tables.oncallShifts).where(and(eq(tables.oncallShifts.userId, userId), sql`${tables.oncallShifts.endsAt} > ${now}`));
    if (shifts.length) throw new ConflictError('on_call_coverage');
    await tx.update(tables.users).set({ disabledAt: now, updatedAt: now, version: sql`${tables.users.version} + 1` }).where(eq(tables.users.id, userId));
    const n = await revokeUserSessions(tx, userId);
    // Item 1: outstanding acknowledgement (and enrolment or reset) links of the user stop working.
    await tx.update(tables.capabilityTokens).set({ usedAt: now }).where(and(eq(tables.capabilityTokens.userId, userId), isNull(tables.capabilityTokens.usedAt)));
    await audit(tx, { accountId: p.accountId, actorKind: 'user', actorId: p.userId, action: 'user.disabled', objectType: 'user', objectId: userId }, now);
    return { revokedSessions: n };
  });
}

/**
 * Lost second factor of a manager (TRD 8.1, V6.4.4): the owner, signed in with both factors, re-enrols the manager.
 * The old secret and recovery codes stop working, sessions end, and a new enrolment link is mailed. An owner's own
 * factor is reset only by two operators after a call-back (not built in B2).
 */
export async function reenrolManager(deps: AuthDeps, p: StaffPrincipal, userId: string): Promise<void> {
  requireOwner(p);
  const { email, token } = await withAccount(deps.database, p.accountId, async (tx) => {
    const now = deps.clock.now();
    const [u] = await tx.select().from(tables.users).where(eq(tables.users.id, userId));
    if (!u) throw new NotFoundError('user');
    if (u.role !== 'manager') throw new ForbiddenError('only a manager is re-enrolled by the owner');
    if (u.disabledAt) throw new ConflictError('user_disabled');
    await tx.update(tables.users).set({ totpSecretEnc: null, totpConfirmedAt: null, totpLastStep: null, updatedAt: now }).where(eq(tables.users.id, userId));
    await tx.delete(tables.recoveryCodes).where(eq(tables.recoveryCodes.userId, userId));
    await revokeUserSessions(tx, userId);
    const token = await issueLink(tx, deps, p.accountId, userId, 'invite');
    await audit(tx, { accountId: p.accountId, actorKind: 'user', actorId: p.userId, action: 'user.reenrolment_started', objectType: 'user', objectId: userId }, now);
    return { email: u.email, token };
  });
  await sendInvite(deps, email, token, true);
}
