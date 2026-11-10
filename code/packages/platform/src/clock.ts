// Clock interface: domain code takes time from here so tests can drive it (AGENTS.md 5).
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  constructor(private t: number) {}
  now(): Date {
    return new Date(this.t);
  }
  set(iso: string | number | Date): void {
    this.t = new Date(iso).getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
