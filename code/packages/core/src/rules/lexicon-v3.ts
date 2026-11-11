// Rule set v3 (B1 fix round 2, finding B1-003 residue): burst/busted/bursted and broken water mains.
// v1 and v2 stay frozen for the decisions stored with them.
import type { Phrase, Rule } from './lexicon-v1';
import { RULES_V2 } from './lexicon-v2';

const s = (...t: string[]): Phrase => ({ mode: 'seq', tokens: t });
const n = (...t: string[]): Phrase => ({ mode: 'near', tokens: t });

const ADD: Record<string, Phrase[]> = {
  'ur.flood': [
    s('burst*'), s('brust*'), s('bursed'), n('pipe*', 'bust*'), n('pipe*', 'broke*'), n('pipe*', 'split*'), n('pipe*', 'crack*'), n('pipe*', 'blew'), n('pipe*', 'exploded'),
    s('water', 'main'), s('watermain*'), n('main', 'broke*'), n('main', 'bust*'), n('main', 'burst*'), n('hose', 'burst*'), n('hose', 'bust*'), n('tank', 'bust*'),
  ],
};

export const RULES_V3: Rule[] = RULES_V2.map((r) => (ADD[r.id] ? { ...r, phrases: [...r.phrases, ...ADD[r.id]!] } : r));
