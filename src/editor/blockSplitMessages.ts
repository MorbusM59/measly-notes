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
  ranges: PersistedPreviewBlockCache['ranges']
}
