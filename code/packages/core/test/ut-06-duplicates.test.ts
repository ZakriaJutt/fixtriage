// UT-06: same-sender threading (DU-2) and duplicate suggestion window (DU-3); DU-4 decisions.
import { describe, expect, it } from 'vitest';
import { appendsToOpenRequest, du4Decision, suggestsDuplicate } from '../src';

const MIN = 60_000;
describe('UT-06 duplicate matching', () => {
  it('same sender at 0, 29, 31 min: append, append, new', () => {
    expect(appendsToOpenRequest(0, 0)).toBe(true);
    expect(appendsToOpenRequest(0, 29 * MIN)).toBe(true);
    expect(appendsToOpenRequest(0, 31 * MIN)).toBe(false);
  });
  it('other sender, same property: 5 h 59 suggest, 6 h 01 no suggestion', () => {
    expect(suggestsDuplicate(0, (5 * 60 + 59) * MIN)).toBe(true);
    expect(suggestsDuplicate(0, (6 * 60 + 1) * MIN)).toBe(false);
  });
  const base = { incidentAcknowledged: true, buildingWide: false, incidentTier: 'urgent' as const, incidentUnitIds: ['u204'], newUnitId: 'u204', newTier: 'urgent' as const };
  it('DU-4 a-d', () => {
    expect(du4Decision({ ...base, incidentAcknowledged: false, newUnitId: 'u305' })).toBe('continue_chain');
    expect(du4Decision(base)).toBe('no_page');
    expect(du4Decision({ ...base, newUnitId: 'u305' })).toBe('reopen');
    expect(du4Decision({ ...base, newUnitId: null })).toBe('reopen');
    expect(du4Decision({ ...base, newTier: 'life_safety' })).toBe('reopen');
    expect(du4Decision({ ...base, buildingWide: true, newUnitId: 'u406' })).toBe('attach_building_wide');
    expect(du4Decision({ ...base, buildingWide: true, newUnitId: 'u406', newTier: 'life_safety' })).toBe('reopen');
  });
  it('B1-005: a life_safety report reopens even on a building-wide life_safety incident and from the same unit', () => {
    expect(du4Decision({ ...base, incidentTier: 'life_safety', buildingWide: true, newUnitId: 'u305', newTier: 'life_safety' })).toBe('reopen');
    expect(du4Decision({ ...base, incidentTier: 'life_safety', newUnitId: 'u204', newTier: 'life_safety' })).toBe('reopen');
    expect(du4Decision({ ...base, incidentTier: 'life_safety', buildingWide: true, newUnitId: 'u305', newTier: 'urgent' })).toBe('attach_building_wide');
  });
});
