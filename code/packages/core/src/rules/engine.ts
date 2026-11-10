// Deterministic rule engine (MH-03, UR-1..UR-3, UR-7). Pure: no I/O, no clock.
import { maxTier, tierRank, type Tier } from '../tiers';
import { ENGLISH_VOCAB, RULES_V1, type HazardClass, type Phrase, type Rule } from './lexicon-v1';

export const RULE_SET_VERSION = 1;

export interface RuleInput {
  text: string | null;
  hasMedia: boolean;
  afterHours: boolean;
}

export interface RuleResult {
  ruleSetVersion: number;
  /** Highest tier from a matched rule, or null when nothing matched. */
  ruleTier: Extract<Tier, 'life_safety' | 'urgent'> | null;
  /** `uncertain` when the text is not usable (UR-3), else null. */
  uncertaintyFloor: 'uncertain' | null;
  uncertaintyReason: 'no_text' | 'photo_only' | 'language_outside_lexicon' | null;
  matchedRules: string[];
  /** Matched rule of the highest tier (first in rule order). */
  primaryRule: string | null;
  hazardClass: HazardClass;
}

const SUBSTITUTIONS: Record<string, string> = { thru: 'through', smth: 'something', u: 'you', ur: 'your', r: 'are', cuz: 'because', bc: 'because', '2nite': 'tonight', w: 'with' };

export function normalise(text: string): string[] {
  const lowered = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '');
  return lowered
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .map((t) => SUBSTITUTIONS[t] ?? t);
}

/** Damerau-Levenshtein (optimal string alignment) distance, early exit above `max`. */
export function editDistance(a: string, b: string, max = 1): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

const FUZZY_MIN = 6;

export function tokenMatches(pattern: string, token: string): boolean {
  if (pattern.endsWith('*')) return token.startsWith(pattern.slice(0, -1));
  if (pattern === token) return true;
  if (pattern.length >= FUZZY_MIN && token.length >= FUZZY_MIN - 1 && pattern[0] === token[0]) return editDistance(pattern, token, 1) <= 1;
  return false;
}

function phraseMatches(p: Phrase, tokens: string[]): boolean {
  const first = p.tokens[0]!;
  if (p.mode === 'seq') {
    for (let i = 0; i < tokens.length; i++) {
      if (!tokenMatches(first, tokens[i]!)) continue;
      let pos = i;
      let ok = true;
      for (let k = 1; k < p.tokens.length; k++) {
        const pat = p.tokens[k]!;
        if (pos + 1 < tokens.length && tokenMatches(pat, tokens[pos + 1]!)) pos += 1;
        else if (pos + 2 < tokens.length && tokenMatches(pat, tokens[pos + 2]!)) pos += 2;
        else {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }
  const WINDOW = 8;
  for (let i = 0; i < tokens.length; i++) {
    if (!tokenMatches(first, tokens[i]!)) continue;
    const lo = Math.max(0, i - WINDOW);
    const hi = Math.min(tokens.length, i + WINDOW + 1);
    const win = tokens.slice(lo, hi);
    if (p.tokens.slice(1).every((pat) => win.some((t) => tokenMatches(pat, t)))) return true;
  }
  return false;
}

const VOCAB = new Set<string>(ENGLISH_VOCAB);
for (const r of RULES_V1) for (const p of r.phrases) for (const t of p.tokens) if (!t.endsWith('*')) VOCAB.add(t);

function isLexiconLanguage(text: string, tokens: string[]): boolean {
  // Any letter outside the Latin script means the text is outside the lexicon's language.
  if (/[\p{L}]/u.test(text) && /[^\p{Script=Latin}\P{L}]/u.test(text)) return false;
  const words = tokens.filter((t) => /\p{L}/u.test(t));
  if (words.length === 0) return false;
  const known = words.filter((t) => VOCAB.has(t) || [...VOCAB].some((v) => v.length >= FUZZY_MIN && tokenMatches(v, t))).length;
  return known / words.length >= 1 / 3;
}

export function evaluateRules(input: RuleInput, rules: Rule[] = RULES_V1): RuleResult {
  const text = (input.text ?? '').trim();
  const tokens = normalise(text);
  const matched: Rule[] = [];
  for (const r of rules) {
    if (r.afterHoursOnly && !input.afterHours) continue;
    if (r.phrases.some((p) => phraseMatches(p, tokens))) matched.push(r);
  }
  let uncertaintyReason: RuleResult['uncertaintyReason'] = null;
  if (tokens.length === 0) uncertaintyReason = input.hasMedia ? 'photo_only' : 'no_text';
  else if (matched.length === 0 && !isLexiconLanguage(text, tokens)) uncertaintyReason = 'language_outside_lexicon';

  let primary: Rule | null = null;
  for (const r of matched) if (primary === null || tierRank(r.tier) > tierRank(primary.tier)) primary = r;

  return {
    ruleSetVersion: RULE_SET_VERSION,
    ruleTier: primary ? primary.tier : null,
    uncertaintyFloor: uncertaintyReason ? 'uncertain' : null,
    uncertaintyReason,
    matchedRules: matched.map((r) => r.id),
    primaryRule: primary?.id ?? null,
    hazardClass: primary?.hazardClass ?? 'unknown',
  };
}

/** Tier from rules and uncertainty alone (no model): used for the safety spine and UT-01. */
export function ruleFloor(r: RuleResult): Tier | null {
  if (r.ruleTier === null && r.uncertaintyFloor === null) return null;
  return maxTier(r.ruleTier, r.uncertaintyFloor);
}
