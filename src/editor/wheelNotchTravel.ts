// One wheel notch, delivered on a curve instead of written straight to the
// scroller -- and spliced, not restarted, when the next notch arrives.
//
// ## Why a notch is not a jump
//
// The render view owns its notches (interaction design 3d): the browser's own
// scrolling is preventDefault'd so a notch can be worth what the reader asked
// for rather than whatever pixel delta the device sent. The cost of owning it
// is that nothing animates it any more -- a notch became an instantaneous
// write of several line heights, which is the one kind of motion the eye
// cannot track at all. A coast got a curve; the single notch that did not
// become a coast kept the jump.
//
// ## Why the second notch splices rather than restarts
//
// A wheel is turned, not tapped, so notches arrive while the previous one is
// still being paid out -- at the spin threshold's own range, 10-50ms apart,
// against a delivery measured in tens of milliseconds. Planning a fresh
// curve from rest for each one would discard the speed the view already has
// and read as a stutter exactly when the reader is moving fastest.
//
// So each notch snapshots the in-flight motion's instantaneous velocity AND
// acceleration (`estimateVelocityAndAcceleration`) and builds a quintic
// Hermite from those to the new total -- whatever was left of the old notch
// plus the new one -- landing at rest. That is
// `ScrollCurvePlan.ts`'s `buildContinuationPlan`, the same mid-flight
// retargeting the escape-hold ring uses, and it composes: the snapshot reads
// whichever leg is running, including an earlier continuation, so a run of
// notches is one accelerating motion rather than a train of pulses.
//
// ## What the reader is owed, and the sign of it
//
// Distance is signed and legs may reverse: a notch the other way is a new
// leg toward a target behind the current one, which is what the reader
// asked for. Within a single leg, though, motion must be monotone -- a
// quintic asked to land a small distance while already moving fast will
// overshoot and come back, and a render view that scrolls backwards by a few
// pixels mid-gesture is a defect. The leg's own high-water mark is held for
// that reason, and only that reason.

import {
  buildContinuationPlan,
  estimateVelocityAndAcceleration,
  sampleContinuationPlan,
  type ContinuationPlan,
} from './ScrollCurvePlan'

/**
 * How long one notch's worth of distance takes to arrive.
 *
 * Not a slider, and deliberately not derived from one. The two numbers that
 * look like candidates answer other questions and are wrong here: the
 * journey curve's total time is 400ms, tuned for travel across a document
 * and long enough that a notch would visibly lag the hand; the spin cut off
 * is about when a coast stops being motion, and follows the dampening rather
 * than the wheel.
 *
 * What this has to satisfy is only: long enough that the eye can follow the
 * distance rather than being shown two positions, and short enough that
 * consecutive notches at an ordinary reading cadence overlap and splice
 * instead of landing as separate pulses. The spin threshold's own range says
 * a turning wheel delivers notches 10-50ms apart, and a browsing hand rather
 * more slowly than that; anything comfortably above that range overlaps, and
 * this sits just under the shortest cut off the reader can choose.
 */
export const WHEEL_NOTCH_TRAVEL_MS = 110

export interface WheelNotchTravel {
  plan: ContinuationPlan
  startMs: number
  /** Signed pixels already handed to the scroller on this leg. */
  paidPx: number
  /** The leg's furthest point so far, for the monotonicity guard. */
  reachedPx: number
  /** +1 or -1: which way this leg is meant to go. */
  sign: 1 | -1
}

const sampleLeg = (travel: WheelNotchTravel, elapsedSec: number): number =>
  sampleContinuationPlan(travel.plan, elapsedSec)

/**
 * How much of the current leg has not been delivered yet.
 *
 * Signed, in the leg's own direction. Used both to build the next leg's
 * target and to hand an interrupted leg's remainder to whatever takes over
 * -- a coast, which must not silently drop the notches the hand already
 * turned.
 */
export function remainingWheelNotchTravelPx(
  travel: WheelNotchTravel | null,
  nowMs: number,
): number {
  if (!travel) return 0
  const elapsedSec = Math.max(0, (nowMs - travel.startMs) / 1000)
  return travel.plan.signedDistance - sampleLeg(travel, elapsedSec)
}

/**
 * Begin a leg carrying `addedPx` on top of whatever is still owed.
 *
 * `travel` is the leg in flight, or null to start from rest. The returned
 * leg always replaces it.
 */
export function retargetWheelNotchTravel(
  travel: WheelNotchTravel | null,
  addedPx: number,
  nowMs: number,
  travelMs: number = WHEEL_NOTCH_TRAVEL_MS,
): WheelNotchTravel {
  let initialVelocity = 0
  let initialAcceleration = 0
  let remainingPx = 0

  if (travel) {
    const elapsedSec = Math.max(0, (nowMs - travel.startMs) / 1000)
    const snapshot = estimateVelocityAndAcceleration(
      (atSec) => sampleLeg(travel, atSec),
      elapsedSec,
    )
    initialVelocity = snapshot.velocity
    initialAcceleration = snapshot.acceleration
    remainingPx = travel.plan.signedDistance - sampleLeg(travel, elapsedSec)
  }

  const signedDistance = remainingPx + addedPx
  return {
    plan: buildContinuationPlan(
      signedDistance,
      initialVelocity,
      initialAcceleration,
      travelMs / 1000,
    ),
    startMs: nowMs,
    paidPx: 0,
    reachedPx: 0,
    sign: signedDistance >= 0 ? 1 : -1,
  }
}

export interface WheelNotchTravelStep {
  /** Signed pixels to scroll now. */
  pixels: number
  /** True once the leg has delivered all of its distance. */
  finished: boolean
}

/**
 * Take whatever the leg owes since it was last asked.
 *
 * Sampled from absolute elapsed time rather than accumulated per frame, so a
 * late or dropped frame lands where the plan says it should instead of
 * losing the difference.
 */
export function takeWheelNotchTravelStep(
  travel: WheelNotchTravel,
  nowMs: number,
): WheelNotchTravelStep {
  const elapsedSec = Math.max(0, (nowMs - travel.startMs) / 1000)
  const raw = sampleLeg(travel, elapsedSec)

  // Never pay backwards within a leg -- see the module comment.
  const travelled = travel.sign > 0
    ? Math.max(raw, travel.reachedPx)
    : Math.min(raw, travel.reachedPx)
  travel.reachedPx = travelled

  const pixels = travelled - travel.paidPx
  travel.paidPx = travelled

  return {
    pixels,
    finished: elapsedSec >= travel.plan.totalDurationSec,
  }
}
