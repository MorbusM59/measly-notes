// The worker boundary's vocabulary, in a module neither side owns -- so the
// worker does not import the client and the client does not import the
// worker's implementation.

import type { PersistedPreviewBlockCache } from '../shared/noteLifecycle'

export interface PreviewBlockSplitRequest {
  /** Correlates a reply with its request; a stale reply is dropped, not applied. */
  id: number
  text: string
}

export interface PreviewBlockSplitRangesMessage {
  id: number
  /**
   * The ranges finished since this id's previous message, in document order
   * -- a DELTA, not the running total. Resending everything each time would
   * make the boundary cost O(n log n) in a document's ranges for no reason;
   * the client accumulates.
   */
  ranges: PersistedPreviewBlockCache['ranges']
  /**
   * The last message for this id. Only then do the accumulated ranges tile
   * the whole document, which is what makes the result safe to persist and
   * to use as the incremental path's base.
   */
  done: boolean
}
