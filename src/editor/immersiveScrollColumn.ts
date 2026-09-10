/**
 * Geometry for immersive mode's grid scrollbar: the edit view's scroll track
 * drawn into the box grid itself (CM6Editor.tsx), because in immersive mode
 * there is no app grid left to hold the ordinary track, and the infinity grid
 * is everything. Pure, so the rules are tested rather than reasoned about
 * (immersiveScrollColumn.test.ts).
 *
 * The scrollbar LOGIC is the ordinary one -- thumb size from the text, click
 * travels, hold snaps, the bridged-journey stretch -- working in pixels
 * against whichever track element is mounted. Only the drawing is the grid's:
 * the thumb's pixel span is turned into whole rows here, and those boxes are
 * coloured.
 */

/**
 * The width reserved at the grid's right edge for its columns.
 *
 * Whole box columns plus the cut-off sliver past the last full one: the grid's
 * box columns are phase-anchored from the LEFT (half a box in), never
 * corrected against the right edge, so the right edge almost always falls
 * mid-box. Reserving the columns PLUS that remainder puts the reserved
 * region's left edge exactly on a real box boundary, with the sliver left
 * empty at the far right. The editor's text is padded out of the whole region,
 * so nothing ever wraps under a column.
 *
 * Columns, reading right to left from the last full box column: the scroll
 * column (immersive mode), then -- only when both are on -- one empty column,
 * then the review-flag column.
 */
export function computeRightEdgeReservePx(
  measuredWidthPx: number,
  cellWidthPx: number,
  columns: { reviewFlags: boolean; scrollColumn: boolean },
): number {
  const count = (columns.reviewFlags ? 1 : 0)
    + (columns.scrollColumn ? 1 : 0)
    + (columns.reviewFlags && columns.scrollColumn ? 1 : 0)
  if (count === 0 || cellWidthPx <= 0) return 0
  const halfCellWidthPx = Math.round(cellWidthPx / 2)
  const remainderPx = (((measuredWidthPx - halfCellWidthPx) % cellWidthPx) + cellWidthPx) % cellWidthPx
  return count * cellWidthPx + remainderPx
}

/**
 * The scroll column's left edge, given where the reserved region starts.
 *
 * The region opens with the review-flag column when flags are on, so the
 * scroll column sits two boxes further right -- past the flags and the one
 * empty box between them -- which makes it the last full box column either way.
 */
export function resolveScrollColumnLeftPx(regionLeftPx: number, cellWidthPx: number, reviewFlags: boolean): number {
  return regionLeftPx + (reviewFlags ? 2 * cellWidthPx : 0)
}

/**
 * The rows of the track a thumb span colours.
 *
 * The span is in pixels, measured from the track's top, exactly as the
 * ordinary scrollbar computes it (including mid-journey, when it stretches).
 * Its size becomes a whole number of rows -- never fewer than one, which keeps
 * the thumb's size steady while it moves. Its start is the row nearest the
 * span's top, but never so far off that the band misses the row holding the
 * span's CENTRE; then it is kept inside the track.
 *
 * Why both rules, when each alone looks sufficient:
 * - Nearest-row start alone can drop the very box a click was on: a click
 *   centres the thumb on itself, and a 1.4-row thumb clicked near the top of a
 *   box starts nearest the box ABOVE, colouring only that one.
 * - Centring on the centre row alone fails at the ends: a thumb pinned against
 *   the top of the track has its centre below the clicked box (a 2.4-row thumb
 *   clicked in the first box centres in the second), and a band centred there
 *   leaves the first box out.
 * Nearest start kept within reach of the centre satisfies both: away from the
 * ends the centre IS the click; pinned at an end, the nearest start is the end
 * itself, and the band runs from there past the centre, over the click. The
 * test pins this down across random clicks, sizes and tracks.
 */
export function snapThumbSpanToRows(
  topPx: number,
  heightPx: number,
  rowHeightPx: number,
  totalRows: number,
): { startRow: number; rows: number } {
  if (!(rowHeightPx > 0) || totalRows <= 0 || !(heightPx > 0)) return { startRow: 0, rows: 0 }
  const rows = Math.min(totalRows, Math.max(1, Math.round(heightPx / rowHeightPx)))
  const centerRow = Math.floor((topPx + heightPx / 2) / rowHeightPx)
  const nearestStartRow = Math.round(topPx / rowHeightPx)
  const startRowCoveringCenter = Math.min(centerRow, Math.max(centerRow - rows + 1, nearestStartRow))
  const startRow = Math.min(totalRows - rows, Math.max(0, startRowCoveringCenter))
  return { startRow, rows }
}
