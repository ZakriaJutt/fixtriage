// B1-008: business hours depend on the runtime's tz database. BC moved to permanent UTC-7 (clocks moved ahead on
// 2026-03-08 for the last time; BC news release 2026AG0013-000209, 2 March 2026). A runtime with older tzdata would
// put America/Vancouver at UTC-8 in winter and shift every after-hours window by one hour, so web and worker refuse
// to start (and /readyz fails) unless the zone data matches. East Kootenay and Golden still change clocks with
// Alberta: those accounts use America/Edmonton, which this check does not constrain.

export const MIN_TZDATA = '2026e';

export interface TzCheck {
  ok: boolean;
  tzdata: string | null;
  vancouverWinterOffsetMinutes: number | null;
  reason: string | null;
}

export function offsetMinutes(instant: Date, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((local - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

export function checkTimezoneData(tzdata: string | null = process.versions.tz ?? null, offsetOf: (d: Date, tz: string) => number = offsetMinutes): TzCheck {
  const winter = offsetOf(new Date('2027-01-15T20:00:00Z'), 'America/Vancouver');
  if (!tzdata || tzdata < MIN_TZDATA) return { ok: false, tzdata, vancouverWinterOffsetMinutes: winter, reason: `tzdata ${tzdata ?? 'unknown'} older than ${MIN_TZDATA}` };
  if (winter !== -420) return { ok: false, tzdata, vancouverWinterOffsetMinutes: winter, reason: 'America/Vancouver winter offset is not UTC-7' };
  return { ok: true, tzdata, vancouverWinterOffsetMinutes: winter, reason: null };
}
