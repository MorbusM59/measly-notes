import React, { useState, useEffect } from 'react';
import { Note } from '../shared/types';
import { Sidebar } from './Sidebar';
import { MarkdownEditor } from './MarkdownEditor';
import { TagInput } from './TagInput';
import './App.css';

export const App: React.FC = () => {
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);

  useEffect(() => {
    // Global keyboard shortcut: Ctrl+Enter to create new note
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        handleCreateNote();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCreateNote = async () => {
    // Create note with default title and pre-filled content
    const note = await window.electronAPI.createNote('Untitled');
    
    // Set initial markdown content with cursor position placeholder
    const initialContent = '# ';
    await window.electronAPI.saveNote(note.id, initialContent);
    
    setSelectedNote(note);
    setRefreshKey(k => k + 1);
  };

  const handleSelectNote = (note: Note) => {
    setSelectedNote(note);
  };

  const handleNoteUpdate = (updatedNote: Note) => {
    setSelectedNote(updatedNote);
    setRefreshKey(k => k + 1);
  };

  const handleSidebarRefresh = () => {
    setSidebarRefreshTrigger(t => t + 1);
  };

  return (
    <div className="app">
      <Sidebar
        key={refreshKey}
        selectedNote={selectedNote}
        onSelectNote={handleSelectNote}
        refreshTrigger={sidebarRefreshTrigger}
      />
      <div className="main-content">
        <TagInput note={selectedNote} onTagsChanged={handleSidebarRefresh} />
        <MarkdownEditor note={selectedNote} onNoteUpdate={handleNoteUpdate} />
      </div>
    </div>
  );
};
