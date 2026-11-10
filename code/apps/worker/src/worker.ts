// Worker loop (TRD 5, 6.3): jobs and outbox every poll, escalation.tick every 15 s, dispatch.watch every 30 s,
// check-in to the external monitor every 60 s. The worker never judges its own health (MH-16, TRD 8.9).
import { createLogger, type MonitorClient } from '@fixtriage/platform';
import { processDueJobs, processOutbox, retryPendingStatusEvents, tickEscalations, watchDispatches, type Deps } from '@fixtriage/services';

const log = createLogger('worker');

export interface WorkerOptions {
  pollMs: number;
  tickMs: number;
  dispatchWatchMs: number;
  checkInMs: number;
  monitor: MonitorClient;
}

export function startWorker(deps: Deps, opts: WorkerOptions): { stop(): Promise<void> } {
  let running = true;
  let lastTick = 0;
  let lastWatch = 0;
  let current: Promise<void> = Promise.resolve();

  const checkIn = async () => {
    try {
      await opts.monitor.checkIn('worker');
    } catch {
      log.warn('checkin.failed'); // nothing else to do in-process: silence is the external monitor's signal
    }
  };
  void checkIn();
  const checkInTimer = setInterval(() => void checkIn(), opts.checkInMs);

  const loop = async () => {
    while (running) {
      const started = Date.now();
      try {
        await processDueJobs(deps);
        if (started - lastTick >= opts.tickMs) {
          lastTick = started;
          await tickEscalations(deps);
        }
        if (started - lastWatch >= opts.dispatchWatchMs) {
          lastWatch = started;
          await watchDispatches(deps);
        }
        await processOutbox(deps);
        await retryPendingStatusEvents(deps);
      } catch (e) {
        log.error('loop.error', { error: e instanceof Error ? e.name : 'unknown' });
      }
      await new Promise((r) => setTimeout(r, Math.max(0, opts.pollMs - (Date.now() - started))));
    }
  };
  current = loop();
  return {
    async stop() {
      running = false;
      clearInterval(checkInTimer);
      await current;
    },
  };
}
