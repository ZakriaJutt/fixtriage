// Worker (TRD 5, 6.3). Two independent loops so that a slow or hung model never delays a safety reply or page (B1-002):
// - safety loop: intake jobs, decision sweep (B1-001), escalation tick every 15 s, dispatch watch every 30 s, outbox,
//   status retries; it checks in to the external monitor only after a completed pass (B1-007), so a stuck loop goes
//   silent and the monitor alerts;
// - model loop: classify jobs with their own concurrency and a hard timeout enforced by the runner.
// The worker never judges its own health (MH-16, TRD 8.9).
import { createLogger, type MonitorClient } from '@fixtriage/platform';
import { processClassifyJobs, processDueJobs, processOutbox, retryPendingStatusEvents, sweepUndecided, tickEscalations, watchDispatches, type Deps } from '@fixtriage/services';

const log = createLogger('worker');

export interface WorkerOptions {
  pollMs: number;
  tickMs: number;
  dispatchWatchMs: number;
  checkInMs: number;
  monitor: MonitorClient;
  classifyConcurrency?: number;
}

/** One pass of the safety loop (exported for tests). */
export async function safetyPass(deps: Deps, state: { lastTick: number; lastWatch: number }, opts: Pick<WorkerOptions, 'tickMs' | 'dispatchWatchMs'>, started: number): Promise<void> {
  await processDueJobs(deps); // excludes model jobs
  await sweepUndecided(deps);
  if (started - state.lastTick >= opts.tickMs) {
    state.lastTick = started;
    await tickEscalations(deps);
  }
  if (started - state.lastWatch >= opts.dispatchWatchMs) {
    state.lastWatch = started;
    await watchDispatches(deps);
  }
  await processOutbox(deps);
  await retryPendingStatusEvents(deps);
}

export function startWorker(deps: Deps, opts: WorkerOptions): { stop(): Promise<void> } {
  let running = true;
  const state = { lastTick: 0, lastWatch: 0 };
  let lastCheckIn = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

  const safetyLoop = async () => {
    while (running) {
      const started = Date.now();
      try {
        await safetyPass(deps, state, opts, started);
        if (Date.now() - lastCheckIn >= opts.checkInMs) {
          lastCheckIn = Date.now();
          void opts.monitor.checkIn('worker').catch(() => log.warn('checkin.failed'));
        }
      } catch (e) {
        log.error('safety_loop.error', { error: e instanceof Error ? e.name : 'unknown' });
      }
      await sleep(opts.pollMs - (Date.now() - started));
    }
  };
  const modelLoop = async () => {
    while (running) {
      const started = Date.now();
      try {
        await processClassifyJobs(deps, { concurrency: opts.classifyConcurrency ?? 4 });
      } catch (e) {
        log.error('model_loop.error', { error: e instanceof Error ? e.name : 'unknown' });
      }
      await sleep(opts.pollMs - (Date.now() - started));
    }
  };
  const loops = Promise.all([safetyLoop(), modelLoop()]);
  return {
    async stop() {
      running = false;
      await loops;
    },
  };
}
