// Sign-in primitives (TRD 8.1, 8.7; T-2.1.3): Argon2id password hashing, the password policy, RFC 6238 TOTP,
// AES-256-GCM for stored TOTP secrets, opaque session and anti-forgery tokens, recovery codes. No I/O except the
// node:crypto calls; time is always a parameter.
import { argon2, createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sha256 } from './keys-and-urls';
import { COMMON_PASSWORDS } from './common-passwords';

// ---------- Passwords (V6.2.1, V6.2.4, V11.4.2) ----------

/** OWASP Password Storage Cheat Sheet (read 2026-11-11): Argon2id, m=19 MiB, t=2, p=1 is the minimum configuration. */
export const ARGON2_PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

function argon2id(password: string, salt: Buffer, p: { memory: number; passes: number; parallelism: number; tagLength: number }): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    argon2('argon2id', { message: Buffer.from(password.normalize('NFC'), 'utf8'), nonce: salt, ...p }, (e, key) => (e ? reject(e) : resolve(key))),
  );
}

/** PHC string: $argon2id$v=19$m=..,t=..,p=..$salt$hash (base64 without padding). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await argon2id(password, salt, ARGON2_PARAMS);
  const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${ARGON2_PARAMS.memory},t=${ARGON2_PARAMS.passes},p=${ARGON2_PARAMS.parallelism}$${b64(salt)}$${b64(hash)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** Constant-time verify. Anything that is not a valid PHC string (e.g. an invited user's placeholder) never verifies. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = PHC.exec(stored);
  if (!m) {
    await argon2id(password, randomBytes(16), ARGON2_PARAMS); // same work either way
    return false;
  }
  const expected = Buffer.from(m[5]!, 'base64');
  const got = await argon2id(password, Buffer.from(m[4]!, 'base64'), { memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]), tagLength: expected.length });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Work for an unknown email, so that response time does not reveal whether the account exists. */
export async function dummyPasswordWork(password: string): Promise<void> {
  await argon2id(password, randomBytes(16), ARGON2_PARAMS);
}

/** Placeholder stored for an invited user who has not set a password yet. Never a valid PHC string. */
export const UNSET_PASSWORD = '!unset';

export type PasswordProblem = 'too_short' | 'too_long' | 'common';

/** V6.2.1 (12 characters minimum), V6.2.9 (at least 64 allowed), V6.2.4 (common-password list). No composition rules (V6.2.5). */
export function checkPasswordPolicy(password: string): PasswordProblem | null {
  const n = [...password.normalize('NFC')].length;
  if (n < PASSWORD_MIN) return 'too_short';
  if (n > PASSWORD_MAX) return 'too_long';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'common';
  return null;
}

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s; V6.5.1) ----------

export const TOTP_PERIOD_S = 30;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(b: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of b) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

export function totpStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_PERIOD_S);
}

export function totpCode(secret: Buffer, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, '0');
}

/**
 * Returns the matching time step within one step of clock drift, or null. The caller stores the step and refuses any
 * step at or below the last accepted one, so a code is accepted once (V6.5.1).
 */
export function matchTotp(secret: Buffer, code: string, at: Date, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(at);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const want = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(want, Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUri(issuer: string, accountLabel: string, secret: Buffer): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD_S}`;
}

// ---------- Secret box for stored TOTP secrets (AES-256-GCM) ----------

const BOX_VERSION = 1;

export function parseSecretKey(b64: string): Buffer {
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('secret key must be 32 bytes, base64');
  return k;
}

export function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from([BOX_VERSION]), iv, c.getAuthTag(), ct]);
}

export function open(key: Buffer, box: Buffer): Buffer {
  if (box[0] !== BOX_VERSION) throw new Error('unknown secret box version');
  const d = createDecipheriv('aes-256-gcm', key, box.subarray(1, 13));
  d.setAuthTag(box.subarray(13, 29));
  return Buffer.concat([d.update(box.subarray(29)), d.final()]);
}

// ---------- Opaque tokens and recovery codes ----------

/** 256-bit random token and its SHA-256 (sessions, anti-forgery tokens, invitation and reset links). */
export function newOpaqueToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

/** Ten single-use recovery codes of 50 random bits each, shown once; stored as SHA-256 of the normalised code. */
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(7)).slice(0, 10);
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export function recoveryCodeHash(code: string): Buffer {
  return sha256(code.toUpperCase().replace(/[^A-Z2-7]/g, ''));
}

export function looksLikeRecoveryCode(code: string): boolean {
  return /^[A-Za-z2-7]{5}-?[A-Za-z2-7]{5}$/.test(code.trim());
}
