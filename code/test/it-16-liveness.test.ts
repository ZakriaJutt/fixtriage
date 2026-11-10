// IT-16: an external-monitor fake outside the application. (a) worker process killed -> both operators alerted
// <= 5 min with no worker running; (b) worker running but the tick stuck -> /readyz fails -> alert <= 5 min;
// (c) probe reply withheld -> /readyz fails -> alert; (d) inbound voice call -> forwarded to the emergency number.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeMonitor } from '@fixtriage/monitor-fake';
import { appUrl } from '@fixtriage/db';
import { processDueJobs, processOutbox } from '@fixtriage/services';
import { harness, owner, resetData, seedAccount, seedOperators, sms, twilioPost, type Harness, type Seeded } from './helpers';
import { serve } from './http-adapter';

const OPS = ['primary-operator', 'backup-operator'];
const CODE = fileURLToPath(new URL('..', import.meta.url));
let h: Harness;
let s: Seeded;
let child: ChildProcess | null = null;
beforeEach(async () => {
  await resetData();
  await seedOperators();
  h = harness('2027-02-04T09:10:00Z');
  h.classifier.mode = 'down';
  s = await seedAccount(h.deps.database);
});
afterEach(() => {
  if (child && child.exitCode === null) child.kill('SIGKILL');
});

const waitFor = async (cond: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe('IT-16 liveness from outside the application', () => {
  it('(a) worker killed: both operators alerted within 5 minutes, with no worker running', async () => {
    let virtual = Date.parse('2027-02-04T09:10:00Z');
    const mon = new FakeMonitor({ now: () => virtual, operators: OPS, components: ['worker'] });
    const port = await mon.listen();
    child = spawn(process.execPath, ['--import', 'tsx', 'apps/worker/src/main.ts'], {
      cwd: CODE,
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: appUrl('test'), PUBLIC_BASE_URL: 'http://localhost:8109', TWILIO_AUTH_TOKEN: 'x'.repeat(32), POSTMARK_INBOUND_SECRET: 'y'.repeat(32), PAGING_FROM_NUMBER: '+16045550199', MONITOR_URL: `http://127.0.0.1:${port}`, CHECKIN_INTERVAL_MS: '200', WORKER_POLL_MS: '200' },
      stdio: 'ignore',
    });
    await waitFor(() => mon.checkIns.length >= 2, 20_000);
    child.kill('SIGKILL');
    await waitFor(() => child!.exitCode !== null || child!.signalCode !== null, 5_000);
    await new Promise((r) => setTimeout(r, 300)); // no late check-in arrives after death
    const last = mon.checkIns[mon.checkIns.length - 1]!.at;
    const n = mon.checkIns.length;
    // worst case of TRD 8.9: the check-in landed just after a monitor cycle; cycles every 60 s
    let alertAt: number | null = null;
    for (let i = 1; i <= 10 && alertAt === null; i++) {
      virtual = last + i * 60_000;
      await mon.cycle();
      if (mon.alerts.length) alertAt = virtual;
    }
    expect(mon.checkIns.length).toBe(n);
    expect(alertAt).not.toBeNull();
    expect(alertAt! - last).toBeLessThanOrEqual(300_000);
    expect(mon.alerts.map((a) => a.operator).sort()).toEqual([...OPS].sort());
    await mon.close();
  }, 40_000);

  it('(b) worker alive but the escalation tick stuck: /readyz fails and both operators are alerted within 5 minutes', async () => {
    const web = await serve(h);
    const mon = new FakeMonitor({ now: () => h.clock.now().getTime(), operators: OPS, components: [], readyUrl: `${web.url}/readyz` });
    expect((await fetch(`${web.url}/readyz`)).status).toBe(200);
    await sms(h, s, s.tenants['204'].mobile, 'no heat');
    await processDueJobs(h.deps); // jobs and outbox keep running; the tick never does from here on
    await processOutbox(h.deps);
    const stuckFrom = h.clock.now().getTime() + 2 * 60_000; // Level 1 second attempt falls due at 2 min and nothing creates it
    let alertAt: number | null = null;
    for (let i = 1; i <= 10 && alertAt === null; i++) {
      h.clock.advance(60_000);
      await processDueJobs(h.deps);
      await processOutbox(h.deps);
      await mon.cycle();
      if (mon.alerts.length) alertAt = h.clock.now().getTime();
    }
    const body = await (await fetch(`${web.url}/readyz`)).json();
    expect(body.ok).toBe(false);
    expect(body.checks.due_escalations.ok).toBe(false);
    expect(alertAt! - stuckFrom).toBeLessThanOrEqual(300_000);
    expect(new Set(mon.alerts.map((a) => a.operator))).toEqual(new Set(OPS));
    await web.close();
  });

  it('(c) platform probe reply withheld: readiness fails after 5 minutes and the monitor alerts', async () => {
    const web = await serve(h);
    const mon = new FakeMonitor({ now: () => h.clock.now().getTime(), operators: OPS, components: [], readyUrl: `${web.url}/readyz` });
    await owner((c) => c.query(`insert into probe_runs (kind, sent_at) values ('sms_round_trip', $1)`, [h.clock.now()]));
    for (let i = 0; i < 8 && !mon.alerts.length; i++) {
      h.clock.advance(60_000);
      await mon.cycle();
    }
    expect(mon.alerts.length).toBe(2);
    expect((await (await fetch(`${web.url}/readyz`)).json()).checks.probe.ok).toBe(false);
    await web.close();
  });

  it('(d) a voice call to the SMS number is forwarded to the emergency contact number', async () => {
    const r = await twilioPost(h, '/webhooks/twilio/voice', { CallSid: 'CAinbound0001', From: s.tenants['204'].mobile, To: s.smsNumber });
    const xml = await r.text();
    const [acc] = await owner((c) => c.query('select emergency_contact_phone from accounts where id = $1', [s.accountId])).then((x) => x.rows);
    expect(xml).toContain(`<Dial>${acc.emergency_contact_phone}</Dial>`);
  });
});
