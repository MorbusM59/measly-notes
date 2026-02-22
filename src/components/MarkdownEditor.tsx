import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Note } from '../shared/types';
import './MarkdownEditor.scss';
import './MarkdownThemes.scss';

interface MarkdownEditorProps {
  note: Note | null;
  onNoteUpdate?: (note: Note) => void;
  showPreview: boolean;
  onTogglePreview: (next: boolean) => void;
}

type EditState = {
  selectionStart: number;
  scrollTop: number;
};

const EDIT_STATE_KEY_PREFIX = 'md-edit-state-';

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ note, onNoteUpdate, showPreview, onTogglePreview }) => {
  const [content, setContent] = useState('');
  const [isOnFirstLine, setIsOnFirstLine] = useState(false);

  // View (preview) settings
  const [viewStyle, setViewStyle] = useState<string>('clean');
  const [viewFontSize, setViewFontSize] = useState<string>('m');
  const [viewSpacing, setViewSpacing] = useState<string>('cozy');

  // Editor settings (separate from view)
  const [editorStyle, setEditorStyle] = useState<string>('syne');
  const [editorFontSize, setEditorFontSize] = useState<string>('m');
  const [editorSpacing, setEditorSpacing] = useState<string>('cozy');

  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editorContentRef = useRef<HTMLDivElement | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef('');
  const lastSavedTitleRef = useRef('');
  const currentNoteIdRef = useRef<number | null>(null);

  // Debounce for selection save
  const selectionSaveTimeout = useRef<NodeJS.Timeout | null>(null);

  // Editor style options — Syne and Red Hat.
  const editorStyleOptions: { key: string; label: string; family: string }[] = [
    { key: 'syne', label: 'Syne Mono', family: "'Syne Mono', 'Menlo', 'Monaco', monospace" },
    { key: 'redhat', label: 'Red Hat Mono', family: "'Red Hat Mono', 'Menlo', 'Monaco', monospace" },
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

  // Helpers to persist per-note edit state
  const getEditStateKey = (noteId: number) => `${EDIT_STATE_KEY_PREFIX}${noteId}`;

  const saveEditState = async (noteId: number) => {
    const ta = textareaRef.current;
    const editorContent = editorContentRef.current;
    if (!ta || !editorContent) return;
    const state: EditState = {
      selectionStart: ta.selectionStart,
      scrollTop: editorContent.scrollTop,
    };
    try {
      // persist to DB via preload API (best-effort)
      try { await window.electronAPI.saveNoteUiState(noteId, { cursorPos: state.selectionStart, scrollTop: state.scrollTop, progressEdit: (editorContent.scrollHeight > editorContent.clientHeight ? editorContent.scrollTop / (editorContent.scrollHeight - editorContent.clientHeight) : 0) }); } catch {}
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
          return { selectionStart: (st.cursorPos ?? 0), scrollTop: (st.scrollTop ?? 0) };
        }
      } catch {}

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
      setTimeout(async () => {
        const ta = textareaRef.current;
        const editorContent = editorContentRef.current;
        if (!ta || !editorContent || !note) return;
        const st = await loadEditState(note.id);
        if (st) {
          ta.selectionStart = ta.selectionEnd = st.selectionStart;
          editorContent.scrollTop = st.scrollTop;
        }
        // ensure proper sizing and visibility
        autosizeTextarea(ta);
        ensureCaretVisible();
      }, 0);
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
        setContent(noteContent);
        lastSavedContentRef.current = noteContent;
        lastSavedTitleRef.current = note.title;

        // Focus & position cursor for edit mode
        if (!showPreview) {
          setTimeout(async () => {
            const textarea = textareaRef.current;
            const editorContent = editorContentRef.current;
            if (textarea) {
              // restore edit state if available
              const st = await loadEditState(note.id);
              if (st) {
                textarea.focus();
                textarea.setSelectionRange(st.selectionStart, st.selectionStart);
                if (editorContent) {
                  editorContent.scrollTop = st.scrollTop;
                }
              } else {
                // default behavior: put cursor at end or after '# '
                textarea.focus();
                if (noteContent === '# ') {
                  textarea.setSelectionRange(2, 2);
                } else {
                  textarea.setSelectionRange((noteContent || '').length, (noteContent || '').length);
                }
              }
              autosizeTextarea(textarea);
              ensureCaretVisible();
            }
          }, 10);
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
      setTimeout(() => textareaRef.current?.focus(), 10);
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

    if (savedViewStyle) setViewStyle(savedViewStyle);
    if (savedViewFontSize) setViewFontSize(savedViewFontSize);
    if (savedViewSpacing) setViewSpacing(savedViewSpacing);

    if (savedEditorStyle) setEditorStyle(savedEditorStyle);
    if (savedEditorFontSize) setEditorFontSize(savedEditorFontSize);
    if (savedEditorSpacing) setEditorSpacing(savedEditorSpacing);
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

  // Preload the selected editor font so switching between edit/view is immediate.
  useEffect(() => {
    const family = getEditorFamily(editorStyle);
    const primary = getPrimaryFamily(family);
    if (!primary) return;

    try {
      if ((document as any).fonts && typeof (document as any).fonts.load === 'function') {
        void (document as any).fonts.load(`12px "${primary}"`).catch(() => {});
      }
    } catch (err) {
      // ignore
    }
  }, [editorStyle]);

  // Autosize helper: set textarea height to its content height.
  const autosizeTextarea = useCallback((ta?: HTMLTextAreaElement | null) => {
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
    const ta = textareaRef.current;
    const editorContent = editorContentRef.current;
    if (!ta || !editorContent) return null;

    // Determine caret line number
    const pos = ta.selectionStart ?? 0;
    const textUpToCursor = content.substring(0, pos);
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
    const editorContent = editorContentRef.current;
    if (!editorContent) return;
    const caretY = getCaretApproxY();
    if (caretY === null) return;

    const visibleTop = editorContent.scrollTop;
    const visibleBottom = visibleTop + editorContent.clientHeight;
    // estimate single line height (approx)
    const ta = textareaRef.current;
    if (!ta) return;
    const cs = window.getComputedStyle(ta);
    let lineHeight = parseFloat(cs.lineHeight || '0');
    if (!lineHeight || Number.isNaN(lineHeight)) {
      const fontSize = parseFloat(cs.fontSize || '16');
      lineHeight = fontSize * 1.2;
    }

    // If caret is above visible top -> scroll up to keep it visible at top (rare)
    if (caretY < visibleTop) {
      editorContent.scrollTop = Math.max(0, caretY - 8);
      return;
    }

    // If caret is within visible area -> do nothing (we want to keep view unchanged)
    if (caretY >= visibleTop && caretY < visibleBottom) {
      return;
    }

    // If caret is below visible area, scroll so caret is one line above bottom
    const target = Math.max(0, Math.round(caretY - (editorContent.clientHeight - Math.round(lineHeight) - 8)));
    editorContent.scrollTop = target;
  };

  // Run autosize when content changes or when switching to edit mode.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    if (!showPreview) {
      autosizeTextarea(ta);
      // ensure caret visible only if needed
      ensureCaretVisible();
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
    if (content === lastSavedContentRef.current) return;

    const savedNote = await window.electronAPI.saveNote(note.id, content);
    lastSavedContentRef.current = content;

    const newTitle = extractTitle(content);
    if (newTitle !== lastSavedTitleRef.current && newTitle !== 'Untitled') {
      await window.electronAPI.updateNoteTitle(note.id, newTitle);
      lastSavedTitleRef.current = newTitle;

      if (onNoteUpdate) {
        if (savedNote) onNoteUpdate(savedNote);
        else onNoteUpdate({ ...note, title: newTitle });
      }
    } else {
      if (onNoteUpdate && savedNote) onNoteUpdate(savedNote);
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
              // non-fatal
            }
          } catch (err) {
            // ignore save errors; still signal completion
            console.warn('autoSave during force-save failed', err);
          } finally {
            try {
              api.forceSaveComplete?.(requestId);
            } catch (_) {}
          }
        });
      }
    } catch (err) {
      console.warn('Failed to register onForceSave:', err);
    }
    return () => {
      try { unsub?.unsubscribe(); } catch {}
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
      if (prevLineContent.trim() === '```') {
        const nextLineStart = actualLineEnd + 1;
        const nextLineEnd = content.indexOf('\n', nextLineStart);
        const nextLineContent = content.substring(nextLineStart, nextLineEnd === -1 ? content.length : nextLineEnd);
        if (nextLineContent.trim() === '```') active.add('codeblock');
      }
    }

    const currentLineContent = content.substring(lineStart, actualLineEnd);
    if (currentLineContent.startsWith('# ')) active.add('h1');
    else if (currentLineContent.startsWith('## ')) active.add('h2');
    else if (currentLineContent.startsWith('### ')) active.add('h3');
    else if (currentLineContent.startsWith('> ')) active.add('blockquote');
    else if (currentLineContent.match(/^- /)) active.add('bullet');
    else if (currentLineContent.match(/^\d+\. /)) active.add('number');

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

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newSelectionStart, newSelectionEnd);
      checkFormatting();
    }, 0);
  };

  const insertAtCursor = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const newText = content.substring(0, start) + text + content.substring(start);
    setContent(newText);
    handleContentChange(newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + text.length, start + text.length);
      ensureCaretVisible();
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

    setTimeout(() => {
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

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
      checkFormatting();
    }, 0);
  };

  // sanitize pasted text (preserve URLs)
  const sanitizePastedText = (text: string): string => {
    if (!text) return '';
    let out = text.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');
    out = out.replace(/\r\n/g, '\n').replace(/\s+$/g, '').trim();
    out = out.replace(/<\/?[^>]+(>|$)/g, '');
    return out;
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
    if (sanitized) insertAtCursor(sanitized);
  };

  // content change handler with debounced save
  const handleContentChange = (newContent: string) => {
    setContent(newContent);

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    if (!isOnFirstLine && note && !showPreview) {
      autoSaveTimeoutRef.current = setTimeout(() => {
        void autoSave();
      }, 1000);
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
          const lead = ln.match(/^\s*/)?.[0] ?? '';
          const toRemove = Math.min(3, lead.length);
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
        setContent(newText);
        handleContentChange(newText);

        setTimeout(() => {
          textarea.focus();
          const newStart = Math.max(0, start - removedBeforeStart);
          const newEnd = Math.max(0, end - removedBeforeEnd);
          textarea.setSelectionRange(newStart, newEnd);
          checkFormatting();
        }, 0);
      } else {
        // Insert three spaces at cursor (use helper to keep behavior consistent)
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

      // debounce save edit state for current note
      if (note?.id != null) {
        if (selectionSaveTimeout.current) clearTimeout(selectionSaveTimeout.current);
        selectionSaveTimeout.current = setTimeout(() => {
          void saveEditState(note.id as number);
        }, 250);
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
      autoSaveTimeoutRef.current = setTimeout(() => {
        void autoSave();
      }, 1000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnFirstLine, note, content]);

  // reflow after fonts arrive (helps initial wrapping)
  useEffect(() => {
    const reflowTextarea = () => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.style.display = 'none';
      // force reflow
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      ta.offsetHeight;
      ta.style.display = '';
      // ensure correct sizing after reflow
      autosizeTextarea(ta);
    };

    if ((document as any).fonts && (document as any).fonts.ready) {
      (document as any).fonts.ready.then(() => {
        requestAnimationFrame(() => requestAnimationFrame(reflowTextarea));
      }).catch(() => {
        setTimeout(reflowTextarea, 100);
      });
    } else {
      const t = setTimeout(reflowTextarea, 100);
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
    lineHeight: `${spacingToLineHeight(editorSpacing)}`,
  };

  // cleanup
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
      if (note?.id != null) {
        if (showPreview) {
          // save preview progress
          try {
            const editorContent = editorContentRef.current;
            if (editorContent) {
              const ratio = editorContent.scrollHeight > editorContent.clientHeight ? editorContent.scrollTop / (editorContent.scrollHeight - editorContent.clientHeight) : 0;
              void window.electronAPI.saveNoteUiState(note.id, { progressPreview: ratio });
            }
          } catch {}
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
          <p>Select a note or create a new one with Ctrl+Enter</p>
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
              <button className={`toolbar-btn-icon ${activeFormats.has('blockquote') ? 'active' : ''}`} onClick={() => prependToLines('> ')} title="Blockquote">"</button>
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
                  <option value="clean">Clean</option>
                  <option value="narrow">Narrow</option>
                  <option value="print">Print</option>
                  <option value="modern">Modern</option>
                  <option value="cute">Cute</option>
                  <option value="hand">Hand</option>
                  <option value="script">Script</option>
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

      <div className="editor-content" ref={editorContentRef}>
        {!showPreview ? (
          <textarea
            ref={textareaRef}
            className={`markdown-textarea editor-style-${editorStyle} size-${editorFontSize} spacing-${editorSpacing}`}
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            onKeyUp={handleTextareaKeyUp}
            onKeyDown={handleTextareaKeyDown}
            onPaste={handlePaste}
            placeholder={`# Note Title

Start typing your note here...`}
            style={editorInlineStyle}
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