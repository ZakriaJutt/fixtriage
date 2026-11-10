// The single business-hours calendar (AGENTS.md 6; TRD 12 "After hours"). Pure: the instant is a parameter.

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type BusinessHours = Partial<Record<Weekday, Array<[string, string]>>>;

export interface Calendar {
  timezone: string;
  hours: BusinessHours;
  /** Local dates `YYYY-MM-DD` the account lists as closed. */
  holidays: string[];
}

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateBusinessHours(h: unknown): h is BusinessHours {
  if (typeof h !== 'object' || h === null || Array.isArray(h)) return false;
  for (const [k, v] of Object.entries(h)) {
    if (!WEEKDAYS.includes(k as Weekday) || !Array.isArray(v)) return false;
    for (const iv of v) {
      if (!Array.isArray(iv) || iv.length !== 2 || !HHMM.test(iv[0]) || !(HHMM.test(iv[1]) || iv[1] === '24:00') || iv[0] >= iv[1]) return false;
    }
  }
  return true;
}

export interface LocalTime {
  date: string; // YYYY-MM-DD
  weekday: Weekday;
  minutes: number; // minutes since local midnight, with seconds as a fraction
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

export function localTime(instant: Date, timezone: string): LocalTime {
  let f = fmtCache.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });
    fmtCache.set(timezone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(instant).map((p) => [p.type, p.value]));
  const weekday = String(parts.weekday).toLowerCase().slice(0, 3) as Weekday;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

export function isAfterHours(instant: Date, cal: Calendar): boolean {
  const lt = localTime(instant, cal.timezone);
  if (cal.holidays.includes(lt.date)) return true;
  const intervals = cal.hours[lt.weekday] ?? [];
  return !intervals.some(([a, b]) => lt.minutes >= toMinutes(a) && lt.minutes < toMinutes(b));
}

/**
 * Adds business hours (FD-4 routine confirmation timeout) by walking in one-minute steps.
 * Bounded to 60 days so that a calendar with no open hours cannot loop forever; returns null then.
 */
export function addBusinessMinutes(start: Date, minutes: number, cal: Calendar): Date | null {
  let remaining = minutes;
  let t = start.getTime();
  const limit = t + 60 * 24 * 60 * 60 * 1000;
  while (remaining > 0) {
    if (t > limit) return null;
    if (!isAfterHours(new Date(t), cal)) remaining -= 1;
    t += 60 * 1000;
  }
  return new Date(t);
}
