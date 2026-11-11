// The one configuration module for web and worker (TRD 8.3, R-03). Validates at startup and exits on error.
import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().url(),
    PUBLIC_BASE_URL: z.string().url(),
    WEB_PORT: z.coerce.number().int().default(8109),
    TWILIO_AUTH_TOKEN: z.string().min(16),
    POSTMARK_INBOUND_SECRET: z.string().min(16),
    PAGING_FROM_NUMBER: z.string().regex(/^\+[1-9]\d{6,14}$/),
    MONITOR_URL: z.string().url().optional(),
    CHECKIN_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
    WORKER_POLL_MS: z.coerce.number().int().positive().default(1_000),
    PROVIDERS: z.enum(['fake']).default('fake'),
    // Security round item 2: our own load balancer or proxy addresses, comma-separated. Empty: the TCP peer is the client.
    TRUSTED_PROXIES: z.string().default('').transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean)),
    // B2 sign-in (TRD 8.1): 32-byte base64 key for the stored TOTP secrets. Local value lives in the gitignored .env.
    TOTP_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64'),
    // B2 staff mail: SMTP only. Local default is Mailpit (127.0.0.1:1025, no authentication).
    MAIL_TRANSPORT: z.enum(['smtp', 'fake']).default('smtp'),
    SMTP_HOST: z.string().default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    SMTP_REQUIRE_TLS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().default('FixTriage <no-reply@fixtriage.localhost>'),
    // B2 object storage: S3 API. Local is MinIO (endpoint set, path-style); production omits the endpoint (AWS S3).
    STORAGE: z.enum(['s3', 'fake']).default('s3'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('fixtriage-dev'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  })
  .superRefine((c, ctx) => {
    // UT-09: links must never point at localhost in production (R-16).
    if (c.NODE_ENV === 'production' && /\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(c.PUBLIC_BASE_URL)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PUBLIC_BASE_URL'], message: 'must not be localhost in production' });
    }
    if (c.NODE_ENV === 'production') {
      // Production mail is authenticated and encrypted; production storage and mail are never fakes.
      if (c.MAIL_TRANSPORT !== 'smtp' || !c.SMTP_USER || !(c.SMTP_SECURE || c.SMTP_REQUIRE_TLS)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMTP_USER'], message: 'production SMTP needs credentials and TLS' });
      if (c.STORAGE !== 's3') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STORAGE'], message: 'production storage must be s3' });
    }
    if (c.STORAGE === 's3' && c.S3_ENDPOINT && !(c.S3_ACCESS_KEY_ID && c.S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['S3_ACCESS_KEY_ID'], message: 'S3_ENDPOINT needs S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY' });
    }
  });

export type Config = z.infer<typeof schema>;

export function parseConfig(env: Record<string, string | undefined>): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    const names = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid configuration: ${names}`);
  }
  return r.data;
}

/** Reads code/.env (gitignored) into process.env for local runs; variables already set win. */
export function loadLocalEnvFile(path: string): boolean {
  try {
    process.loadEnvFile(path);
    return true;
  } catch {
    return false;
  }
}

let cached: Config | null = null;
export function loadConfig(): Config {
  if (!cached) cached = parseConfig(process.env);
  return cached;
}
