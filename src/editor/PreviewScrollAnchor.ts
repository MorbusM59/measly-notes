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
  /**
   * OUTSIDE the mounted range is not a gap, and must not be answered.
   *
   * A continuous pane mounts every block, so a line that no element spans is
   * genuinely between two neighbours and the one after it is the right
   * answer. A WINDOWED pane mounts only a moving run, so the same condition
   * usually means something else entirely: the target is not in the DOM yet.
   * Neither neighbour is then anywhere near it -- answering with the run's
   * own first or last element moves the reader by half a window.
   *
   * Measured: restoring line 197 while the window held blocks 91..108 landed
   * on the run's edge instead, and the next capture recorded a position eight
   * blocks away, which walked the note forward on every switch. Resolving
   * backwards had the same defect pointing the other way.
   *
   * So this answers null, and the caller retries. The restore already asks
   * the window to scroll to the line before looking the element up; one frame
   * later the window has mounted it and the spanning branch above answers
   * exactly. Refusing to guess is what makes the retry meaningful -- a
   * confident wrong answer is precisely what stops it from happening.
   */
  const firstEntry = sortedEntries[0]
  const lastEntry = sortedEntries[sortedEntries.length - 1]
  if (sourceLine < firstEntry.lineStart || sourceLine > lastEntry.lineEnd) {
    return null
  }

  const afterEntry = sortedEntries.find((entry) => entry.lineStart >= sourceLine)
  return afterEntry ?? null
}
