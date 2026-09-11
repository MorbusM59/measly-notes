// What the bars show, assembled by the director's side of the house rather
// than by the hook: these are game numbers, and React has no opinion about
// them.
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

import type { EscapeMenuReadout } from '../escapeMenu/escapeMenuContract'
import { totalArmor } from './model/armor'
import { activeGame, profileOf, type GameSave } from './model/gameState'
import type { Modifier } from './model/modifiers'
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
    { key: 'xp', label: 'Motes', value: String(game.experienceUnits) },
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
