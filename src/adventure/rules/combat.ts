// Combat, resolved in one call.
//
// "Combat is decided immediately" -- the player commits to a fight and is
// told how it went; there is no per-attack input. That is a statement about
// the INTERFACE, not about the maths: the exchange still runs blow by blow
// (hit, dodge, crit), because that is what makes a stat point feel like
// anything, and because the log it produces is what an encounter's prose
// will be written from. It just runs to completion inside this function.
//
// The player strikes first. Each exchange: the player attacks (hitChance,
// then critChance doubling the damage), and if the enemy is still standing
// it answers (the player's dodgeChance is the only defence -- enemies have
// no accuracy stat of their own yet).
//
// PROVISIONAL: the player's base damage. The specification gives a damage
// MULTIPLIER (50% + 15% * Might) and never says what it multiplies, so this
// module supplies the multiplicand as one named, overridable tuning
// constant rather than burying a number in the formula. It is the first
// entry in the design doc's open questions.

import { nextRandom } from '../rng'
import type { DerivedStats } from './stats'
import type { Enemy } from './enemies'

export interface CombatTuning {
  /** What damageMultiplier multiplies. See the module comment. */
  playerBaseDamage: number
  /** A crit deals this many times normal damage. */
  critMultiplier: number
  /** Safety valve: an exchange count no real fight should approach. */
  maxExchanges: number
}

export const DEFAULT_COMBAT_TUNING: CombatTuning = {
  playerBaseDamage: 10,
  critMultiplier: 2,
  maxExchanges: 200,
}

export type CombatEventKind = 'player-hit' | 'player-crit' | 'player-miss' | 'enemy-hit' | 'enemy-dodged'

export interface CombatEvent {
  kind: CombatEventKind
  damage: number
  /** Hit points left on whoever was struck, after this event. */
  targetHitPointsRemaining: number
}

export interface CombatResult {
  outcome: 'victory' | 'defeat'
  hitPointsRemaining: number
  damageTaken: number
  damageDealt: number
  exchanges: number
  log: CombatEvent[]
  rngState: number
}

export interface CombatInput {
  derived: DerivedStats
  /** Current hit points, which are NOT restored between fights by this module. */
  hitPoints: number
  enemy: Enemy
  rngState: number
  tuning?: CombatTuning
}

function chance(probability: number, rngState: number): { hit: boolean; rngState: number } {
  const draw = nextRandom(rngState)
  return { hit: draw.value < probability, rngState: draw.state }
}

export function resolveCombat(input: CombatInput): CombatResult {
  const tuning = input.tuning ?? DEFAULT_COMBAT_TUNING
  const { derived, enemy } = input

  let rngState = input.rngState
  let playerHitPoints = input.hitPoints
  let enemyHitPoints = enemy.maxHitPoints
  let damageTaken = 0
  let damageDealt = 0
  let exchanges = 0
  const log: CombatEvent[] = []

  const swing = Math.max(1, Math.round(tuning.playerBaseDamage * derived.damageMultiplier))

  while (playerHitPoints > 0 && enemyHitPoints > 0 && exchanges < tuning.maxExchanges) {
    exchanges += 1

    const landed = chance(derived.hitChance, rngState)
    rngState = landed.rngState
    if (landed.hit) {
      const crit = chance(derived.critChance, rngState)
      rngState = crit.rngState
      const damage = crit.hit ? swing * tuning.critMultiplier : swing
      enemyHitPoints -= damage
      damageDealt += damage
      log.push({
        kind: crit.hit ? 'player-crit' : 'player-hit',
        damage,
        targetHitPointsRemaining: Math.max(0, enemyHitPoints),
      })
    } else {
      log.push({ kind: 'player-miss', damage: 0, targetHitPointsRemaining: Math.max(0, enemyHitPoints) })
    }

    if (enemyHitPoints <= 0) break

    const dodged = chance(derived.dodgeChance, rngState)
    rngState = dodged.rngState
    if (dodged.hit) {
      log.push({ kind: 'enemy-dodged', damage: 0, targetHitPointsRemaining: playerHitPoints })
      continue
    }
    playerHitPoints -= enemy.damage
    damageTaken += enemy.damage
    log.push({ kind: 'enemy-hit', damage: enemy.damage, targetHitPointsRemaining: Math.max(0, playerHitPoints) })
  }

  return {
    // A fight that hits maxExchanges is content that cannot be won (an
    // enemy healthier than the player can out-damage); calling it a defeat
    // is honest and keeps the run advancing rather than hanging.
    outcome: enemyHitPoints <= 0 && playerHitPoints > 0 ? 'victory' : 'defeat',
    hitPointsRemaining: Math.max(0, playerHitPoints),
    damageTaken,
    damageDealt,
    exchanges,
    log,
    rngState,
  }
}
