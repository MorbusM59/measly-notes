// How many rows one turn of the wheel is worth.
//
// ## The bug this exists because of
//
// The edit view scrolls by whole rows -- the grid is the point (see
// rowGridGuard.ts) -- so a wheel handler here has to answer one question:
// how much pixel delta is one notch? The old answer was the constant 100,
// the Windows default of three lines at 33.3px each. On a machine whose
// pointer settings send 50 per notch (one or two lines), the accumulator
// then took TWO notches to reach one unit: the first fell under the
// threshold and moved nothing, the second moved a row. Every other notch
// did nothing, in both directions, on every note. It was reported from the
// symptom -- "scrolling up only produces a line movement on every other
// wheel position" -- and found by tracing the real deltas
// (`thockdown:debug-wheel`), because the arithmetic is provably symmetric
// and correct for the delta it was written for. The delta was the input
// nobody had checked.
//
// ## Why measuring beats a bigger constant
//
// A device's notch size is a system setting, not a platform constant: the
// same OS sends 50, 100 or 120 depending on the user's "lines to scroll".
// Any fixed number is right for some machines and halves or doubles the
// scroll rate on the rest. The device states its own notch size on every
// event, so the honest unit is the smallest delta the current gesture has
// actually produced -- one notch, by definition, since a gesture cannot
// send less than one.
//
// The unit only ever SHRINKS, and is never reset -- deliberately, and this
// was the one real design decision here. Re-learning it per gesture reads
// as the safer choice, and it is the opposite: a reset unit means the first
// notch after every pause is measured against the 100px assumption again,
// so on a 50px device an isolated, deliberate single notch -- the most
// common scroll there is -- would move nothing at all, forever. Persisting
// it costs only the case where a second pointing device with a LARGER notch
// is used later in the same session, which then scrolls a shade fast and
// never scrolls dead. Fast is a preference; dead is a bug.
//
// Deltas below WHEEL_NOTCH_MIN_PX never teach anything: those are trackpad
// pixel-scroll events, which have no notch to measure and would otherwise
// drive the unit down to a couple of pixels and make the wheel wildly
// oversensitive. They still accumulate against the standing unit, which is
// exactly the behavior a trackpad had before any of this.

import { PIXELS_PER_WHEEL_UNIT } from './LayoutConstants'

/** The notch size assumed until a device demonstrates its own. */
export const WHEEL_NOTCH_DEFAULT_PX = PIXELS_PER_WHEEL_UNIT

/**
 * The smallest delta allowed to be believed as a notch.
 *
 * Above it, a delta is a discrete wheel click worth one row. Below it, it is
 * a trackpad's continuous pixel scroll, which has no notch at all -- see the
 * module comment.
 */
export const WHEEL_NOTCH_MIN_PX = 12

/**
 * Quiet time after which a leftover sub-notch remainder is abandoned.
 *
 * Only the remainder -- the learned notch size persists across gestures on
 * purpose (see the module comment). A fraction of a notch left over from a
 * scroll a second ago should not be spent on the next one; within a single
 * continuous gesture it is exactly what should carry.
 */
export const WHEEL_GESTURE_IDLE_MS = 500

export interface WheelNotchState {
  /** The pixel size of one notch, as currently understood. */
  notchPx: number
  /** Delta accumulated since the last whole row, signed. */
  pendingPx: number
  /** When the last wheel event arrived, for gesture-boundary detection. */
  lastEventMs: number | null
}

export function createWheelNotchState(): WheelNotchState {
  return { notchPx: WHEEL_NOTCH_DEFAULT_PX, pendingPx: 0, lastEventMs: null }
}

/** The notch size after seeing `deltaPx`; only ever shrinks. */
export function resolveWheelNotchPx(currentNotchPx: number, deltaPx: number): number {
  const magnitude = Math.abs(deltaPx)
  if (!Number.isFinite(magnitude) || magnitude < WHEEL_NOTCH_MIN_PX) return currentNotchPx
  return Math.min(currentNotchPx, magnitude)
}

/**
 * How many rows a pixel-mode wheel event should scroll, advancing `state`.
 *
 * Returns 0 when the event was genuinely sub-notch (a trackpad still
 * accumulating), which is the only case the caller should decline.
 */
export function stepWheelNotch(state: WheelNotchState, deltaPx: number, nowMs: number): number {
  if (!Number.isFinite(deltaPx) || deltaPx === 0) return 0

  // A new gesture inherits no remainder: carrying one across the gap spends
  // it on a later, unrelated turn of the wheel. The learned notch does carry.
  if (state.lastEventMs !== null && nowMs - state.lastEventMs > WHEEL_GESTURE_IDLE_MS) {
    state.pendingPx = 0
  }
  state.lastEventMs = nowMs

  // A reversal discards the residual too. Half a notch of leftover downward
  // travel must not be subtracted from the first notch of an upward one --
  // that is the same swallowed-notch feeling this module exists to remove,
  // just at the turn instead of at every other click.
  if (state.pendingPx !== 0 && Math.sign(deltaPx) !== Math.sign(state.pendingPx)) {
    state.pendingPx = 0
  }

  state.notchPx = resolveWheelNotchPx(state.notchPx, deltaPx)
  state.pendingPx += deltaPx

  const sign = state.pendingPx < 0 ? -1 : 1
  const unitCount = Math.floor(Math.abs(state.pendingPx) / state.notchPx)
  if (unitCount === 0) return 0
  state.pendingPx -= unitCount * state.notchPx * sign
  return unitCount * sign
}
