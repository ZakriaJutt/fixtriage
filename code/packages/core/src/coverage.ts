// On-call coverage check (EP-1, EP-9; UT-05). Pure.
// Levels 1 and 2 must be covered by shifts at every instant of the window; Level 3 is the account owner
// unless a Level 3 shift names someone else. Across Levels 1-3 there must be at least two different people
// with different phone numbers at every instant.

export interface Shift {
  userId: string;
  phone: string | null;
  level: 1 | 2 | 3;
  startsAt: number;
  endsAt: number;
}

export interface CoverageInput {
  shifts: Shift[];
  owner: { userId: string; phone: string | null };
  from: number;
  to: number;
}

export interface Interval {
  from: number;
  to: number;
}
export interface CoverageResult {
  ok: boolean;
  gaps: Array<Interval & { level: 1 | 2 }>;
  notTwoPeople: Interval[];
}

export const COVERAGE_WINDOW_DAYS = 14; // EP-9

function merge<T extends Interval>(items: T[], same: (a: T, b: T) => boolean): T[] {
  const out: T[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.to === it.from && same(last, it)) last.to = it.to;
    else out.push({ ...it });
  }
  return out;
}

export function checkCoverage(input: CoverageInput): CoverageResult {
  const pts = new Set<number>([input.from, input.to]);
  for (const s of input.shifts) {
    if (s.startsAt > input.from && s.startsAt < input.to) pts.add(s.startsAt);
    if (s.endsAt > input.from && s.endsAt < input.to) pts.add(s.endsAt);
  }
  const bounds = [...pts].sort((a, b) => a - b);
  const gaps: CoverageResult['gaps'] = [];
  const notTwo: Interval[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i]!;
    const b = bounds[i + 1]!;
    const at = (lv: number) => input.shifts.find((s) => s.level === lv && s.startsAt <= a && s.endsAt >= b);
    const l1 = at(1);
    const l2 = at(2);
    const l3 = at(3) ?? { userId: input.owner.userId, phone: input.owner.phone };
    if (!l1) gaps.push({ level: 1, from: a, to: b });
    if (!l2) gaps.push({ level: 2, from: a, to: b });
    const people = [l1, l2, l3].filter((p): p is NonNullable<typeof p> => !!p);
    const ids = new Set(people.map((p) => p.userId));
    const phones = new Set(people.map((p) => p.phone).filter((p): p is string => !!p));
    if (ids.size < 2 || phones.size < 2) notTwo.push({ from: a, to: b });
  }
  const g1 = merge(gaps.filter((g) => g.level === 1), () => true);
  const g2 = merge(gaps.filter((g) => g.level === 2), () => true);
  const n2 = merge(notTwo, () => true);
  const all = [...g1, ...g2].sort((x, y) => x.from - y.from || x.level - y.level);
  return { ok: all.length === 0 && n2.length === 0, gaps: all, notTwoPeople: n2 };
}
