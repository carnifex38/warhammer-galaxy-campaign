// What the short column names on a stat line mean, for the little window that opens when one is tapped. The rules data only has the
// short names, so these plain-language reminders are written here. They are a memory jog at the table, not the rulebook.

export interface StatInfo { name: string; text: string }

// the same short name can mean something a little different in each game, so a table's own entry (by its type) wins over the general one
const BY_TABLE: Record<string, StatInfo> = {
  // Horus Heresy
  'Ranged Weapon:AP': { name: 'Armour Penetration', text: 'How well the weapon gets through armour. A lower number is better: a target whose armour save is no better than the AP value cannot use it.' },
  'Melee Weapon:AP': { name: 'Armour Penetration', text: 'How well the weapon gets through armour. A lower number is better: a target whose armour save is no better than the AP value cannot use it.' },
  // 40,000
  'Ranged Weapons:AP': { name: 'Armour Penetration', text: 'How well the weapon cuts through armour. Each point makes the target’s armour save that much worse (AP -1 turns a 3+ save into a 4+).' },
  'Melee Weapons:AP': { name: 'Armour Penetration', text: 'How well the weapon cuts through armour. Each point makes the target’s armour save that much worse (AP -1 turns a 3+ save into a 4+).' },
  'Ranged Weapons:BS': { name: 'Ballistic Skill', text: 'The roll needed to hit when shooting with this weapon (3+ means a 3 or more on a six-sided die). Lower is better.' },
  'Melee Weapons:WS': { name: 'Weapon Skill', text: 'The roll needed to hit in close combat with this weapon (3+ means a 3 or more on a six-sided die). Lower is better.' },
  'Ranged Weapons:A': { name: 'Attacks', text: 'How many dice are rolled to hit each time the weapon is used (a number, or a die such as D6).' },
  'Melee Weapons:A': { name: 'Attacks', text: 'How many dice are rolled to hit each time the weapon is used in close combat (a number, or a die such as D6).' },
  'Ranged Weapons:S': { name: 'Strength', text: 'How hard the weapon hits. It is compared with the target’s Toughness to decide the roll needed to wound.' },
  'Melee Weapons:S': { name: 'Strength', text: 'How hard the weapon hits. It is compared with the target’s Toughness to decide the roll needed to wound.' },
  'Ranged Weapons:D': { name: 'Damage', text: 'How many wounds each hit that is not saved takes off the target.' },
  'Melee Weapons:D': { name: 'Damage', text: 'How many wounds each hit that is not saved takes off the target.' },
  'Ranged Weapons:Range': { name: 'Range', text: 'How far the weapon shoots, in inches.' },
  'Melee Weapons:Range': { name: 'Range', text: 'Melee: the weapon can only be used against enemies in close combat.' },
}

const GENERAL: Record<string, StatInfo> = {
  // a model or unit's own stats
  M: { name: 'Movement', text: 'How far the model can move, in inches.' },
  WS: { name: 'Weapon Skill', text: 'How good the model is in close combat. Higher (or, in 40,000, a lower roll) means it hits more often.' },
  BS: { name: 'Ballistic Skill', text: 'How good the model is at shooting. It decides how often its shots hit.' },
  S: { name: 'Strength', text: 'How hard the model hits. It is compared with the target’s Toughness to decide what is needed to wound.' },
  T: { name: 'Toughness', text: 'How hard the model is to wound. Higher is tougher.' },
  W: { name: 'Wounds', text: 'How many wounds the model can take before it is removed.' },
  I: { name: 'Initiative', text: 'How fast the model acts in close combat: the higher Initiative strikes first.' },
  A: { name: 'Attacks', text: 'How many attacks the model makes in close combat.' },
  LD: { name: 'Leadership', text: 'How well the model holds its nerve. Used for morale and leadership tests.' },
  CL: { name: 'Cool', text: 'Keeping calm under fire: used to resist pinning, fear and panic.' },
  WP: { name: 'Willpower', text: 'Mental strength: used to resist psychic and other mind-affecting effects.' },
  IN: { name: 'Intelligence', text: 'Knowledge and technical skill: used for tests involving machines, tactics and the like.' },
  SAV: { name: 'Armour Save', text: 'The roll needed to shrug off a wound. Lower is better (3+ is better than 5+). Weapons with a good AP can take it away.' },
  INV: { name: 'Invulnerable Save', text: 'A save that armour-piercing weapons cannot take away.' },
  Sv: { name: 'Armour Save', text: 'The roll needed to shrug off damage (3+ means a 3 or more on a six-sided die). Lower is better. Weapons with AP make it worse.' },
  InSv: { name: 'Invulnerable Save', text: 'A save that Armour Penetration does not make worse.' },
  OC: { name: 'Objective Control', text: 'How much the model counts towards holding an objective. Add up both sides: the higher total controls it.' },
  Base: { name: 'Base size', text: 'The size of the model’s base, in millimetres.' },
  // vehicles
  'Front Armour': { name: 'Front Armour', text: 'The vehicle’s armour value on its front. Attacks have to beat it to do damage.' },
  'Side Armour': { name: 'Side Armour', text: 'The vehicle’s armour value on its sides. Attacks have to beat it to do damage.' },
  'Rear Armour': { name: 'Rear Armour', text: 'The vehicle’s armour value on its back. Attacks have to beat it to do damage.' },
  HP: { name: 'Hull Points', text: 'How much damage the vehicle can take before it is destroyed.' },
  // weapons (Horus Heresy)
  R: { name: 'Range', text: 'How far the weapon shoots, in inches.' },
  FP: { name: 'Firepower', text: 'How many shots the weapon makes each time it fires.' },
  RS: { name: 'Ranged Strength', text: 'The Strength of the weapon’s hits, compared with the target’s Toughness to wound.' },
  AP: { name: 'Armour Penetration', text: 'How well the weapon gets through armour.' },
  D: { name: 'Damage', text: 'How many wounds each hit that is not saved takes off the target.' },
  IM: { name: 'Initiative Modifier', text: 'Changes the wielder’s Initiative while using this weapon. “I” means no change; a number is added or taken away.' },
  AM: { name: 'Attacks Modifier', text: 'Changes the wielder’s Attacks while using this weapon. “A” means no change; +1 gives one more attack.' },
  SM: { name: 'Strength Modifier', text: 'Changes the wielder’s Strength while using this weapon. “S” means no change; +1 adds one, ×2 doubles it.' },
  Range: { name: 'Range', text: 'How far the weapon shoots, in inches.' },
}

/** What a column of a stat line means: its full name and what it does. Nothing for a column that is not known. */
export function statInfo(table: string, column: string): StatInfo | null {
  return BY_TABLE[`${table}:${column}`] ?? GENERAL[column] ?? null
}
