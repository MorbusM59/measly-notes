export type PreviewSourceAnchorEntry = {
  element: HTMLElement
  line: number
  lineStart: number
  lineEnd: number
  text: string | null
}

export function resolvePreviewSourceAnchorEntry(
  entries: PreviewSourceAnchorEntry[],
  sourceLine: number,
): PreviewSourceAnchorEntry | null {
  if (entries.length === 0) return null

  const sortedEntries = [...entries].sort((a, b) => a.lineStart - b.lineStart)

  const spanningEntry = sortedEntries.find((entry) => entry.lineStart <= sourceLine && sourceLine <= entry.lineEnd)
  if (spanningEntry) {
    return spanningEntry
  }

  /**
   * No element covers the line, so it fell in a gap -- and which way we
   * resolve that gap decides whether a restore is stable or walks.
   *
   * FORWARD, deliberately. This used to take the nearest EARLIER element,
   * and that lost the reader a paragraph on every single note switch,
   * cumulatively, until they were back at the top of the document. The
   * mechanism, measured end to end:
   *
   *   capture   reads the element at the reference offset -- say its
   *             `data-source-line` is 94 -- and stores the BLOCK it belongs to
   *   restore   converts that block back to a line, which is the block's
   *             `startLine` (93) and is by construction <= the element's own
   *             line, so it lands in the gap before it
   *   this      resolved that gap backwards, to the PREVIOUS paragraph
   *
   * Each switch therefore landed one paragraph above where the reader left,
   * and the next capture recorded the new position, so it compounded. The
   * line moved by 2 and the scroll by ~171px per switch, which is exactly one
   * paragraph. (EditRestoreMath's `landScrollTopLines` carries a comment about
   * the same failure in the opposite direction, from a sign error; this is the
   * same class of bug at the other end of the same round trip.)
   *
   * Resolving forward converges instead: the line being restored is a block's
   * start, so the first element at or after it IS that block's element. Land
   * on it, and the next capture reads that same element, whose block start is
   * the same line again. A fixed point rather than a walk.
   */
  const afterEntry = sortedEntries.find((entry) => entry.lineStart >= sourceLine)
  if (afterEntry) {
    return afterEntry
  }

  // Only when the line is past every element -- a position at or beyond the
  // end of the document. There is nothing forward to land on, so the last
  // element is the honest answer.
  const beforeEntry = [...sortedEntries]
    .reverse()
    .find((entry) => entry.lineEnd <= sourceLine)

  if (beforeEntry) {
    return beforeEntry
  }

  return sortedEntries[0]
}
