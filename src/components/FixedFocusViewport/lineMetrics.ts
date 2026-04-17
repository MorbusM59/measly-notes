/**
 * Fixed-line-height metrics for deterministic text wrapping and viewport calculations.
 * All pixel values are pre-computed based on font size and spacing preset.
 */

export type SpacingPreset = 'tight' | 'compact' | 'cozy' | 'wide';

export interface LineMetrics {
  lineHeightPercent: number;  // e.g., 100, 115, 130, 150
  rowGapPx: number;           // e.g., 1, 2, 5, 10
}

export interface ComputedMetrics {
  fontSizePx: number;
  lineHeightPx: number;       // computed: fontSize * (lineHeightPercent / 100)
  rowHeightPx: number;        // lineHeight + rowGap (total height per wrapped row)
  rowGapPx: number;
}

export const PRESET_METRICS: Record<SpacingPreset, LineMetrics> = {
  tight: { lineHeightPercent: 100, rowGapPx: 1 },
  compact: { lineHeightPercent: 115, rowGapPx: 2 },
  cozy: { lineHeightPercent: 130, rowGapPx: 5 },
  wide: { lineHeightPercent: 150, rowGapPx: 10 },
};

/**
 * Compute pixel metrics from font size and spacing preset.
 */
export function computeMetrics(
  fontSizePx: number,
  spacingPreset: SpacingPreset
): ComputedMetrics {
  const preset = PRESET_METRICS[spacingPreset];
  const lineHeightPx = fontSizePx * (preset.lineHeightPercent / 100);
  const rowHeightPx = lineHeightPx + preset.rowGapPx;

  return {
    fontSizePx,
    lineHeightPx,
    rowHeightPx,
    rowGapPx: preset.rowGapPx,
  };
}

/**
 * Get font size in pixels for the editor based on size setting.
 * Maps abstract size keys to concrete px values.
 */
export function getFontSizePx(sizeKey: string): number {
  const sizes: Record<string, number> = {
    xs: 12,
    s: 14,
    m: 16,      // default
    l: 18,
    xl: 20,
  };
  return sizes[sizeKey] ?? 16;
}

/**
 * Calculate how many complete wrapped rows fit in a container of given height.
 * This respects that rows may not fill the container completely.
 */
export function rowsInHeight(heightPx: number, metrics: ComputedMetrics): number {
  if (heightPx <= 0 || metrics.rowHeightPx <= 0) return 0;
  // Integer rows that fit in the height
  return Math.floor(heightPx / metrics.rowHeightPx);
}

/**
 * Calculate pixel height needed for N complete wrapped rows.
 */
export function heightForRows(rowCount: number, metrics: ComputedMetrics): number {
  if (rowCount <= 0) return 0;
  // rowCount rows: (rowCount - 1) * rowHeight + lineHeight (last row has no gap below)
  return (rowCount - 1) * metrics.rowHeightPx + metrics.lineHeightPx;
}
