// Held-out synthetic set (B1-003 round-3 fix). Written by the developer BEFORE the rule set v4 tuning and not used
// to choose stems, pairs or quieting words; measured once before and once after. Small and written by one person:
// the rates it gives are indicative ("measured on a small synthetic set"), not a measurement of real traffic.
// The reviewer's round-3 lists (REVIEWER_R3_*) were used for tuning and are kept for regression only.
import type { Tier } from '../../src/tiers';

export const HOLDOUT_EMERGENCIES: Array<[string, Extract<Tier, 'life_safety' | 'urgent'>]> = [
  ['theres water pouring out of the light fixture', 'life_safety'],
  ['my carbon monixide detector is going off', 'life_safety'],
  ['the hydro just cut out in the whole building', 'urgent'],
  ['basement suite flooded about an inch of water', 'urgent'],
  ['cant open my front door the key snapped in the lock', 'urgent'],
  ['heater died and its freezing', 'urgent'],
  ['smells like rotten eggs in the kitchen', 'life_safety'],
  ['my dad slipped in the tub and cant get up', 'life_safety'],
  ['black smoke from the furnace room', 'life_safety'],
  ['toilet backing up into the bathtub', 'urgent'],
  ['no hot water or heat since this morning', 'urgent'],
  ['outlet popped and there was a flash', 'life_safety'],
  ['water coming thru the light in the ceiling', 'life_safety'],
  ['someone broke the lobby door glass and its open', 'urgent'],
  ['electric panel is buzzing and hot to touch', 'life_safety'],
  ['my unit has no electricity at all', 'urgent'],
  ['pipes froze nothing from the taps', 'urgent'],
  ['theres a burning plastic smell from the heater', 'life_safety'],
  ['lost my keys cant get into my apartment', 'urgent'],
  ['leaking really bad from the unit above', 'urgent'],
];

export const HOLDOUT_ROUTINE: string[] = [
  'can i get a new mailbox key cut', 'the bathroom door handle is loose', 'my window wont stay open', 'the garage door remote needs a battery',
  'when is the next fire alarm test', 'the hallway light is out again', 'can you check the dryer vent sometime', 'the shower head is a bit loose',
  'i would like to renew my lease', 'the fridge door seal is torn', 'theres a squeaky floorboard in the living room', 'can i install a shelf on the wall',
  'the kitchen faucet is stiff to turn', 'my balcony door sticks a little', 'please fix the broken blind slat', 'the parking gate was left open last night',
  'when will the hot water tank be serviced', 'the bathroom sink drains slowly', 'can we get the carpets cleaned before move out', 'the outside lights are on during the day',
];

/** Reviewer's round-3 attack lists (fixtriage-b1-round3.mts R2 and R3), used for tuning v4. */
export const REVIEWER_R3_EMERGENCIES: Array<[string, Extract<Tier, 'life_safety' | 'urgent'>]> = [
  ['kitchen is on fyer', 'life_safety'], ['i smell somthing burning in the wall', 'life_safety'], ['stove wont turn off and its smoking', 'life_safety'],
  ['there is a strong oder like eggs by the furnace', 'life_safety'], ['CO alrm keeps beeping', 'life_safety'], ['my husband colapsed in the bathroom', 'life_safety'],
  ['baby stuck in the bedroom door wont open', 'life_safety'], ['wires are arcing behind the dryer', 'life_safety'], ['water driping onto the breaker box', 'life_safety'],
  ['ceiling caved in on my bed', 'urgent'], ['its raining inside my living room from upstairs', 'urgent'], ['tolet is overfloing onto the floor', 'urgent'],
  ['brown stuff comming up the shower drain', 'urgent'], ['furnce quit and its minus 10', 'urgent'], ['we have been without heat since supper', 'urgent'],
  ['thermostat says 9 degrees and nothing is blowing', 'urgent'], ['whole apartment went dark', 'urgent'], ['i am loked out my keys are inside', 'urgent'],
  ['someone kicked in my door and it wont close', 'urgent'], ['the taps are dry nothing comes out', 'urgent'], ['hydro is out in my suite only', 'urgent'],
  ['washer hose popped off water all over', 'urgent'], ['sprinkler head went off in the hallway', 'urgent'], ['the deadbolt snapped i cant secure the door', 'urgent'],
  ['radiater is ice cold all night', 'urgent'], ['elevator stopped with me in it', 'life_safety'], ['sink is geysering water', 'urgent'], ['icicles forming inside its so cold in here', 'urgent'],
];

export const REVIEWER_R3_ROUTINE: string[] = [
  'the cabinet door in my kitchen is loose', 'can someone replace the light bulb in the hallway', 'my dishwasher leaves spots on the glasses', 'when is the window cleaning scheduled',
  'the closet door is off its track', 'the tap in the bathroom drips a little', 'could i get a second parking pass', 'the blinds in the bedroom are broken',
  'my fridge is making a humming noise', 'the grass out front needs cutting', 'is it ok to paint my bedroom wall', 'the intercom buzzer is quiet',
  'there is a small crack in the bathroom tile', 'my mailbox key is bent', 'the laundry room dryer ate my quarters', 'the hallway carpet is dirty',
  'please send me a copy of my lease', 'the screen door does not slide well', 'when will the rent receipt be ready', 'a kitchen drawer handle fell off',
  'the towel bar came off the wall', 'can i have a cat', 'the oven light is burnt out', 'the caulking around the tub is peeling',
  'my neighbour plays music late', 'the garbage bins were not picked up', 'the bathroom fan is noisy', 'my window screen has a hole',
  'the stove clock is wrong', 'thanks for fixing the sink', 'the weather stripping on my door is worn out', 'can you turn the water off on tuesday for my plumber',
  'the water pressure in the shower is a bit low', 'the heat is a little too warm can you turn it down', 'my smoke detector needs a new battery it chirps', 'one outlet cover is cracked',
  'the front door lock is a bit stiff', 'there is a cold draft by the window', 'the toilet seat is loose', 'i want to book the elevator for moving out',
];
