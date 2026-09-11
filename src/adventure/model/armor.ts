// Armor, which is not a stat.
//
// Every other stat is static for the length of a level. Armor is SPENT: it
// absorbs damage as a flat reduction, and each time it absorbs anything it
// may wear away by a point. So it lives in game state beside hit points,
// not in the stat block, and it is two pools rather than one number:
//
//   - `fromItems`  -- granted once per acquisition, and the only pool decay
//                     can touch.
//   - `natural`    -- granted by traits, and exempt from decay entirely.
//
// One number could not express a trait that grants armor decay cannot
// touch, and flattening the two would make such a trait behave like any
// other point of armor the moment something hit you.
//
// Armor is REBUILT at the start of each level rather than carried: an item
// carried over counts as a fresh acquisition, which is what makes carrying
// an armour item over a real choice rather than a formality.

import { nextChance, type RngState } from '../core/rng'
import { isOnAcquireEffect, type Modifier } from './modifiers'

export interface Armor {
  /** Granted by items on acquisition. Decays. */
  fromItems: number
  /** Granted by traits. Decay cannot touch it. */
  natural: number
}

export const NO_ARMOR: Armor = { fromItems: 0, natural: 0 }

export function totalArmor(armor: Armor): number {
  return Math.max(0, armor.fromItems) + Math.max(0, armor.natural)
}

/**
 * UNSPECIFIED, and labelled rather than guessed at quietly. The design says
 * a successful absorb has "a chance based on luck" that the armor is not
 * worn down, without giving the curve. This is a placeholder shape with one
 * named constant per term, so replacing it is an edit here and nowhere
 * else. It is NOT a tuned value.
 */
export const ARMOR_DECAY_TUNING = {
  /** Chance the armor survives an absorb at Luck 0. */
  baseSurvivalChance: 0.2,
  /** Added to that chance per point of Luck. */
  survivalChancePerLuck: 0.1,
} as const

export function armorSurvivalChance(luck: number): number {
  const chance = ARMOR_DECAY_TUNING.baseSurvivalChance + ARMOR_DECAY_TUNING.survivalChancePerLuck * luck
  return Math.max(0, Math.min(1, chance))
}

/** Armor rebuilt from everything held, as at the start of a level. */
export function armorFromHoldings(held: readonly Modifier[]): Armor {
  let fromItems = 0
  let natural = 0
  for (const modifier of held) {
    for (const effect of modifier.effects) {
      if (effect.kind === 'armorOnAcquire') fromItems += effect.amount
      else if (effect.kind === 'naturalArmor') natural += effect.amount
    }
  }
  return { fromItems, natural }
}

/** One acquisition's worth of armor, applied the moment a modifier is taken. */
export function applyAcquisition(armor: Armor, modifier: Modifier): Armor {
  const granted = modifier.effects
    .filter(isOnAcquireEffect)
    .reduce((sum, effect) => (effect.kind === 'armorOnAcquire' ? sum + effect.amount : sum), 0)
  return granted === 0 ? armor : { ...armor, fromItems: armor.fromItems + granted }
}

export interface AbsorbResult {
  /** Damage left after armor took its share. Never below zero. */
  damage: number
  /** How much armor actually stopped. Zero when the blow was already harmless. */
  absorbed: number
  armor: Armor
  /** Whether this absorb cost a point of armor. Worth narrating. */
  decayed: boolean
  rng: RngState
}

/**
 * Armor's whole behaviour in one place: reduce, then possibly wear.
 *
 * The decay roll happens ONLY when armor actually stopped something. Armor
 * that was not tested does not wear out, which is the difference between a
 * shield and a candle -- and rolling regardless would make a fight the
 * player dodged entirely cost them the same as one they took on the chin.
 */
export function absorb(
  armor: Armor,
  incomingDamage: number,
  luck: number,
  decayFloor: number,
  rng: RngState,
): AbsorbResult {
  const shield = totalArmor(armor)
  const absorbed = Math.max(0, Math.min(shield, incomingDamage))
  const damage = Math.max(0, incomingDamage - absorbed)

  if (absorbed <= 0) return { damage, absorbed, armor, decayed: false, rng }

  const survived = nextChance(rng, armorSurvivalChance(luck))
  if (survived.value || armor.fromItems <= decayFloor) {
    return { damage, absorbed, armor, decayed: false, rng: survived.rng }
  }

  return {
    damage,
    absorbed,
    armor: { ...armor, fromItems: Math.max(decayFloor, armor.fromItems - 1) },
    decayed: true,
    rng: survived.rng,
  }
}
