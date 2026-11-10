// Fake external monitor (MH-16a, TRD 8.9), standing in for the hosted dead-man and uptime service. It runs OUTSIDE
// the application: it receives check-ins over HTTP, probes /readyz over HTTP, and alerts the operators through its
// own channel (recorded here), never through the application's provider account.
import { createServer, type Server } from 'node:http';

export interface MonitorAlert {
  at: number;
  operator: string;
  reason: string;
}

export interface MonitorOptions {
  now: () => number;
  operators: string[];
  /** Alert after this much silence from a component (MH-16: 180 s). */
  silenceMs?: number;
  /** Consecutive failed probes before an alert (TRD 8.9: two). */
  probeFailuresToAlert?: number;
  components?: string[];
  readyUrl?: string;
}

export class FakeMonitor {
  readonly alerts: MonitorAlert[] = [];
  readonly checkIns: Array<{ component: string; at: number }> = [];
  private last = new Map<string, number>();
  private alerted = new Set<string>();
  private probeFailures = 0;
  private server: Server | null = null;

  constructor(private readonly o: MonitorOptions) {}

  receiveCheckIn(component: string): void {
    const at = this.o.now();
    this.last.set(component, at);
    this.checkIns.push({ component, at });
    this.alerted.delete(`silence:${component}`);
  }

  private alert(key: string, reason: string): void {
    if (this.alerted.has(key)) return;
    this.alerted.add(key);
    for (const op of this.o.operators) this.alerts.push({ at: this.o.now(), operator: op, reason });
  }

  /** One monitor cycle (the hosted service runs one about every 60 s). */
  async cycle(): Promise<void> {
    const now = this.o.now();
    const silence = this.o.silenceMs ?? 180_000;
    for (const c of this.o.components ?? ['web', 'worker']) {
      const last = this.last.get(c);
      if (last !== undefined && now - last > silence) this.alert(`silence:${c}`, `${c} silent`);
    }
    if (this.o.readyUrl) {
      let ok = false;
      try {
        ok = (await fetch(this.o.readyUrl, { signal: AbortSignal.timeout(5_000) })).status === 200;
      } catch {
        ok = false;
      }
      this.probeFailures = ok ? 0 : this.probeFailures + 1;
      if (ok) this.alerted.delete('probe');
      if (this.probeFailures >= (this.o.probeFailuresToAlert ?? 2)) this.alert('probe', 'readiness probe failed');
    }
  }

  listen(port = 0): Promise<number> {
    this.server = createServer((req, res) => {
      const m = req.method === 'POST' && req.url?.match(/^\/checkin\/(web|worker)$/);
      if (m) {
        this.receiveCheckIn(m[1]!);
        res.writeHead(204).end();
      } else res.writeHead(404).end();
    });
    return new Promise((resolve) => this.server!.listen(port, '127.0.0.1', () => resolve((this.server!.address() as { port: number }).port)));
  }

  close(): Promise<void> {
    return new Promise((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}
