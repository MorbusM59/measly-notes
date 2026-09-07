// Gear and traits: the only things in the game that change a player outside
// of levelling, and therefore the only place the order of operations
// matters.
//
// One shape covers both. They differ in where they come from (gold buys
// gear, experience buys traits) and in nothing else the rules care about,
// so they share a type and are told apart by `kind` -- which keeps
// "keep one gear and one trait" (loadout.ts) a filter rather than two
// parallel systems.
//
// THE ORDER, which is the actual rule "capped at 6 before item gains":
//   1. base stats, clamped to 0..6            <- a run's own progression
//   2. + every modifier's statDeltas          <- uncapped; this is the point
//   3. derive                                  <- stats.ts's formulas
//   4. * derivedScales, + derivedDeltas        <- gear that skips the stats
//   5. normalize                               <- counts whole, chances 0..1
//
// Step 4 exists because "major boosts" will not all be expressible as stat
// points: a charm that adds a spell cast, or halves incoming damage, has no
// stat to go through. Anything that cannot be expressed even that way gets
// a `tag`, which a future system can look for by name -- the deliberate
// escape hatch, in the one form that keeps modifiers plain data (and so
// serializable, offerable, and testable) instead of turning them into code.

import {
  addStatBlocks,
  clampBaseStats,
  deriveStats,
  normalizeDerived,
  type DerivedStatKey,
  type DerivedStats,
  type StatBlock,
  type StatKey,
} from './stats'

export type ModifierKind = 'gear' | 'trait'

export interface Modifier {
  id: string
  name: string
  kind: ModifierKind
  /** One line, as the ring's cell label and the log will read it. */
  description?: string
  /** How rare it is in an offer roll; higher is likelier. Default 1. */
  weight?: number
  /** Straight stat points. Uncapped by design -- see the module comment. */
  statDeltas?: Partial<Record<StatKey, number>>
  /** Multiplied into a derived value before flat deltas. */
  derivedScales?: Partial<Record<DerivedStatKey, number>>
  /** Added to a derived value after scaling. */
  derivedDeltas?: Partial<Record<DerivedStatKey, number>>
  /** Named hooks for effects the numbers above cannot express yet. */
  tags?: readonly string[]
}

export interface EffectiveProfile {
  /** Base + gear, uncapped. What a check rolls against. */
  stats: StatBlock
  /** Everything those stats imply, after gear has had its say. */
  derived: DerivedStats
}

/**
 * The player, resolved: base stats plus whatever is currently held. The one
 * function every other system asks for numbers, so no consumer ever has to
 * remember the order above.
 */
export function resolveProfile(baseStats: StatBlock, modifiers: readonly Modifier[]): EffectiveProfile {
  let stats = clampBaseStats(baseStats)
  for (const modifier of modifiers) {
    if (modifier.statDeltas) stats = addStatBlocks(stats, modifier.statDeltas)
  }

  const derived = { ...deriveStats(stats) }
  for (const modifier of modifiers) {
    for (const [key, scale] of Object.entries(modifier.derivedScales ?? {})) {
      derived[key as DerivedStatKey] *= scale as number
    }
  }
  for (const modifier of modifiers) {
    for (const [key, delta] of Object.entries(modifier.derivedDeltas ?? {})) {
      derived[key as DerivedStatKey] += delta as number
    }
  }

  return { stats, derived: normalizeDerived(derived) }
}

/** Whether anything currently held carries a named hook. */
export function hasTag(modifiers: readonly Modifier[], tag: string): boolean {
  return modifiers.some((modifier) => modifier.tags?.includes(tag) ?? false)
}

/**
 * Everything the game can offer, by kind. Content supplies it; the rules
 * only ever read it, which is what lets offers, loadouts and saved runs
 * refer to modifiers BY ID and stay valid across content changes (an id
 * that no longer resolves is dropped, not crashed on -- see loadout.ts).
 */
export interface ModifierCatalog {
  gear: readonly Modifier[]
  traits: readonly Modifier[]
}

export const EMPTY_MODIFIER_CATALOG: ModifierCatalog = { gear: [], traits: [] }

export function indexCatalog(catalog: ModifierCatalog): Map<string, Modifier> {
  return new Map([...catalog.gear, ...catalog.traits].map((modifier) => [modifier.id, modifier]))
}

/** Resolves ids to modifiers, silently dropping ids content no longer has. */
export function resolveModifiers(ids: readonly string[], catalog: ModifierCatalog): Modifier[] {
  const index = indexCatalog(catalog)
  return ids.flatMap((id) => {
    const modifier = index.get(id)
    return modifier ? [modifier] : []
  })
}
