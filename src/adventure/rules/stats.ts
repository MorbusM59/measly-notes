// The five stats the game is actually played on, and everything they mean.
//
// This is the spine of the run framework (docs/adventure-game-design.md).
// Two rules make the rest of the system fall out of it:
//
//   1. Stats are DECLARED, not hardcoded as fields. Every formula below
//      reads a StatBlock, and a sixth stat is a line in STAT_KEYS plus a
//      formula -- not a schema migration through combat, gear and the save
//      format. (This is not hypothetical: the spec's hit-point formula
//      names a "Resilience" that is not in its own stat list. See
//      MAX_HIT_POINTS below and the design doc's open questions.)
//   2. The cap is on BASE stats only. "All stats are capped at 6 before
//      item gains" is the whole reason effective stats are computed in a
//      documented order (modifiers.ts) rather than clamped everywhere: a
//      run's own progress stops at 6, and gear is what takes you past it.
//
// Nothing here is random, stateful, or async, and nothing here knows what a
// round, an enemy or a menu is.

export const STAT_KEYS = ['luck', 'might', 'perception', 'charm', 'agility'] as const

export type StatKey = (typeof STAT_KEYS)[number]

export type StatBlock = Readonly<Record<StatKey, number>>

/** What a run's own progression can reach. Gear adds on top of it. */
export const BASE_STAT_CAP = 6

export function createStatBlock(fill = 0): StatBlock {
  return Object.fromEntries(STAT_KEYS.map((key) => [key, fill])) as StatBlock
}

export function addStatBlocks(base: StatBlock, delta: Partial<Record<StatKey, number>>): StatBlock {
  return Object.fromEntries(
    STAT_KEYS.map((key) => [key, base[key] + (delta[key] ?? 0)]),
  ) as StatBlock
}

/** Clamps to [0, BASE_STAT_CAP]. Applied to base stats only -- see the module comment. */
export function clampBaseStats(stats: StatBlock): StatBlock {
  return Object.fromEntries(
    STAT_KEYS.map((key) => [key, Math.max(0, Math.min(BASE_STAT_CAP, Math.floor(stats[key])))]),
  ) as StatBlock
}

// --- Derived values --------------------------------------------------------

/**
 * Everything a stat block implies, in one record. Named rather than
 * computed at each call site so gear can modify a derived value directly
 * (modifiers.ts) without every consumer knowing which stat produced it, and
 * so a formula change is one line here rather than a search.
 */
export interface DerivedStats {
  /** Offers shown per selection at the start of a round (Luck). */
  offerChoices: number
  /** Chance an attack deals double damage (Luck). */
  critChance: number
  /** Starting and maximum hit points (see MAX_HIT_POINTS). */
  maxHitPoints: number
  /** Multiplier on outgoing damage (Might). */
  damageMultiplier: number
  /** Choices offered at each step of a round (Perception). */
  encounterChoices: number
  /** Spell casts available per round (Charm). */
  spellCasts: number
  /** Chance to avoid an incoming attack entirely (Agility). */
  dodgeChance: number
  /** Chance an outgoing attack lands (Agility). */
  hitChance: number
}

export type DerivedStatKey = keyof DerivedStats

export const DERIVED_STAT_KEYS: readonly DerivedStatKey[] = [
  'offerChoices',
  'critChance',
  'maxHitPoints',
  'damageMultiplier',
  'encounterChoices',
  'spellCasts',
  'dodgeChance',
  'hitChance',
]

/**
 * Which derived values are counts (whole numbers) and which are chances
 * (clamped to 0..1). Kept as data because modifiers.ts has to re-apply the
 * same discipline after gear has had its say -- a "+1 encounter choice"
 * charm and a "+15% crit" charm must not each invent their own rounding.
 */
const COUNT_KEYS: ReadonlySet<DerivedStatKey> = new Set<DerivedStatKey>([
  'offerChoices',
  'encounterChoices',
  'spellCasts',
  'maxHitPoints',
])

const CHANCE_KEYS: ReadonlySet<DerivedStatKey> = new Set<DerivedStatKey>([
  'critChance',
  'dodgeChance',
  'hitChance',
])

/**
 * Hit points read Might, not the "Resilience" the specification's own
 * formula names -- there is no Resilience in its list of stats, and Might
 * is the stat the formula is written under. Recorded here rather than
 * silently chosen: if Resilience is meant to be a sixth stat, it is one
 * entry in STAT_KEYS and one word in this formula. See the design doc.
 */
const MAX_HIT_POINTS = (stats: StatBlock) => 50 + 15 * stats.might

export function deriveStats(effective: StatBlock): DerivedStats {
  return normalizeDerived({
    offerChoices: 2 + effective.luck / 2,
    critChance: 0.2 + 0.1 * effective.luck,
    maxHitPoints: MAX_HIT_POINTS(effective),
    damageMultiplier: 0.5 + 0.15 * effective.might,
    encounterChoices: 2 + effective.perception / 2,
    spellCasts: 2 + effective.charm,
    dodgeChance: 0.5 + 0.05 * effective.agility,
    hitChance: 0.5 + 0.05 * effective.agility,
  })
}

/**
 * Puts every derived value back in its legal shape: counts are whole and
 * non-negative (2 + Luck/2 at Luck 3 is three choices, not three and a
 * half), chances sit in 0..1, and open-ended multipliers are merely
 * non-negative. Exported because gear applies after the formulas and has to
 * land in the same shape -- see modifiers.ts.
 */
export function normalizeDerived(derived: DerivedStats): DerivedStats {
  const result = { ...derived }
  for (const key of DERIVED_STAT_KEYS) {
    const value = result[key]
    if (COUNT_KEYS.has(key)) result[key] = Math.max(0, Math.floor(value))
    else if (CHANCE_KEYS.has(key)) result[key] = Math.max(0, Math.min(1, value))
    else result[key] = Math.max(0, value)
  }
  return result
}
