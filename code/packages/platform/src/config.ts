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
  })
  .superRefine((c, ctx) => {
    // UT-09: links must never point at localhost in production (R-16).
    if (c.NODE_ENV === 'production' && /\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(c.PUBLIC_BASE_URL)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PUBLIC_BASE_URL'], message: 'must not be localhost in production' });
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

let cached: Config | null = null;
export function loadConfig(): Config {
  if (!cached) cached = parseConfig(process.env);
  return cached;
}
