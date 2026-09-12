/// <reference lib="webworker" />

// Parsing a note's block map, off the main thread.
//
// The full split runs remark over the whole document, which is 1.6 seconds on
// a 320KB note -- and on the main thread that is 1.6 seconds of frozen app on
// the FIRST open of every large note: no scroll, no sidebar, no window
// controls, nothing. That is the moment a reader decides whether an app is
// solid, so it is the one place a spinner would be an admission rather than a
// courtesy.
//
// It is an unusually clean fit for a worker: text in, line ranges out, no
// DOM, no state, no clock. Everything about the split is already pure --
// see PreviewBlockSplit.ts -- so nothing had to be made safe to move it here.
//
// The INCREMENTAL split deliberately stays on the main thread. It reparses
// the changed span plus one neighbouring block, which is small by
// construction and needs to be synchronous to keep a keystroke's result in
// the same frame as the keystroke. Only the cold full parse comes here.

import { splitMarkdownIntoPreviewBlocksIncremental } from './PreviewBlockSplit'
import type { PreviewBlockSplitRangesMessage, PreviewBlockSplitRequest } from './blockSplitMessages'

const workerScope = self as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<PreviewBlockSplitRequest>) => {
  const { id, text } = event.data
  // Ranges only. The blocks are text slices, and shipping a second copy of
  // the whole document back across the boundary would cost more than the
  // line split that reconstitutes them on the other side.
  const { ranges } = splitMarkdownIntoPreviewBlocksIncremental(text, null)
  const response: PreviewBlockSplitRangesMessage = { id, ranges }
  workerScope.postMessage(response)
}
