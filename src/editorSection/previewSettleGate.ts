/**
 * The render-view "settle gate": keeps a freshly-switched-to note's preview
 * unpainted until its geometry has actually stopped moving, so the first
 * frame the user sees is the final one.
 *
 * ## The problem this exists for
 *
 * Switching notes in render mode used to paint the new note, and only then
 * land its restored scroll position on top -- the restore in
 * useEditorSectionMount's preview-restore effect can't even *know* where to
 * scroll until an async getNoteUiState round-trip resolves, which is several
 * frames after the new blocks are already on screen. Measured in render
 * mode, switching between two notes with very different geometry:
 *
 *   BIG -> SMALL: the new note's blocks mount while scrollTop is still the
 *                 outgoing note's (40), and only the NEXT commit snaps it
 *                 to 0 -- i.e. the new text is painted at the old note's
 *                 offset first
 *
 * plus react-virtual's own corrections as each newly-mounted block's real
 * measured height replaces the initial estimate. The user sees the text
 * arrive, then shuffle.
 *
 * With the gate in place the same switch measures: visible (old note) ->
 * hidden at ~18ms as the content swaps -> revealed at ~52ms already at its
 * final geometry, with no intermediate state ever painted.
 *
 * ## Why it's built this way
 *
 * The gate deliberately does NOT count frames or wait a fixed duration --
 * "wait 2 frames and hope it's done" is exactly the failure mode it
 * replaces, and no duration can be trusted to outlast react-virtual's
 * reconciliation on an arbitrary document (the same reasoning recorded on
 * applyPreviewSourceAnchor's own "no follow-up nudge" comment). Instead it
 * watches a real signal: a *geometry fixed point*. Each evaluation samples
 * the scroll container's own geometry (scrollTop + scrollHeight + the
 * virtualizer's sizer height) and compares it against the previous sample.
 * Two consecutive identical samples means nothing is moving any more, and
 * that's the reveal signal. Evaluation is scheduled on rAF purely because
 * that's the point at which a frame's layout is complete and stable -- the
 * frame is the *observation point*, not the condition; the loop reschedules
 * itself for exactly as long as the geometry keeps changing and stops the
 * moment it doesn't, so a trivial note settles in one evaluation and a
 * pathological one takes as many as it genuinely needs.
 *
 * `visibility: hidden` (not `display: none`, not opacity) is what hides it:
 * the subtree stays laid out, so react-virtual's ResizeObserver measurement
 * and the restore's own `scrollIntoView` both behave exactly as they do
 * when visible. The gate changes *when* the user sees the result, never
 * what the mechanism underneath computes.
 *
 * The `maxSettleMs` bound is a safety valve, not the mechanism: it exists
 * so a pathological document can never leave the preview permanently
 * invisible, and reaching it is a bug worth the console warning it emits.
 *
 * ## The second condition: a movement we know is coming
 *
 * A geometry fixed point turned out not to be sufficient on its own. The
 * preview's background measurement survey buffers every height it measures
 * and lands them in ONE commit at the end, and the gate would routinely
 * reach its fixed point BEFORE that commit -- so the note was revealed at
 * heights we already knew were about to be replaced, and the reader watched
 * it settle anyway. Measured on three ordinary notes (see the settle trace,
 * `thockdown:debug-preview-settle`), the commit landed 51-85ms after the
 * reveal and moved the document's total height by up to 271px of 2837, which
 * is both the reflow and the scrollbar-thumb jump that were reported.
 *
 * So "at rest" is only a reveal signal once `isMeasurementPending` says the
 * survey has nothing left to commit. Its bound is deliberately much tighter
 * than `maxSettleMs` and deliberately silent -- see
 * DEFAULT_MAX_MEASUREMENT_WAIT_MS for why those two failures are not the
 * same kind of thing.
 *
 * Both of those measurements were taken after a related fix on the other
 * side of the same interaction: the survey used to treat the restore's own
 * scroll as the reader scrolling and stand aside for the full quiet window,
 * which pushed its commit out to ~250ms after the reveal. See
 * usePreviewMarkdownRendering's scroll listener.
 */

import {
  SETTLE_WATCH_DURATION_MS,
  formatSettleSample,
  isSettleTraceOn,
  readSettleGeometry,
  readTopMountedBlockIndex,
  sampleDiffers,
  traceSettle,
  type SettleGeometrySample,
} from './previewSettleTrace'

/** How long the gate will hold the preview hidden before revealing it regardless. Safety valve only -- see the module comment. */
const DEFAULT_MAX_SETTLE_MS = 600

/**
 * How long the gate will keep waiting for the measurement survey AFTER the
 * geometry itself has come to rest.
 *
 * A resting geometry is not a finished one while the survey still has heights
 * to commit: that commit is a movement we know is coming, and revealing
 * before it is choosing to show the reader a layout we already know is about
 * to change. Measured on three ordinary notes, it lands 51-85ms after the
 * fixed point -- so waiting for it costs about a frame's worth of extra hold
 * in the normal case, and removes the last visible settle.
 *
 * It is bounded separately from `maxSettleMs`, and much more tightly, because
 * the two failures are not the same. Overrunning `maxSettleMs` means
 * something is broken. Overrunning this just means the survey is slow -- a big
 * continuous document, a loaded machine -- and there the right answer is to
 * stop waiting and show the note, because a pane held blank is worse than a
 * settle the reader can at least read through. Reaching this bound is a
 * graceful degradation to the previous behaviour, not a bug, and it does not
 * warn.
 */
const DEFAULT_MAX_MEASUREMENT_WAIT_MS = 250

export interface PreviewSettleGateOptions {
  /** The preview scroll container (`previewScrollRef`'s element). Read lazily -- it isn't mounted yet when the gate is created. */
  getContainer: () => HTMLElement | null
  maxSettleMs?: number
  /** See DEFAULT_MAX_MEASUREMENT_WAIT_MS. */
  maxMeasurementWaitMs?: number
  /**
   * Whether the preview's background measurement survey still has heights to
   * commit for the document now on screen.
   *
   * The gate treats a pending survey as "the geometry has not finished
   * moving", because it has not: the survey buffers every measured height and
   * lands them in ONE commit at the end (see commitPrewarmedSizes), and that
   * commit changed the total document height by up to 10% on the notes this
   * was measured on. Absent, or answering false, the gate behaves exactly as
   * it did before this existed.
   */
  isMeasurementPending?: () => boolean
  /**
   * Elements outside the scroll container that must be hidden and revealed
   * with it, in the same frame.
   *
   * The render view's scrollbar is not inside the pane it describes -- it
   * lives in its own `<aside>` (SectionEditorArea.tsx), so the container's
   * own `visibility` never reached it and it went on settling in full view
   * after the text had stopped: its size and position both change when the
   * measurement survey commits, because until then it is drawn from a
   * provisional ratio over an estimated content height. Covering the text and
   * not the thing that describes the text just moves which half of the window
   * the reader watches settle.
   */
  getCompanions?: () => Array<HTMLElement | null>
  /**
   * Run once per reveal, WHILE everything is still hidden.
   *
   * For anything that has to be brought up to date before it is seen. The
   * scrollbar needs exactly this: it is redrawn from scroll events, so on its
   * own it would reappear holding whatever it last computed and only catch up
   * on the next event -- visibly, which is the defect this is here to avoid.
   */
  onBeforeReveal?: () => void
  /** Injectable clock/schedulers, for tests. Defaults to the real ones. */
  scheduler?: PreviewSettleGateScheduler
}

export interface PreviewSettleGateScheduler {
  now: () => number
  requestFrame: (callback: () => void) => number
  cancelFrame: (handle: number) => void
  setTimer: (callback: () => void, delayMs: number) => number
  clearTimer: (handle: number) => void
}

const DEFAULT_SCHEDULER: PreviewSettleGateScheduler = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimer: (handle) => window.clearTimeout(handle),
}

export interface PreviewSettleGate {
  /**
   * A new preview target (note switch, snapshot switch) is starting to
   * load: hide the preview and open a fresh generation. Returns the
   * generation id, which every later call must pass back so a superseded
   * switch can never reveal (or un-hide) the one that replaced it.
   */
  beginSettle: () => number
  /**
   * The restore has issued its scroll write for `generation` -- or has
   * determined there's nothing to restore. Until this lands the gate stays
   * hidden no matter how stable the geometry looks, since "stable" before
   * the scroll has been applied just means we're stably in the wrong place.
   */
  markRestoreApplied: (generation: number) => void
  /** Called from the preview renderer's commit layout effect: the block subtree changed, so geometry may be moving again. */
  notifyCommit: () => void
  /** Subscribe to those same commits -- used by the restore to retry its anchor lookup exactly when the DOM could have changed, instead of polling frames. */
  subscribeToCommit: (listener: () => void) => () => void
  /** Reveal immediately and abandon the current generation (leaving preview mode, unmount, no note open). */
  forceReveal: (reason?: string) => void
  /**
   * Whether the preview is hidden right now, waiting for its geometry to
   * settle.
   *
   * Exists so that machinery which reacts to the reader can tell that the
   * reader is not, in fact, there: nobody scrolls a pane they cannot see, so
   * a scroll event fired while this is true belongs to the restore, not to
   * them. See usePreviewMarkdownRendering's scroll listener, where treating
   * the restore's own scroll as the reader's made the measurement survey
   * stand aside for the whole quiet window at exactly the moment it most
   * needed to run.
   */
  isHolding: () => boolean
  dispose: () => void
}

export function createPreviewSettleGate({
  getContainer,
  maxSettleMs = DEFAULT_MAX_SETTLE_MS,
  maxMeasurementWaitMs = DEFAULT_MAX_MEASUREMENT_WAIT_MS,
  isMeasurementPending,
  getCompanions,
  onBeforeReveal,
  scheduler = DEFAULT_SCHEDULER,
}: PreviewSettleGateOptions): PreviewSettleGate {
  let generation = 0
  let isHidden = false
  let restoreAppliedGeneration = -1
  let lastSignature: string | null = null
  /** When the geometry first came to rest while the survey was still pending. Null whenever it is not resting, or nothing is pending. */
  let measurementWaitStartedAtMs: number | null = null
  let settleStartedAtMs = 0
  let scheduledFrame: number | null = null
  let safetyTimer: number | null = null
  const commitListeners = new Set<() => void>()

  const setHidden = (hidden: boolean) => {
    const value = hidden ? 'hidden' : ''
    const container = getContainer()
    // Written directly rather than through React state on purpose: the
    // settle loop can evaluate several times per switch, and routing that
    // through a re-render would churn the whole preview subtree (and so
    // move the very geometry it's trying to observe settle).
    if (container) container.style.visibility = value
    // The companions are written even when the container is missing: they are
    // separate elements with their own lifetimes, and leaving one hidden
    // because the scroller happened to be gone is how a scrollbar disappears
    // for good.
    for (const companion of getCompanions?.() ?? []) {
      if (companion) companion.style.visibility = value
    }
  }

  const cancelScheduled = () => {
    if (scheduledFrame !== null) {
      scheduler.cancelFrame(scheduledFrame)
      scheduledFrame = null
    }
    if (safetyTimer !== null) {
      scheduler.clearTimer(safetyTimer)
      safetyTimer = null
    }
  }

  /**
   * Follows the geometry for a while AFTER a reveal, when the trace is on.
   *
   * The gate's own job ends at the reveal; this is the part that says
   * whether ending it there was right. See previewSettleTrace.ts for why it
   * reports the three components separately and latches one block to follow.
   */
  let watchFrame: number | null = null
  const stopWatching = () => {
    if (watchFrame === null) return
    scheduler.cancelFrame(watchFrame)
    watchFrame = null
  }

  const watchAfterReveal = () => {
    stopWatching()
    if (!isSettleTraceOn()) return
    const container = getContainer()
    if (!container) return

    const latchedBlockIndex = readTopMountedBlockIndex(container)
    const startedAtMs = scheduler.now()
    let previous: SettleGeometrySample = readSettleGeometry(container, latchedBlockIndex)
    let changes = 0
    traceSettle(() => `watch  start latchedBlock=${latchedBlockIndex ?? 'none'} for=${SETTLE_WATCH_DURATION_MS}ms`)

    const step = () => {
      watchFrame = null
      const stillThere = getContainer()
      if (!stillThere) return
      const elapsedMs = scheduler.now() - startedAtMs
      const sample = readSettleGeometry(stillThere, latchedBlockIndex)
      if (sampleDiffers(sample, previous)) {
        changes += 1
        traceSettle(() => formatSettleSample(elapsedMs, sample, previous))
        previous = sample
      }
      if (elapsedMs >= SETTLE_WATCH_DURATION_MS) {
        traceSettle(() => `watch  end changes=${changes} -- ${changes === 0 ? 'nothing moved after the reveal' : 'the reveal was followed by movement (see the textShift on each line)'}`)
        return
      }
      watchFrame = scheduler.requestFrame(step)
    }

    watchFrame = scheduler.requestFrame(step)
  }

  const reveal = (reason: string) => {
    const container = getContainer()
    traceSettle(() => {
      const heldMs = Math.round(scheduler.now() - settleStartedAtMs)
      const geometry = container ? readSettleGeometry(container, null) : null
      return `reveal gen=${generation} reason=${reason} heldMs=${heldMs}`
        + (geometry ? ` scrollTop=${geometry.scrollTop} scrollHeight=${geometry.scrollHeight} sizerH=${geometry.sizerHeightPx}` : ' (no container)')
    })
    cancelScheduled()
    isHidden = false
    lastSignature = null
    // Before the un-hide, deliberately: anything brought up to date here is
    // then correct in the very first frame it is seen, rather than correcting
    // itself in the second one.
    try {
      onBeforeReveal?.()
    } catch (error) {
      console.warn('[preview-settle-gate] onBeforeReveal threw -- revealing anyway', error)
    }
    setHidden(false)
    watchAfterReveal()
  }

  /**
   * The observed signal. scrollHeight and the virtualizer's own sizer
   * height together cover "a block's real measured height replaced its
   * estimate"; scrollTop covers the restore landing (and react-virtual's
   * scroll corrections afterwards). Anything that would visibly move the
   * text moves at least one of the three.
   */
  const readGeometrySignature = (container: HTMLElement): string => {
    const sizer = container.firstElementChild as HTMLElement | null
    return `${container.scrollTop}|${container.scrollHeight}|${sizer?.style.height ?? ''}`
  }

  const evaluate = () => {
    scheduledFrame = null
    if (!isHidden) return

    const container = getContainer()
    if (!container) {
      reveal('no-container')
      return
    }

    if (scheduler.now() - settleStartedAtMs > maxSettleMs) {
      console.warn('[preview-settle-gate] revealed on the safety bound rather than a settled geometry -- something upstream never stopped moving', {
        maxSettleMs,
        signature: readGeometrySignature(container),
        restoreApplied: restoreAppliedGeneration === generation,
        // Distinguishes the one benign way to get here: the geometry never
        // came to rest long enough for the (tightly bounded) measurement wait
        // to expire first. That is a slow survey, not a stuck pane.
        measurementPending: isMeasurementPending?.() ?? false,
      })
      reveal('safety-bound')
      return
    }

    // Stable-but-not-yet-restored is not settled: keep watching until the
    // restore's scroll write has actually been issued for this generation.
    if (restoreAppliedGeneration !== generation) {
      lastSignature = null
      scheduleEvaluate()
      return
    }

    const signature = readGeometrySignature(container)
    if (lastSignature !== null && signature === lastSignature) {
      // At rest -- but not necessarily finished. The measurement survey
      // commits every height it has gathered in one go at the end, and that
      // commit moves the geometry again. Revealing between the two is how the
      // reader ends up watching the note settle: the note is shown at heights
      // we already know are about to be replaced. So a resting geometry with
      // a pending survey is a wait, not a reveal signal -- bounded, because a
      // slow survey must not hold the pane blank (see
      // DEFAULT_MAX_MEASUREMENT_WAIT_MS).
      if (isMeasurementPending?.()) {
        if (measurementWaitStartedAtMs === null) {
          measurementWaitStartedAtMs = scheduler.now()
          traceSettle(() => `waiting gen=${generation} geometry at rest, survey still pending (up to ${maxMeasurementWaitMs}ms)`)
        } else if (scheduler.now() - measurementWaitStartedAtMs > maxMeasurementWaitMs) {
          reveal('measurement-wait-expired')
          return
        }
        scheduleEvaluate()
        return
      }

      reveal('fixed-point')
      return
    }

    traceSettle(() => `sample gen=${generation} sig=${signature}${lastSignature === null ? ' (first)' : ' (moved)'}`)
    // Moving again -- so any wait we had started is over; the survey's own
    // commit is one of the things that lands here.
    measurementWaitStartedAtMs = null
    lastSignature = signature
    scheduleEvaluate()
  }

  const scheduleEvaluate = () => {
    if (!isHidden || scheduledFrame !== null) return
    scheduledFrame = scheduler.requestFrame(evaluate)
  }

  return {
    beginSettle: () => {
      generation += 1
      isHidden = true
      restoreAppliedGeneration = -1
      lastSignature = null
      measurementWaitStartedAtMs = null
      settleStartedAtMs = scheduler.now()
      stopWatching()
      setHidden(true)
      traceSettle(() => `begin  gen=${generation} container=${getContainer() ? 'yes' : 'MISSING -- nothing was hidden'}`)
      scheduleEvaluate()
      // A timer, NOT another animation frame, because the whole point of
      // this bound is to cover the cases where frames stop arriving: a
      // backgrounded or non-compositing window throttles rAF to nothing, and
      // a gate that could only ever reveal from inside a frame callback
      // would leave such a window's preview blank until it was focused
      // again. Timers keep firing there. (Found exactly this way -- the
      // gate held the preview hidden indefinitely in a non-compositing
      // browser pane.)
      if (safetyTimer !== null) scheduler.clearTimer(safetyTimer)
      safetyTimer = scheduler.setTimer(() => {
        safetyTimer = null
        if (!isHidden) return
        console.warn('[preview-settle-gate] revealing on the safety timer -- the geometry never reached a fixed point (or frames stopped arriving)')
        reveal('safety-timer')
      }, maxSettleMs)
      return generation
    },

    markRestoreApplied: (forGeneration: number) => {
      if (forGeneration !== generation) {
        traceSettle(() => `restore ignored gen=${forGeneration} (current is ${generation})`)
        return
      }
      restoreAppliedGeneration = forGeneration
      traceSettle(() => `restore applied gen=${forGeneration}`)
      // Restart the comparison from here: samples taken before the scroll
      // landed say nothing about whether the *final* position is stable.
      lastSignature = null
      measurementWaitStartedAtMs = null
      scheduleEvaluate()
    },

    notifyCommit: () => {
      for (const listener of commitListeners) listener()
      scheduleEvaluate()
    },

    subscribeToCommit: (listener: () => void) => {
      commitListeners.add(listener)
      return () => {
        commitListeners.delete(listener)
      }
    },

    forceReveal: (reason?: string) => {
      generation += 1
      restoreAppliedGeneration = -1
      reveal(reason ?? 'forced')
    },

    isHolding: () => isHidden,

    dispose: () => {
      cancelScheduled()
      stopWatching()
      commitListeners.clear()
      setHidden(false)
    },
  }
}
