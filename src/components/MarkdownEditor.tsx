import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Note } from '../shared/types';
import './MarkdownEditor.css';
import './MarkdownThemes.css';

interface MarkdownEditorProps {
  note: Note | null;
  onNoteUpdate?: (note: Note) => void;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ note, onNoteUpdate }) => {
  const [content, setContent] = useState('');
  const [isOnFirstLine, setIsOnFirstLine] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [viewStyle, setViewStyle] = useState<string>('elegant');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef('');
  const lastSavedTitleRef = useRef('');
  
  // Expose forceSave method via window for App to call
  useEffect(() => {
    (window as any).forceSaveCurrentNote = async () => {
      if (note && content) {
        // Clear any pending auto-save
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
          autoSaveTimeoutRef.current = null;
        }
        // Save immediately
        await autoSave();
      }
    };
    
    return () => {
      delete (window as any).forceSaveCurrentNote;
    };
  }, [note, content]);

  // Load note content when note changes
  useEffect(() => {
    if (note) {
      window.electronAPI.loadNote(note.id).then(noteContent => {
        setContent(noteContent);
        lastSavedContentRef.current = noteContent;
        lastSavedTitleRef.current = note.title;
        
        // Focus textarea and position cursor after content is loaded
        setTimeout(() => {
          const textarea = textareaRef.current;
          if (textarea) {
            // Switch to edit mode if in view mode
            setShowPreview(false);
            
            // Focus the textarea
            textarea.focus();
            
            // Position cursor after "# " for new notes
            if (noteContent === '# ') {
              textarea.setSelectionRange(2, 2);
            } else {
              // For existing notes, position at end
              textarea.setSelectionRange(noteContent.length, noteContent.length);
            }
          }
        }, 0);
      });
    } else {
      setContent('');
      lastSavedContentRef.current = '';
      lastSavedTitleRef.current = '';
    }
  }, [note]);

  // Load and persist view style
  useEffect(() => {
    const savedStyle = localStorage.getItem('markdown-view-style');
    if (savedStyle) {
      setViewStyle(savedStyle);
    }
  }, []);

  const handleStyleChange = (style: string) => {
    setViewStyle(style);
    localStorage.setItem('markdown-view-style', style);
  };

  // Check if cursor is on first line
  const checkCursorPosition = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = content.substring(0, cursorPos);
    const lines = textBeforeCursor.split('\n');
    const isFirstLine = lines.length === 1;
    setIsOnFirstLine(isFirstLine);
  }, [content]);

  // Extract title from first line
  const extractTitle = useCallback((text: string): string => {
    const lines = text.split('\n');
    const firstLine = lines[0] || '';
    
    // Check if first line starts with # (markdown heading)
    if (firstLine.startsWith('# ')) {
      return firstLine.substring(2).trim();
    }
    
    return 'Untitled';
  }, []);

  // Auto-save function
  const autoSave = useCallback(async () => {
    if (!note || !content) return;
    
    // Only save if content has changed
    if (content === lastSavedContentRef.current) return;
    
    // Save content
    await window.electronAPI.saveNote(note.id, content);
    lastSavedContentRef.current = content;
    
    // Update title if it has changed
    const newTitle = extractTitle(content);
    if (newTitle !== lastSavedTitleRef.current && newTitle !== 'Untitled') {
      await window.electronAPI.updateNoteTitle(note.id, newTitle);
      lastSavedTitleRef.current = newTitle;
      
      // Notify parent about note update
      if (onNoteUpdate) {
        onNoteUpdate({ ...note, title: newTitle });
      }
    }
  }, [note, content, extractTitle, onNoteUpdate]);

  // Markdown formatting functions
  const wrapSelection = (before: string, after: string = before) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end);
    const newText = content.substring(0, start) + before + selectedText + after + content.substring(end);
    
    setContent(newText);
    handleContentChange(newText);
    
    // Restore focus and selection
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
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
    
    // Find the start and end of the lines
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = content.indexOf('\n', end);
    const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;
    
    const selectedLines = content.substring(lineStart, actualLineEnd);
    const lines = selectedLines.split('\n');
    
    const newLines = lines.map((line, index) => {
      if (numbered) {
        return `${index + 1}. ${line}`;
      }
      return `${prefix}${line}`;
    });
    
    const newText = content.substring(0, lineStart) + newLines.join('\n') + content.substring(actualLineEnd);
    
    setContent(newText);
    handleContentChange(newText);
    
    setTimeout(() => {
      textarea.focus();
    }, 0);
  };

  const insertHeading = (level: number) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    
    // Find the start of the current line
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const prefix = '#'.repeat(level) + ' ';
    
    const newText = content.substring(0, lineStart) + prefix + content.substring(lineStart);
    
    setContent(newText);
    handleContentChange(newText);
    
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length);
    }, 0);
  };

  // Handle content change with debounced auto-save
  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    
    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    
    // Don't auto-save while on first line
    if (!isOnFirstLine && note) {
      autoSaveTimeoutRef.current = setTimeout(() => {
        autoSave();
      }, 1000);
    }
  };

  // Handle cursor position change
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleSelectionChange = () => {
      checkCursorPosition();
    };

    textarea.addEventListener('click', handleSelectionChange);
    textarea.addEventListener('keyup', handleSelectionChange);

    return () => {
      textarea.removeEventListener('click', handleSelectionChange);
      textarea.removeEventListener('keyup', handleSelectionChange);
    };
  }, [checkCursorPosition]);

  // Trigger auto-save when moving off first line
  useEffect(() => {
    if (!isOnFirstLine && note && content !== lastSavedContentRef.current) {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      autoSaveTimeoutRef.current = setTimeout(() => {
        autoSave();
      }, 1000);
    }
  }, [isOnFirstLine, note, content, autoSave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
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

  return (
    <div className="markdown-editor">
      <div className="editor-toolbar">
        <button 
          className={`toolbar-toggle-btn ${!showPreview ? 'active' : ''}`}
          onClick={() => setShowPreview(!showPreview)}
        >
          {showPreview ? 'Edit' : 'View'}
        </button>
        
        {!showPreview && (
          <div className="markdown-toolbar">
            <button className="toolbar-btn-icon" onClick={() => wrapSelection('**')} title="Bold">
              <strong>B</strong>
            </button>
            <button className="toolbar-btn-icon" onClick={() => wrapSelection('*')} title="Italic">
              <em>I</em>
            </button>
            <button className="toolbar-btn-icon" onClick={() => wrapSelection('~~')} title="Strikethrough">
              <span style={{ textDecoration: 'line-through' }}>S</span>
            </button>
            <span className="toolbar-divider">|</span>
            <button className="toolbar-btn-icon" onClick={() => insertHeading(1)} title="Heading 1">
              H1
            </button>
            <button className="toolbar-btn-icon" onClick={() => insertHeading(2)} title="Heading 2">
              H2
            </button>
            <button className="toolbar-btn-icon" onClick={() => insertHeading(3)} title="Heading 3">
              H3
            </button>
            <span className="toolbar-divider">|</span>
            <button className="toolbar-btn-icon" onClick={() => wrapSelection('[', '](url)')} title="Link">
              🔗
            </button>
            <button className="toolbar-btn-icon" onClick={() => wrapSelection('`')} title="Inline Code">
              {'<>'}
            </button>
            <button className="toolbar-btn-icon" onClick={() => wrapSelection('```\n', '\n```')} title="Code Block">
              {'{ }'}
            </button>
            <span className="toolbar-divider">|</span>
            <button className="toolbar-btn-icon" onClick={() => prependToLines('- ')} title="Bulleted List">
              ≡
            </button>
            <button className="toolbar-btn-icon" onClick={() => prependToLines('', true)} title="Numbered List">
              #
            </button>
            <button className="toolbar-btn-icon" onClick={() => prependToLines('> ')} title="Blockquote">
              "
            </button>
            <button className="toolbar-btn-icon" onClick={() => insertAtCursor('\n---\n')} title="Horizontal Rule">
              —
            </button>
          </div>
        )}
        
        {showPreview && (
          <div className="style-selector">
            <select value={viewStyle} onChange={(e) => handleStyleChange(e.target.value)}>
              <option value="elegant">Elegant & Formal</option>
              <option value="business">Clean Business</option>
              <option value="friendly">Friendly & Playful</option>
              <option value="technical">Monospace / Technical</option>
            </select>
          </div>
        )}
        
        {isOnFirstLine && (
          <span className="auto-save-status">Auto-save paused (editing title)</span>
        )}
      </div>
      
      <div className="editor-content">
        {!showPreview ? (
          <textarea
            ref={textareaRef}
            className="markdown-textarea"
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder="# Note Title

Start typing your note here..."
          />
        ) : (
          <div className={`markdown-preview style-${viewStyle}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};
