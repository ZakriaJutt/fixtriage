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

function stemMatches(stem: string, token: string): boolean {
  if (EXACT.has(stem)) return token === stem || token === `${stem}s`;
  if (token.startsWith(stem)) return true;
  if (stem.length < 5 || token[0] !== stem[0]) return false; // 4-letter stems (fire, heat, leak) rely on prefixes and the normaliser's misspelling table
  const head = token.slice(0, stem.length + 1);
  const max = stem.length >= 7 ? 2 : 1;
  return editDistance(stem, head, max) <= max || editDistance(stem, token.slice(0, stem.length), max) <= max;
}

export interface CandidateResult {
  candidate: boolean;
  cues: string[];
}

/**
 * Weak stems (STOP set) count only next to another cue; strong stems count alone. `tokens` are the engine's
 * normalised tokens. Errs towards marking: a false candidate costs one page, a missed one can cost the HCF.
 */
export function safetyCandidate(tokens: string[]): CandidateResult {
  const strong: string[] = [];
  const weak: string[] = [];
  for (const t of tokens) {
    if (EXCLUDE.has(t)) continue;
    for (const stem of SAFETY_STEMS) {
      if (!stemMatches(stem, t)) continue;
      (STOP.has(stem) ? weak : strong).push(stem);
      break;
    }
  }
  for (const [a, b] of SAFETY_PAIRS) {
    const i = tokens.findIndex((t) => t === a || (a.length >= 4 && stemMatches(a, t)));
    if (i >= 0 && tokens.slice(i + 1, i + 4).some((t) => stemMatches(b, t))) strong.push(`${a}+${b}`);
  }
  const cues = [...new Set([...strong, ...(strong.length || weak.length >= 2 ? weak : [])])];
  return { candidate: strong.length > 0 || weak.length >= 2, cues };
}
