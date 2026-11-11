// Rule set v4 (B1-003 round-3 fix): the reviewer's nine misses, quieted false pages, the URGENT reply, frozen v3,
// and the known limits measured on a small synthetic set (recorded in PRD SM-12 and verification section 7).
import { describe, expect, it } from 'vitest';
import { carrierKeyword, distressFloor, evaluateRules, intakeFloor, normalise, renderUrgentPrompt, RULE_SET_VERSION, SAFETY_CANDIDATE_V3, SAFETY_CANDIDATE_V4, safetyCandidate, URGENT_KEYWORD_LINE } from '../src';
import { HOLDOUT_EMERGENCIES, HOLDOUT_ROUTINE, REVIEWER_R3_EMERGENCIES, REVIEWER_R3_ROUTINE } from './fixtures/holdout-set';

const floor = (t: string, ah: boolean) => intakeFloor(evaluateRules({ text: t, hasMedia: false, afterHours: ah }), ah);

describe('rule set v4', () => {
  it('is the current version', () => expect(RULE_SET_VERSION).toBe(4));
  it('after hours, every one of the reviewer\'s 28 fresh emergency phrasings has a floor (none closable by a model "routine")', () => {
    expect(REVIEWER_R3_EMERGENCIES.filter(([t]) => floor(t, true) === null).map(([t]) => t)).toEqual([]);
  });
  it.each(['kitchen is on fyer', 'wires are arcing behind the dryer', 'its raining inside my living room from upstairs', 'brown stuff comming up the shower drain', 'thermostat says 9 degrees and nothing is blowing', 'whole apartment went dark', 'hydro is out in my suite only', 'elevator stopped with me in it', 'sink is geysering water'])(
    'reviewer miss "%s" now reaches its labelled tier by rule, in business hours too',
    (t) => {
      const want = REVIEWER_R3_EMERGENCIES.find(([x]) => x === t)![1];
      expect(floor(t, true)).toBe(want);
      expect(floor(t, false)).toBe(want);
    },
  );
  it('after hours, of the reviewer\'s 40 routine messages only the chirping smoke detector pages (rule ls.fire, kept on purpose)', () => {
    expect(REVIEWER_R3_ROUTINE.filter((t) => floor(t, true) !== null)).toEqual(['my smoke detector needs a new battery it chirps']);
  });
  it('known limits on the developer\'s held-out set (written before tuning): miss at most 1/20, false page at most 2/20 after hours', () => {
    expect(HOLDOUT_EMERGENCIES.filter(([t]) => floor(t, true) === null).length).toBeLessThanOrEqual(1);
    expect(HOLDOUT_ROUTINE.filter((t) => floor(t, true) !== null).length).toBeLessThanOrEqual(2);
  });
  it('no v3 stem is removed or demoted from strong to weak', () => {
    const v3Strong = SAFETY_CANDIDATE_V3.stems.filter((x) => !SAFETY_CANDIDATE_V3.weak.includes(x));
    for (const st of SAFETY_CANDIDATE_V3.stems) expect(SAFETY_CANDIDATE_V4.stems).toContain(st);
    for (const st of v3Strong) expect(SAFETY_CANDIDATE_V4.weak).not.toContain(st);
    for (const p of SAFETY_CANDIDATE_V3.pairs) expect(SAFETY_CANDIDATE_V4.pairs).toContainEqual(p);
  });
  it('v3 behaviour is frozen for decisions stored with it', () => {
    expect(safetyCandidate(normalise('the closet door is off its track'), SAFETY_CANDIDATE_V3).candidate).toBe(true);
    expect(safetyCandidate(normalise('the closet door is off its track'), SAFETY_CANDIDATE_V4).candidate).toBe(false);
  });
  it.each(['my mom fell off the ladder', 'the outlet burned out and smells hot', 'no heat and the heat pump is too hot to touch', 'the door lock is broken i cant get in', 'water coming in under the door', 'power is out'])(
    'quieting does not reach a real report: "%s" still has an after-hours floor',
    (t) => expect(floor(t, true)).not.toBeNull(),
  );
});

describe('EP-10a URGENT reply', () => {
  it.each(['URGENT', 'urgent', 'Urgent!', 'urgent.', 'urgnet', 'URGANT', 'urgen', 'its urgent', 'yes urgent please', 'EMERGENCY', 'emergancy'])('"%s" is rule ur.tenant_urgent (urgent), in and out of hours', (t) => {
    for (const ah of [true, false]) {
      const r = evaluateRules({ text: t, hasMedia: false, afterHours: ah });
      expect(r.matchedRules).toContain('ur.tenant_urgent');
      expect(r.ruleTier).toBe('urgent');
    }
  });
  it('the prompt is fixed text with the one keyword and the emergency examples; its only input is the contact number', () => {
    const p = renderUrgentPrompt({ emergencyContactPhone: '+16045550100' });
    expect(p.templateId).toBe('tenant.urgent_prompt');
    expect(p.body).toContain(URGENT_KEYWORD_LINE);
    expect(p.body).toContain('911');
    expect(p.body).toContain('+16045550100');
  });
});

describe('B1-012 distress floor', () => {
  it.each(['HELP', 'help', 'HELP!', 'HELP!!!', 'help.', 'Help me', 'please help', 'help help', 'SOS', 'INFO', 'someone help'])('"%s" has an uncertain floor', (t) => {
    expect(distressFloor(t)).toBe('uncertain');
  });
  it.each(['the blinds are broken', 'can you help with my lease', 'STOP', 'START', '', null])('"%s" has none', (t) => expect(distressFloor(t)).toBeNull());
  it('HELP and INFO are still recognised as carrier keywords (stored), STOP is the only one that consumes', () => {
    expect(carrierKeyword('HELP!')).toBe('help');
    expect(carrierKeyword('info')).toBe('help');
    expect(carrierKeyword('STOP')).toBe('stop');
  });
});
