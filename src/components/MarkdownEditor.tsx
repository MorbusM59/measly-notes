import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Note } from '../shared/types';
import './MarkdownEditor.css';
import './MarkdownThemes.css';

interface MarkdownEditorProps {
  note: Note | null;
  onNoteUpdate?: (note: Note) => void;
  showPreview: boolean;
  onTogglePreview: (next: boolean) => void;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ note, onNoteUpdate, showPreview, onTogglePreview }) => {
  const [content, setContent] = useState('');
  const [isOnFirstLine, setIsOnFirstLine] = useState(false);
  const [viewStyle, setViewStyle] = useState<string>('clean');
  const [fontSize, setFontSize] = useState<string>('m');
  const [spacing, setSpacing] = useState<string>('cozy');
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef('');
  const lastSavedTitleRef = useRef('');
  const currentNoteIdRef = useRef<number | null>(null);

  // Editor font options — reduced to just Syne Mono and Red Hat Mono
  const editorFontOptions: { key: string; label: string; family: string }[] = [
    { key: 'syne', label: 'Syne Mono', family: "'Syne Mono', 'Menlo', 'Monaco', monospace" },
    { key: 'redhat', label: 'Red Hat Mono', family: "'Red Hat Mono', 'Menlo', 'Monaco', monospace" },
  ];
  // Default editor font (will be overridden by saved preference if present)
  const [editorFont, setEditorFont] = useState<string>(editorFontOptions[0].family);

  // Helper: extract the primary font-family name from a CSS font-family string
  // Example: "'Fira Code', 'Menlo', 'Monaco', monospace" -> Fira Code
  const getPrimaryFamily = (fontFamilyValue: string | null | undefined): string | null => {
    if (!fontFamilyValue) return null;
    const first = fontFamilyValue.split(',')[0].trim();
    // Remove surrounding quotes if present
    return first.replace(/^['"]|['"]$/g, '') || null;
  };

  // When entering view mode, clear any pending autosave so nothing runs during preview.
  useEffect(() => {
    if (showPreview) {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    }
  }, [showPreview]);

  // Load note content when note changes
  useEffect(() => {
    if (note) {
      // If same note id already loaded, only update title ref (avoid clobbering editor)
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
          setTimeout(() => {
            const textarea = textareaRef.current;
            if (textarea) {
              textarea.focus();
              if (noteContent === '# ') {
                textarea.setSelectionRange(2, 2);
              } else {
                textarea.setSelectionRange(noteContent.length, noteContent.length);
              }
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
  }, [note, showPreview]);

  // If switched to edit mode, focus textarea
  useEffect(() => {
    if (!showPreview) {
      setTimeout(() => textareaRef.current?.focus(), 10);
    }
  }, [showPreview]);

  // Load and persist view style, font size, spacing and editor font
  useEffect(() => {
    const savedStyle = localStorage.getItem('markdown-view-style');
    const savedFontSize = localStorage.getItem('markdown-font-size');
    const savedSpacing = localStorage.getItem('markdown-spacing');
    const savedEditorFont = localStorage.getItem('markdown-editor-font');

    if (savedStyle) setViewStyle(savedStyle);
    if (savedFontSize) setFontSize(savedFontSize);
    if (savedSpacing) setSpacing(savedSpacing);
    if (savedEditorFont) setEditorFont(savedEditorFont);
  }, []);

  const handleStyleChange = (style: string) => {
    setViewStyle(style);
    localStorage.setItem('markdown-view-style', style);
  };

  const handleFontSizeChange = (size: string) => {
    setFontSize(size);
    localStorage.setItem('markdown-font-size', size);
  };

  const handleSpacingChange = (spacingValue: string) => {
    setSpacing(spacingValue);
    localStorage.setItem('markdown-spacing', spacingValue);
  };

  const handleEditorFontChange = (value: string) => {
    setEditorFont(value);
    localStorage.setItem('markdown-editor-font', value);
  };

  // Preload the selected font so switching between edit/view is immediate.
  useEffect(() => {
    const primary = getPrimaryFamily(editorFont);
    if (!primary) return;

    try {
      if ((document as any).fonts && typeof (document as any).fonts.load === 'function') {
        void (document as any).fonts.load(`12px "${primary}"`).catch(() => {});
      }
    } catch (err) {
      // ignore
    }
  }, [editorFont]);

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

  // Formatting helpers
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

  // selection listeners
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const handleSelectionChange = () => {
      checkCursorPosition();
      checkFormatting();
    };
    textarea.addEventListener('click', handleSelectionChange);
    textarea.addEventListener('keyup', handleSelectionChange);
    textarea.addEventListener('select', handleSelectionChange);
    return () => {
      textarea.removeEventListener('click', handleSelectionChange);
      textarea.removeEventListener('keyup', handleSelectionChange);
      textarea.removeEventListener('select', handleSelectionChange);
    };
  }, [checkCursorPosition, checkFormatting]);

  // trigger auto-save when moving off first line
  useEffect(() => {
    if (!isOnFirstLine && note && content !== lastSavedContentRef.current) {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = setTimeout(() => {
        void autoSave();
      }, 1000);
    }
  }, [isOnFirstLine, note, content, autoSave]);

  // cleanup
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    };
  }, []);

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

  // toolbar layout styles: two flex areas (left/right) and fixed toolbar height/line-height
  const toolbarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '44px',       // fixed height to avoid 1px difference when toggling modes
    lineHeight: '44px',
    padding: '0 8px',
  };
  const leftToolsStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };
  const rightToolsStyle: React.CSSProperties = {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
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

        {/* right-aligned controls (size/spacings/fonts/style) */}
        <div style={rightToolsStyle}>
          {/* In view mode we keep the Style selector (applies to preview rendering) */}
          {showPreview && (
            <div className="style-selector">
              <label className="selector-label">Style:</label>
              <select value={viewStyle} onChange={(e) => handleStyleChange(e.target.value)}>
                <option value="clean">Clean</option>
                <option value="narrow">Narrow</option>
                <option value="print">Print</option>
                <option value="modern">Modern</option>
                <option value="cute">Cute</option>
                <option value="hand">Hand</option>
                <option value="script">Script</option>
              </select>
            </div>
          )}

          {/* Size selector - available in both edit and view mode */}
          <div className="style-selector">
            <label className="selector-label">Size:</label>
            <select value={fontSize} onChange={(e) => handleFontSizeChange(e.target.value)}>
              <option value="xs">XS</option>
              <option value="s">S</option>
              <option value="m">M</option>
              <option value="l">L</option>
              <option value="xl">XL</option>
            </select>
          </div>

          {/* Spacing selector - available in both edit and view mode */}
          <div className="style-selector">
            <label className="selector-label">Spacing:</label>
            <select value={spacing} onChange={(e) => handleSpacingChange(e.target.value)}>
              <option value="tight">Tight</option>
              <option value="compact">Compact</option>
              <option value="cozy">Cozy</option>
              <option value="wide">Wide</option>
            </select>
          </div>

          {/* Editor Font selector - reduced to Syne Mono and Red Hat Mono */}
          <div className="style-selector">
            <label className="selector-label">Editor Font:</label>
            <select value={editorFont} onChange={(e) => handleEditorFontChange(e.target.value)}>
              {editorFontOptions.map((opt) => (
                <option key={opt.key} value={opt.family}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isOnFirstLine && <span className="auto-save-status">Auto-save paused (editing title)</span>}
      </div>

      <div className="editor-content">
        {!showPreview ? (
          <textarea
            ref={textareaRef}
            className="markdown-textarea"
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            onKeyUp={handleTextareaKeyUp}
            onPaste={handlePaste}
            placeholder={`# Note Title

Start typing your note here...`}
            // Apply selected editor font
            style={{ fontFamily: editorFont }}
          />
        ) : (
          <div className={`markdown-preview style-${viewStyle} size-${fontSize} spacing-${spacing}`}>
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

                  // If the visible link text is exactly the href (bare/autolink), render as plain text.
                  if (href && childText && childText.trim() === href.trim()) {
                    return <span>{childText}</span>;
                  }

                  // Only render anchors for allowed absolute protocols.
                  if (isSafeHref(href)) {
                    return (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {props.children}
                      </a>
                    );
                  }

                  // Unsafe or relative link → render as plain text.
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
