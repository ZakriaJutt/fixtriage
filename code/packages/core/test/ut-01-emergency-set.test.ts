// UT-01: every item of the synthetic emergency set ends non-routine by rules + uncertainty alone, with the labelled tier.
import { describe, expect, it } from 'vitest';
import { evaluateRules, ruleFloor } from '../src';
import { EMERGENCY_SET } from './fixtures/emergency-set';

describe('UT-01 emergency fixture set', () => {
  it('has at least 200 items', () => {
    expect(EMERGENCY_SET.length).toBeGreaterThanOrEqual(200);
  });
  const failures = EMERGENCY_SET.map((item) => {
    const r = evaluateRules({ text: item.text, hasMedia: item.hasMedia ?? false, afterHours: item.afterHours ?? false });
    return { item, got: ruleFloor(r), rules: r.matchedRules };
  }).filter((x) => x.got !== x.item.label);
  it('every item ends with its labelled tier and none ends routine', () => {
    expect(failures.map((f) => `${f.item.id} "${f.item.text}" expected ${f.item.label} got ${f.got} [${f.rules.join(',')}]`)).toEqual([]);
  });
  it('a lockout in business hours is not given the after-hours rule (UR-7 scope)', () => {
    const r = evaluateRules({ text: 'I am locked out', hasMedia: false, afterHours: false });
    expect(r.matchedRules).not.toContain('ur.lockout_after_hours');
  });
  it('a plain routine message has no rule hit and no uncertainty floor', () => {
    const r = evaluateRules({ text: 'kitchen tap dripping a little', hasMedia: true, afterHours: false });
    expect(ruleFloor(r)).toBeNull();
  });
});
