// Safety-candidate layer (B1 fix round 2, ruling on B1-003): phrase lists will always miss variants, so word stems
// with edit-distance tolerance mark a message as a possible emergency. A candidate is not a tier: after hours it
// sets an `uncertain` floor, so a model "routine" alone can never close it and it is paged (EP-8). Pure.
import { editDistance } from './engine';

/** Stems (lower-case, after normalisation). A token matches by prefix, or within edit distance 1 (2 for 7+ letters) with the same first letter. */
export const SAFETY_STEMS: string[] = [
  'burst', 'bust', 'leak', 'flood', 'overflow', 'gush', 'pour', 'spray', 'drip', 'sewage', 'sewer', 'backup', 'watermain',
  'heat', 'furnace', 'boiler', 'radiator', 'freez', 'cold',
  'gas', 'propane', 'smell', 'fume', 'smoke', 'fire', 'flame', 'burn', 'spark', 'electr', 'shock', 'outlet', 'wire', 'breaker', 'power',
  'monoxide', 'carbon', 'alarm', 'detector',
  'injur', 'hurt', 'bleed', 'blood', 'fell', 'fall', 'trapped', 'stuck', 'unconscious', 'breath',
  'lock', 'locked', 'key', 'break', 'broke', 'smash', 'secure', 'intruder',
  'urgent', 'emergency', 'help', 'danger', 'collapse',
  'rotten', 'sulf', 'sulph', 'melt', 'ambulance', 'elevator', 'toilet', 'clog', 'flush', 'poop', 'feces', 'cave', 'caving', 'damage', 'basement',
  'water', 'ceiling', 'fixture', 'plug', 'pool', 'wall', 'pipe', 'off', 'kick', 'outage', 'blackout', 'backed', 'everywhere', 'not', 'dry', 'intrud', 'egg', 'beep', 'chirp', 'scream', 'went', 'open', 'door', 'window', 'inside', 'out',
];
/** Two-word cues whose words are too common to stand alone. */
export const SAFETY_PAIRS: Array<[string, string]> = [['water', 'main'], ['pipe', 'broke'], ['no', 'water'], ['no', 'heat'], ['no', 'power'], ['cant', 'get'], ['co', 'alarm'], ['co', 'detect'], ['co', 'beep'], ['passed', 'out'], ['broke', 'into'], ['taps', 'dry']];

/** Place names and words that begin like a stem but are not one (Burnaby, Gastown, Heather). */
const EXCLUDE = new Set(['burnaby', 'gastown', 'heather', 'heathrow', 'fireweed', 'sparkling']);

const STOP = new Set(['fall', 'cold', 'help', 'key', 'break', 'broke', 'stuck', 'power', 'drip', 'pour', 'smell', 'alarm', 'wire', 'outlet', 'lock', 'locked', 'detector', 'breaker',
  'water', 'ceiling', 'fixture', 'plug', 'pool', 'wall', 'pipe', 'off', 'kick', 'outage', 'blackout', 'backed', 'everywhere', 'not', 'dry', 'intrud', 'egg', 'beep', 'chirp', 'scream', 'went', 'open', 'door', 'window', 'inside', 'out', 'toilet', 'basement', 'damage', 'flush', 'elevator']);

/** Short weak cues that must match a whole word (so that "dry" does not match "dryer"). */
const EXACT = new Set(['dry', 'not', 'off', 'out', 'open', 'went', 'egg', 'tap', 'key', 'fall', 'wall', 'pool', 'plug', 'door']);

export interface CandidateConfig {
  stems: string[];
  pairs: Array<[string, string]>;
  /** Weak stems: count only next to another cue. */
  weak: string[];
  /** Short weak cues that must match a whole word. */
  exact: string[];
  exclude: string[];
  /** v4: context words (door, off, out...) that make a candidate only with a non-context weak cue. */
  context?: string[];
  /** v4: words of a mild or administrative message (stiff, loose, book, a weekday) that cancel a weak+context pair. */
  quiet?: string[];
  /** v4: benign idioms that drop one token's cue (a bulb "burnt out", a handle "fell off", heat "too warm"). */
  benignIdioms?: boolean;
}

/** Rule set v3 (frozen: its definition and checksum are stored). */
export const SAFETY_CANDIDATE_V3: CandidateConfig = { stems: SAFETY_STEMS, pairs: SAFETY_PAIRS, weak: [...STOP], exact: [...EXACT], exclude: [...EXCLUDE] };

/**
 * Rule set v4 (round-3 fix, B1-003): the reviewer's nine misses get stems or pairs; obvious false pages are quieted
 * by context and quiet words and three benign idioms. No v3 stem is removed or weakened.
 */
export const SAFETY_CANDIDATE_V4: CandidateConfig = {
  stems: [...SAFETY_STEMS, 'fyer', 'arcing', 'arced', 'geyser', 'sprinkler', 'rain', 'drain', 'hydro', 'dark', 'thermostat'],
  pairs: [
    ...SAFETY_PAIRS,
    ['rain', 'inside'], ['up', 'drain'], ['nothing', 'blow'], ['went', 'dark'], ['hydro', 'out'], ['no', 'hydro'], ['hydro', 'off'], ['hydro', 'down'], ['hydro', 'went'],
    ['elevator', 'stop'], ['elevator', 'stuck'],
  ],
  weak: [...STOP, 'rain', 'drain', 'hydro', 'dark', 'thermostat'],
  exact: [...EXACT, 'dark'],
  exclude: [...EXCLUDE],
  context: ['off', 'out', 'not', 'door', 'window', 'wall', 'went', 'open', 'inside'],
  quiet: ['stiff', 'loose', 'squeaky', 'squeak', 'squeaks', 'sticks', 'sticky', 'draft', 'drafty', 'book', 'booking', 'reserve', 'schedule', 'scheduled',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'tomorrow'],
  benignIdioms: true,
};

export const CURRENT_SAFETY_CANDIDATE = SAFETY_CANDIDATE_V4;

function stemMatches(stem: string, token: string, exact: Set<string> = EXACT): boolean {
  if (exact.has(stem)) return token === stem || token === `${stem}s`;
  if (token.startsWith(stem)) return true;
  if (stem.length < 5 || token[0] !== stem[0]) return false; // 4-letter stems (fire, heat, leak) rely on prefixes and the normaliser's misspelling table
  const head = token.slice(0, stem.length + 1);
  const max = stem.length >= 7 ? 2 : 1;
  return editDistance(stem, head, max) <= max || editDistance(stem, token.slice(0, stem.length), max) <= max;
}

const FIXTURE_NOUNS = new Set(['handle', 'handles', 'knob', 'knobs', 'cover', 'bar', 'shelf', 'blind', 'blinds', 'rod', 'hinge', 'trim', 'tile', 'hook', 'button', 'plate']);
const NEGATION = new Set(['no', 'not', 'nothing', 'cold', 'without', 'freezing']);

/** v4 benign idioms: true when token i carries no cue in this message. Narrow on purpose; each needs its context. */
function benign(tokens: string[], i: number): boolean {
  const t = tokens[i]!;
  const next = tokens[i + 1];
  // "the oven light is burnt out": only with a light or bulb word and nothing else burning-related
  if (/^burn(t|ed)$/.test(t) && next === 'out' && tokens.some((x) => /^(light|lights|bulb|bulbs)$/.test(x))) return true;
  // "a drawer handle fell off": a fixture noun right before, "off" right after
  if ((t === 'fell' || t === 'fall' || t === 'came') && next === 'off' && tokens.slice(Math.max(0, i - 2), i).some((x) => FIXTURE_NOUNS.has(x))) return true;
  // "the heat is a little too warm": excess, not absence (no negation anywhere)
  if (t.startsWith('heat') && tokens.some((x, k) => x === 'too' && tokens.slice(k + 1, k + 3).some((y) => y === 'warm' || y === 'hot')) && !tokens.some((x) => NEGATION.has(x))) return true;
  return false;
}

export interface CandidateResult {
  candidate: boolean;
  cues: string[];
}

/**
 * Weak stems count only next to another cue; strong stems count alone. `tokens` are the engine's normalised tokens.
 * v4: a context word (door, off, out) pairs only with a non-context weak cue, and not in a quiet message. Errs
 * towards marking: a false candidate costs one page, a missed one can cost the HCF.
 */
export function safetyCandidate(tokens: string[], cfg: CandidateConfig = CURRENT_SAFETY_CANDIDATE): CandidateResult {
  const weakSet = new Set(cfg.weak);
  const exact = new Set(cfg.exact);
  const exclude = new Set(cfg.exclude);
  const context = new Set(cfg.context ?? []);
  const strong: string[] = [];
  const weak: string[] = [];
  tokens.forEach((t, i) => {
    if (exclude.has(t)) return;
    if (cfg.benignIdioms && benign(tokens, i)) return;
    for (const stem of cfg.stems) {
      if (!stemMatches(stem, t, exact)) continue;
      (weakSet.has(stem) ? weak : strong).push(stem);
      break;
    }
  });
  for (const [a, b] of cfg.pairs) {
    const i = tokens.findIndex((t) => t === a || (a.length >= 4 && stemMatches(a, t, exact)));
    if (i >= 0 && tokens.slice(i + 1, i + 4).some((t) => stemMatches(b, t, exact))) strong.push(`${a}+${b}`);
  }
  let weakEnough: boolean;
  if (!cfg.context) weakEnough = weak.length >= 2;
  else {
    const core = weak.filter((w) => !context.has(w));
    const ctx = weak.length - core.length;
    const quiet = tokens.some((t) => (cfg.quiet ?? []).includes(t));
    weakEnough = core.length >= 2 || (core.length >= 1 && ctx >= 1 && !quiet);
  }
  const candidate = strong.length > 0 || weakEnough;
  const cues = [...new Set([...strong, ...(candidate ? weak : [])])];
  return { candidate, cues };
}
