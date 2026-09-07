// Enemies, which are entirely derived: the round and the difficulty give a
// base value (difficulty.ts), and an archetype says what percentage of that
// base this particular creature is worth in health and in damage.
//
// So an archetype is a SHAPE, not a statline -- "a brute is 140-180% health
// and 80-110% damage" holds at round 1 and at round 40, and content never
// writes a number that goes stale as the curve moves. Roles exist because a
// round's layout (round.ts) asks for a miniboss or a boss by role, not by
// name; a new enemy is one entry in a content array.

import { nextRandom } from '../rng'
import { enemyBaseValue, type DifficultyKey } from './difficulty'

export type EnemyRole = 'minion' | 'miniboss' | 'boss'

export interface PercentRange {
  /** Multipliers of the round's base value, e.g. 1.4 for 140%. */
  min: number
  max: number
}

export interface EnemyArchetype {
  id: string
  name: string
  role: EnemyRole
  health: PercentRange
  damage: PercentRange
  /** Fame awarded for defeating it -- the run's score. */
  fame: number
  /** Relative likelihood among archetypes of the same role. Default 1. */
  weight?: number
  /** Named hooks for behaviour the two numbers cannot express yet. */
  tags?: readonly string[]
}

export interface Enemy {
  archetypeId: string
  name: string
  role: EnemyRole
  maxHitPoints: number
  /** Damage per landed attack, before the player's dodge is considered. */
  damage: number
  fame: number
  tags: readonly string[]
}

function rollInRange(range: PercentRange, base: number, rngState: number): { value: number; rngState: number } {
  const draw = nextRandom(rngState)
  const span = Math.max(0, range.max - range.min)
  return { value: base * (range.min + draw.value * span), rngState: draw.state }
}

export function rollEnemy(
  archetype: EnemyArchetype,
  difficulty: DifficultyKey,
  round: number,
  rngState: number,
): { enemy: Enemy; rngState: number } {
  const base = enemyBaseValue(difficulty, round)
  const health = rollInRange(archetype.health, base, rngState)
  const damage = rollInRange(archetype.damage, base, health.rngState)
  return {
    enemy: {
      archetypeId: archetype.id,
      name: archetype.name,
      role: archetype.role,
      // Rounded because hit points are counted, not measured; a fight's log
      // reads in whole numbers or it reads like a spreadsheet.
      maxHitPoints: Math.max(1, Math.round(health.value)),
      damage: Math.max(1, Math.round(damage.value)),
      fame: archetype.fame,
      tags: archetype.tags ?? [],
    },
    rngState: damage.rngState,
  }
}

/** Weighted pick among the archetypes of one role. Null when content has none. */
export function pickArchetype(
  archetypes: readonly EnemyArchetype[],
  role: EnemyRole,
  rngState: number,
): { archetype: EnemyArchetype | null; rngState: number } {
  const candidates = archetypes.filter((archetype) => archetype.role === role)
  if (candidates.length === 0) return { archetype: null, rngState }
  const total = candidates.reduce((sum, archetype) => sum + (archetype.weight ?? 1), 0)
  const draw = nextRandom(rngState)
  let remaining = draw.value * total
  for (const archetype of candidates) {
    remaining -= archetype.weight ?? 1
    if (remaining < 0) return { archetype, rngState: draw.state }
  }
  return { archetype: candidates[candidates.length - 1], rngState: draw.state }
}
