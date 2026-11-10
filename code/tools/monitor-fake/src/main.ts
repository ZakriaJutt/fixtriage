// Local run of the fake monitor next to `npm run dev` (port 3109; alerts printed, never sent).
import { FakeMonitor } from './index';

const port = Number(process.env.MONITOR_PORT ?? 3109);
const m = new FakeMonitor({ now: () => Date.now(), operators: ['primary-operator', 'backup-operator'], readyUrl: process.env.READY_URL ?? 'http://127.0.0.1:8109/readyz' });
await m.listen(port);
setInterval(() => {
  const before = m.alerts.length;
  void m.cycle().then(() => {
    for (const a of m.alerts.slice(before)) process.stdout.write(JSON.stringify({ component: 'monitor-fake', event: 'alert', operator: a.operator, reason: a.reason }) + '\n');
  });
}, 60_000);
process.stdout.write(JSON.stringify({ component: 'monitor-fake', event: 'listening', port }) + '\n');
