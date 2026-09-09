// What scrolling the render view actually costs, per frame.
//
// `localStorage['thockdown:debug-frame-cost'] = '1'`, scroll, read the line
// it prints when you stop. Attaches nothing when unset.
//
// ## What this is for
//
// One decision: whether the preview can stop virtualizing and simply mount
// the whole note. The continuous path exists to be exact, and almost all of
// the machinery around it -- estimates, the measurement survey, the
// progress bar, persisted heights -- exists only because blocks that are not
// mounted still need a height. Mount everything and all of it becomes
// unnecessary.
//
// The one thing standing in the way is a measured note already in this
// codebase: leaving ~90 rendered markdown blocks in the DOM was found to cost
// "layout on every frame the reader scrolls", and unmounting them was the fix
// (usePreviewMarkdownRendering's calibration teardown). A full mount is
// several hundred. So the question is not "is a bigger DOM slower" -- it is
// "by how much, on the slowest machine this app promises to serve".
//
// ## Why frame intervals, and not a timer around anything
//
// Scroll cost does not live in any function this code could bracket. The
// work is the browser's own: layout, paint, composite, on content this app
// only supplies. The only place it becomes visible is the gap between one
// frame and the next -- so that gap is what gets recorded, and nothing else.
//
// Which means this is USELESS in the Claude Code browser pane, where nothing
// composites and requestAnimationFrame never fires (see CLAUDE.md). It has to
// be read in the real app.
//
// Reported as a distribution rather than a mean, because a mean is exactly
// the wrong summary here: scrolling that is smooth except for a hitch every
// twenty frames reads as broken, and averages that away to nothing. The p95
// and the dropped-frame count are the numbers that describe what a reader
// feels; the median only says whether the baseline is healthy.

const FRAME_COST_FLAG = 'thockdown:debug-frame-cost'
const FRAME_COST_LIMIT = 200

/** How long after the last scroll event the recording is considered over. */
const FRAME_COST_QUIET_MS = 250

/** Above this, a frame did not make its slot. 16.7ms is one frame at 60Hz; 1.5x of it is a miss nobody argues about. */
const DROPPED_FRAME_MS = 25

interface FrameCostHost {
  __previewFrameCostTrace?: string[]
}

/** Read live, not latched -- see scrollTrace.ts's isScrollTraceOn for why. */
export function isFrameCostTraceOn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(FRAME_COST_FLAG) === '1'
  } catch {
    return false
  }
}

function appendFrameCost(line: string): void {
  if (typeof window === 'undefined') return
  const host = window as unknown as FrameCostHost
  if (!host.__previewFrameCostTrace) host.__previewFrameCostTrace = []
  host.__previewFrameCostTrace.push(line)
  if (host.__previewFrameCostTrace.length > FRAME_COST_LIMIT) {
    host.__previewFrameCostTrace.splice(0, host.__previewFrameCostTrace.length - FRAME_COST_LIMIT)
  }
  console.log('[frame-cost] ' + line)
}

/** What the run should say about the document it was measured on. */
export interface FrameCostContext {
  mountedBlocks: number
  totalBlocks: number
  chars: number
  mountAll: boolean
}

export function summarizeFrameIntervals(intervalsMs: readonly number[]): {
  frames: number
  medianMs: number
  p95Ms: number
  maxMs: number
  dropped: number
} | null {
  if (intervalsMs.length === 0) return null
  const sorted = [...intervalsMs].sort((a, b) => a - b)
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
  const round = (value: number) => Math.round(value * 10) / 10
  return {
    frames: sorted.length,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(sorted[sorted.length - 1]),
    dropped: sorted.filter((interval) => interval > DROPPED_FRAME_MS).length,
  }
}

let sampling = false
let lastFrameAtMs = 0
let lastScrollAtMs = 0
let intervals: number[] = []
let frameHandle: number | null = null
let contextReader: (() => FrameCostContext) | null = null

const stop = () => {
  if (frameHandle !== null) {
    cancelAnimationFrame(frameHandle)
    frameHandle = null
  }
  sampling = false

  const summary = summarizeFrameIntervals(intervals)
  const context = contextReader?.()
  intervals = []
  contextReader = null
  if (!summary || !context) return
  // A handful of frames is a nudge, not a scroll, and its numbers are noise.
  if (summary.frames < 10) return

  appendFrameCost(
    `scroll ${context.mountAll ? 'MOUNT-ALL' : 'virtualized'}`
    + ` mounted=${context.mountedBlocks}/${context.totalBlocks} blocks chars=${context.chars}`
    + ` frames=${summary.frames} median=${summary.medianMs}ms p95=${summary.p95Ms}ms max=${summary.maxMs}ms`
    + ` dropped(>${DROPPED_FRAME_MS}ms)=${summary.dropped}`,
  )
}

const step = () => {
  frameHandle = null
  const now = performance.now()
  if (lastFrameAtMs > 0) intervals.push(now - lastFrameAtMs)
  lastFrameAtMs = now

  if (now - lastScrollAtMs > FRAME_COST_QUIET_MS) {
    stop()
    return
  }
  frameHandle = requestAnimationFrame(step)
}

/**
 * Called on every preview scroll event. Starts recording on the first one and
 * keeps going until the scrolling stops, then prints the run.
 *
 * `readContext` is called once, at the END -- the block counts are read when
 * the run is summarized rather than when it started, so a window that changed
 * mid-scroll is described by what it settled on.
 */
export function noteFrameCostScroll(readContext: () => FrameCostContext): void {
  if (!isFrameCostTraceOn()) return
  lastScrollAtMs = performance.now()
  contextReader = readContext
  if (sampling) return
  sampling = true
  lastFrameAtMs = 0
  intervals = []
  frameHandle = requestAnimationFrame(step)
}
