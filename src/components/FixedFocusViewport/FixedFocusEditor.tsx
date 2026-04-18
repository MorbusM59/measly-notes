/**
 * FixedFocusEditor: React component for the three-zone fixed viewport editor.
 *
 * Architecture:
 * - Model manages all state (text, viewport, caret)
 * - Component renders three hard-clipped zones from model state
 * - Center zone is the only editable area (textarea)
 * - Top/bottom are display-only divs
 */

import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { FixedFocusViewportModel } from './viewportModel';
import { WrappedLine, findRowForCharIndex } from './textWrapping';
import { ComputedMetrics } from './lineMetrics';
import './FixedFocusEditor.scss';

let gridMeasurementContext: CanvasRenderingContext2D | null = null;
const charWidthCache = new Map<string, number>();
const SPACE_MARKER = '\u00B7';

interface IndentHighlight {
  topPx: number;
  widthPx: number;
}

interface FixedFocusEditorProps {
  text: string;
  caretPos: number;
  fontSizePx: number;
  spacingPreset: string;
  fontFamily?: string;
  horizontalPaddingPx?: number;
  topRowCount?: number;
  bottomRowCount?: number;
  minCenterRowCount?: number;
  containerWidthPx?: number;
  containerHeightPx?: number;
  viewportStartRow?: number;
  onViewportStartRowChange?: (nextViewportStartRow: number) => void;
  onTopRowCountChange?: (nextTopRowCount: number) => void;
  onBottomRowCountChange?: (nextBottomRowCount: number) => void;
  onTextChange: (newText: string, newCaretPos: number) => void;
  onCaretChange?: (newCaretPos: number) => void;
  textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  textareaClassName?: string;
  textareaStyle?: React.CSSProperties;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onKeyUp?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCopy?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart?: React.CompositionEventHandler<HTMLTextAreaElement>;
  onCompositionEnd?: React.CompositionEventHandler<HTMLTextAreaElement>;
}

// ─────────────────────────────────────────────────────────────────────────────

export const FixedFocusEditor: React.FC<FixedFocusEditorProps> = ({
  text,
  caretPos,
  fontSizePx,
  spacingPreset,
  fontFamily = '"Syne Mono", Menlo, Monaco, monospace',
  horizontalPaddingPx = 20,
  topRowCount,
  bottomRowCount,
  minCenterRowCount = 1,
  containerWidthPx = 500,
  containerHeightPx = 400,
  viewportStartRow,
  onViewportStartRowChange,
  onTopRowCountChange,
  onBottomRowCountChange,
  onTextChange,
  onCaretChange,
  textareaRef,
  textareaClassName,
  textareaStyle,
  placeholder,
  onKeyDown,
  onKeyUp,
  onCopy,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
}) => {
  const [uncontrolledViewportStartRow, setUncontrolledViewportStartRow] = useState(0);
  const [uncontrolledTopRowCount, setUncontrolledTopRowCount] = useState(topRowCount ?? 3);
  const [uncontrolledBottomRowCount, setUncontrolledBottomRowCount] = useState(bottomRowCount ?? 3);
  const [activeResizeHandle, setActiveResizeHandle] = useState<'top' | 'bottom' | null>(null);
  const [resizeAnchorViewportStartRow, setResizeAnchorViewportStartRow] = useState<number | null>(null);
  const centerInputRef = useRef<HTMLTextAreaElement>(null);
  const resizeStateRef = useRef<{
    handle: 'top' | 'bottom';
    startY: number;
    startTopRowCount: number;
    startBottomRowCount: number;
    totalVisibleRows: number;
  } | null>(null);
  const latestEffectiveViewportStartRowRef = useRef(0);
  const centerStartRow = viewportStartRow ?? uncontrolledViewportStartRow;
  const resolvedTopRowCount = topRowCount ?? uncontrolledTopRowCount;
  const resolvedBottomRowCount = bottomRowCount ?? uncontrolledBottomRowCount;
  const contentWidthPx = Math.max(1, containerWidthPx - (horizontalPaddingPx * 2));
  const topInsetPx = Math.max(0, computeTopInsetPx(spacingPreset));
  const drawableHeightPx = Math.max(1, containerHeightPx - topInsetPx);
  const charCellWidthPx = useMemo(
    () => measureMonospaceCellWidthPx(fontSizePx, fontFamily),
    [fontFamily, fontSizePx]
  );

  const setViewportStartRow = useCallback((nextViewportStartRow: number | ((prev: number) => number)) => {
    const resolvedNextRow = typeof nextViewportStartRow === 'function'
      ? nextViewportStartRow(centerStartRow)
      : nextViewportStartRow;
    const clampedNextRow = Math.max(0, resolvedNextRow);
    if (viewportStartRow === undefined) {
      setUncontrolledViewportStartRow(clampedNextRow);
    }
    onViewportStartRowChange?.(clampedNextRow);
  }, [centerStartRow, onViewportStartRowChange, viewportStartRow]);

  const setTopZoneRowCount = useCallback((nextTopRowCount: number) => {
    const clampedTopRowCount = Math.max(0, Math.floor(nextTopRowCount));
    if (topRowCount === undefined) {
      setUncontrolledTopRowCount(clampedTopRowCount);
    }
    onTopRowCountChange?.(clampedTopRowCount);
  }, [onTopRowCountChange, topRowCount]);

  const setBottomZoneRowCount = useCallback((nextBottomRowCount: number) => {
    const clampedBottomRowCount = Math.max(0, Math.floor(nextBottomRowCount));
    if (bottomRowCount === undefined) {
      setUncontrolledBottomRowCount(clampedBottomRowCount);
    }
    onBottomRowCountChange?.(clampedBottomRowCount);
  }, [bottomRowCount, onBottomRowCountChange]);

  useEffect(() => {
    if (!textareaRef) return;
    textareaRef.current = centerInputRef.current;
  }, [textareaRef]);

  // Build model for zone slicing + layout; viewport driven entirely by centerStartRow state
  const model = useMemo(() => {
    const m = new FixedFocusViewportModel(
      fontSizePx,
      spacingPreset,
      contentWidthPx,
      drawableHeightPx,
      fontFamily,
      resolvedTopRowCount,
      resolvedBottomRowCount
    );
    m.setText(text, contentWidthPx);
    return m;
  }, [
    text,
    fontSizePx,
    spacingPreset,
    contentWidthPx,
    drawableHeightPx,
    centerStartRow,
    fontFamily,
    resolvedTopRowCount,
    resolvedBottomRowCount,
  ]);

  const wrappedLines = model.getWrappedLines();
  const provisionalViewport = model.getViewport();
  const caretRow = findRowForCharIndex(caretPos, wrappedLines);

  const maxStart = Math.max(0, wrappedLines.length - provisionalViewport.centerRowCount);
  const maxViewportStartRow = Math.max(0, wrappedLines.length - 1);
  const clampedCenterStartRow = Math.max(0, Math.min(centerStartRow, maxViewportStartRow));
  let effectiveCenterStartRow = activeResizeHandle && resizeAnchorViewportStartRow != null
    ? Math.max(0, Math.min(resizeAnchorViewportStartRow, maxViewportStartRow))
    : clampedCenterStartRow;
  if (!activeResizeHandle) {
    if (caretRow < effectiveCenterStartRow) {
      effectiveCenterStartRow = caretRow;
    } else if (caretRow >= effectiveCenterStartRow + provisionalViewport.centerRowCount) {
      effectiveCenterStartRow = Math.min(
        maxViewportStartRow,
        caretRow - provisionalViewport.centerRowCount + 1
      );
    }
  }

  model.setViewportStartRow(effectiveCenterStartRow);

  const metrics = model.getMetrics();
  const layout = model.getLayout();
  const viewport = model.getViewport();
  const topRows = model.getTopZoneRows();
  const centerRows = model.getCenterZoneRows();
  const bottomRows = model.getBottomZoneRows();
  const totalVisibleRows = viewport.topRowCount + viewport.centerRowCount + viewport.bottomRowCount;

  // Keep maxStart fresh for use inside the stable wheel listener
  const maxStartRef = useRef(maxStart);

  useEffect(() => {
    maxStartRef.current = maxStart;
  }, [maxStart]);

  useEffect(() => {
    latestEffectiveViewportStartRowRef.current = effectiveCenterStartRow;
  }, [effectiveCenterStartRow]);

  const finishResize = useCallback(() => {
    setViewportStartRow(latestEffectiveViewportStartRowRef.current);
    resizeStateRef.current = null;
    setResizeAnchorViewportStartRow(null);
    setActiveResizeHandle(null);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, [setViewportStartRow]);

  const handleResizeMove = useCallback((event: PointerEvent) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState) return;

    const deltaRows = Math.round((event.clientY - resizeState.startY) / metrics.rowHeightPx);
    if (resizeState.handle === 'top') {
      const maxTopRowCount = Math.max(0, resizeState.totalVisibleRows - minCenterRowCount - resizeState.startBottomRowCount);
      setTopZoneRowCount(Math.max(0, Math.min(maxTopRowCount, resizeState.startTopRowCount + deltaRows)));
      return;
    }

    const maxBottomRowCount = Math.max(0, resizeState.totalVisibleRows - minCenterRowCount - resizeState.startTopRowCount);
    setBottomZoneRowCount(Math.max(0, Math.min(maxBottomRowCount, resizeState.startBottomRowCount - deltaRows)));
  }, [metrics.rowHeightPx, minCenterRowCount, setBottomZoneRowCount, setTopZoneRowCount]);

  useEffect(() => {
    if (!activeResizeHandle) return;

    const handlePointerUp = () => finishResize();
    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handleResizeMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [activeResizeHandle, finishResize, handleResizeMove]);

  // Keep the browser's own textarea scrolling disabled and sync viewport to the caret
  // when edits like Enter move it outside the visible center zone.
  useEffect(() => {
    const ta = centerInputRef.current;
    if (ta) {
      if (ta.scrollTop !== 0) ta.scrollTop = 0;
      if (ta.scrollLeft !== 0) ta.scrollLeft = 0;
    }

    if (ta && (ta.selectionStart !== caretPos || ta.selectionEnd !== caretPos)) {
      ta.setSelectionRange(caretPos, caretPos);
    }
  }, [caretPos]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.currentTarget.value;
    const newCaretPos = e.currentTarget.selectionStart ?? 0;
    onTextChange(newText, newCaretPos);
  };

  // Track caret changes from mouse clicks / selection
  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const newCaretPos = e.currentTarget.selectionStart ?? 0;
    if (newCaretPos !== caretPos) {
      onCaretChange?.(newCaretPos);
    }
  };

  const getRowAlignedCaretPos = (targetRow: number) => {
    const safeSourceRowIndex = Math.max(0, Math.min(caretRow, wrappedLines.length - 1));
    const safeTargetRowIndex = Math.max(0, Math.min(targetRow, wrappedLines.length - 1));
    const sourceRow = wrappedLines[safeSourceRowIndex];
    const target = wrappedLines[safeTargetRowIndex];
    if (!sourceRow || !target) return caretPos;

    const caretCol = caretPos - sourceRow.startCharIndex;
    const targetRowLen = target.endCharIndex - target.startCharIndex;
    return target.startCharIndex + Math.min(caretCol, targetRowLen);
  };

  // Register non-passive wheel listener once so we can call preventDefault.
  // (React's synthetic onWheel cannot preventDefault on passive listeners.)
  useEffect(() => {
    const ta = centerInputRef.current;
    if (!ta) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      const scrollCeiling = Math.max(maxStartRef.current, effectiveCenterStartRow);
      const nextViewportStartRow = Math.max(0, Math.min(scrollCeiling, effectiveCenterStartRow + dir));
      if (nextViewportStartRow === effectiveCenterStartRow) return;

      setViewportStartRow(nextViewportStartRow);

      const nextVisibleStart = nextViewportStartRow;
      const nextVisibleEnd = nextViewportStartRow + viewport.centerRowCount - 1;
      if (caretRow < nextVisibleStart) {
        onCaretChange?.(getRowAlignedCaretPos(nextVisibleStart));
      } else if (caretRow > nextVisibleEnd) {
        onCaretChange?.(getRowAlignedCaretPos(nextVisibleEnd));
      }
    };
    ta.addEventListener('wheel', onWheel, { passive: false });
    return () => ta.removeEventListener('wheel', onWheel);
  }, [effectiveCenterStartRow, viewport.centerRowCount, caretRow, onCaretChange, wrappedLines, caretPos]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.shiftKey || e.ctrlKey || e.altKey)) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const caretRow = findRowForCharIndex(caretPos, wrappedLines);
        if (caretRow > 0) {
          const prevRow = caretRow - 1;
          const caretCol = caretPos - wrappedLines[caretRow].startCharIndex;
          const prevRowLen = wrappedLines[prevRow].endCharIndex - wrappedLines[prevRow].startCharIndex;
          const newCaretPos = wrappedLines[prevRow].startCharIndex + Math.min(caretCol, prevRowLen);
          onCaretChange?.(newCaretPos);
          if (prevRow < centerStartRow) {
            setViewportStartRow(row => Math.max(0, row - 1));
          }
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const caretRow = findRowForCharIndex(caretPos, wrappedLines);
        if (caretRow < wrappedLines.length - 1) {
          const nextRow = caretRow + 1;
          const caretCol = caretPos - wrappedLines[caretRow].startCharIndex;
          const nextRowLen = wrappedLines[nextRow].endCharIndex - wrappedLines[nextRow].startCharIndex;
          const newCaretPos = wrappedLines[nextRow].startCharIndex + Math.min(caretCol, nextRowLen);
          onCaretChange?.(newCaretPos);
          if (nextRow >= effectiveCenterStartRow + viewport.centerRowCount) {
            setViewportStartRow(row => Math.min(Math.max(maxStartRef.current, row), row + 1));
          }
        }
        return;
      }
    }

    onKeyDown?.(e);
  };

  const startResize = (handle: 'top' | 'bottom') => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStateRef.current = {
      handle,
      startY: event.clientY,
      startTopRowCount: viewport.topRowCount,
      startBottomRowCount: viewport.bottomRowCount,
      totalVisibleRows,
    };
    setResizeAnchorViewportStartRow(effectiveCenterStartRow);
    setActiveResizeHandle(handle);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
  };

  // Translate the textarea vertically so that row `centerStartRow` aligns with
  // the top of the center zone. The parent div clips via overflow:hidden.
  const textareaTopPx = -(effectiveCenterStartRow * metrics.rowHeightPx);
  const textareaHeightPx = Math.max(
    layout.centerHeightPx,
    wrappedLines.length * metrics.rowHeightPx
  );
  const topRowsInsetPx = Math.max(0, layout.topHeightPx - (topRows.length * metrics.rowHeightPx));
  const dividerOffsetPx = metrics.rowGapPx > 0 ? Math.floor(metrics.rowGapPx / 2) : 0;
  const topDividerTopPx = Math.max(0, Math.round(topInsetPx + layout.topHeightPx - dividerOffsetPx));
  const bottomDividerTopPx = Math.max(0, Math.round(topInsetPx + layout.topHeightPx + layout.centerHeightPx - dividerOffsetPx));
  const indentHighlights = useMemo(() => {
    const highlights: IndentHighlight[] = [];
    const appendZoneHighlights = (rows: WrappedLine[], zoneTopPx: number, insetTopPx = 0) => {
      rows.forEach((row, rowIndex) => {
        if (!row.isLineStart) return;
        const rowText = text.slice(row.startCharIndex, row.endCharIndex);
        const indentCellCount = countLeadingIndentCells(rowText);
        if (indentCellCount <= 0) return;

        highlights.push({
          topPx: zoneTopPx + insetTopPx + (rowIndex * metrics.rowHeightPx),
          widthPx: indentCellCount * charCellWidthPx,
        });
      });
    };

    appendZoneHighlights(topRows, 0, topRowsInsetPx);
    appendZoneHighlights(centerRows, layout.topHeightPx);
    appendZoneHighlights(bottomRows, layout.topHeightPx + layout.centerHeightPx);

    return highlights;
  }, [
    bottomRows,
    centerRows,
    charCellWidthPx,
    layout.centerHeightPx,
    layout.topHeightPx,
    metrics.rowHeightPx,
    text,
    topRows,
    topRowsInsetPx,
  ]);

  return (
    <div
      className="fixed-focus-editor"
      style={{
        display: 'flex',
        position: 'relative',
        height: `${containerHeightPx}px`,
        width: `${containerWidthPx}px`,
        fontFamily,
        fontSize: `${fontSizePx}px`,
        overflow: 'hidden',
      }}
    >
      <div
        className="fixed-focus-editor-content"
        style={{
          position: 'absolute',
          top: `${topInsetPx}px`,
          left: 0,
          right: 0,
          height: `${drawableHeightPx}px`,
        }}
      >
        <div
          className="fixed-focus-grid-overlay"
          aria-hidden
          style={{
            '--grid-row-height': `${metrics.rowHeightPx}px`,
            '--grid-column-width': `${charCellWidthPx}px`,
            '--grid-horizontal-offset': `${horizontalPaddingPx}px`,
          } as React.CSSProperties}
        />

        <div className="fixed-focus-indent-overlay" aria-hidden>
          {indentHighlights.map((highlight, index) => (
            <div
              key={`${highlight.topPx}-${highlight.widthPx}-${index}`}
              className="indent-highlight"
              style={{
                top: `${highlight.topPx}px`,
                left: `${horizontalPaddingPx}px`,
                width: `${highlight.widthPx}px`,
                height: `${metrics.rowHeightPx}px`,
              }}
            />
          ))}
        </div>

        {/* Top Zone (display-only) */}
        {layout.topHeightPx > 0 && (
          <div
            className="zone zone-top"
            style={{
              height: `${layout.topHeightPx}px`,
              overflow: 'hidden',
            }}
          >
            <MirroredTextLayer
              text={text}
              metrics={metrics}
              totalWrappedRowCount={wrappedLines.length}
              visibleHeightPx={layout.topHeightPx}
              startRow={Math.max(0, effectiveCenterStartRow - topRows.length)}
              insetTopPx={Math.max(0, layout.topHeightPx - (topRows.length * metrics.rowHeightPx))}
              horizontalPaddingPx={horizontalPaddingPx}
              textareaClassName={textareaClassName}
              textareaStyle={textareaStyle}
            />
          </div>
        )}

        {/* Center Zone (editable textarea, no scroll) */}
        <div
          className="zone zone-center"
          style={{
            height: `${layout.centerHeightPx}px`,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <textarea
            ref={centerInputRef}
            className={textareaClassName ? `zone-textarea ${textareaClassName}` : 'zone-textarea'}
            value={text}
            onChange={handleInput}
            onSelect={handleSelect}
            onKeyDown={handleKeyDown}
            onKeyUp={onKeyUp}
            onCopy={onCopy}
            onPaste={onPaste}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            placeholder={placeholder}
            style={{
              position: 'absolute',
              top: `${textareaTopPx}px`,
              left: 0,
              width: '100%',
              height: `${textareaHeightPx}px`,
              fontSize: `${fontSizePx}px`,
              lineHeight: `${metrics.rowHeightPx}px`,
              padding: `0 ${horizontalPaddingPx}px`,
              margin: 0,
              border: 'none',
              resize: 'none',
              outline: 'none',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
              overflow: 'hidden',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              ...textareaStyle,
            }}
          />
        </div>

        {/* Bottom Zone (display-only) */}
        {layout.bottomHeightPx > 0 && (
          <div
            className="zone zone-bottom"
            style={{
              height: `${layout.bottomHeightPx}px`,
              overflow: 'hidden',
            }}
          >
            <MirroredTextLayer
              text={text}
              metrics={metrics}
              totalWrappedRowCount={wrappedLines.length}
              visibleHeightPx={layout.bottomHeightPx}
              startRow={effectiveCenterStartRow + viewport.centerRowCount}
              insetTopPx={0}
              horizontalPaddingPx={horizontalPaddingPx}
              textareaClassName={textareaClassName}
              textareaStyle={textareaStyle}
            />
          </div>
        )}
      </div>

      <div
        className={`zone-divider zone-divider-top${activeResizeHandle === 'top' ? ' is-active' : ''}`}
        style={{ top: `${topDividerTopPx}px` }}
        onPointerDown={startResize('top')}
      />

      <div
        className={`zone-divider zone-divider-bottom${activeResizeHandle === 'bottom' ? ' is-active' : ''}`}
        style={{ top: `${bottomDividerTopPx}px` }}
        onPointerDown={startResize('bottom')}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

interface MirroredTextLayerProps {
  text: string;
  metrics: ComputedMetrics;
  totalWrappedRowCount: number;
  visibleHeightPx: number;
  startRow: number;
  insetTopPx?: number;
  horizontalPaddingPx?: number;
  textareaClassName?: string;
  textareaStyle?: React.CSSProperties;
}

const MirroredTextLayer: React.FC<MirroredTextLayerProps> = ({
  text,
  metrics,
  totalWrappedRowCount,
  visibleHeightPx,
  startRow,
  insetTopPx = 0,
  horizontalPaddingPx = 20,
  textareaClassName,
  textareaStyle,
}) => (
  <div
    style={{
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}
  >
    <textarea
      aria-hidden
      readOnly
      tabIndex={-1}
      className={textareaClassName ? `zone-textarea ${textareaClassName}` : 'zone-textarea'}
      value={text}
      style={{
        position: 'absolute',
        top: `${insetTopPx - (startRow * metrics.rowHeightPx)}px`,
        left: 0,
        width: '100%',
        height: `${Math.max(visibleHeightPx, totalWrappedRowCount * metrics.rowHeightPx)}px`,
        fontSize: 'inherit',
        lineHeight: `${metrics.rowHeightPx}px`,
        padding: `0 ${horizontalPaddingPx}px`,
        margin: 0,
        border: 'none',
        resize: 'none',
        outline: 'none',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        wordWrap: 'break-word',
        pointerEvents: 'none',
        userSelect: 'none',
        ...textareaStyle,
      }}
    />
  </div>
);

export default FixedFocusEditor;

function computeTopInsetPx(spacingPreset: string): number {
  return 15;
}

function getGridMeasurementContext(): CanvasRenderingContext2D | null {
  if (gridMeasurementContext) return gridMeasurementContext;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  gridMeasurementContext = canvas.getContext('2d');
  return gridMeasurementContext;
}

function measureMonospaceCellWidthPx(fontSizePx: number, fontFamily: string): number {
  const cacheKey = `${fontSizePx}px|${fontFamily}`;
  const cached = charWidthCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const ctx = getGridMeasurementContext();
  if (!ctx) {
    const fallback = Math.max(1, Math.round(fontSizePx * 0.6));
    charWidthCache.set(cacheKey, fallback);
    return fallback;
  }

  ctx.font = `${fontSizePx}px ${fontFamily}`;
  const width = ctx.measureText('M').width;
  const measured = Math.max(1, Math.round(width * 1000) / 1000);
  charWidthCache.set(cacheKey, measured);
  return measured;
}

function countLeadingIndentCells(text: string): number {
  let indentCellCount = 0;
  for (const char of text) {
    if (char === SPACE_MARKER || char === ' ') {
      indentCellCount += 1;
      continue;
    }
    if (char === '\t') {
      indentCellCount += 3;
      continue;
    }
    break;
  }
  return indentCellCount;
}

