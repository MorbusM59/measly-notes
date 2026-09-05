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

/** One wheel event, reduced to what the pixel conversion below needs. */
export interface WheelSpinNudgeInput {
  /** The event's raw deltaY, signed. */
  deltaY: number
  /** WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages. */
  deltaMode: number
  /** What `stepWheelNotch` made of this event: 0 means "not a nudge yet". */
  units: number
  /** The notch size the accumulator has learned, in pixels. */
  notchPx: number
  /** The pane's own line height, for line-mode wheels. */
  lineHeightPx: number
  /** What one page means here, for page-mode wheels. */
  pageHeightPx: number
}

/**
 * The minimum delta the notch accumulator will believe as a notch.
 *
 * Re-stated here rather than imported so this module stays free of the
 * row-counting one; `wheelNotch.ts`'s own constant is the same number and
 * the test asserts they have not drifted.
 */
export const WHEEL_SPIN_NUDGE_MIN_PX = 12

/**
 * What one wheel event is worth in pixels of scrolling, or 0 when it is not
 * a nudge yet.
 *
 * The gate is the edit view's -- `units`, straight from the shared notch
 * accumulator -- so both panes agree on when a spin has been made and a
 * trackpad's sub-notch stream reads as a spin in neither.
 *
 * The AMOUNT is the event's own delta, not the accumulator's learned notch
 * size, and the difference matters here in a way it cannot in the edit view.
 * The learned size only ever shrinks from a 100px assumption, so a device
 * that sends 120 per notch reads as 100 -- the right answer for counting
 * rows and the wrong one for continuing a scroll the browser has just made
 * at 120. Below the notch minimum there is no single event to take the
 * amount from, because the nudge was assembled out of several; there the
 * accumulator's figure is the only one available, and is what it is for.
 */
export function resolveWheelSpinNudgePixels(input: WheelSpinNudgeInput): number {
  const { deltaY, deltaMode, units, notchPx, lineHeightPx, pageHeightPx } = input
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0
  const magnitude = Math.abs(deltaY)
  // Line and page mode state their own unit, and need neither the
  // accumulator's gate nor its guess.
  if (deltaMode === 1) return Math.max(1, Math.trunc(magnitude)) * Math.max(1, lineHeightPx)
  if (deltaMode === 2) return Math.max(1, Math.trunc(magnitude)) * Math.max(1, pageHeightPx)
  if (units === 0) return 0
  return magnitude >= WHEEL_SPIN_NUDGE_MIN_PX ? magnitude : Math.abs(units) * notchPx
}
