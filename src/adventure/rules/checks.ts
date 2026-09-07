// The stat check, in one place.
//
// The rule: roll a D6, add the encounter's Difficulty Rating, and the check
// passes if the stat MATCHES OR EXCEEDS that total. So the die is the
// opposition, not the player's contribution -- a stat of 6 passes DR 0
// always, and DR 6 cannot be passed at all. Worth stating plainly because
// the inverse convention (stat + d6 vs a target) is the more common one in
// tabletop games, reads identically in prose, and is what this codebase
// implemented before the rule was pinned down.
//
// The scene layer (engine.ts) resolves its own `check` outcomes through
// this same function rather than rolling its own dice, so there is exactly
// one place where "did it pass" is decided.

import { nextIntInclusive } from '../rng'

export const CHECK_DIE_SIDES = 6

export interface CheckResult {
  passed: boolean
  /** The die alone. */
  roll: number
  /** roll + difficultyRating -- what the stat had to match or beat. */
  target: number
  statValue: number
  rngState: number
}

export function resolveCheck(
  statValue: number,
  difficultyRating: number,
  rngState: number,
  dieSides: number = CHECK_DIE_SIDES,
): CheckResult {
  const draw = nextIntInclusive(rngState, 1, dieSides)
  const target = draw.value + difficultyRating
  return {
    passed: statValue >= target,
    roll: draw.value,
    target,
    statValue,
    rngState: draw.state,
  }
}
