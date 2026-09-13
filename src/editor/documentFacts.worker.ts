/// <reference lib="webworker" />

// Facts derived from a note's whole text, computed off the main thread.
//
// Every one of these is a full remark parse of the document -- 1.6 seconds on
// a 320KB note, sixteen on a 2MB one. On the main thread that is a frozen
// app: no scroll, no sidebar, no window controls. That is the moment a reader
// decides whether an app is solid, so it is the one place a spinner would be
// an admission rather than a courtesy.
//
// They are an unusually clean fit for a worker: text in, small answers out,
// no DOM, no state, no clock. Everything here is already pure -- see
// PreviewBlockSplit.ts and PreviewVisibleText.ts -- so nothing had to be made
// safe to move it.
//
// The INCREMENTAL split deliberately stays on the main thread. It reparses
// the changed span plus one neighbouring block, which is small by
// construction and needs to be synchronous to keep a keystroke's result in
// the same frame as the keystroke. Only whole-document work comes here.

import { splitPreviewBlockRangesProgressively } from './PreviewBlockSplit'
import { buildPreviewVisibleDocumentFindHits } from './FindReplaceEngine'
import type {
  DocumentFactsRequest,
  DocumentFactsResponse,
} from './documentFactsMessages'

const workerScope = self as DedicatedWorkerGlobalScope

function handleSplit(id: number, text: string): void {
  // Ranges only. The blocks are text slices, and shipping a second copy of
  // the whole document back across the boundary would cost more than the
  // line split that reconstitutes them on the other side.
  //
  // Sent in order and in pieces, smallest first: a reader waiting on a 2MB
  // note should get the top of it in a few milliseconds rather than the
  // whole of it in seconds. See splitPreviewBlockRangesProgressively for why
  // a chunk discards its own last range and why the windows double.
  for (const ranges of splitPreviewBlockRangesProgressively(text)) {
    const partial: DocumentFactsResponse = { kind: 'split', id, ranges, done: false }
    workerScope.postMessage(partial)
  }
  // A separate terminal message rather than a flag on the last chunk: the
  // generator cannot know which chunk is last until it has tried to produce
  // another, and an empty message costs nothing next to the parse.
  const complete: DocumentFactsResponse = { kind: 'split', id, ranges: [], done: true }
  workerScope.postMessage(complete)
}

function handleFind(id: number, text: string, query: string, caseSensitive: boolean): void {
  // The projection this builds is memoized inside PreviewVisibleText, so a
  // second query against the same note is a string scan rather than a parse.
  // That memo is the reason searching feels instant after the first term --
  // and, when it lived on the main thread and held exactly one document, the
  // reason switching notes and coming back froze the app all over again.
  const hits = buildPreviewVisibleDocumentFindHits(text, query, caseSensitive)
  const response: DocumentFactsResponse = { kind: 'find', id, hits }
  workerScope.postMessage(response)
}

workerScope.onmessage = (event: MessageEvent<DocumentFactsRequest>) => {
  const request = event.data
  if (request.kind === 'split') {
    handleSplit(request.id, request.text)
    return
  }
  handleFind(request.id, request.text, request.query, request.caseSensitive)
}
