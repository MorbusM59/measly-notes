// A wheel spin's schedule, delivered continuously instead of in steps.
//
// ## Why the render view needs this and the edit view does not
//
// `wheelSpin.ts` describes a coast as a series of simulated nudges: the nth
// one lands d_n = d_avg * (1 + n*a)^n after the last. In the edit view every
// nudge is a whole row, and a row is small (one line height) -- so a coast
// there is a fast run of small steps, which reads as motion, and the steps
// themselves are the point: text is never between rows (interaction design
// 3d).
//
// The render view has no rows, and its nudges are not small. One notch of a
// mouse wheel is worth whatever the device says -- typically three text
// lines, often a hundred pixels. Firing that as a discrete jump every d_n
// would be fine at the start of a coast, where d_n is 10-50ms, and clearly
// wrong at the end of one, where the dampening has stretched d_n toward the
// cut off: a hundred-pixel jump twice a second is not a page coasting to a
// stop, it is a page being nudged twice.
//
// So the render view takes the same schedule and delivers it as speed
// rather than as steps: over the interval d_n, the pixels of one nudge are
// paid out smoothly. The nudge boundaries, the decay, the cut off and the
// total distance travelled by any moment are all exactly what the edit view
// would have done -- this is the schedule interpolated, not a second model
// of it. That is the whole of "identical, minus the quantization".
//
// ## What this module does not know
//
// Where the segments come from. The caller supplies the next segment's
// duration on demand, which is how the decay and the cut off stay in
// `wheelSpin.ts` where the edit view reads them from too. A null duration
// means the coast is over; this module reports that and stops asking.

export type WheelSpinGlideDirection = -1 | 1

export interface WheelSpinGlide {
  direction: WheelSpinGlideDirection
  /** Pixels one simulated nudge is worth -- what a real notch moved. */
  pixelsPerNudge: number
  /** Time left in the segment being paid out, in ms. */
  remainingMs: number
  /** Pixels still to pay out in that segment. */
  remainingPx: number
}

export function createWheelSpinGlide(
  direction: WheelSpinGlideDirection,
  pixelsPerNudge: number,
): WheelSpinGlide {
  return { direction, pixelsPerNudge: Math.abs(pixelsPerNudge), remainingMs: 0, remainingPx: 0 }
}

export interface WheelSpinGlideStep {
  /** Signed pixels to scroll this frame. */
  pixels: number
  /** True once the schedule ran out: the caller should end the coast. */
  finished: boolean
}

/**
 * Advance the glide by `elapsedMs` and report how far to scroll.
 *
 * `nextSegmentDurationMs` is asked for a duration only when the current
 * segment is spent, and answering null ends the coast. It is called at most
 * once per exhausted segment, so it may have side effects -- the caller's
 * does: it is what advances `wheelSpin.ts`'s own nudge counter, which is
 * what makes the next duration a longer one.
 *
 * A single call can cross several segments; a frame that arrives late after
 * a stall must not silently drop the nudges it slept through, or a coast
 * would come out of a hitch running at the speed it had before it, having
 * skipped the dampening in between.
 */
export function advanceWheelSpinGlide(
  glide: WheelSpinGlide,
  elapsedMs: number,
  nextSegmentDurationMs: () => number | null,
): WheelSpinGlideStep {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return { pixels: 0, finished: false }
  }

  let paidPx = 0
  let remainingMs = elapsedMs

  while (remainingMs > 0) {
    if (glide.remainingMs <= 0) {
      const durationMs = nextSegmentDurationMs()
      if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) {
        return { pixels: paidPx * glide.direction, finished: true }
      }
      glide.remainingMs = durationMs
      glide.remainingPx = glide.pixelsPerNudge
    }

    const consumedMs = Math.min(remainingMs, glide.remainingMs)
    // Share of what is LEFT of this segment, not of the whole segment: a
    // segment entered mid-frame still pays out exactly its own remainder.
    const paidNowPx = glide.remainingPx * (consumedMs / glide.remainingMs)
    paidPx += paidNowPx
    glide.remainingPx -= paidNowPx
    glide.remainingMs -= consumedMs
    remainingMs -= consumedMs
  }

  return { pixels: paidPx * glide.direction, finished: false }
}

