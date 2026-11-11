// Duplicate-report rules (DU-2, DU-3, DU-4; UT-06). Pure.
import { EP } from './escalation-policy';
import { tierRank, type Tier } from './tiers';

/** DU-2: a message from the same sender joins the open request if it arrives within 30 minutes of the request opening. */
export function appendsToOpenRequest(requestOpenedAt: number, receivedAt: number): boolean {
  const d = receivedAt - requestOpenedAt;
  return d >= 0 && d <= EP.sameSenderWindowSeconds * 1000;
}

/** DU-3: a different sender's report of the same hazard at the same property within 6 hours of the incident opening. */
export function suggestsDuplicate(incidentCreatedAt: number, receivedAt: number): boolean {
  const d = receivedAt - incidentCreatedAt;
  return d >= 0 && d <= EP.duplicateWindowSeconds * 1000;
}

export type Du4Decision = 'continue_chain' | 'no_page' | 'reopen' | 'attach_building_wide';

export interface Du4Input {
  incidentAcknowledged: boolean;
  buildingWide: boolean;
  incidentTier: Tier;
  incidentUnitIds: Array<string | null>;
  newUnitId: string | null;
  newTier: Tier;
}

/**
 * DU-4. A suggestion never suppresses a page by itself:
 * (a) not acknowledged: the running chain continues (pages show the new count);
 * (c) any life_safety report reopens (EP-11c), even on a building-wide incident (B1-005: DU-4(c) "any life_safety
 *     report" wins over the building-wide exemption of DU-4(d));
 * (d) building-wide, not a higher tier: attached without a page (listed for review);
 * (b) acknowledged, same known unit, not higher: no new page;
 * (c) otherwise (different or unknown unit, higher tier): reopen (EP-11c).
 */
export function du4Decision(i: Du4Input): Du4Decision {
  if (!i.incidentAcknowledged) return 'continue_chain';
  if (i.newTier === 'life_safety') return 'reopen';
  const higher = tierRank(i.newTier) > tierRank(i.incidentTier);
  if (i.buildingWide && !higher) return 'attach_building_wide';
  const sameUnit = i.newUnitId !== null && i.incidentUnitIds.includes(i.newUnitId);
  if (sameUnit && !higher) return 'no_page';
  return 'reopen';
}
