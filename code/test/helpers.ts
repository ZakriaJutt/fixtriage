// Shared integration-test harness: synthetic accounts, fake providers, a fake clock and a worker loop.
// All data is synthetic (AGENTS.md 9): 555-01xx numbers, example.test addresses, invented names.
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDatabase, ownerUrl, appUrl, withAccount, tables, type Database } from '@fixtriage/db';
import { FakeClassifier, FakeClock, FakeMessagingProvider, FakeObjectStorage, sha256, twilioSignature } from '@fixtriage/platform';
import { processDueJobs, processOutbox, retryPendingStatusEvents, tickEscalations, watchDispatches, type Deps } from '@fixtriage/services';
import { createHandlers, route, SESSION_COOKIE, CSRF_HEADER, type WebDeps } from '../apps/web/src/handlers';

export const BASE_URL = 'https://app.fixtriage.example';
export const TWILIO_TOKEN = 'test-twilio-token-0123456789abcdef';
export const POSTMARK_SECRET = 'test-postmark-secret-0123456789';
export const PAGING_FROM = '+16045550199';

let shared: Database | null = null;
export function appDb(): Database {
  if (!shared) shared = createDatabase(appUrl('test'), 20);
  return shared;
}

export async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: ownerUrl('test') });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Empties every table except rule_sets and schema_migrations (owner role; TRUNCATE fires no row triggers). */
export async function resetData(): Promise<void> {
  await owner(async (c) => {
    const r = await c.query(`select tablename from pg_tables where schemaname = 'public' and tablename not in ('rule_sets', 'schema_migrations')`);
    await c.query(`truncate ${r.rows.map((x) => `"${x.tablename}"`).join(', ')} cascade`);
  });
}

export interface Harness {
  deps: WebDeps;
  clock: FakeClock;
  messaging: FakeMessagingProvider;
  classifier: FakeClassifier;
  storage: FakeObjectStorage;
  handlers: ReturnType<typeof createHandlers>;
}

export function harness(startIso: string): Harness {
  const clock = new FakeClock(Date.parse(startIso));
  const messaging = new FakeMessagingProvider();
  const classifier = new FakeClassifier();
  const storage = new FakeObjectStorage();
  const deps: WebDeps = { database: appDb(), clock, messaging, classifier, storage, publicBaseUrl: BASE_URL, pagingFromNumber: PAGING_FROM, twilioAuthToken: TWILIO_TOKEN, postmarkSecret: POSTMARK_SECRET };
  return { deps, clock, messaging, classifier, storage, handlers: createHandlers(deps) };
}

export interface Seeded {
  accountId: string;
  smsNumber: string;
  emailAddress: string;
  ownerId: string;
  lee: string; // Level 1
  sam: string; // Level 2
  phones: { owner: string; lee: string; sam: string };
  propertyId: string;
  units: Record<'204' | '305' | '406', string>;
  tenants: Record<'204' | '305' | '406', { id: string; mobile: string; email: string | null }>;
  vendors: { plumbA: string; plumbB: string; heatA: string; heatB: string };
  vendorPhones: { plumbA: string; plumbB: string; heatA: string; heatB: string };
}

let seq = 0;
const wk: Array<[string, string]> = [['09:00', '17:00']];

/** One synthetic brokerage. `n` keeps numbers unique across accounts in one test. */
export async function seedAccount(database: Database, n = ++seq % 50): Promise<Seeded> {
  const accountId = randomUUID();
  const d = String(n).padStart(2, '0');
  const ph = (x: number) => `+1604555${String(n * 20 + x).padStart(4, '0')}`;
  const s: Seeded = {
    accountId,
    smsNumber: ph(0),
    emailAddress: `requests-${d}-${accountId.slice(0, 6)}@in.fixtriage.example`,
    ownerId: randomUUID(),
    lee: randomUUID(),
    sam: randomUUID(),
    phones: { owner: ph(1), lee: ph(2), sam: ph(3) },
    propertyId: randomUUID(),
    units: { '204': randomUUID(), '305': randomUUID(), '406': randomUUID() },
    tenants: {
      '204': { id: randomUUID(), mobile: ph(4), email: `t204-${d}@example.test` },
      '305': { id: randomUUID(), mobile: ph(5), email: null },
      '406': { id: randomUUID(), mobile: ph(6), email: null },
    },
    vendors: { plumbA: randomUUID(), plumbB: randomUUID(), heatA: randomUUID(), heatB: randomUUID() },
    vendorPhones: { plumbA: ph(7), plumbB: ph(8), heatA: ph(9), heatB: ph(10) },
  };
  await withAccount(database, accountId, async (tx) => {
    await tx.insert(tables.accounts).values({ id: accountId, name: `Example Realty ${d}`, businessHours: { mon: wk, tue: wk, wed: wk, thu: wk, fri: wk }, emergencyContactPhone: ph(11), plan: 'pilot', status: 'live' });
    const pw = 'not-a-real-hash';
    await tx.insert(tables.users).values([
      { id: s.ownerId, accountId, email: `owner-${accountId}@example.test`, displayName: 'Olive Owner', mobile: s.phones.owner, role: 'owner', passwordHash: pw, isReviewer: true },
      { id: s.lee, accountId, email: `lee-${accountId}@example.test`, displayName: 'Lee Level-One', mobile: s.phones.lee, role: 'manager', passwordHash: pw },
      { id: s.sam, accountId, email: `sam-${accountId}@example.test`, displayName: 'Sam Level-Two', mobile: s.phones.sam, role: 'manager', passwordHash: pw },
    ]);
    await tx.insert(tables.properties).values({ id: s.propertyId, accountId, label: 'Maple Court', streetAddress: `${100 + n} Example Street`, city: 'Vancouver' });
    for (const [label, id] of Object.entries(s.units)) await tx.insert(tables.units).values({ id, accountId, propertyId: s.propertyId, label });
    for (const [label, t] of Object.entries(s.tenants)) await tx.insert(tables.tenantContacts).values({ id: t.id, accountId, unitId: s.units[label as '204'], name: `Tenant ${label}`, mobile: t.mobile, email: t.email });
    await tx.insert(tables.channels).values([
      { accountId, kind: 'sms', address: s.smsNumber, provider: 'twilio', status: 'live' },
      { accountId, kind: 'email', address: s.emailAddress, provider: 'postmark', status: 'live' },
    ]);
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2028-01-01T00:00:00Z');
    await tx.insert(tables.oncallShifts).values([
      { accountId, userId: s.lee, level: 1, startsAt: from, endsAt: to },
      { accountId, userId: s.sam, level: 2, startsAt: from, endsAt: to },
      { accountId, userId: s.ownerId, level: 3, startsAt: from, endsAt: to },
    ]);
    const v = s.vendors;
    const vp = s.vendorPhones;
    await tx.insert(tables.vendors).values([
      { id: v.plumbA, accountId, name: 'Alpha Plumbing', mobile: vp.plumbA, afterHours: true },
      { id: v.plumbB, accountId, name: 'Beta Plumbing', mobile: vp.plumbB, afterHours: true },
      { id: v.heatA, accountId, name: 'Gamma Heating', mobile: vp.heatA, afterHours: true },
      { id: v.heatB, accountId, name: 'Delta Heating', mobile: vp.heatB, afterHours: true },
    ]);
    await tx.insert(tables.vendorTrades).values([
      { accountId, vendorId: v.plumbA, trade: 'plumbing', rank: 1 },
      { accountId, vendorId: v.plumbB, trade: 'plumbing', rank: 2 },
      { accountId, vendorId: v.heatA, trade: 'heating', rank: 1 },
      { accountId, vendorId: v.heatB, trade: 'heating', rank: 2 },
    ]);
  });
  return s;
}

export const OPERATOR_PHONES = { primary: '+16045559901', backup: '+16045559902' };

/** Two operators on the Level 4 roster (EP-5, EP-9). Global table: inserted with the owner role. */
export async function seedOperators(): Promise<{ primary: string; backup: string }> {
  return owner(async (c) => {
    const p = randomUUID();
    const b = randomUUID();
    await c.query(`insert into operators (id, email, display_name, mobile, level4_rank, password_hash) values ($1, 'op1@fixtriage.example', 'Primary Operator', $2, 1, 'x'), ($3, 'op2@fixtriage.example', 'Backup Operator', $4, 2, 'x')`, [p, OPERATOR_PHONES.primary, b, OPERATOR_PHONES.backup]);
    return { primary: p, backup: b };
  });
}

/** A signed-in staff session (sign-in itself is T-2.1.3, not in B1). Returns the cookie and anti-forgery token. */
export async function seedSession(userId: string): Promise<{ cookie: string; csrf: string }> {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  await owner((c) => c.query(`insert into sessions (user_id, token_hash, csrf_token_hash, last_seen_at, expires_at) values ($1, $2, $3, now(), now() + interval '7 days')`, [userId, sha256(token), sha256(csrf)]));
  return { cookie: `${SESSION_COOKIE}=${token}`, csrf };
}

let sid = 0;
export function nextSid(prefix = 'SM'): string {
  return `${prefix}test${Date.now().toString(36)}${(++sid).toString().padStart(5, '0')}`;
}

/** Calls a handler like Twilio would: form body, signature over PUBLIC_BASE_URL + path. */
export async function twilioPost(h: Harness, path: string, params: Record<string, string>): Promise<Response> {
  const sig = twilioSignature(TWILIO_TOKEN, BASE_URL + path, params);
  const req = new Request(`http://internal${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig }, body: new URLSearchParams(params).toString() });
  return call(h, 'POST', path, req);
}

export async function call(h: Harness, method: string, path: string, req?: Request): Promise<Response> {
  const r = route(h.handlers, method, path);
  if (!r) throw new Error(`no route ${method} ${path}`);
  return r.handler(req ?? new Request(`http://internal${path}`, { method }), r.params);
}

export async function staffCall(h: Harness, method: string, path: string, session: { cookie: string; csrf: string } | null, body?: unknown, extra: Record<string, string> = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extra };
  if (session) {
    headers.cookie = session.cookie;
    if (method !== 'GET' && !('omitCsrf' in extra) && !(CSRF_HEADER in extra)) headers[CSRF_HEADER] = session.csrf;
  }
  delete headers.omitCsrf;
  const req = new Request(`http://internal${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return call(h, method, path, req);
}

export async function sms(h: Harness, s: Seeded, from: string, body: string | null, opts: { sid?: string; media?: number } = {}): Promise<Response> {
  return twilioPost(h, '/webhooks/twilio/sms', { MessageSid: opts.sid ?? nextSid(), From: from, To: s.smsNumber, Body: body ?? '', NumMedia: String(opts.media ?? 0) });
}

/** Runs the worker's passes until nothing more happens (bounded). Does not advance the clock. */
export async function drain(deps: Deps, opts: { jobs?: boolean; outbox?: boolean } = {}): Promise<void> {
  for (let i = 0; i < 20; i++) {
    let n = 0;
    if (opts.jobs !== false) n += await processDueJobs(deps);
    n += await tickEscalations(deps);
    n += await watchDispatches(deps);
    if (opts.outbox !== false) n += await processOutbox(deps);
    n += await retryPendingStatusEvents(deps);
    if (n === 0) return;
  }
}

/** Advance the fake clock in 15 s ticks (the escalation tick interval), draining at each tick. */
export async function runFor(h: Harness, ms: number, opts: { jobs?: boolean; outbox?: boolean } = {}): Promise<void> {
  const end = h.clock.now().getTime() + ms;
  while (h.clock.now().getTime() < end) {
    h.clock.advance(Math.min(15_000, end - h.clock.now().getTime()));
    await drain(h.deps, opts);
  }
}

/** Pages sent so far to a phone (voice + SMS), from the fake provider. */
export const pagesTo = (h: Harness, phone: string) => h.messaging.sent.filter((m) => m.to === phone && (m.channel === 'voice' || m.body.startsWith('FixTriage ')));

/** Owner-role query helper for assertions (sees all accounts). */
export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return owner(async (c) => (await c.query(text, params)).rows as T[]);
}
