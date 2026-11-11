// `npm run dev` (the proposed `pnpm dev`, adapted: no Docker or pnpm on this machine). One command:
// application role, migrations and rule-set seed on fixtriage_dev, fake external monitor (port 3109),
// web (Next.js, port 8109) and worker; waits for /healthz and /readyz and names the unhealthy part.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { appUrl, ownerUrl } from '@fixtriage/db';
import { migrate } from '@fixtriage/db/migrate';
import { seedRuleSets } from '@fixtriage/services';
import { loadLocalEnvFile } from '@fixtriage/platform';

const CODE = fileURLToPath(new URL('..', import.meta.url));
const WEB_PORT = 8109;
const MONITOR_PORT = 3109;
const children: ChildProcess[] = [];

function fail(part: string, why: string): never {
  console.error(`dev: UNHEALTHY ${part}: ${why}`);
  for (const c of children) c.kill('SIGTERM');
  process.exit(1);
}

// Local settings (SMTP to Mailpit, S3 to MinIO, the local TOTP key) come from the gitignored code/.env; see .env.example.
if (!loadLocalEnvFile(`${CODE}.env`)) fail('settings', 'code/.env is missing: copy .env.example to .env and fill the local values');

const env = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: appUrl('dev'),
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? `http://localhost:${WEB_PORT}`,
  // Local fakes only: random per run, never committed, never a real provider secret.
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ?? randomBytes(24).toString('hex'),
  POSTMARK_INBOUND_SECRET: process.env.POSTMARK_INBOUND_SECRET ?? randomBytes(24).toString('hex'),
  PAGING_FROM_NUMBER: process.env.PAGING_FROM_NUMBER ?? '+16045550199',
  MONITOR_URL: `http://127.0.0.1:${MONITOR_PORT}`,
  MONITOR_PORT: String(MONITOR_PORT),
  READY_URL: `http://127.0.0.1:${WEB_PORT}/readyz`,
};

function run(name: string, args: string[], cwd = CODE): ChildProcess {
  const c = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] });
  c.on('exit', (code) => {
    if (code !== 0 && code !== null) fail(name, `exited with ${code}`);
  });
  children.push(c);
  return c;
}

try {
  const setup = spawn(process.execPath, ['--import', 'tsx', 'packages/db/scripts/setup-role.ts'], { cwd: CODE, stdio: 'inherit' });
  await new Promise<void>((res, rej) => setup.on('exit', (c) => (c === 0 ? res() : rej(new Error(`setup-role exit ${c}`)))));
  const m = await migrate(ownerUrl('dev'));
  await seedRuleSets(ownerUrl('dev'));
  console.log(`dev: database fixtriage_dev migrated (${m.applied.length} applied, ${m.skipped.length} already)`);
} catch (e) {
  fail('database', e instanceof Error ? e.message : 'unknown');
}

run('monitor', ['--import', 'tsx', 'tools/monitor-fake/src/main.ts']);
run('web', [fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), 'dev', '-p', String(WEB_PORT)], `${CODE}apps/web`);
run('worker', ['--import', 'tsx', 'apps/worker/src/main.ts']);

async function waitHttp(part: string, url: string, ms: number): Promise<number> {
  const end = Date.now() + ms;
  let last = 'no answer';
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (r.status === 200) return 200;
      last = `HTTP ${r.status}: ${await r.text()}`;
    } catch (e) {
      last = e instanceof Error ? e.message : 'error';
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(part, last);
}

await waitHttp('web /healthz', `http://127.0.0.1:${WEB_PORT}/healthz`, 120_000);
await waitHttp('web /readyz', `http://127.0.0.1:${WEB_PORT}/readyz`, 60_000);
console.log(`dev: healthy. web http://localhost:${WEB_PORT} (healthz, readyz green); worker running; fake monitor on ${MONITOR_PORT}. Ctrl-C to stop.`);

const stop = () => {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
