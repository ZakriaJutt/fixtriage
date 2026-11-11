// B2 integration-test helpers: the real SMTP mailer pointed at Mailpit and the real S3 store pointed at MinIO, read
// from code/.env (gitignored; names in .env.example). Mailpit is shared by several local projects, so every test uses
// its own unique recipient address and deletes only its own messages.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { base32Decode, loadLocalEnvFile, parseConfig, S3ObjectStorage, SmtpMailer, totpCode, totpStep } from '@fixtriage/platform';
import { call, type Harness } from './helpers';

loadLocalEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));

const env = { DATABASE_URL: 'postgres://unused@localhost/x', PUBLIC_BASE_URL: 'https://app.fixtriage.example', TWILIO_AUTH_TOKEN: 'x'.repeat(32), POSTMARK_INBOUND_SECRET: 'y'.repeat(32), PAGING_FROM_NUMBER: '+16045550199', ...process.env, NODE_ENV: 'test' };
export const localConfig = parseConfig(env);
export const MAILPIT = process.env.MAILPIT_API ?? 'http://127.0.0.1:8025/api/v1';

export function smtpMailer(): SmtpMailer {
  const c = localConfig;
  return new SmtpMailer({ host: c.SMTP_HOST, port: c.SMTP_PORT, secure: c.SMTP_SECURE, requireTls: c.SMTP_REQUIRE_TLS, user: c.SMTP_USER, pass: c.SMTP_PASS, from: c.MAIL_FROM });
}

export function minio(): S3ObjectStorage {
  const c = localConfig;
  return new S3ObjectStorage({ endpoint: c.S3_ENDPOINT, region: c.S3_REGION, bucket: c.S3_BUCKET, accessKeyId: c.S3_ACCESS_KEY_ID, secretAccessKey: c.S3_SECRET_ACCESS_KEY, forcePathStyle: c.S3_FORCE_PATH_STYLE });
}

export const uniqueEmail = (tag: string) => `b2-${tag}-${randomUUID().slice(0, 8)}@example.test`;

interface MailpitSummary {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
}

/** Waits for the newest message to `to` in Mailpit and returns its subject and text body. */
export async function mailTo(to: string, opts: { count?: number; timeoutMs?: number } = {}): Promise<{ id: string; subject: string; text: string }> {
  const want = opts.count ?? 1;
  const end = Date.now() + (opts.timeoutMs ?? 10_000);
  while (Date.now() < end) {
    const r = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const list = ((await r.json()) as { messages: MailpitSummary[] }).messages;
    if (list.length >= want) {
      const m = (await (await fetch(`${MAILPIT}/message/${list[0]!.ID}`)).json()) as { ID: string; Subject: string; Text: string };
      return { id: m.ID, subject: m.Subject, text: m.Text };
    }
    await new Promise((res) => setTimeout(res, 150));
  }
  throw new Error(`no mail to ${to} in Mailpit`);
}

export async function mailCount(to: string): Promise<number> {
  const r = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await r.json()) as { messages: unknown[] }).messages.length;
}

/** Deletes the Mailpit messages sent to the given test addresses (and nothing else). */
export async function deleteMailTo(addresses: string[]): Promise<void> {
  for (const a of addresses) {
    const r = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${a}"`)}`);
    const ids = ((await r.json()) as { messages: MailpitSummary[] }).messages.map((m) => m.ID);
    if (ids.length) await fetch(`${MAILPIT}/messages`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: ids }) });
  }
}

export function tokenFromMail(text: string, page: 'enrol' | 'reset'): string {
  const m = new RegExp(`/${page}#token=([A-Za-z0-9_-]{43})`).exec(text);
  if (!m) throw new Error(`no ${page} link in mail`);
  return m[1]!;
}

export const codeFor = (secretB32: string, h: Harness, offsetSteps = 0) => totpCode(base32Decode(secretB32), totpStep(h.clock.now()) + offsetSteps);

/** JSON POST to a pre-session auth route from a given client address. */
/** JSON POST to a pre-session auth route. `client` is the direct peer address; `xff` an optional X-Forwarded-For header. */
export async function authPost(h: Harness, path: string, body: unknown, opts: { client?: string; xff?: string; cookie?: string; csrf?: string; contentType?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': opts.contentType ?? 'application/json' };
  if (opts.xff) headers['x-forwarded-for'] = opts.xff;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.csrf) headers['x-csrf-token'] = opts.csrf;
  return call(h, 'POST', path, new Request(`http://internal${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), opts.client ?? '198.51.100.1');
}

/** Session cookie pair from a sign-in response, in the shape staffCall() takes. */
export function sessionFrom(res: Response): { cookie: string; csrf: string; setCookies: string[] } {
  const set = res.headers.getSetCookie();
  const session = set.find((c) => c.startsWith('__Host-ft_session='))!;
  const csrf = set.find((c) => c.startsWith('__Host-ft_csrf='))!;
  return { cookie: session.split(';')[0]!, csrf: csrf.split(';')[0]!.split('=')[1]!, setCookies: set };
}
