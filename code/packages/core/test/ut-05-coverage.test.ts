// UT-05: a gap on Saturday 00:00-08:00 at Level 1 is named; one person on all levels fails "two different people" (EP-1, EP-9).
import { describe, expect, it } from 'vitest';
import { checkCoverage, type Shift } from '../src';

const H = 3_600_000;
const from = Date.parse('2027-02-01T08:00:00Z'); // Monday 00:00 PST
const to = from + 14 * 24 * H;
const satMidnight = from + 5 * 24 * H; // Saturday 2027-02-06 00:00 PST
const owner = { userId: 'owner', phone: '+16045550101' };

describe('UT-05 coverage', () => {
  it('names the Level 1 gap', () => {
    const shifts: Shift[] = [
      { userId: 'lee', phone: '+16045550102', level: 1, startsAt: from, endsAt: satMidnight },
      { userId: 'lee', phone: '+16045550102', level: 1, startsAt: satMidnight + 8 * H, endsAt: to },
      { userId: 'sam', phone: '+16045550103', level: 2, startsAt: from, endsAt: to },
    ];
    const r = checkCoverage({ shifts, owner, from, to });
    expect(r.ok).toBe(false);
    expect(r.gaps).toEqual([{ level: 1, from: satMidnight, to: satMidnight + 8 * H }]);
  });
  it('passes when covered by two different people', () => {
    const shifts: Shift[] = [
      { userId: 'lee', phone: '+16045550102', level: 1, startsAt: from, endsAt: to },
      { userId: 'sam', phone: '+16045550103', level: 2, startsAt: from, endsAt: to },
    ];
    expect(checkCoverage({ shifts, owner, from, to }).ok).toBe(true);
  });
  it('one person on all levels is rejected', () => {
    const shifts: Shift[] = [
      { userId: 'owner', phone: owner.phone, level: 1, startsAt: from, endsAt: to },
      { userId: 'owner', phone: owner.phone, level: 2, startsAt: from, endsAt: to },
    ];
    const r = checkCoverage({ shifts, owner, from, to });
    expect(r.ok).toBe(false);
    expect(r.gaps).toEqual([]);
    expect(r.notTwoPeople).toEqual([{ from, to }]);
  });
  it('two people sharing one phone number is rejected', () => {
    const shifts: Shift[] = [
      { userId: 'lee', phone: owner.phone, level: 1, startsAt: from, endsAt: to },
      { userId: 'sam', phone: owner.phone, level: 2, startsAt: from, endsAt: to },
    ];
    expect(checkCoverage({ shifts, owner, from, to }).notTwoPeople.length).toBe(1);
  });
});
