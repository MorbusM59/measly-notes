// Items and traits: the only things that change a player outside of
// levelling, and therefore the only place the order of operations matters.
//
// One shape covers both. They differ in where they come from (gold buys
// items, experience buys traits) and in nothing the rules care about, so
// they share a type and are told apart by `kind` -- which keeps "keep one
// item and one trait at the end of a level" a filter rather than two
// parallel systems.
//
// EFFECTS ARE DATA, NOT CODE, and that is load-bearing rather than
// fastidious. The tab bar shows a modifier's effect while its cell is in
// the ring's selection spot, and that text has to be LIVE: "Avid Collector:
// +30% damage (3 items)" is true only if the number is computed from the
// same declaration the resolver applies. A hand-written description string
// goes stale the first time the effect depends on anything, and nothing
// tells you it has. So one vocabulary produces both the maths and the
// words, and `tag` is the deliberate escape hatch for the rare effect the
// vocabulary cannot express -- that one carries a written description,
// because nothing else can describe it.
//
// THE ORDER, which is the actual rule "capped at 6 before item gains":
//   1. base stats, clamped to 0..6        <- a game's own progression
//   2. + every statDelta                  <- uncapped; this is the point
//   3. derive                             <- stats.ts's formulas
//   4. * derivedScale, + derivedDelta     <- effects that skip the stats
//   5. normalize                          <- counts whole, chances 0..1

import {
  addStats,
  clampBaseStats,
  deriveStats,
  formatDerived,
  normalizeDerived,
  STAT_LABELS,
  type DerivedKey,
  type DerivedStats,
  type StatBlock,
  type StatKey,
  DERIVED_LABELS,
} from './stats'

export type ModifierKind = 'item' | 'trait'

/** What a modifier's effect can depend on besides the stat block itself. */
export interface HoldingCounts {
  items: number
  traits: number
}

export type ModifierEffect =
  /** Straight stat points. Uncapped by design -- see the module comment. */
  | { kind: 'statDelta'; stat: StatKey; amount: number }
  /** Added to a derived value after scaling. */
  | { kind: 'derivedDelta'; derived: DerivedKey; amount: number }
  /** Multiplied into a derived value before flat deltas. */
  | { kind: 'derivedScale'; derived: DerivedKey; factor: number }
  /**
   * Scales with how much is currently held -- "+10% damage for every
   * acquired item". The one effect shape that proves the vocabulary was
   * worth having: it cannot be a constant, and its description cannot be
   * written down in advance.
   */
  | { kind: 'derivedScalePerHolding'; derived: DerivedKey; factorPer: number; holding: ModifierKind }
  /**
   * Armor granted ONCE, when this modifier is acquired. Not a passive
   * bonus: armor is spent as it absorbs, and carrying an item into the next
   * level counts as a fresh acquisition. See armor.ts.
   */
  | { kind: 'armorOnAcquire'; amount: number }
  /** Armor that decay cannot touch. Added on top of the decaying pool. */
  | { kind: 'naturalArmor'; amount: number }
  /** Decay never takes the decaying pool below this. */
  | { kind: 'armorDecayFloor'; floor: number }
  /** The escape hatch: a named hook a system looks for, with its own prose. */
  | { kind: 'tag'; tag: string; description: string }

export interface Modifier {
  id: string
  kind: ModifierKind
  name: string
  icon: string
  effects: readonly ModifierEffect[]
  /** Relative likelihood in an offer roll; higher is likelier, 0 is unreachable. */
  weight?: number
}

/**
 * Whether an effect fires once on acquisition rather than being re-applied
 * whenever the profile is resolved. Passive and on-acquire effects live in
 * the same list because a modifier is one thing to a player; they are told
 * apart HERE so that neither is ever applied the wrong number of times.
 */
export function isOnAcquireEffect(effect: ModifierEffect): boolean {
  return effect.kind === 'armorOnAcquire'
}

export interface EffectiveProfile {
  /** Base + modifiers, uncapped. What a stat check rolls against. */
  stats: StatBlock
  /** Everything those stats imply, after modifiers have had their say. */
  derived: DerivedStats
  /** Armor that decay cannot reduce. */
  naturalArmor: number
  /** The lowest the decaying armor pool can be driven by decay. */
  armorDecayFloor: number
  /** Named hooks currently held, for effects the numbers cannot express. */
  tags: readonly string[]
}

/**
 * The player, resolved: base stats plus everything currently held. The one
 * function every other module asks for numbers, so no caller ever has to
 * remember the order in the module comment.
 */
export function resolveProfile(
  baseStats: StatBlock,
  modifiers: readonly Modifier[],
  holdings: HoldingCounts,
): EffectiveProfile {
  let stats = clampBaseStats(baseStats)
  for (const modifier of modifiers) {
    for (const effect of modifier.effects) {
      if (effect.kind === 'statDelta') stats = addStats(stats, { [effect.stat]: effect.amount })
    }
  }

  const derived = { ...deriveStats(stats) }
  let naturalArmor = 0
  let armorDecayFloor = 0
  const tags: string[] = []

  for (const modifier of modifiers) {
    for (const effect of modifier.effects) {
      if (effect.kind === 'derivedScale') derived[effect.derived] *= effect.factor
      else if (effect.kind === 'derivedScalePerHolding') {
        derived[effect.derived] *= 1 + effect.factorPer * holdings[effect.holding === 'item' ? 'items' : 'traits']
      }
    }
  }
  for (const modifier of modifiers) {
    for (const effect of modifier.effects) {
      if (effect.kind === 'derivedDelta') derived[effect.derived] += effect.amount
      else if (effect.kind === 'naturalArmor') naturalArmor += effect.amount
      else if (effect.kind === 'armorDecayFloor') armorDecayFloor = Math.max(armorDecayFloor, effect.floor)
      else if (effect.kind === 'tag') tags.push(effect.tag)
    }
  }

  return { stats, derived: normalizeDerived(derived), naturalArmor, armorDecayFloor, tags }
}

export function hasTag(profile: EffectiveProfile, tag: string): boolean {
  return profile.tags.includes(tag)
}

function signed(amount: number): string {
  return amount >= 0 ? `+${amount}` : String(amount)
}

function signedPercent(fraction: number): string {
  const percent = Math.round(fraction * 100)
  return percent >= 0 ? `+${percent}%` : `${percent}%`
}

/**
 * One effect, in words, computed from the SAME declaration the resolver
 * reads -- which is the whole reason effects are data. An effect that
 * depends on what is held says so and shows its current value, because a
 * player reading "+10% per item" still has to count their own items to know
 * what it is doing for them right now.
 */
export function describeEffect(effect: ModifierEffect, holdings: HoldingCounts): string {
  switch (effect.kind) {
    case 'statDelta':
      return `${signed(effect.amount)} ${STAT_LABELS[effect.stat]}`
    case 'derivedDelta':
      return `${signed(effect.amount)} ${DERIVED_LABELS[effect.derived]}`
    case 'derivedScale':
      return `${signedPercent(effect.factor - 1)} ${DERIVED_LABELS[effect.derived]}`
    case 'derivedScalePerHolding': {
      const held = holdings[effect.holding === 'item' ? 'items' : 'traits']
      const noun = effect.holding === 'item' ? 'item' : 'trait'
      const current = formatDerived(effect.derived, 1 + effect.factorPer * held)
      return `${signedPercent(effect.factorPer)} ${DERIVED_LABELS[effect.derived]} per ${noun} (${held} held: ${current})`
    }
    case 'armorOnAcquire':
      return `${signed(effect.amount)} Armor when acquired`
    case 'naturalArmor':
      return `${signed(effect.amount)} Armor that cannot decay`
    case 'armorDecayFloor':
      return `Armor never decays below ${effect.floor}`
    case 'tag':
      return effect.description
  }
}

/** Every line the tab bar shows while this modifier is in the selection spot. */
export function describeModifier(modifier: Modifier, holdings: HoldingCounts): string[] {
  return modifier.effects.map((effect) => describeEffect(effect, holdings))
}
