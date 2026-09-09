import { describe, expect, it } from 'vitest'
import { resolvePreviewSourceAnchorEntry } from './PreviewScrollAnchor'

describe('resolvePreviewSourceAnchorEntry', () => {
  it('prefers a block that spans the requested source line over an earlier sibling block', () => {
    const entries = [
      { element: {} as HTMLElement, line: 2, lineStart: 2, lineEnd: 8, text: 'intro' },
      { element: {} as HTMLElement, line: 10, lineStart: 10, lineEnd: 14, text: 'body' },
      { element: {} as HTMLElement, line: 15, lineStart: 15, lineEnd: 20, text: 'tail' },
    ]

    const resolved = resolvePreviewSourceAnchorEntry(entries, 12)

    expect(resolved?.text).toBe('body')
    expect(resolved?.lineStart).toBe(10)
    expect(resolved?.lineEnd).toBe(14)
  })

  it('resolves a gap FORWARD, to the next block rather than the previous one', () => {
    // This asserted the opposite until a note switch was measured walking the
    // reader one paragraph up the document every time, cumulatively. A
    // restore's line is a block's `startLine`, which sits in the gap just
    // before that block's own element -- so resolving backwards landed a
    // paragraph early, the next capture recorded the new spot, and it
    // compounded. Forward is a fixed point; backward is a walk.
    const entries = [
      { element: {} as HTMLElement, line: 2, lineStart: 2, lineEnd: 4, text: 'intro' },
      { element: {} as HTMLElement, line: 8, lineStart: 8, lineEnd: 10, text: 'body' },
    ]

    const resolved = resolvePreviewSourceAnchorEntry(entries, 6)

    expect(resolved?.text).toBe('body')
  })

  it('is a fixed point across repeated restores, which is the property that matters', () => {
    // The regression this file exists to prevent is cumulative, so the test
    // has to be cumulative too: resolving, re-capturing and resolving again
    // must not move. A single-step assertion cannot see a walk.
    const entries = [
      { element: {} as HTMLElement, line: 2, lineStart: 2, lineEnd: 4, text: 'intro' },
      { element: {} as HTMLElement, line: 8, lineStart: 8, lineEnd: 10, text: 'body' },
      { element: {} as HTMLElement, line: 14, lineStart: 14, lineEnd: 16, text: 'tail' },
    ]
    // A block whose element starts at 8 is stored as a block beginning at 7
    // (the blank line before it belongs to the block's range).
    const blockStartLineFor = (text: string | null) => (text === 'body' ? 7 : text === 'tail' ? 13 : 1)

    let line = 7
    const visited: (string | null)[] = []
    for (let round = 0; round < 4; round += 1) {
      const resolved = resolvePreviewSourceAnchorEntry(entries, line)
      visited.push(resolved?.text ?? null)
      line = blockStartLineFor(resolved?.text ?? null)
    }

    expect(visited).toEqual(['body', 'body', 'body', 'body'])
  })

  it('falls back to the last block when the line is past the end of the document', () => {
    const entries = [
      { element: {} as HTMLElement, line: 2, lineStart: 2, lineEnd: 4, text: 'intro' },
      { element: {} as HTMLElement, line: 8, lineStart: 8, lineEnd: 10, text: 'body' },
    ]

    // Nothing forward to land on, so the honest answer is the last element
    // rather than snapping the reader back to the top.
    expect(resolvePreviewSourceAnchorEntry(entries, 40)?.text).toBe('body')
  })
})
