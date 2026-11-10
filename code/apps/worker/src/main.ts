// Worker entry point. Starts without any web-framework module (T-2.1.5).
import { createDatabase } from '@fixtriage/db';
import { createLogger, FakeClassifier, FakeMessagingProvider, FakeObjectStorage, HttpMonitorClient, loadConfig, noopMonitor, systemClock } from '@fixtriage/platform';
import { startWorker } from './worker';

const log = createLogger('worker');
const config = (() => {
  try {
    return loadConfig();
  } catch (e) {
    log.error('config.invalid', { error: e instanceof Error ? e.message.replace(/=.*/g, '') : 'unknown' });
    process.exit(1);
  }
})();

const database = createDatabase(config.DATABASE_URL);
// B1: providers are fakes only (no accounts, no keys). Real clients are later tasks behind the same interfaces.
const deps = {
  database,
  clock: systemClock,
  messaging: new FakeMessagingProvider(),
  classifier: new FakeClassifier(),
  storage: new FakeObjectStorage(),
  publicBaseUrl: config.PUBLIC_BASE_URL,
  pagingFromNumber: config.PAGING_FROM_NUMBER,
};
const worker = startWorker(deps, {
  pollMs: config.WORKER_POLL_MS,
  tickMs: 15_000,
  dispatchWatchMs: 30_000,
  checkInMs: config.CHECKIN_INTERVAL_MS,
  monitor: config.MONITOR_URL ? new HttpMonitorClient(config.MONITOR_URL) : noopMonitor,
});
log.info('worker.started', { providers: config.PROVIDERS });

const shutdown = async () => {
  await worker.stop();
  await database.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
