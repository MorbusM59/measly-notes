// What the CHROME around the editor shows, assembled by the director's side
// of the house rather than by the hook: these are game numbers, and React has
// no opinion about them.
//
// A mode owning a slot owns all six of that slot's chrome surfaces (see
// escapeMenuContract.ts's EscapeMenuModeChrome). This file fills four of them
// -- the readouts, the subject line, the counter and the strip. The toggle is
// deliberately EMPTY: nothing in the game has claimed that button yet, and
// leaving the editor's line-number/freeze toggle showing underneath would be
// reporting on a document this slot is not displaying. The gauge is filled
// once the mote model lands.
//
// The design's status line is `health | six stats | gold, experience,
// points, fame`, with armor beside health. Two things it also asks for are
// NOT here, each for a reason worth stating rather than silently dropping:
//
//   - ICONS per readout. The escape-menu contract's readout is a short
//     label and a value; giving it an icon is a change to a shared seam
//     (src/escapeMenu/escapeMenuContract.ts) that other features would see,
//     so it is a deliberate edit rather than a side effect of this work.
//   - MOTES UNTIL THE NEXT STAT POINT. The threshold is specified
//     (10 + 5 * points acquired), but whether spending experience on traits
//     also consumes progress toward it is not. Showing a number computed
//     from an unresolved rule would make the rule look decided.

import type { EscapeMenuChromeGauge, EscapeMenuChromePill, EscapeMenuModeChrome, EscapeMenuReadout } from '../escapeMenu/escapeMenuContract'
import { totalArmor } from './model/armor'
import { moteBalance, statPointProgress, statPointSpan } from './model/motes'
import { activeGame, heldModifiers, holdingCounts, profileOf, type GameSave } from './model/gameState'
import { describeModifier, type Modifier } from './model/modifiers'
import { STAT_KEYS, STAT_LABELS } from './model/stats'

const SHORT: Readonly<Record<string, string>> = {
  might: 'MGT',
  agility: 'AGI',
  perception: 'PER',
  intellect: 'INT',
  charisma: 'CHA',
  luck: 'LCK',
}

export function statusReadouts(save: GameSave, catalog: ReadonlyMap<string, Modifier>): EscapeMenuReadout[] {
  const game = activeGame(save)
  if (!game) {
    return [
      { key: 'games', label: 'Games', value: String(save.profile.gamesStarted) },
      { key: 'best', label: 'Best fame', value: String(save.profile.bestFame) },
    ]
  }

  const profile = profileOf(save, game, catalog)
  const armor = totalArmor(game.armor)

  return [
    { key: 'hp', label: 'HP', value: `${game.hitPoints}/${profile.derived.maxHitPoints}` },
    ...(armor > 0 ? [{ key: 'armor', label: 'ARM', value: String(armor) }] : []),
    // Effective stats, not base: what a check actually rolls against is
    // what the player needs to see. The base cap is a rule about
    // progression, not about what is true of them right now.
    ...STAT_KEYS.map((key) => ({
      key,
      label: SHORT[key] ?? STAT_LABELS[key],
      value: String(profile.stats[key]),
    })),
    { key: 'gold', label: 'Gold', value: String(game.goldUnits) },
    // The BALANCE, not the total earned: this readout is what the player can
    // spend. How close the next stat point is is the rail's job, and reads
    // the total instead -- see model/motes.ts for why those are two numbers.
    { key: 'xp', label: 'Motes', value: String(moteBalance(game.experienceEarned, game.experienceSpentOnTraits)) },
    ...(game.statPoints > 0 ? [{ key: 'points', label: 'Points', value: String(game.statPoints) }] : []),
    { key: 'fame', label: 'Fame', value: String(game.fame) },
  ]
}

/** The one line that says where you are. Level and region, once a game is running. */
export function statusSubject(save: GameSave, regionNameOf: (regionId: string) => string | null): string {
  const game = activeGame(save)
  if (!game) return 'Thockquest'
  const region = game.regionId ? regionNameOf(game.regionId) : null
  return region ? `Thockquest — Level ${game.level}, ${region}` : `Thockquest — Level ${game.level}`
}

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]

/**
 * The level, in roman numerals, because the counter is read as a heading for
 * the run rather than as a quantity -- and because it has to sit beside two
 * arabic numbers (the round and the actions left) without being mistaken for
 * one of them.
 */
export function romanNumeral(value: number): string {
  let remaining = Math.max(0, Math.floor(value))
  if (remaining === 0) return '—'
  let out = ''
  for (const [amount, symbol] of ROMAN) {
    while (remaining >= amount) {
      out += symbol
      remaining -= amount
    }
  }
  return out
}

/**
 * The one line where a note's word count would be: `IV [Combat] 3 | 4` --
 * level, the stage you are in, and how far through it you are.
 *
 * The progress pair is ABSENT rather than zeroed until there is something
 * that counts rounds and actions: combat is deliberately unbuilt (see
 * docs/adventure-platform.md), and `3 | 4` with nothing behind it would read
 * as a working feature reporting zero.
 */
export function chromeCounter(save: GameSave, stageTitle: string): string {
  const game = activeGame(save)
  const level = game ? `${romanNumeral(game.level)} ` : ''
  return `${level}[${stageTitle}]`
}

function pillsOf(held: readonly Modifier[], kind: Modifier['kind'], counts: ReturnType<typeof holdingCounts>): EscapeMenuChromePill[] {
  return held
    .filter((modifier) => modifier.kind === kind)
    // Acquisition order, and duplicates kept: two of the same item are two
    // things the run is carrying, and collapsing them would hide that from
    // the one surface that shows what you have.
    .map((modifier, index) => ({
      key: `${modifier.id}:${index}`,
      icon: modifier.icon,
      label: modifier.name,
      detail: describeModifier(modifier, counts),
    }))
}

/**
 * What the run is carrying, across the width the snapshot timeline occupies:
 * items reading out from the left, traits in from the right.
 *
 * This is what replaced the two permanent ring cells and the two screens
 * behind them. It costs nothing per screen and is always true, where those
 * cost three of twelve cells everywhere to be true on demand.
 */
export function chromeStrip(save: GameSave, catalog: ReadonlyMap<string, Modifier>): EscapeMenuModeChrome['strip'] {
  const game = activeGame(save)
  if (!game) return undefined
  const held = heldModifiers(save, game.id, catalog)
  const counts = holdingCounts(held)
  return {
    leading: pillsOf(held, 'item', counts),
    trailing: pillsOf(held, 'trait', counts),
  }
}

/**
 * The rail's gauges. One today: how close the next stat point is.
 *
 * It reads the run's TOTAL experience against the moving threshold, so it
 * does not move when motes are spent on a trait -- which is the whole of the
 * mote design and the thing a single running balance could not express.
 *
 * A list because the rail is subdivided: the second gauge is a layout
 * question, and the layout answers it already (escapeMenuContract.ts).
 */
export function chromeGauges(save: GameSave): EscapeMenuChromeGauge[] {
  const game = activeGame(save)
  if (!game) return []

  const span = statPointSpan(game.statPointsAcquired)
  const into = Math.max(0, game.experienceEarned - (game.experienceToNextStatPoint - span))
  return [
    {
      key: 'statPoint',
      icon: 'fa-solid fa-arrow-up-right-dots',
      ratio: statPointProgress(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsAcquired),
      label: 'Next stat point',
      detail: [
        `${into} of ${span} motes earned toward it`,
        `${game.experienceEarned} earned in total, next point at ${game.experienceToNextStatPoint}`,
      ],
    },
  ]
}
