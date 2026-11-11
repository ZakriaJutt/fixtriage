// UT-01: every item of the synthetic emergency set ends non-routine by rules + uncertainty alone, with the labelled tier.
import { describe, expect, it } from 'vitest';
import { evaluateRules, intakeFloor, normalise, ruleFloor, safetyCandidate } from '../src';
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

describe('safety-candidate layer (fix round 2, B1-003 ruling)', () => {
  it('the stem layer alone (without the phrase rules) marks every English emergency fixture', () => {
    const missed = EMERGENCY_SET.filter((i) => i.label !== 'uncertain' && !safetyCandidate(normalise(i.text ?? '')).candidate).map((i) => `${i.id} ${i.text}`);
    expect(missed).toEqual([]);
  });
  it.each(['something weird with the gas meter', 'small leak under the sink', 'smoke alarm keeps chirping', 'neighbour is burning something', 'heat is kinda weak tonight', 'water main valve question'])(
    '"%s" has no rule tier but is a candidate: after hours the intake floor is uncertain, in business hours none',
    (text) => {
      const r = evaluateRules({ text, hasMedia: false, afterHours: true });
      expect(r.safetyCandidate).toBe(true);
      expect(intakeFloor(r, true)).not.toBeNull();
      const day = evaluateRules({ text, hasMedia: false, afterHours: false });
      expect(['uncertain', 'urgent', 'life_safety', null]).toContain(intakeFloor(day, false));
    },
  );
  it.each(['kitchen tap dripping a little', 'the dishwasher is making a noise', 'can someone fix the blinds', 'light bulb out in the hallway', 'paint is peeling', 'the dryer is broken', 'cabinet hinge is loose', 'ok thanks', 'I live in Burnaby near Gastown'])(
    '"%s" is not a candidate', (text) => expect(evaluateRules({ text, hasMedia: false, afterHours: true }).safetyCandidate).toBe(false),
  );
});
