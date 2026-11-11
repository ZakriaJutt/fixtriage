// Rule set v2 (B1 fix round 1, finding B1-003): v1 plus negated-function phrasings ("heat doesnt work"),
// short-word misspellings handled by the v2 normaliser, falls, an unsecurable unit and spreading leaks.
// v1 stays frozen in lexicon-v1.ts so that its stored checksum still matches (MH-03: decisions keep their version).
import { RULES_V1, type Phrase, type Rule } from './lexicon-v1';

const s = (...t: string[]): Phrase => ({ mode: 'seq', tokens: t });
const n = (...t: string[]): Phrase => ({ mode: 'near', tokens: t });

const NEGATED = ['doesnt', 'dont', 'isnt', 'wont', 'didnt', 'aint', 'cant', 'stopped', 'broke', 'broken', 'dead', 'died', 'off', 'out', 'failed', 'failing'];
const negatedOf = (...things: string[]): Phrase[] => things.flatMap((x) => [...NEGATED.map((w) => n(x, w)), n(x, 'not', 'work*'), n(x, 'no', 'work*')]);

const ADD: Record<string, Phrase[]> = {
  'ls.gas': [s('gas', 'leak'), n('gas', 'smell*'), s('smell', 'gas'), s('smells', 'gas'), s('smells', 'like', 'gas'), s('gas', 'odour'), s('gas', 'odor')],
  'ls.injury': [n('fell', 'cant', 'get', 'up'), n('fallen', 'cant'), n('cant', 'get', 'up'), s('fell', 'down'), s('has', 'fallen'), s('not', 'breathing'), s('cant', 'breathe'), s('passed', 'out'), s('heart', 'attack'), s('stroke')],
  'ur.no_heat': negatedOf('heat', 'heating', 'heater', 'heaters', 'furnace', 'boiler', 'radiator', 'radiators', 'baseboard', 'baseboards', 'thermostat'),
  'ur.flood': [n('water', 'everywhere'), n('leak*', 'everywhere'), n('water', 'heater', 'leak*'), n('water', 'tank', 'leak*'), n('hot', 'water', 'tank', 'burst'), n('water', 'heater', 'burst'), n('leak*', 'badly'), n('water', 'coming', 'in')],
  'ur.lock': [n('cant', 'secure'), n('not', 'secure'), n('unsecure*'), n('window', 'smashed'), n('window', 'broken'), n('window', 'broke'), n('broken', 'window'), n('smashed', 'window'), n('glass', 'smashed'), n('door', 'wont', 'lock'), n('door', 'cant', 'lock'), n('lock', 'doesnt', 'work*')],
  'ur.electrical': negatedOf('power', 'electricity'),
  'ur.no_water': [n('no', 'water'), n('water', 'not', 'coming'), n('water', 'doesnt', 'work*'), n('taps', 'not', 'work*')],
};

export const RULES_V2: Rule[] = RULES_V1.map((r) => (ADD[r.id] ? { ...r, phrases: [...r.phrases, ...ADD[r.id]!] } : r));
