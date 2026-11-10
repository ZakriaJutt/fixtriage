// UT-03: isAfterHours at boundaries, on a holiday and across a clock change.
// Finding (B1, 2026-11-11): the IANA tz database shipped with Node 24.22.2 (tzdata 2026e) has America/Vancouver
// at UTC-7 all year from 2026-03-08, so the fixture's "clock change 2027-03-14" does not occur in that zone.
// The test therefore checks (1) Vancouver boundaries in 2027 at the offset the zone database gives, (2) the last
// Vancouver change on 2026-03-08, and (3) the 2027-03-14 change in a zone that still has it (America/Toronto).
import { describe, expect, it } from 'vitest';
import { isAfterHours, type Calendar } from '../src';

const wk: Array<[string, string]> = [['09:00', '17:00']];
const hours = { mon: wk, tue: wk, wed: wk, thu: wk, fri: wk };
const van: Calendar = { timezone: 'America/Vancouver', hours, holidays: ['2027-01-01'] };
const tor: Calendar = { timezone: 'America/Toronto', hours, holidays: [] };
const at = (iso: string, cal: Calendar = van) => isAfterHours(new Date(iso), cal);

describe('UT-03 business hours', () => {
  it('Vancouver 2027 (UTC-7 in tzdata 2026e): 16:59:59 open, 17:00:00 closed, 08:59:59 closed, 09:00 open', () => {
    expect(at('2027-03-12T23:59:59Z')).toBe(false); // Fri 16:59:59
    expect(at('2027-03-13T00:00:00Z')).toBe(true); // Fri 17:00:00
    expect(at('2027-03-15T15:59:59Z')).toBe(true); // Mon 08:59:59
    expect(at('2027-03-15T16:00:00Z')).toBe(false); // Mon 09:00:00
  });
  it('Vancouver across its 2026-03-08 change (PST -> PDT)', () => {
    expect(at('2026-03-07T00:59:59Z')).toBe(false); // Fri 2026-03-06 16:59:59 PST
    expect(at('2026-03-07T01:00:00Z')).toBe(true); // 17:00:00 PST
    expect(at('2026-03-09T23:59:59Z')).toBe(false); // Mon 2026-03-09 16:59:59 PDT
    expect(at('2026-03-10T00:00:00Z')).toBe(true); // 17:00:00 PDT
  });
  it('a zone with the 2027-03-14 change (Toronto) is correct on both sides', () => {
    expect(at('2027-03-12T21:59:59Z', tor)).toBe(false); // Fri 16:59:59 EST
    expect(at('2027-03-12T22:00:00Z', tor)).toBe(true); // Fri 17:00 EST
    expect(at('2027-03-15T20:59:59Z', tor)).toBe(false); // Mon 16:59:59 EDT
    expect(at('2027-03-15T21:00:00Z', tor)).toBe(true); // Mon 17:00 EDT
  });
  it('a weekend day is closed', () => {
    expect(at('2027-03-14T18:00:00Z')).toBe(true);
  });
  it('holiday 2027-01-01 (a Friday) is after hours all day', () => {
    expect(at('2027-01-01T19:00:00Z')).toBe(true); // 12:00 local
    expect(at('2026-12-31T19:00:00Z')).toBe(false); // Thu 12:00 local
  });
});
