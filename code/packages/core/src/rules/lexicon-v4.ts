// Rule set v4 (B1 round-3 fix, B1-003): the reviewer's nine fresh misses reach their labelled tier by rule
// ("hydro is out", "went dark", "on fyer", "arcing", "raining inside", "up the drain", "nothing is blowing",
// "elevator stopped", "geysering"), and a sprinkler going off (a context-word regression found while tuning). v1..v3 stay frozen for the decisions stored with them.
import type { Phrase, Rule } from './lexicon-v1';
import { RULES_V3 } from './lexicon-v3';

const s = (...t: string[]): Phrase => ({ mode: 'seq', tokens: t });
const n = (...t: string[]): Phrase => ({ mode: 'near', tokens: t });

const ADD: Record<string, Phrase[]> = {
  'ls.fire': [s('fyer'), s('fyre'), s('arcing'), s('arced'), n('wire*', 'arc')],
  'ls.injury': [n('elevator', 'stopped'), n('elevator', 'stuck'), n('stuck', 'elevator')],
  'ur.flood': [n('raining', 'inside'), n('rain*', 'ceiling'), s('geyser*'), n('water', 'all', 'over'), n('sprinkler*', 'off'), n('sprinkler*', 'went')],
  'ur.sewer': [s('up', 'drain*'), s('up', 'shower', 'drain*'), s('up', 'tub', 'drain*'), s('up', 'floor', 'drain*')],
  'ur.no_heat': [n('nothing', 'blowing'), n('thermostat', 'degrees', 'nothing')],
  'ur.electrical': [n('hydro', 'out'), s('no', 'hydro'), n('hydro', 'off'), n('hydro', 'down'), n('hydro', 'went'), n('went', 'dark'), n('hydro', 'outage')],
};

export const RULES_V4: Rule[] = RULES_V3.map((r) => (ADD[r.id] ? { ...r, phrases: [...r.phrases, ...ADD[r.id]!] } : r));
