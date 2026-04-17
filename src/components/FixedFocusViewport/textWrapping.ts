/**
 * Text wrapping engine: calculates how text wraps into visual rows
 * given a specific container width and font metrics.
 *
 * This is the core of the viewport model: it converts between
 * text positions (character offsets) and visual rows.
 */

import { ComputedMetrics } from './lineMetrics';

let measurementContext: CanvasRenderingContext2D | null = null;
const measurementCache = new Map<string, number>();

/**
 * A "wrapped row" is a visual line of text that may span multiple logical lines
 * or be only part of a logical line (if it wraps due to width).
 *
 * For simplicity in v1, we'll use a monospace-friendly approximation:
 * measure text width and estimate wrapping based on average character width.
 */

export interface WrappedLine {
  startCharIndex: number;  // position in full document
  endCharIndex: number;    // exclusive
  logicalLineIndex: number; // which \n-delimited line this came from
  isLineStart: boolean;    // true if starts at beginning of logical line
  isLineEnd: boolean;      // true if ends at end of logical line (before \n or EOF)
}

/**
 * Compute wrapped rows for a given text and container width.
 * Returns array of wrapped lines, where each represents one visual row.
 */
export function computeWrappedLines(
  text: string,
  containerWidthPx: number,
  metrics: ComputedMetrics,
  fontFamily = '"Syne Mono", Menlo, Monaco, monospace'
): WrappedLine[] {
  const lines: WrappedLine[] = [];
  const logicalLines = text.split('\n');

  let globalCharIndex = 0;

  for (let logLineIdx = 0; logLineIdx < logicalLines.length; logLineIdx++) {
    const logicalLine = logicalLines[logLineIdx];
    const lineCharCount = logicalLine.length;

    if (lineCharCount === 0) {
      // Empty logical line -> one wrapped row (the empty line itself)
      lines.push({
        startCharIndex: globalCharIndex,
        endCharIndex: globalCharIndex,
        logicalLineIndex: logLineIdx,
        isLineStart: true,
        isLineEnd: true,
      });
      globalCharIndex += 1; // account for the \n
    } else {
      // Split logical line into wrapped rows using measured text width.
      let linePos = 0;
      while (linePos < lineCharCount) {
        const rowStart = linePos;
        const maxRowEnd = findMaxFittingEnd(
          logicalLine,
          rowStart,
          containerWidthPx,
          metrics.fontSizePx,
          fontFamily
        );
        let rowEnd = maxRowEnd;

        // Prefer wrapping at whitespace to better match textarea pre-wrap behavior.
        if (maxRowEnd < lineCharCount) {
          const breakPos = findWrapBreak(logicalLine, rowStart, maxRowEnd);
          if (breakPos > rowStart) {
            rowEnd = breakPos;
          }
        }

        lines.push({
          startCharIndex: globalCharIndex + rowStart,
          endCharIndex: globalCharIndex + rowEnd,
          logicalLineIndex: logLineIdx,
          isLineStart: rowStart === 0,
          isLineEnd: rowEnd === lineCharCount,
        });

        linePos = rowEnd;
      }

      globalCharIndex += lineCharCount + 1; // include the \n
    }
  }

  return lines;
}

function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (measurementContext) return measurementContext;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  measurementContext = canvas.getContext('2d');
  return measurementContext;
}

function measureTextWidthPx(text: string, fontSizePx: number, fontFamily: string): number {
  if (text.length === 0) return 0;

  const ctx = getMeasurementContext();
  if (!ctx) {
    return text.length * fontSizePx * 0.6;
  }

  const font = `${fontSizePx}px ${fontFamily}`;
  const cacheKey = `${font}|${text}`;
  const cached = measurementCache.get(cacheKey);
  if (cached !== undefined) return cached;

  ctx.font = font;
  const width = ctx.measureText(text).width;
  measurementCache.set(cacheKey, width);
  return width;
}

function findMaxFittingEnd(
  line: string,
  rowStart: number,
  maxWidthPx: number,
  fontSizePx: number,
  fontFamily: string
): number {
  let low = rowStart + 1;
  let high = line.length;
  let best = rowStart + 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const width = measureTextWidthPx(line.slice(rowStart, mid), fontSizePx, fontFamily);
    if (width <= maxWidthPx) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function findWrapBreak(line: string, rowStart: number, maxRowEnd: number): number {
  for (let i = maxRowEnd; i > rowStart; i--) {
    const char = line[i - 1];
    if (char === ' ' || char === '\t') {
      return i;
    }
  }

  return maxRowEnd;
}

/**
 * Find which wrapped row contains the given character position.
 */
export function findRowForCharIndex(
  charIndex: number,
  wrappedLines: WrappedLine[]
): number {
  for (let i = 0; i < wrappedLines.length; i++) {
    const row = wrappedLines[i];
    if (charIndex >= row.startCharIndex && charIndex <= row.endCharIndex) {
      return i;
    }
  }
  // If not found, return last row
  return Math.max(0, wrappedLines.length - 1);
}

/**
 * Get the character range for a given wrapped row.
 */
export function getRowCharRange(
  rowIndex: number,
  wrappedLines: WrappedLine[]
): { start: number; end: number } | null {
  if (rowIndex < 0 || rowIndex >= wrappedLines.length) return null;
  const row = wrappedLines[rowIndex];
  return { start: row.startCharIndex, end: row.endCharIndex };
}

/**
 * Get total number of wrapped rows in the document.
 */
export function getTotalWrappedRows(wrappedLines: WrappedLine[]): number {
  return wrappedLines.length;
}
