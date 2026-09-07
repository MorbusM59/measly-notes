// A tiny deterministic PRNG whose entire state is one 32-bit integer, so a
// run's randomness can live in the saved session as a plain number.
//
// Math.random is unusable here for a structural reason, not a stylistic
// one: a session is written to disk after every choice and may be resumed
// days later in a different process. Anything drawn from a source the
// session cannot carry would make "continue" subtly different from "never
// stopped", and would make a reported bug unreproducible -- the seed plus
// the choice history is otherwise a complete recording of a run.
//
// mulberry32: fast, no dependencies, statistically fine for picking between
// a handful of story branches (this is not cryptography and must never be
// used as though it were).

/** One draw. Returns the value in [0, 1) and the state to store for next time. */
export function nextRandom(state: number): { value: number; state: number } {
  // >>> 0 keeps the state a genuine uint32 through every arithmetic step,
  // which is what makes it round-trip through JSON as an exact integer.
  const next = (state + 0x6d2b79f5) >>> 0
  let t = next
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return { value, state: next }
}

/** An integer in [min, max], inclusive. `max < min` yields `min`. */
export function nextIntInclusive(state: number, min: number, max: number): { value: number; state: number } {
  if (max <= min) return { value: min, state: nextRandom(state).state }
  const draw = nextRandom(state)
  return { value: min + Math.floor(draw.value * (max - min + 1)), state: draw.state }
}

/**
 * A fresh seed for a new run. The only place in the module that reads a
 * non-deterministic source -- from here on the run is a pure function of
 * this number and the player's choices.
 */
export function createSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}

/** Normalizes any number into the uint32 range the generator expects. */
export function toRngState(value: number): number {
  return Math.floor(Math.abs(value)) >>> 0
}
