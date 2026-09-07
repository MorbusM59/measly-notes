// The one knob the player sets before a run, and the curve every enemy in
// that run is measured against.
//
// The whole difficulty of the game lives in a single number per preset,
// because the enemy scale is a single exponential: base = 10 * factor^round
// (enemies.ts turns that base into a concrete enemy). Making it a table
// rather than a switch means a fifth preset -- or a per-run modifier that
// nudges the factor -- is data, not a code path.

export const DIFFICULTY_KEYS = ['easy', 'medium', 'hard', 'insane'] as const

export type DifficultyKey = (typeof DIFFICULTY_KEYS)[number]

export interface DifficultyPreset {
  key: DifficultyKey
  label: string
  /** The `x` in `10 * x^round`. */
  scaleFactor: number
}

export const DIFFICULTY_PRESETS: Readonly<Record<DifficultyKey, DifficultyPreset>> = {
  easy: { key: 'easy', label: 'Easy', scaleFactor: 1.01 },
  medium: { key: 'medium', label: 'Medium', scaleFactor: 1.02 },
  hard: { key: 'hard', label: 'Hard', scaleFactor: 1.05 },
  insane: { key: 'insane', label: 'Insane', scaleFactor: 1.1 },
}

/** The base the round's enemies are rolled from. Rounds are 1-based. */
export const ENEMY_BASE_AT_ROUND_ZERO = 10

export function enemyBaseValue(difficulty: DifficultyKey, round: number): number {
  const factor = DIFFICULTY_PRESETS[difficulty].scaleFactor
  return ENEMY_BASE_AT_ROUND_ZERO * factor ** Math.max(0, round)
}
