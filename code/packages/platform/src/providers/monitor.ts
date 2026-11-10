// External monitor boundary (MH-16a, TRD 8.9): the process only reports that it is alive; it never judges itself.
export interface MonitorClient {
  checkIn(component: 'web' | 'worker'): Promise<void>;
}
export class HttpMonitorClient implements MonitorClient {
  constructor(private readonly baseUrl: string) {}
  async checkIn(component: 'web' | 'worker'): Promise<void> {
    const ctl = AbortSignal.timeout(5_000);
    await fetch(`${this.baseUrl.replace(/\/+$/, '')}/checkin/${component}`, { method: 'POST', signal: ctl });
  }
}
export const noopMonitor: MonitorClient = { checkIn: async () => undefined };
