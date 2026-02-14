import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Note } from '../shared/types';
import './MarkdownEditor.css';

interface MarkdownEditorProps {
  note: Note | null;
  onNoteUpdate?: (note: Note) => void;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ note, onNoteUpdate }) => {
  const [content, setContent] = useState('');
  const [isOnFirstLine, setIsOnFirstLine] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef('');
  const lastSavedTitleRef = useRef('');

  // Load note content when note changes
  useEffect(() => {
    if (note) {
      window.electronAPI.loadNote(note.id).then(noteContent => {
        setContent(noteContent);
        lastSavedContentRef.current = noteContent;
        lastSavedTitleRef.current = note.title;
      });
    } else {
      setContent('');
      lastSavedContentRef.current = '';
      lastSavedTitleRef.current = '';
    }
  }, [note]);

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
          className={`toolbar-btn ${!showPreview ? 'active' : ''}`}
          onClick={() => setShowPreview(false)}
        >
          Edit
        </button>
        <button 
          className={`toolbar-btn ${showPreview ? 'active' : ''}`}
          onClick={() => setShowPreview(true)}
        >
          Preview
        </button>
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
          <div className="markdown-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};
