// Asking the worker for a note's block map, with the main thread as the
// fallback rather than as the plan.
//
// ## One worker, kept
//
// The texture worker is created and terminated per image, which is right for
// something generated once on a settings change. This one is asked on every
// cold note open, and spinning up a module worker means parsing and
// instantiating remark again each time -- more than the parse it is there to
// move. So it is created on first use and kept.
//
// ## A reply is matched, not assumed
//
// Every request carries an id and every reply is matched against the request
// still outstanding for that text. Two large notes opened in quick succession
// otherwise resolve in whatever order the worker finishes them, and the
// second note gets the first note's block map -- which is not a slow note, it
// is a caret in the wrong place.
//
// ## The fallback is silent and correct
//
// Where a worker cannot be constructed at all -- an environment without them,
// a bundler that did not emit the chunk, a CSP that refuses it -- this runs
// the same pure function on the main thread. That is exactly today's
// behaviour, so the fallback is a slow path rather than a broken one, and it
// is what keeps this testable without a worker harness.

import { splitMarkdownIntoPreviewBlocksIncremental, restorePreviewBlockSplitCacheFromRanges, type PreviewBlockSplitCache } from './PreviewBlockSplit'
import type { PreviewBlockSplitRangesMessage, PreviewBlockSplitRequest } from './blockSplitMessages'

type Pending = { resolve: (cache: PreviewBlockSplitCache) => void; text: string }

let worker: Worker | null | undefined
let nextRequestId = 1
const pending = new Map<number, Pending>()

function ensureWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    const created = new Worker(new URL('./blockSplit.worker.ts', import.meta.url), { type: 'module' })
    created.onmessage = (event: MessageEvent<PreviewBlockSplitRangesMessage>) => {
      const { id, ranges } = event.data
      const request = pending.get(id)
      if (!request) return
      pending.delete(id)
      request.resolve(restorePreviewBlockSplitCacheFromRanges(request.text, ranges))
    }
    created.onerror = () => {
      // One failure retires the worker for the session: whatever broke it is
      // not going to be better on the next note, and every request from here
      // takes the main-thread path rather than hanging on a dead port.
      for (const [, request] of pending) {
        request.resolve(splitMarkdownIntoPreviewBlocksIncremental(request.text, null))
      }
      pending.clear()
      worker = null
    }
    worker = created
  } catch {
    worker = null
  }
  return worker
}

/**
 * The full block map for `text`, parsed off the main thread where possible.
 *
 * Always resolves -- there is no error path a caller could do anything useful
 * with, since the answer is derivable here too, just slowly.
 */
export function requestFullBlockSplit(text: string): Promise<PreviewBlockSplitCache> {
  const active = ensureWorker()
  if (!active) return Promise.resolve(splitMarkdownIntoPreviewBlocksIncremental(text, null))

  const id = nextRequestId
  nextRequestId += 1
  return new Promise<PreviewBlockSplitCache>((resolve) => {
    pending.set(id, { resolve, text })
    const request: PreviewBlockSplitRequest = { id, text }
    active.postMessage(request)
  })
}
