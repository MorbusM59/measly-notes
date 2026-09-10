import { describe, expect, it } from 'vitest'
import { computeRightEdgeReservePx, resolveScrollColumnLeftPx, snapThumbSpanToRows } from './immersiveScrollColumn'

// Small seeded LCG: reproducible sequences without a dependency.
const createRandom = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

describe('computeRightEdgeReservePx', () => {
  it('reserves nothing when there are no columns', () => {
    expect(computeRightEdgeReservePx(800, 11, { reviewFlags: false, scrollColumn: false })).toBe(0)
  })

  it('matches the flag-column formula it replaces when only flags are on', () => {
    for (const width of [800, 801, 805, 1333]) {
      const half = Math.round(11 / 2)
      const remainder = (((width - half) % 11) + 11) % 11
      expect(computeRightEdgeReservePx(width, 11, { reviewFlags: true, scrollColumn: false })).toBe(11 + remainder)
    }
  })

  it('always starts the reserved region on a box boundary, and makes the scroll column the last full column', () => {
    const random = createRandom(0x51de)
    for (let run = 0; run < 2000; run += 1) {
      const cell = 6 + Math.floor(random() * 20)
      const width = 300 + Math.floor(random() * 2000)
      const reviewFlags = random() < 0.5
      const reserve = computeRightEdgeReservePx(width, cell, { reviewFlags, scrollColumn: true })
      const regionLeft = width - reserve
      const half = Math.round(cell / 2)
      // The region's left edge is a real box boundary of the half-cell-phased grid.
      expect(((regionLeft - half) % cell + cell) % cell).toBe(0)
      const scrollLeft = resolveScrollColumnLeftPx(regionLeft, cell, reviewFlags)
      // Last full column: one box wide, and only the sub-box sliver after it.
      const sliver = width - (scrollLeft + cell)
      expect(sliver).toBeGreaterThanOrEqual(0)
      expect(sliver).toBeLessThan(cell)
      if (reviewFlags) {
        // Flags open the region; exactly one empty box sits between them and the scroll column.
        expect(scrollLeft - (regionLeft + cell)).toBe(cell)
      }
    }
  })
})

describe('snapThumbSpanToRows', () => {
  it('colours nothing for an empty span or track', () => {
    expect(snapThumbSpanToRows(10, 0, 20, 30)).toEqual({ startRow: 0, rows: 0 })
    expect(snapThumbSpanToRows(10, 40, 20, 0)).toEqual({ startRow: 0, rows: 0 })
  })

  it('never colours fewer than one row, nor more than the track holds', () => {
    expect(snapThumbSpanToRows(0, 3, 20, 30).rows).toBe(1)
    expect(snapThumbSpanToRows(0, 5000, 20, 30)).toEqual({ startRow: 0, rows: 30 })
  })

  it('colours the clicked box for any click, thumb size and track -- including thumbs pinned at either end', () => {
    const random = createRandom(0x7ac4)
    for (let run = 0; run < 5000; run += 1) {
      const rowHeight = 12 + Math.floor(random() * 30)
      const totalRows = 1 + Math.floor(random() * 80)
      const trackHeight = totalRows * rowHeight
      // The ordinary thumb: at least one row tall (the grid's minimum), never taller than the track.
      const thumbHeight = rowHeight + random() * (trackHeight - rowHeight)
      // A click anywhere in the track, exact to the pixel -- the upper or lower part of a box alike.
      const clickY = random() * trackHeight
      // What the scrollbar does with it: centre the thumb on the click, kept inside the track.
      const thumbTop = Math.max(0, Math.min(clickY - thumbHeight / 2, trackHeight - thumbHeight))
      const { startRow, rows } = snapThumbSpanToRows(thumbTop, thumbHeight, rowHeight, totalRows)
      const clickedRow = Math.floor(clickY / rowHeight)
      expect(clickedRow).toBeGreaterThanOrEqual(startRow)
      expect(clickedRow).toBeLessThan(startRow + rows)
      expect(startRow).toBeGreaterThanOrEqual(0)
      expect(startRow + rows).toBeLessThanOrEqual(totalRows)
    }
  })
})
