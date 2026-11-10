// UT-04: step schedule with a 300 s timeout (EP-3, EP-5).
import { describe, expect, it } from 'vitest';
import { planSteps, type PlannedStep } from '../src';

const MIN = 60_000;
function simulate(untilMin: number, engagedAtMin: number | null): Array<[number, string]> {
  const existing: PlannedStep[] = [];
  for (let m = 0; m <= untilMin * 4; m++) {
    const now = (m * MIN) / 4; // tick every 15 s
    const out = planSteps({ startedAt: 0, ackTimeoutSeconds: 300, existing, operatorEngagedAt: engagedAtMin === null ? null : engagedAtMin * MIN, companions: [], now });
    existing.push(...out.due);
  }
  return existing.map((s) => [s.dueAt / MIN, `L${s.level}${s.level === 4 ? (s.role === 'operator_primary' ? 'p' : 'b') : ''}`]);
}

describe('UT-04 escalation schedule', () => {
  it('Levels 1-3 at 0, 2, 5, 7, 10, 12; primary operator 15, backup 20, both every 5 min; Levels 1-3 again from 30 min', () => {
    const steps = simulate(46, null);
    const at = (m: number) => steps.filter(([t]) => t === m).map(([, k]) => k).sort();
    expect(at(0)).toEqual(['L1']);
    expect(at(2)).toEqual(['L1']);
    expect(at(5)).toEqual(['L2']);
    expect(at(7)).toEqual(['L2']);
    expect(at(10)).toEqual(['L3']);
    expect(at(12)).toEqual(['L3']);
    expect(at(15)).toEqual(['L4p']);
    expect(at(20)).toEqual(['L4b']);
    expect(at(25)).toEqual(['L4b', 'L4p']);
    expect(at(30)).toEqual(['L1', 'L2', 'L3', 'L4b', 'L4p']);
    expect(at(45)).toEqual(['L1', 'L2', 'L3', 'L4b', 'L4p']);
    expect(steps.filter(([t]) => ![0, 2, 5, 7, 10, 12, 15, 20].includes(t) && t % 5 !== 0)).toEqual([]);
  });
  it('an operator engaging stops operator re-pages but not the 15-minute re-page of Levels 1-3 (EP-5)', () => {
    const steps = simulate(61, 22);
    const ops = steps.filter(([, k]) => k.startsWith('L4')).map(([t]) => t);
    expect(Math.max(...ops)).toBe(20);
    const l1 = steps.filter(([, k]) => k === 'L1').map(([t]) => t);
    expect(l1).toEqual([0, 2, 30, 45, 60]);
  });
  it('no step is created twice and none is skipped after a 90 s gap (IT-06 logic)', () => {
    const existing: PlannedStep[] = [];
    for (const now of [0, 4 * MIN, 5.5 * MIN, 5.75 * MIN]) existing.push(...planSteps({ startedAt: 0, ackTimeoutSeconds: 300, existing, operatorEngagedAt: null, companions: [], now }).due);
    expect(existing.map((s) => `${s.level}.${s.attempt}`)).toEqual(['1.1', '1.2', '2.1']);
  });
  it('companions (EP-11, FD-3) are paged with Level 1 at 0 and 2 min', () => {
    const out = planSteps({ startedAt: 0, ackTimeoutSeconds: 300, existing: [], operatorEngagedAt: null, companions: ['approver'], now: 2 * MIN });
    expect(out.due.map((s) => `${s.role}@${s.dueAt / MIN}`).sort()).toEqual(['approver@0', 'approver@2', 'oncall@0', 'oncall@2']);
  });
  it('an early Level 2 start (EP-4) moves the rest of the ladder', () => {
    const existing: PlannedStep[] = [{ cycle: 1, level: 1, attempt: 1, role: 'oncall', dueAt: 0 }, { cycle: 1, level: 2, attempt: 1, role: 'oncall', dueAt: 1 * MIN }];
    const out = planSteps({ startedAt: 0, ackTimeoutSeconds: 300, existing, operatorEngagedAt: null, companions: [], now: 6 * MIN });
    expect(out.due.map((s) => `${s.level}.${s.attempt}@${s.dueAt / MIN}`)).toEqual(['2.2@3', '3.1@6']);
  });
});
