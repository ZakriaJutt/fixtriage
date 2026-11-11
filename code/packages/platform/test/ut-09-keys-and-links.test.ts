// UT-09: storage keys follow AD-10; links use PUBLIC_BASE_URL and never localhost in production config.
import { describe, expect, it } from 'vitest';
import { parseConfig, publicUrl, storageKey } from '../src';

const env = { DATABASE_URL: 'postgres://x@localhost/db', TWILIO_AUTH_TOKEN: 'x'.repeat(32), POSTMARK_INBOUND_SECRET: 'y'.repeat(32), PAGING_FROM_NUMBER: '+16045550199', TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), SMTP_USER: 'u', SMTP_REQUIRE_TLS: 'true' };

describe('UT-09 keys and links', () => {
  it('builds acct/{id}/{purpose}/{yyyy}/{mm}/{uuid}', () => {
    const k = storageKey('11111111-1111-4111-8111-111111111111', 'inbound', new Date('2027-02-03T10:00:00Z'));
    expect(k).toMatch(/^acct\/11111111-1111-4111-8111-111111111111\/inbound\/2027\/02\/[0-9a-f-]{36}$/);
  });
  it('link host equals PUBLIC_BASE_URL', () => {
    const cfg = parseConfig({ ...env, PUBLIC_BASE_URL: 'https://app.fixtriage.example', NODE_ENV: 'production' });
    const url = new URL(publicUrl(cfg.PUBLIC_BASE_URL, '/a/tok'));
    expect(url.host).toBe('app.fixtriage.example');
  });
  it('rejects a localhost PUBLIC_BASE_URL in production', () => {
    expect(() => parseConfig({ ...env, PUBLIC_BASE_URL: 'http://localhost:8109', NODE_ENV: 'production' })).toThrow(/PUBLIC_BASE_URL/);
    expect(() => parseConfig({ ...env, PUBLIC_BASE_URL: 'http://localhost:8109', NODE_ENV: 'development' })).not.toThrow();
  });
});
