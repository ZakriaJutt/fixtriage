// Rule set v1 (MH-03, UR-1, UR-2, UR-7). English only: no pilot buyer has named another language yet
// (PRD 7.1 "plus the languages pilot buyers name"); text outside the lexicon's language ends `uncertain` (UR-3).
// A phrase is a list of tokens. `seq` = tokens in order with at most one filler token between them;
// `near` = all tokens anywhere within 8 tokens of the first. A token ending in `*` is a prefix.
// Non-prefix tokens of 6+ letters also match at edit distance 1 with the same first letter (misspellings); shorter known misspellings are listed.
import type { Tier } from '../tiers';

export type HazardClass =
  | 'fire'
  | 'gas'
  | 'carbon_monoxide'
  | 'water_electrical'
  | 'injury'
  | 'flood'
  | 'sewer'
  | 'no_water'
  | 'no_heat'
  | 'lock'
  | 'electrical'
  | 'lockout'
  | 'tenant_urgent'
  | 'unknown';

export interface Phrase {
  mode: 'seq' | 'near';
  tokens: string[];
}

export interface Rule {
  id: string;
  tier: Extract<Tier, 'life_safety' | 'urgent'>;
  hazardClass: Exclude<HazardClass, 'unknown'>;
  /** UR-7: only applies when the message was received after hours. */
  afterHoursOnly?: boolean;
  phrases: Phrase[];
}

const s = (...t: string[]): Phrase => ({ mode: 'seq', tokens: t });
const n = (...t: string[]): Phrase => ({ mode: 'near', tokens: t });

export const RULES_V1: Rule[] = [
  // UR-1 life_safety
  {
    id: 'ls.fire',
    tier: 'life_safety',
    hazardClass: 'fire',
    phrases: [s('fire'), s('fires'), s('flame'), s('flames'), s('flaming'), s('burning'), s('smoke'), s('smoking'), s('smokey'), s('smoky'), s('spark'), s('sparks'), s('sparking'), s('sparked'), s('smok'), s('burnt', 'smell'), s('smell', 'burnt'), s('melting', 'wire*'), s('wire*', 'melting')],
  },
  {
    id: 'ls.gas',
    tier: 'life_safety',
    hazardClass: 'gas',
    phrases: [n('gas', 'smell*'), n('gas', 'smel'), n('gas', 'leak*'), n('gas', 'odou*'), n('gas', 'odor*'), n('gas', 'stink*'), n('gas', 'hiss*'), n('gaz', 'smell*'), n('gaz', 'smel'), s('rotten', 'egg*'), s('sulfur'), s('sulphur'), s('propane'), s('natural', 'gas')],
  },
  {
    id: 'ls.co',
    tier: 'life_safety',
    hazardClass: 'carbon_monoxide',
    phrases: [s('carbon', 'monoxide'), s('monoxide'), s('co', 'alarm*'), s('co', 'detector*'), s('co', 'detecter*')],
  },
  {
    id: 'ls.water_electrical',
    tier: 'life_safety',
    hazardClass: 'water_electrical',
    phrases: [
      n('water', 'outlet*'), n('water', 'socket*'), n('water', 'electrical'), n('water', 'panel'), n('water', 'breaker*'), n('water', 'wiring'), n('water', 'wires'),
      n('water', 'light', 'fixture*'), n('water', 'plug*'), n('leak*', 'outlet*'), n('leak*', 'light', 'fixture*'), n('drip*', 'light', 'fixture*'), n('drip*', 'outlet*'),
    ],
  },
  {
    id: 'ls.injury',
    tier: 'life_safety',
    hazardClass: 'injury',
    phrases: [s('injured'), s('injury'), s('hurt'), s('bleeding'), s('unconscious'), s('trapped'), s('stuck', 'in', 'elevator'), s('stuck', 'in', 'the', 'elevator'), s('ambulance'), s('electrocuted'), s('shocked'), s('fell', 'through')],
  },
  // UR-2 urgent
  {
    id: 'ur.flood',
    tier: 'urgent',
    hazardClass: 'flood',
    phrases: [
      s('flood*'), s('flooding'), s('flooded'), s('burst'), s('bursting'), s('pipe', 'broke'), s('broken', 'pipe'), s('water', 'through', 'ceiling'), s('water', 'through', 'the', 'ceiling'), s('water', 'coming', 'through'),
      s('water', 'everywhere'), s('water', 'pouring'), s('pouring', 'water'), s('gushing'), s('major', 'leak'), s('big', 'leak'), s('huge', 'leak'),
      n('leak*', 'ceiling'), n('leak*', 'roof'), n('leak*', 'pipe*'), n('water', 'ceiling'), n('water', 'spraying'), n('water', 'leaking', 'downstairs'), s('water', 'damage'),
      s('ceiling', 'collapsed'), s('ceiling', 'caving'),
    ],
  },
  {
    id: 'ur.sewer',
    tier: 'urgent',
    hazardClass: 'sewer',
    phrases: [
      s('sewage'), s('sewer'), n('backed', 'up', 'toilet'), n('backed', 'up', 'drain*'), n('backing', 'up'), n('backup', 'toilet'), n('backup', 'drain*'),
      n('toilet', 'overflow*'), n('toilet', 'clogged'), n('toilet', 'blocked'), n('toilet', 'not', 'working'), n('toilet', 'wont', 'flush'), n('toilet', 'broken'), n('toilet', 'unusable'),
      n('drain*', 'blocked'), n('poop'), n('feces'),
    ],
  },
  {
    id: 'ur.no_water',
    tier: 'urgent',
    hazardClass: 'no_water',
    phrases: [s('no', 'water'), s('water', 'is', 'off'), s('water', 'shut', 'off'), s('water', 'not', 'working'), s('no', 'running', 'water'), s('taps', 'dry')],
  },
  {
    id: 'ur.no_heat',
    tier: 'urgent',
    hazardClass: 'no_heat',
    phrases: [
      s('no', 'heat'), s('no', 'heet'), s('no', 'heating'), s('no', 'heater'), n('heat', 'not', 'working'), n('heat', 'stopped'), n('heat', 'broken'), n('heat', 'off'), n('heat', 'out'),
      n('heating', 'not', 'working'), n('heating', 'broken'), n('heating', 'stopped'), n('heater', 'broken'), n('heater', 'not', 'working'), n('heater', 'stopped'), n('heaters', 'not'),
      n('furnace', 'out'), n('furnace', 'broken'), n('furnace', 'not'), n('furnace', 'died'), n('furnace', 'off'), n('furnace', 'stopped'), n('furnace', 'dead'),
      n('boiler', 'out'), n('boiler', 'broken'), n('boiler', 'not'), n('boiler', 'died'), n('boiler', 'off'), n('radiator*', 'cold'), n('radiator*', 'not'),
      s('freezing', 'inside'), s('freezing', 'in', 'here'), s('so', 'cold', 'inside'), n('baseboard*', 'not'),
    ],
  },
  {
    id: 'ur.lock',
    tier: 'urgent',
    hazardClass: 'lock',
    phrases: [
      n('lock', 'broken'), n('lock', 'broke'), n('lock', 'damaged'), n('lock', 'jammed'), n('lock', 'wont'), n('lock', 'doesnt'), n('lock', 'not', 'working'), n('lock', 'not', 'work*'), n('cant', 'lock'), n('wont', 'lock'), n('doesnt', 'lock'),
      n('door', 'kicked'), s('break', 'in'), s('broke', 'in'), s('broken', 'into'), s('break', 'in*'), n('door', 'wont', 'close'), n('deadbolt', 'broken'),
    ],
  },
  {
    id: 'ur.electrical',
    tier: 'urgent',
    hazardClass: 'electrical',
    phrases: [s('no', 'power'), s('power', 'out'), s('power', 'is', 'out'), s('power', 'outage'), s('no', 'electricity'), s('electricity', 'out'), n('electrical', 'failure'), n('electrical', 'out'), n('breaker', 'keeps'), n('lights', 'out', 'whole'), s('power', 'went', 'out')],
  },
  {
    id: 'ur.lockout_after_hours',
    tier: 'urgent',
    hazardClass: 'lockout',
    afterHoursOnly: true,
    phrases: [s('locked', 'out'), s('lock', 'out'), s('lockout'), n('lost', 'key*'), n('cant', 'get', 'in'), n('keys', 'inside'), n('key', 'inside'), n('key', 'broke'), n('key', 'snapped'), s('locked', 'myself', 'out')],
  },
  {
    id: 'ur.tenant_urgent',
    tier: 'urgent',
    hazardClass: 'tenant_urgent',
    phrases: [s('urgent'), s('emergency')],
  },
];

/**
 * English vocabulary used only to decide that a text is in the lexicon's language at all.
 * A Latin-script message in which fewer than a third of the tokens are known is treated as
 * "language outside the lexicon" and ends `uncertain` (UR-3). Unknown words raise, never lower.
 */
export const ENGLISH_VOCAB: string[] = (
  'a about above after again all also am an and any are around as at away back bad be because been before behind being below bit both broke broken but by ' +
  'call called came can cant come coming could did didnt do does doesnt doing done dont down each even ever every few for from get gets getting go goes going gone ' +
  'got had has have having he help her here hes him his how i if im in into is isnt it its ive just keep keeps know last later like little look looks lot made make ' +
  'many may me more morning most much my need needs never new next night no not now of off ok okay on once one only or other our out over please pls plz really right ' +
  'said same see seems she should since so some someone something soon still stopped sure than thank thanks that thats the their them then there these they thing ' +
  'think this those through thru time to today tomorrow tonight too two under until up us very want was wasnt water way we week well went were what when where which ' +
  'while who why will with wont would yes yesterday you your hi hello hey sorry again since started start starting always almost bathroom kitchen bedroom living room ' +
  'unit apartment apt suite building floor ceiling wall walls door doors window windows sink tap taps faucet faucets drip dripping drips leak leaking leaks shower tub bath ' +
  'toilet drain drains pipe pipes heat heater heating furnace boiler radiator hot cold warm air fan vent dryer washer dishwasher fridge freezer stove oven range microwave ' +
  'light lights bulb switch outlet power electrical lock locked key keys mailbox garage parking stairs elevator hallway balcony deck roof mold mould smell smells noise ' +
  'noisy loud bugs mice pest pests ants cockroach blind blinds screen cabinet cabinets counter tile tiles carpet paint crack cracked hole loose stuck working work works ' +
  'fix fixed repair repaired replace replaced check checked send someone tenant landlord manager neighbour neighbor upstairs downstairs next door small big little ' +
  'slow slowly fast quick quickly bit lot noticed notice happening happened again problem issue issues thing things also another nothing anything everything'
).split(/\s+/);
