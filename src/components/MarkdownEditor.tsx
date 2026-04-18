import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Note } from '../shared/types';
import { FixedFocusEditor } from './FixedFocusViewport';
import './MarkdownEditor.scss';
import './MarkdownThemes.scss';

interface MarkdownEditorProps {
  note: Note | null;
  onNoteUpdate?: (note: Note) => void;
  showPreview: boolean;
  onTogglePreview: (next: boolean) => void;
  hasAnyNotes?: boolean;
}

type EditState = {
  selectionStart: number;
  scrollTop: number;
  viewportStartRow?: number;
};

const EDIT_STATE_KEY_PREFIX = 'md-edit-state-';

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ note, onNoteUpdate, showPreview, onTogglePreview, hasAnyNotes }) => {
  const [content, setContent] = useState('');
  const [caretPos, setCaretPos] = useState(0);
  const [editViewportStartRow, setEditViewportStartRow] = useState(0);
  const [editorViewportSize, setEditorViewportSize] = useState({ width: 0, height: 0 });
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [fixedFocusTopRowCount, setFixedFocusTopRowCount] = useState(3);
  const [fixedFocusBottomRowCount, setFixedFocusBottomRowCount] = useState(3);
  const isComposingRef = useRef(false);
  const [isOnFirstLine, setIsOnFirstLine] = useState(false);

  // View (preview) settings
  const [viewStyle, setViewStyle] = useState<string>('modern');
  const [viewFontSize, setViewFontSize] = useState<string>('m');
  const [viewSpacing, setViewSpacing] = useState<string>('cozy');

  // Editor settings (separate from view)
  const [editorStyle, setEditorStyle] = useState<string>('syne');
  const [editorFontSize, setEditorFontSize] = useState<string>('m');
  const [editorSpacing, setEditorSpacing] = useState<string>('cozy');

  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editorContentRef = useRef<HTMLDivElement | null>(null);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef('');
  const lastSavedTitleRef = useRef('');
  const currentNoteIdRef = useRef<number | null>(null);

  // Short-lived UI timeouts that should be cleared on unmount
  const loadNoteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRestoreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce for selection save
  const selectionSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track all transient timeouts so they can be cleared on unmount
  const pendingTimeoutsRef = useRef<number[]>([]);
  const programmaticInsertRef = useRef(false);

  const scheduleTimeout = (cb: () => void, ms: number) => {
    const id = window.setTimeout(cb, ms);
    pendingTimeoutsRef.current.push(id as unknown as number);
    return id;
  };

  const setTextareaSelection = useCallback((start: number, end = start) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.setSelectionRange(start, end);
    setCaretPos(start);
  }, []);

  // Editor style options — Syne and Red Hat (display labels simplified).
  const editorStyleOptions: { key: string; label: string; family: string }[] = [
    { key: 'syne', label: 'Syne', family: "'Syne Mono', 'Menlo', 'Monaco', monospace" },
    { key: 'redhat', label: 'Red Hat', family: "'Red Hat Mono', 'Menlo', 'Monaco', monospace" },
  ];

  const getEditorFamily = (styleKey: string): string => {
    const opt = editorStyleOptions.find(o => o.key === styleKey);
    return opt ? opt.family : editorStyleOptions[0].family;
  };

  const getPrimaryFamily = (fontFamilyValue: string | null | undefined): string | null => {
    if (!fontFamilyValue) return null;
    const first = fontFamilyValue.split(',')[0].trim();
    return first.replace(/^['"]|['"]$/g, '') || null;
  };

  const normalizeForChecks = (s: string) => s || '';
  const countLeadingSpaces = (s: string) => {
    const m = (s || '').match(/^ */);
    return m ? m[0].length : 0;
  };
  const stripTrailingWhitespace = (s: string) => {
    if (!s) return s;
    return s.replace(/[ \t]+$/, '');
  };

  // Helpers to persist per-note edit state
  const getEditStateKey = (noteId: number) => `${EDIT_STATE_KEY_PREFIX}${noteId}`;

  const saveEditState = async (noteId: number) => {
    const ta = textareaRef.current;
    const editorContent = editorContentRef.current;
    if (!ta || !editorContent) return;
    const persistedViewportStartRow = showPreview ? 0 : editViewportStartRow;
    const state: EditState = {
      selectionStart: ta.selectionStart,
      scrollTop: showPreview ? editorContent.scrollTop : persistedViewportStartRow,
      viewportStartRow: persistedViewportStartRow,
    };
    try {
      // persist to DB via preload API (best-effort)
      try {
        await window.electronAPI.saveNoteUiState(noteId, {
          cursorPos: state.selectionStart,
          scrollTop: state.scrollTop,
          progressEdit: showPreview
            ? (editorContent.scrollHeight > editorContent.clientHeight ? editorContent.scrollTop / (editorContent.scrollHeight - editorContent.clientHeight) : 0)
            : 0,
        });
      } catch (err) { console.warn('saveNoteUiState failed', err); }
    } catch {
      // ignore
    }

    try {
      localStorage.setItem(getEditStateKey(noteId), JSON.stringify(state));
    } catch {
      // ignore storage errors
    }
  };

  const loadEditState = async (noteId: number): Promise<EditState | null> => {
    try {
      try {
        const st = await window.electronAPI.getNoteUiState(noteId);
        if (st && (st.cursorPos != null || st.scrollTop != null)) {
          return {
            selectionStart: (st.cursorPos ?? 0),
            scrollTop: (st.scrollTop ?? 0),
            viewportStartRow: (st.scrollTop ?? 0),
          };
        }
      } catch (err) { console.warn('loadNote failed to provide content', err); }

      const raw = localStorage.getItem(getEditStateKey(noteId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as EditState;
      return parsed;
    } catch {
      return null;
    }
  };

  // When entering view mode, clear any pending autosave so nothing runs during preview.
  useEffect(() => {
    if (showPreview) {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
      // Save edit state when we enter preview so it can be restored when returning to edit.
      if (note?.id != null) void saveEditState(note.id);
    } else {
      // when entering edit mode, attempt to restore scroll/selection (handled in note load or note-change flow)
      if (previewRestoreTimeoutRef.current) {
        clearTimeout(previewRestoreTimeoutRef.current);
        previewRestoreTimeoutRef.current = null;
      }
      previewRestoreTimeoutRef.current = scheduleTimeout(async () => {
        const ta = textareaRef.current;
        const editorContent = editorContentRef.current;
        if (!ta || !editorContent || !note) return;
        const st = await loadEditState(note.id);
        if (st) {
          setTextareaSelection(st.selectionStart, st.selectionStart);
          setEditViewportStartRow(st.viewportStartRow ?? st.scrollTop ?? 0);
          if (showPreview) editorContent.scrollTop = st.scrollTop;
        }
        // ensure proper sizing and visibility
        autosizeTextarea(ta);
        ensureCaretVisible();
      }, 0) as unknown as ReturnType<typeof setTimeout>;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview]);

  // Load note content when note changes
  useEffect(() => {
    if (note) {
      if (currentNoteIdRef.current === note.id) {
        lastSavedTitleRef.current = note.title;
        return;
      }

      currentNoteIdRef.current = note.id;
      window.electronAPI.loadNote(note.id).then(noteContent => {
        lastSavedContentRef.current = noteContent;
        setContent(noteContent);
        lastSavedTitleRef.current = note.title;
        setEditViewportStartRow(0);
        setCaretPos(0);

        // Focus & position cursor for edit mode
        if (!showPreview) {
          if (loadNoteTimeoutRef.current) {
            clearTimeout(loadNoteTimeoutRef.current);
            loadNoteTimeoutRef.current = null;
          }
          loadNoteTimeoutRef.current = scheduleTimeout(async () => {
            const textarea = textareaRef.current;
            const editorContent = editorContentRef.current;
            if (textarea) {
              // restore edit state if available
              const st = await loadEditState(note.id);
              if (st) {
                textarea.focus();
                setTextareaSelection(st.selectionStart, st.selectionStart);
                setEditViewportStartRow(st.viewportStartRow ?? st.scrollTop ?? 0);
                if (editorContent && showPreview) {
                  editorContent.scrollTop = st.scrollTop;
                }
              } else {
                // default behavior: put cursor at end or after '# '
                textarea.focus();
                if (noteContent === '# ') {
                  setTextareaSelection(2, 2);
                } else {
                  setTextareaSelection((noteContent || '').length, (noteContent || '').length);
                }
              }
              autosizeTextarea(textarea);
              ensureCaretVisible();
            }
          }, 10) as unknown as ReturnType<typeof setTimeout>;
        }
      }).catch(err => {
        console.warn('loadNote failed', err);
      });
    } else {
      setContent('');
      lastSavedContentRef.current = '';
      lastSavedTitleRef.current = '';
      currentNoteIdRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);

  // If switched to edit mode, focus textarea (restore handled elsewhere)
  useEffect(() => {
    if (!showPreview) {
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
        focusTimeoutRef.current = null;
      }
      focusTimeoutRef.current = scheduleTimeout(() => textareaRef.current?.focus(), 10) as unknown as ReturnType<typeof setTimeout>;
    }
  }, [showPreview]);

  // Load and persist view/editor settings.
  useEffect(() => {
    const savedViewStyle = localStorage.getItem('markdown-view-style');
    const savedViewFontSize = localStorage.getItem('markdown-view-font-size') || localStorage.getItem('markdown-font-size');
    const savedViewSpacing = localStorage.getItem('markdown-view-spacing') || localStorage.getItem('markdown-spacing');

    const savedEditorStyle = localStorage.getItem('markdown-editor-style');
    const savedEditorFontSize = localStorage.getItem('markdown-editor-font-size');
    const savedEditorSpacing = localStorage.getItem('markdown-editor-spacing');
    const savedFixedFocusTopRowCount = localStorage.getItem('markdown-editor-fixed-focus-top-rows');
    const savedFixedFocusBottomRowCount = localStorage.getItem('markdown-editor-fixed-focus-bottom-rows');

    if (savedViewStyle) setViewStyle(savedViewStyle);
    if (savedViewFontSize) setViewFontSize(savedViewFontSize);
    if (savedViewSpacing) setViewSpacing(savedViewSpacing);

    if (savedEditorStyle) setEditorStyle(savedEditorStyle);
    if (savedEditorFontSize) setEditorFontSize(savedEditorFontSize);
    if (savedEditorSpacing) setEditorSpacing(savedEditorSpacing);
    if (savedFixedFocusTopRowCount) {
      const parsedTopRowCount = Number(savedFixedFocusTopRowCount);
      if (Number.isFinite(parsedTopRowCount) && parsedTopRowCount >= 0) {
        setFixedFocusTopRowCount(Math.floor(parsedTopRowCount));
      }
    }
    if (savedFixedFocusBottomRowCount) {
      const parsedBottomRowCount = Number(savedFixedFocusBottomRowCount);
      if (Number.isFinite(parsedBottomRowCount) && parsedBottomRowCount >= 0) {
        setFixedFocusBottomRowCount(Math.floor(parsedBottomRowCount));
      }
    }
  }, []);

  // View handlers
  const handleViewStyleChange = (style: string) => {
    setViewStyle(style);
    localStorage.setItem('markdown-view-style', style);
  };
  const handleViewFontSizeChange = (size: string) => {
    setViewFontSize(size);
    localStorage.setItem('markdown-view-font-size', size);
  };
  const handleViewSpacingChange = (spacingValue: string) => {
    setViewSpacing(spacingValue);
    localStorage.setItem('markdown-view-spacing', spacingValue);
  };

  // Editor handlers
  const handleEditorStyleChange = (style: string) => {
    setEditorStyle(style);
    localStorage.setItem('markdown-editor-style', style);
  };
  const handleEditorFontSizeChange = (size: string) => {
    setEditorFontSize(size);
    localStorage.setItem('markdown-editor-font-size', size);
  };
  const handleEditorSpacingChange = (spacingValue: string) => {
    setEditorSpacing(spacingValue);
    localStorage.setItem('markdown-editor-spacing', spacingValue);
  };
  const handleFixedFocusTopRowCountChange = (rowCount: number) => {
    setFixedFocusTopRowCount(rowCount);
    localStorage.setItem('markdown-editor-fixed-focus-top-rows', String(rowCount));
  };
  const handleFixedFocusBottomRowCountChange = (rowCount: number) => {
    setFixedFocusBottomRowCount(rowCount);
    localStorage.setItem('markdown-editor-fixed-focus-bottom-rows', String(rowCount));
  };

  // Preload the selected editor font so switching between edit/view is immediate.
  useEffect(() => {
    const family = getEditorFamily(editorStyle);
    const primary = getPrimaryFamily(family);
    if (!primary) return;

    try {
      if ((document as any).fonts && typeof (document as any).fonts.load === 'function') {
        void (document as any).fonts.load(`12px "${primary}"`).catch((err: any) => { console.warn('fonts.load failed', err); });
      }
    } catch (err) {
      // ignore
    }
  }, [editorStyle]);

  // Autosize helper: set textarea height to its content height.
  const autosizeTextarea = useCallback((ta?: HTMLTextAreaElement | null) => {
    if (!showPreview) return;
    const el = ta ?? textareaRef.current;
    const editorContent = editorContentRef.current;
    if (!el) return;
    // preserve scrollTop of the scrolling container so we don't jump
    const prevScrollTop = editorContent ? editorContent.scrollTop : 0;

    // Reset so scrollHeight is measured correctly
    el.style.height = 'auto';
    // Add a small fudge to avoid cutting off last line on some browsers
    const newHeight = el.scrollHeight + 2;
    el.style.height = `${newHeight}px`;

    // restore container scrollTop to previous value (keeps view stable)
    if (editorContent) {
      const maxScroll = editorContent.scrollHeight - editorContent.clientHeight;
      editorContent.scrollTop = Math.max(0, Math.min(prevScrollTop, maxScroll));
    }
  }, []);

  // Compute approximate caret Y (relative to editorContent's scrollTop)
  const getCaretApproxY = (): number | null => {
    if (!showPreview) return null;
    const ta = textareaRef.current;
    const editorContent = editorContentRef.current;
    if (!ta || !editorContent) return null;

    // Determine caret line number
    const pos = ta.selectionStart ?? 0;
    // Use ta.value (live DOM) not the React state `content`, which may be stale
    // inside programmatic-insert timeouts (old closure).
    const textUpToCursor = ta.value.substring(0, pos);
    const lineIndex = textUpToCursor.split('\n').length - 1;

    const cs = window.getComputedStyle(ta);
    // get line-height; fallback to font-size * 1.2
    let lineHeight = parseFloat(cs.lineHeight || '0');
    if (!lineHeight || Number.isNaN(lineHeight)) {
      const fontSize = parseFloat(cs.fontSize || '16');
      lineHeight = fontSize * 1.2;
    }

    // compute padding-top of textarea
    const paddingTop = parseFloat(cs.paddingTop || '0');

    // textarea offset relative to editorContent
    let textareaOffsetTop = 0;
    let node: HTMLElement | null = ta;
    while (node && node !== editorContent && node.offsetParent) {
      textareaOffsetTop += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    // caret Y within editorContent coordinate space
    const caretY = textareaOffsetTop + paddingTop + lineIndex * lineHeight;
    return caretY;
  };

  // Ensure caret is visible in editorContent. Only scroll if caret is below visible area.
  const ensureCaretVisible = () => {
    if (!showPreview) return;
    const editorContent = editorContentRef.current;
    if (!editorContent) return;
    const caretY = getCaretApproxY();
    if (caretY === null) return;

    // estimate single line height (approx)
    const ta = textareaRef.current;
    if (!ta) return;
    const cs = window.getComputedStyle(ta);
    let lineHeight = parseFloat(cs.lineHeight || '0');
    if (!lineHeight || Number.isNaN(lineHeight)) {
      const fontSize = parseFloat(cs.fontSize || '16');
      lineHeight = fontSize * 1.2;
    }

    const visibleTop = editorContent.scrollTop;
    const visibleBottom = visibleTop + editorContent.clientHeight - (lineHeight / 2);

    // If caret is above visible top -> scroll up to keep it visible at top (rare)
    if (caretY < visibleTop) {
      editorContent.scrollTop = Math.max(0, caretY - 8);
      return;
    }

    // If caret is within visible area -> do nothing (we want to keep view unchanged)
    if (caretY >= visibleTop && caretY < visibleBottom) {
      return;
    }

    // If caret is below visible area, scroll down by three lines (or to end)
    // This prevents the caret from being pushed right to the very bottom
    // where it's hard to see when typing new lines.
    const maxScroll = editorContent.scrollHeight - editorContent.clientHeight;
    const desired = editorContent.scrollTop + (lineHeight * 3);
    // Ensure we don't scroll past the max; also don't overshoot so caret becomes invisible again
    editorContent.scrollTop = Math.max(0, Math.min(desired, maxScroll));
  };

  // Run autosize when content changes or when switching to edit mode.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (!showPreview) return;

    if (!showPreview) {
      autosizeTextarea(ta);
      // ensure caret visible only if needed; skip during programmatic inserts
      if (!programmaticInsertRef.current) ensureCaretVisible();
    } else {
      // Clearing height when in preview so textarea doesn't force layout
      ta.style.height = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, showPreview, autosizeTextarea]);

  // Attach an input listener to autosize while the user types/pastes.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (!showPreview) return;
    const onInput = () => {
      autosizeTextarea(ta);
      ensureCaretVisible();
    };
    ta.addEventListener('input', onInput);
    // Ensure initial sizing
    autosizeTextarea(ta);
    return () => {
      ta.removeEventListener('input', onInput);
    };
  }, [autosizeTextarea]);

  // cursor / first line detection
  const checkCursorPosition = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = content.substring(0, cursorPos);
    const lines = textBeforeCursor.split('\n');
    setIsOnFirstLine(lines.length === 1);
  }, [content]);

  // extract title
  const extractTitle = useCallback((text: string): string => {
    const lines = text.split('\n');
    const firstLine = lines[0] || '';
    if (firstLine.startsWith('# ')) {
      return firstLine.substring(2).trim();
    }
    return 'Untitled';
  }, []);

  // autoSave (returns a promise)
  const autoSave = useCallback(async () => {
    if (!note || content == null) return;
    const diskContent = content;
    if (diskContent === lastSavedContentRef.current) return;

    const savedNote = await window.electronAPI.saveNote(note.id, diskContent);
    lastSavedContentRef.current = diskContent;

    const newTitle = extractTitle(diskContent);
    // Only notify parent about the saved note when the title actually
    // changes. Avoid writing empty titles (e.g. when content is just "# ").
    const newTitleNonEmpty = newTitle.trim();
    if (newTitle !== lastSavedTitleRef.current && newTitleNonEmpty.length > 0) {
      await window.electronAPI.updateNoteTitle(note.id, newTitle);
      lastSavedTitleRef.current = newTitle;

      if (onNoteUpdate) {
        const payload = savedNote ? { ...savedNote, title: newTitle } : { ...note, title: newTitle };
        onNoteUpdate(payload);
      }
    }
  }, [note, content, extractTitle, onNoteUpdate]);

  // Register force-save listener from preload API; accept requestId and respond when done
  useEffect(() => {
    let unsub: { unsubscribe: () => void } | null = null;
    try {
      const api = (window as any).electronAPI;
      if (api && typeof api.onForceSave === 'function') {
        unsub = api.onForceSave(async (requestId?: string) => {
          if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
            autoSaveTimeoutRef.current = null;
          }
          try {
            await autoSave();
            // Persist edit UI state (cursor/scroll) while textarea is still mounted.
            try {
              if (note?.id != null) await saveEditState(note.id);
            } catch (err) {
              console.warn('saveEditState during force-save failed', err);
            }
          } catch (err) {
            // ignore save errors; still signal completion
            console.warn('autoSave during force-save failed', err);
            } finally {
            try {
              api.forceSaveComplete?.(requestId);
            } catch (err) { console.warn('forceSaveComplete notification failed', err); }
          }
        });
      }
    } catch (err) {
      console.warn('Failed to register onForceSave:', err);
    }
    return () => {
      try { unsub?.unsubscribe(); } catch (err) { console.warn('failed to unsubscribe editor listeners', err); }
    };
  }, [autoSave, note, content]);

  // formatting detection
  const checkFormatting = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const active = new Set<string>();

    if (start === end && start === 0) {
      setActiveFormats(active);
      return;
    }

    if (start >= 2 && end <= content.length - 2) {
      if (content.substring(start - 2, start) === '**' && content.substring(end, end + 2) === '**') active.add('bold');
    }
    if (start >= 1 && end <= content.length - 1) {
      const beforeChar = content.substring(start - 1, start);
      const afterChar = content.substring(end, end + 1);
      const beforeBefore = start >= 2 ? content.substring(start - 2, start - 1) : '';
      const afterAfter = end <= content.length - 2 ? content.substring(end + 1, end + 2) : '';
      if (beforeChar === '*' && afterChar === '*' && beforeBefore !== '*' && afterAfter !== '*') active.add('italic');
    }
    if (start >= 2 && end <= content.length - 2) {
      if (content.substring(start - 2, start) === '~~' && content.substring(end, end + 2) === '~~') active.add('strikethrough');
    }
    if (start >= 1 && end <= content.length - 1) {
      if (content.substring(start - 1, start) === '`' && content.substring(end, end + 1) === '`') active.add('code');
    }

    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = content.indexOf('\n', end);
    const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;

    if (lineStart >= 4) {
      const prevLine = content.lastIndexOf('\n', lineStart - 2);
      const prevLineContent = content.substring(prevLine + 1, lineStart - 1);
      const prevLineNorm = normalizeForChecks(prevLineContent).trim();
      if (prevLineNorm === '```') {
        const nextLineStart = actualLineEnd + 1;
        const nextLineEnd = content.indexOf('\n', nextLineStart);
        const nextLineContent = content.substring(nextLineStart, nextLineEnd === -1 ? content.length : nextLineEnd);
        if (normalizeForChecks(nextLineContent).trim() === '```') active.add('codeblock');
      }
    }

    const currentLineContent = content.substring(lineStart, actualLineEnd);
    const currentLineNorm = normalizeForChecks(currentLineContent);
    if (currentLineNorm.startsWith('# ')) active.add('h1');
    else if (currentLineNorm.startsWith('## ')) active.add('h2');
    else if (currentLineNorm.startsWith('### ')) active.add('h3');
    else if (currentLineNorm.startsWith('> ')) active.add('blockquote');
    else if (currentLineNorm.match(/^- /)) active.add('bullet');
    else if (currentLineNorm.match(/^\d+\. /)) active.add('number');

    setActiveFormats(active);
  }, [content]);

  // Formatting helpers (unchanged)
  const wrapSelection = (before: string, after: string = before) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end);

    const isWrapped =
      start >= before.length &&
      end <= content.length - after.length &&
      content.substring(start - before.length, start) === before &&
      content.substring(end, end + after.length) === after;

    let newText: string;
    let newSelectionStart: number;
    let newSelectionEnd: number;

    if (isWrapped) {
      newText = content.substring(0, start - before.length) + selectedText + content.substring(end + after.length);
      newSelectionStart = start - before.length;
      newSelectionEnd = end - before.length;
    } else {
      newText = content.substring(0, start) + before + selectedText + after + content.substring(end);
      newSelectionStart = start + before.length;
      newSelectionEnd = end + before.length;
    }

    setContent(newText);
    handleContentChange(newText);

    scheduleTimeout(() => {
      textarea.focus();
      setTextareaSelection(newSelectionStart, newSelectionEnd);
      checkFormatting();
    }, 0);
  };

  const insertAtCursor = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const newText = content.substring(0, start) + text + content.substring(start);
    // mark this as a programmatic insert so autosize/ensureCaretVisible
    // triggered by the content-change effect do not run and cause jumps
    programmaticInsertRef.current = true;
    setContent(newText);
    handleContentChange(newText);
    scheduleTimeout(() => {
      textarea.focus();
      setTextareaSelection(start + text.length, start + text.length);
      autosizeTextarea(textarea);
      ensureCaretVisible();
      programmaticInsertRef.current = false;
    }, 0);
  };

  const prependToLines = (prefix: string, numbered = false) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = content.indexOf('\n', end);
    const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;
    const selectedLines = content.substring(lineStart, actualLineEnd);
    const lines = selectedLines.split('\n');

    const allHavePrefix = lines.every(line => {
      if (numbered) return line.match(/^\d+\. /);
      return line.startsWith(prefix);
    });

    let newLines: string[];
    if (allHavePrefix) {
      newLines = lines.map(line => {
        if (numbered) return line.replace(/^\d+\. /, '');
        return line.startsWith(prefix) ? line.substring(prefix.length) : line;
      });
    } else {
      newLines = lines.map((line, index) => {
        if (numbered) return `${index + 1}. ${line}`;
        return `${prefix}${line}`;
      });
    }

    const newText = content.substring(0, lineStart) + newLines.join('\n') + content.substring(actualLineEnd);
    setContent(newText);
    handleContentChange(newText);

    scheduleTimeout(() => {
      textarea.focus();
      checkFormatting();
    }, 0);
  };

  const insertHeading = (level: number) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = content.indexOf('\n', start);
    const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;
    const currentLine = content.substring(lineStart, actualLineEnd);
    const prefix = '#'.repeat(level) + ' ';
    const hasHeading = currentLine.startsWith(prefix);

    let newText: string;
    let newCursorPos: number;

    if (hasHeading) {
      newText = content.substring(0, lineStart) + currentLine.substring(prefix.length) + content.substring(actualLineEnd);
      newCursorPos = start - prefix.length;
    } else {
      let cleanLine = currentLine;
      const headingMatch = currentLine.match(/^#{1,6} /);
      if (headingMatch) cleanLine = currentLine.substring(headingMatch[0].length);
      newText = content.substring(0, lineStart) + prefix + cleanLine + content.substring(actualLineEnd);
      newCursorPos = headingMatch ? start - headingMatch[0].length + prefix.length : start + prefix.length;
    }

    setContent(newText);
    handleContentChange(newText);

    scheduleTimeout(() => {
      textarea.focus();
      setTextareaSelection(newCursorPos, newCursorPos);
      checkFormatting();
    }, 0);
  };

  // sanitize pasted text (preserve URLs)
  const sanitizePastedText = (text: string): string => {
    if (!text) return '';
    let out = text.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');
    out = out.replace(/\r\n/g, '\n');
    out = out.replace(/<\/?[^>]+(>|$)/g, '');
    return out;
  };

  const handleCopy = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = ta.value.substring(start, end);
    try {
      e.clipboardData.setData('text/plain', selected || '');
      e.preventDefault();
    } catch (err) {
      // fallback: allow normal copy
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    let plain = e.clipboardData.getData('text/plain') || '';
    if (!plain) {
      const html = e.clipboardData.getData('text/html') || '';
      if (html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        plain = tmp.textContent || tmp.innerText || '';
      }
    }
    const sanitized = sanitizePastedText(plain);
    if (sanitized) {
      insertAtCursor(sanitized);
    }
  };

  // content change handler with debounced save
  const handleContentChange = (newContent: string) => {
    setContent(newContent);

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Do not trigger autosave for programmatic edits (tab/shift-tab inserts/etc.)
    // since they do not change the note title and should not cause parent
    // menu updates. Autosave still runs for normal user edits when not on
    // the first line.
    if (!programmaticInsertRef.current && !isOnFirstLine && note && !showPreview) {
      autoSaveTimeoutRef.current = scheduleTimeout(() => {
        void autoSave();
      }, 1000) as unknown as ReturnType<typeof setTimeout>;
    }
  };

  const handleTextareaKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (!isOnFirstLine && note && content !== lastSavedContentRef.current) {
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
          autoSaveTimeoutRef.current = null;
        }
        void autoSave();
      }
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !showPreview) {
      // New behaviour:
      // - Enter: continue indentation and continue list (bullets keep '-'/'*'/'+', numbered lists increment).
      // - Shift+Enter: insert a hard break (two trailing spaces) and continue indentation, but do NOT continue list markers.
      // - Ctrl+Enter: insert a blank line and start next line with no indentation.
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const lineStart = content.lastIndexOf('\n', start - 1) + 1;
      const currentLineBeforeCursor = content.substring(lineStart, start);
      const currentLineFull = (() => {
        const lineEnd = content.indexOf('\n', lineStart);
        return lineEnd === -1 ? content.substring(lineStart) : content.substring(lineStart, lineEnd);
      })();

      const leadingWhitespace = currentLineFull.match(/^[ \t]*/)?.[0] ?? '';

      const normLine = normalizeForChecks(currentLineFull);
      const bulletMatch = normLine.match(/^\s*([-*+])\s+(.*)$/);
      const numberMatch = normLine.match(/^\s*(\d+)\.\s+(.*)$/);

      // Ctrl+Enter: insert an extra blank line and start next line without indentation
      if (e.ctrlKey || e.metaKey) {
        const trimmedBefore = stripTrailingWhitespace(currentLineBeforeCursor);
        const newText = content.substring(0, lineStart) + trimmedBefore + '\n\n' + content.substring(end);
        const newCursorPos = lineStart + trimmedBefore.length + 2; // after the two newlines
        programmaticInsertRef.current = true;
        setCaretPos(newCursorPos);
        handleContentChange(newText);
        scheduleTimeout(() => {
          textarea.focus();
          setTextareaSelection(newCursorPos, newCursorPos);
          autosizeTextarea(textarea);
          ensureCaretVisible();
          programmaticInsertRef.current = false;
        }, 0);
        return;
      }

      // Shift+Enter: hard break (two trailing spaces) + continue indentation, but DO NOT continue list markers
      if (e.shiftKey) {
        const trimmedBefore = stripTrailingWhitespace(currentLineBeforeCursor);
        const insert = '  \n' + leadingWhitespace;
        const newText = content.substring(0, lineStart) + trimmedBefore + insert + content.substring(end);
        const newCursorPos = lineStart + trimmedBefore.length + 3 + leadingWhitespace.length;
        programmaticInsertRef.current = true;
        setCaretPos(newCursorPos);
        handleContentChange(newText);
        scheduleTimeout(() => {
          textarea.focus();
          setTextareaSelection(newCursorPos, newCursorPos);
          autosizeTextarea(textarea);
          ensureCaretVisible();
          programmaticInsertRef.current = false;
        }, 0);
        return;
      }

      // Default Enter: continue list or just continue indentation
      let markerText = '';
      if (numberMatch) {
        const num = parseInt(numberMatch[1], 10) || 0;
        markerText = `${num + 1}. `;
      } else if (bulletMatch) {
        const ch = bulletMatch[1] || '-';
        markerText = `${ch} `;
      }

      const trimmedBefore = stripTrailingWhitespace(currentLineBeforeCursor);
      const insert = '\n' + leadingWhitespace + markerText;
      const newText = content.substring(0, lineStart) + trimmedBefore + insert + content.substring(end);
      const newCursorPos = lineStart + trimmedBefore.length + 1 + leadingWhitespace.length + markerText.length;
      programmaticInsertRef.current = true;
      setCaretPos(newCursorPos);
      handleContentChange(newText);
      scheduleTimeout(() => {
        textarea.focus();
        setTextareaSelection(newCursorPos, newCursorPos);
        autosizeTextarea(textarea);
        ensureCaretVisible();
        programmaticInsertRef.current = false;
      }, 0);
      return;
    }

    // Shift+Backspace: if current line is only whitespace, delete the current line
    // and move caret to end of previous line (also remove trailing spaces there).
    if (e.key === 'Backspace' && e.shiftKey && !showPreview) {
      const textarea = textareaRef.current;
      if (!textarea) return;
      // Only handle when there's no selection — otherwise leave native behavior
      if (textarea.selectionStart !== textarea.selectionEnd) return;
      const pos = textarea.selectionStart;
      const before = content.substring(0, pos);
      const after = content.substring(pos);
      const lines = content.split('\n');
      const lineIndex = before.split('\n').length - 1;
      const currentLine = lines[lineIndex] ?? '';

      // Only trigger when current line is empty or only spaces/tabs
      if (normalizeForChecks(currentLine).trim() === '') {
        e.preventDefault();
        if (lineIndex === 0) {
          // First line: remove it and place cursor at start
          const newLines = lines.slice(1);
          const newText = newLines.join('\n');
          programmaticInsertRef.current = true;
          setContent(newText);
          handleContentChange(newText);
          scheduleTimeout(() => {
            textarea.focus();
            setTextareaSelection(0, 0);
            autosizeTextarea(textarea);
            ensureCaretVisible();
            programmaticInsertRef.current = false;
          }, 0);
          return;
        }

        // Remove current empty line and trim trailing whitespace from previous line
        const prevLine = lines[lineIndex - 1] ?? '';
        const prevTrimmed = stripTrailingWhitespace(prevLine);

        const newLines = [] as string[];
        for (let i = 0; i < lines.length; i++) {
          if (i === lineIndex - 1) newLines.push(prevTrimmed);
          else if (i === lineIndex) continue; // skip current (empty) line
          else newLines.push(lines[i]);
        }

        const newText = newLines.join('\n');

        // compute new cursor position: end of the previous (trimmed) line
        let newCursorPos = 0;
        for (let i = 0; i < lineIndex - 1; i++) {
          newCursorPos += newLines[i].length + 1; // include newline
        }
        newCursorPos += prevTrimmed.length;

        programmaticInsertRef.current = true;
        setContent(newText);
        handleContentChange(newText);
        scheduleTimeout(() => {
          textarea.focus();
          setTextareaSelection(newCursorPos, newCursorPos);
          autosizeTextarea(textarea);
          ensureCaretVisible();
          programmaticInsertRef.current = false;
        }, 0);
        return;
      }
    }

    if (e.key === 'Tab' && !showPreview) {
      e.preventDefault();
      if (e.shiftKey) {
        // remove up to three leading spaces from each selected line (or from current line)
        const textarea = textareaRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const lineStart = content.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = content.indexOf('\n', end);
        const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;
        const selected = content.substring(lineStart, actualLineEnd);
        const lines = selected.split('\n');

        let pos = lineStart;
        let removedBeforeStart = 0;
        let removedBeforeEnd = 0;
        const newLines = lines.map((ln, idx) => {
          const leadLen = countLeadingSpaces(ln);
          const toRemove = Math.min(3, leadLen);
          // update removed counters relative to selection bounds
          const origLen = ln.length;
          if (start > pos) {
            const within = Math.max(0, Math.min(start - pos, origLen));
            removedBeforeStart += Math.min(toRemove, within);
          }
          if (end > pos) {
            const withinEnd = Math.max(0, Math.min(end - pos, origLen));
            removedBeforeEnd += Math.min(toRemove, withinEnd);
          }
          // advance pos: include newline for all but last line
          pos += origLen + (idx < lines.length - 1 ? 1 : 0);
          return ln.substring(toRemove);
        });

        const newText = content.substring(0, lineStart) + newLines.join('\n') + content.substring(actualLineEnd);
        // mark as programmatic change to avoid the autosize/ensureCaretVisible
        // effect from running and jumping the scroll; run manual reflow instead
        programmaticInsertRef.current = true;
        setContent(newText);
        handleContentChange(newText);

        scheduleTimeout(() => {
          textarea.focus();
          const newStart = Math.max(0, start - removedBeforeStart);
          const newEnd = Math.max(0, end - removedBeforeEnd);
          setTextareaSelection(newStart, newEnd);
          autosizeTextarea(textarea);
          checkFormatting();
          programmaticInsertRef.current = false;
        }, 0);
      } else {
        insertAtCursor('   ');
      }
    }
  };

  // selection listeners
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const handleSelectionChange = () => {
      checkCursorPosition();
      checkFormatting();
      setCaretPos(textarea.selectionStart ?? 0);

      // debounce save edit state for current note
      if (note?.id != null) {
        if (selectionSaveTimeout.current) clearTimeout(selectionSaveTimeout.current);
            selectionSaveTimeout.current = scheduleTimeout(() => {
              void saveEditState(note.id as number);
            }, 250) as unknown as ReturnType<typeof setTimeout>;
      }
    };
    textarea.addEventListener('click', handleSelectionChange);
    textarea.addEventListener('keyup', handleSelectionChange);
    textarea.addEventListener('select', handleSelectionChange);
    return () => {
      textarea.removeEventListener('click', handleSelectionChange);
      textarea.removeEventListener('keyup', handleSelectionChange);
      textarea.removeEventListener('select', handleSelectionChange);
      if (selectionSaveTimeout.current) {
        clearTimeout(selectionSaveTimeout.current);
        selectionSaveTimeout.current = null;
      }
    };
  }, [checkCursorPosition, checkFormatting, note]);

  // trigger auto-save when moving off first line
  useEffect(() => {
    if (!isOnFirstLine && note && content !== lastSavedContentRef.current) {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = scheduleTimeout(() => {
        void autoSave();
      }, 1000) as unknown as ReturnType<typeof setTimeout>;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnFirstLine, note, content]);

  // reflow after fonts arrive (helps initial wrapping)
  useEffect(() => {
    const container = editorContentRef.current;
    if (!container) return;

    const updateSize = () => {
      setEditorViewportSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    updateSize();
    const frameId = requestAnimationFrame(updateSize);
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [showPreview, note?.id]);

  useEffect(() => {
    const reflowTextarea = () => {
      if (showPreview) {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.display = 'none';
        ta.offsetHeight;
        ta.style.display = '';
        autosizeTextarea(ta);
        return;
      }

      setLayoutRevision((version) => version + 1);
    };

    if ((document as any).fonts && (document as any).fonts.ready) {
      (document as any).fonts.ready.then(() => {
        requestAnimationFrame(() => requestAnimationFrame(reflowTextarea));
      }).catch(() => {
        scheduleTimeout(reflowTextarea, 100);
      });
    } else {
      const t = scheduleTimeout(reflowTextarea, 100);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorStyle, autosizeTextarea]);

  // toolbar layout styles: two flex areas (left/right) and fixed toolbar height/line-height
  const toolbarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '44px',
    lineHeight: '44px',
    padding: '0',
    flexWrap: 'nowrap',   // prevent wrapping to next line
    overflow: 'hidden',   // clip overflow so content is cut off at the edge
  };
  const leftToolsStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: '0 0 auto',     // keep left controls visible
    minWidth: 0,
  };
  const rightToolsStyle: React.CSSProperties = {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: '0 0 auto',     // do not shrink; allow toolbar container to clip it
    overflow: 'hidden',   // clip overflowing right-side content
    whiteSpace: 'nowrap',
  };

  // Helper: map size/spacing tokens to actual values for the editor textarea
  const sizeToPx = (size: string): number => {
    switch (size) {
      case 'xs': return 12;
      case 's': return 14;
      case 'm': return 16;
      case 'l': return 18;
      case 'xl': return 20;
      default: return 16;
    }
  };
  const spacingToLineHeight = (spacingVal: string): number => {
    switch (spacingVal) {
      case 'tight': return 1.2;
      case 'compact': return 1.4;
      case 'cozy': return 1.6;
      case 'wide': return 1.8;
      default: return 1.6;
    }
  };

  // derive inline styles for editor textarea based on editor settings (kept for potential fallbacks)
  const editorInlineStyle: React.CSSProperties = {
    fontFamily: getEditorFamily(editorStyle),
    fontSize: `${sizeToPx(editorFontSize)}px`,
  };

  // cleanup
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
      if (selectionSaveTimeout.current) {
        clearTimeout(selectionSaveTimeout.current);
        selectionSaveTimeout.current = null;
      }
      if (loadNoteTimeoutRef.current) {
        clearTimeout(loadNoteTimeoutRef.current);
        loadNoteTimeoutRef.current = null;
      }
      if (previewRestoreTimeoutRef.current) {
        clearTimeout(previewRestoreTimeoutRef.current);
        previewRestoreTimeoutRef.current = null;
      }
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
        focusTimeoutRef.current = null;
      }
      // Clear any other pending timeouts scheduled via scheduleTimeout
      try {
        if (pendingTimeoutsRef.current && pendingTimeoutsRef.current.length) {
          pendingTimeoutsRef.current.forEach(id => clearTimeout(id));
          pendingTimeoutsRef.current = [];
        }
      } catch (err) {
        // ignore
      }
      if (note?.id != null) {
        if (showPreview) {
          // save preview progress
          try {
            const editorContent = editorContentRef.current;
            if (editorContent) {
              const ratio = editorContent.scrollHeight > editorContent.clientHeight ? editorContent.scrollTop / (editorContent.scrollHeight - editorContent.clientHeight) : 0;
              void window.electronAPI.saveNoteUiState(note.id, { progressPreview: ratio });
            }
          } catch (err) { console.warn('failed to restore selection after load', err); }
        } else {
          void saveEditState(note.id);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist scrolling/progress in both preview and edit modes.
  useEffect(() => {
    if (!note?.id) return;
    if (!showPreview) return;
    const id = note.id;
    let timer: NodeJS.Timeout | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const el = editorContentRef.current;
        if (!el) return;
        const ratio = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0;
        if (showPreview) {
          void window.electronAPI.saveNoteUiState(id, { progressPreview: ratio });
        } else {
          void window.electronAPI.saveNoteUiState(id, { progressEdit: ratio, cursorPos: textareaRef.current?.selectionStart ?? null, scrollTop: el.scrollTop });
        }
      }, 200);
    };

    const el = editorContentRef.current;
    if (el) {
      el.addEventListener('scroll', handler);
    }
    return () => {
      if (el) el.removeEventListener('scroll', handler);
      if (timer) clearTimeout(timer);
    };
  }, [showPreview, note?.id]);

  if (!note) {
    return (
      <div className="markdown-editor empty">
        <div className="empty-state">
          <p>{hasAnyNotes ? 'Select a note or create a new one with Ctrl+N' : 'Go ahead and create your first note with Ctrl+N.'}</p>
        </div>
      </div>
    );
  }

  // safe href check
  const isSafeHref = (href: string | undefined): boolean => {
    if (!href) return false;
    try {
      const parsed = new URL(href);
      const allowed = ['http:', 'https:', 'mailto:', 'tel:'];
      return allowed.includes(parsed.protocol);
    } catch {
      return false;
    }
  };

  return (
    <div className="markdown-editor">
      <div className="editor-toolbar" style={toolbarStyle}>
        <div style={leftToolsStyle}>
          <button
            className={`toolbar-toggle-btn ${!showPreview ? 'active' : ''}`}
            onClick={() => onTogglePreview(!showPreview)}
          >
            {showPreview ? 'Edit' : 'View'}
          </button>

          {/* left-aligned text editing tools - only in edit mode */}
          {!showPreview && (
            <div className="markdown-toolbar">
              <button className={`toolbar-btn-icon ${activeFormats.has('bold') ? 'active' : ''}`} onClick={() => wrapSelection('**')} title="Bold">
                <strong>B</strong>
              </button>
              <button className={`toolbar-btn-icon ${activeFormats.has('italic') ? 'active' : ''}`} onClick={() => wrapSelection('*')} title="Italic">
                <em>I</em>
              </button>
              <button className={`toolbar-btn-icon ${activeFormats.has('strikethrough') ? 'active' : ''}`} onClick={() => wrapSelection('~~')} title="Strikethrough">
                <span style={{ textDecoration: 'line-through' }}>S</span>
              </button>
              <span className="toolbar-divider">|</span>
              <button className={`toolbar-btn-icon ${activeFormats.has('h1') ? 'active' : ''}`} onClick={() => insertHeading(1)} title="Heading 1">H1</button>
              <button className={`toolbar-btn-icon ${activeFormats.has('h2') ? 'active' : ''}`} onClick={() => insertHeading(2)} title="Heading 2">H2</button>
              <button className={`toolbar-btn-icon ${activeFormats.has('h3') ? 'active' : ''}`} onClick={() => insertHeading(3)} title="Heading 3">H3</button>
              <span className="toolbar-divider">|</span>
              <button className="toolbar-btn-icon" onClick={() => wrapSelection('[', '](url)')} title="Link">🔗</button>
              <button className={`toolbar-btn-icon ${activeFormats.has('code') ? 'active' : ''}`} onClick={() => wrapSelection('`')} title="Inline Code">{'<>'}</button>
              <button className={`toolbar-btn-icon ${activeFormats.has('codeblock') ? 'active' : ''}`} onClick={() => wrapSelection('```\n', '\n```')} title="Code Block">{'{ }'}</button>
              <span className="toolbar-divider">|</span>
              <button className={`toolbar-btn-icon ${activeFormats.has('bullet') ? 'active' : ''}`} onClick={() => prependToLines('- ')} title="Bulleted List">≡</button>
              <button className={`toolbar-btn-icon ${activeFormats.has('number') ? 'active' : ''}`} onClick={() => prependToLines('', true)} title="Numbered List">#</button>
              <button className={`toolbar-btn-icon ${activeFormats.has('blockquote') ? 'active' : ''}`} onClick={() => prependToLines('> ')} title="Blockquote">&quot;</button>
              <button className="toolbar-btn-icon" onClick={() => insertAtCursor('\n---\n')} title="Horizontal Rule">—</button>
            </div>
          )}
        </div>

        {/* right-aligned controls — always rendered, but clipped by container when there's not enough space */}
        <div style={rightToolsStyle}>
          {showPreview ? (
            <>
              <div className="style-selector">
                <label className="selector-label">Style:</label>
                <select value={viewStyle} onChange={(e) => handleViewStyleChange(e.target.value)}>
                  <option value="modern">Modern</option>
                  <option value="narrow">Narrow</option>
                  <option value="cute">Cute</option>
                  <option value="print">Print</option>
                </select>
              </div>

              <div className="style-selector">
                <label className="selector-label">Size:</label>
                <select value={viewFontSize} onChange={(e) => handleViewFontSizeChange(e.target.value)}>
                  <option value="xs">XS</option>
                  <option value="s">S</option>
                  <option value="m">M</option>
                  <option value="l">L</option>
                  <option value="xl">XL</option>
                </select>
              </div>

              <div className="style-selector">
                <label className="selector-label">Spacing:</label>
                <select value={viewSpacing} onChange={(e) => handleViewSpacingChange(e.target.value)}>
                  <option value="tight">Tight</option>
                  <option value="compact">Compact</option>
                  <option value="cozy">Cozy</option>
                  <option value="wide">Wide</option>
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="style-selector">
                <label className="selector-label">Style:</label>
                <select value={editorStyle} onChange={(e) => handleEditorStyleChange(e.target.value)}>
                  {editorStyleOptions.map(opt => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="style-selector">
                <label className="selector-label">Size:</label>
                <select value={editorFontSize} onChange={(e) => handleEditorFontSizeChange(e.target.value)}>
                  <option value="xs">XS</option>
                  <option value="s">S</option>
                  <option value="m">M</option>
                  <option value="l">L</option>
                  <option value="xl">XL</option>
                </select>
              </div>

              <div className="style-selector">
                <label className="selector-label">Spacing:</label>
                <select value={editorSpacing} onChange={(e) => handleEditorSpacingChange(e.target.value)}>
                  <option value="tight">Tight</option>
                  <option value="compact">Compact</option>
                  <option value="cozy">Cozy</option>
                  <option value="wide">Wide</option>
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="editor-content" ref={editorContentRef} style={!showPreview ? { overflow: 'hidden' } : undefined}>
        {!showPreview ? (
          <FixedFocusEditor
            key={`${editorStyle}-${editorFontSize}-${editorSpacing}-${layoutRevision}`}
            text={content}
            caretPos={caretPos}
            fontFamily={getEditorFamily(editorStyle)}
            fontSizePx={sizeToPx(editorFontSize)}
            spacingPreset={editorSpacing}
            horizontalPaddingPx={20}
            topRowCount={fixedFocusTopRowCount}
            bottomRowCount={fixedFocusBottomRowCount}
            containerWidthPx={Math.max(1, editorViewportSize.width)}
            containerHeightPx={Math.max(1, editorViewportSize.height)}
            viewportStartRow={editViewportStartRow}
            onViewportStartRowChange={setEditViewportStartRow}
            onTopRowCountChange={handleFixedFocusTopRowCountChange}
            onBottomRowCountChange={handleFixedFocusBottomRowCountChange}
            onTextChange={(newText, newCaretPos) => {
              handleContentChange(newText);
              setCaretPos(newCaretPos);
              checkCursorPosition();
              scheduleTimeout(() => {
                const textarea = textareaRef.current;
                if (!textarea) return;
                textarea.focus();
                setTextareaSelection(newCaretPos, newCaretPos);
              }, 0);
            }}
            onCaretChange={(newCaretPos) => {
              const textarea = textareaRef.current;
              if (!textarea) return;
              setTextareaSelection(newCaretPos, newCaretPos);
              checkCursorPosition();
              checkFormatting();
            }}
            textareaRef={textareaRef}
            textareaClassName={`markdown-textarea editor-style-${editorStyle}`}
            textareaStyle={editorInlineStyle}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
            onCopy={(e) => handleCopy(e)}
            onKeyUp={handleTextareaKeyUp}
            onKeyDown={handleTextareaKeyDown}
            onPaste={handlePaste}
            placeholder={`# Note Title

Start typing your note here...`}
          />
        ) : (
          <div className={`markdown-preview style-${viewStyle} size-${viewFontSize} spacing-${viewSpacing}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ node, ...props }) => {
                  const href = (props as any).href as string | undefined;
                  const children = props.children;
                  let childText = '';
                  if (Array.isArray(children)) {
                    childText = children.map(c => (typeof c === 'string' ? c : (c && (c as any).props?.children) || '')).join('');
                  } else if (typeof children === 'string') {
                    childText = children;
                  } else if (children && (children as any).props?.children) {
                    childText = (children as any).props.children;
                  }

                  if (href && childText && childText.trim() === href.trim()) {
                    return <span>{childText}</span>;
                  }

                  if (isSafeHref(href)) {
                    return (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {props.children}
                      </a>
                    );
                  }

                  return <span>{props.children}</span>;
                }
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};