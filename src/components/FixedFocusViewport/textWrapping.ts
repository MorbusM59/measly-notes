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

// ---- Per-logical-line wrap cache ------------------------------------------------
// Caches the visual row layout (relative offsets) for each unique combination of
// (lineText × containerWidth × font). On a typical keypress only ONE logical line
// changes, so every other line is an O(1) cache hit instead of a full measurement.

interface RelativeRowSpan {
  startOffset: number;  // offset from the start of the logical line
  endOffset: number;
  isLineStart: boolean;
  isLineEnd: boolean;
}

const lineWrapCache = new Map<string, RelativeRowSpan[]>();
const MAX_LINE_WRAP_CACHE_SIZE = 2000;

function makeLineWrapKey(
  lineText: string,
  containerWidthPx: number,
  fontSizePx: number,
  fontFamily: string,
  charCellWidthPx: number | undefined,
): string {
  const cellStr = charCellWidthPx != null ? charCellWidthPx.toFixed(4) : '';
  return `${containerWidthPx.toFixed(2)}|${fontSizePx}|${cellStr}|${fontFamily}|${lineText}`;
}
// ---------------------------------------------------------------------------------

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
 *
 * @param charCellWidthPx - When provided (DOM-measured), used directly for column
 *   calculation instead of canvas measurement. This ensures the wrap model is
 *   consistent with the browser's actual text layout.
 */
export function computeWrappedLines(
  text: string,
  containerWidthPx: number,
  metrics: ComputedMetrics,
  fontFamily = '"Syne Mono", Menlo, Monaco, monospace',
  charCellWidthPx?: number
): WrappedLine[] {
  const lines: WrappedLine[] = [];
  const logicalLines = text.split('\n');

  let globalCharIndex = 0;

  for (let logLineIdx = 0; logLineIdx < logicalLines.length; logLineIdx++) {
    const logicalLine = logicalLines[logLineIdx];

    // Use cached per-line spans — only the edited line is a cache miss.
    const spans = computeLineSpans(logicalLine, containerWidthPx, metrics, fontFamily, charCellWidthPx);

    for (const span of spans) {
      lines.push({
        startCharIndex: globalCharIndex + span.startOffset,
        endCharIndex: globalCharIndex + span.endOffset,
        logicalLineIndex: logLineIdx,
        isLineStart: span.isLineStart,
        isLineEnd: span.isLineEnd,
      });
    }

    globalCharIndex += logicalLine.length + 1; // +1 for the \n separator
  }

  return lines;
}

/**
 * Compute (and cache) the visual row layout for a single logical line.
 * Returns relative offsets; the caller translates them to absolute char indices.
 */
function computeLineSpans(
  logicalLine: string,
  containerWidthPx: number,
  metrics: ComputedMetrics,
  fontFamily: string,
  charCellWidthPx: number | undefined,
): RelativeRowSpan[] {
  const cacheKey = makeLineWrapKey(logicalLine, containerWidthPx, metrics.fontSizePx, fontFamily, charCellWidthPx);
  const cached = lineWrapCache.get(cacheKey);
  if (cached) return cached;

  const spans: RelativeRowSpan[] = [];
  const lineCharCount = logicalLine.length;

  if (lineCharCount === 0) {
    // Empty logical line → one wrapped row (the empty line itself).
    spans.push({ startOffset: 0, endOffset: 0, isLineStart: true, isLineEnd: true });
  } else {
    let linePos = 0;
    while (linePos < lineCharCount) {
      const rowStart = linePos;
      const maxRowEnd = findMaxFittingEnd(
        logicalLine,
        rowStart,
        containerWidthPx,
        metrics.fontSizePx,
        fontFamily,
        charCellWidthPx
      );
      let rowEnd = maxRowEnd;

      // Prefer wrapping at whitespace while keeping wrapped rows free from
      // leading spaces. When a boundary space would be the first char on the
      // next row, move the entire trailing word to the next row as well.
      if (maxRowEnd < lineCharCount) {
        const charAtBoundary = logicalLine[maxRowEnd];
        const isBoundaryWhitespace = charAtBoundary === ' ' || charAtBoundary === '\t';
        if (isBoundaryWhitespace) {
          const trailingWordStart = findWordStartBeforeIndex(logicalLine, rowStart, maxRowEnd);
          if (trailingWordStart > rowStart) {
            rowEnd = trailingWordStart;
          }
        } else {
          const breakPos = findWrapBreak(logicalLine, rowStart, maxRowEnd);
          if (breakPos > rowStart) {
            rowEnd = breakPos;
          }
        }
      }

      spans.push({
        startOffset: rowStart,
        endOffset: rowEnd,
        isLineStart: rowStart === 0,
        isLineEnd: rowEnd === lineCharCount,
      });

      linePos = rowEnd;
    }
  }

  if (lineWrapCache.size >= MAX_LINE_WRAP_CACHE_SIZE) {
    const firstKey = lineWrapCache.keys().next().value;
    if (firstKey !== undefined) lineWrapCache.delete(firstKey);
  }
  lineWrapCache.set(cacheKey, spans);
  return spans;
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
  fontFamily: string,
  charCellWidthPx?: number
): number {
  // When a DOM-measured cell width is provided, iterate through characters
  // counting visual cells (accounting for tabs = 3 cells, others = 1 cell).
  if (charCellWidthPx && charCellWidthPx > 0) {
    const maxCells = Math.floor(maxWidthPx / charCellWidthPx);
    let cellsUsed = 0;

    for (let i = rowStart; i < line.length; i++) {
      const char = line[i];
      const cellsForChar = char === '\t' ? 3 : 1;
      if (cellsUsed + cellsForChar > maxCells) {
        return i;
      }
      cellsUsed += cellsForChar;
    }

    return line.length;
  }

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

function findWordStartBeforeIndex(line: string, rowStart: number, index: number): number {
  let cursor = index - 1;
  while (cursor >= rowStart) {
    const char = line[cursor];
    if (char === ' ' || char === '\t') {
      return cursor + 1;
    }
    cursor -= 1;
  }

  return rowStart;
}

/**
 * Find which wrapped row contains the given character position.
 */
export function findRowForCharIndex(
  charIndex: number,
  wrappedLines: WrappedLine[]
): number {
  if (wrappedLines.length === 0) return 0;

  let low = 0;
  let high = wrappedLines.length - 1;
  let candidate = high;

  // Find first row whose end boundary is >= charIndex.
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const row = wrappedLines[mid];
    if (charIndex <= row.endCharIndex) {
      candidate = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  // Shared boundary between wrapped rows belongs to the previous visual row.
  // This keeps Home/End behavior stable on upper wrapped rows while preserving
  // a single caret index representation.
  for (let i = candidate; i < wrappedLines.length; i += 1) {
    const row = wrappedLines[i];

    if (charIndex < row.startCharIndex) {
      return i;
    }

    if (charIndex <= row.endCharIndex) {
      return i;
    }
  }

  return wrappedLines.length - 1;
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
