// The single tier ordering (AGENTS.md 6). UR-5: life_safety > urgent > uncertain > routine.

export const TIERS = ['life_safety', 'urgent', 'uncertain', 'routine'] as const;
export type Tier = (typeof TIERS)[number];

const RANK: Record<Tier, number> = { routine: 0, uncertain: 1, urgent: 2, life_safety: 3 };

export function tierRank(t: Tier): number {
  return RANK[t];
}

export function isTier(v: unknown): v is Tier {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v);
}

/** Highest of the given tiers; nulls are ignored. With nothing given the default is `uncertain` (UR-3), never `routine`. */
export function maxTier(...tiers: Array<Tier | null | undefined>): Tier {
  let best: Tier | null = null;
  for (const t of tiers) {
    if (t == null) continue;
    if (best === null || RANK[t] > RANK[best]) best = t;
  }
  return best ?? 'uncertain';
}

export function isLower(candidate: Tier, current: Tier): boolean {
  return RANK[candidate] < RANK[current];
}

/** Tiers that start an escalation at once, whatever the clock (EP-3). */
export function pagesImmediately(t: Tier): boolean {
  return t === 'life_safety' || t === 'urgent';
}
