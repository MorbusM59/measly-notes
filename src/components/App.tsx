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
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set());
  const [selectedYears, setSelectedYears] = useState<Set<number | 'older'>>(new Set());
  const [viewMode, setViewMode] = useState<'date' | 'category'>('date');
  const [sidebarWidth, setSidebarWidth] = useState<number>(400);
  const [isDragging, setIsDragging] = useState(false);

  // Load sidebar width from localStorage
  useEffect(() => {
    const savedWidth = localStorage.getItem('sidebar-width');
    if (savedWidth) {
      const width = parseInt(savedWidth, 10);
      if (width >= 250 && width <= 600) {
        setSidebarWidth(width);
      }
    }
  }, []);

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
    // Force save the current note before creating a new one
    if ((window as any).forceSaveCurrentNote) {
      await (window as any).forceSaveCurrentNote();
    }
    
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

  const handleMonthToggle = (month: number) => {
    const newMonths = new Set(selectedMonths);
    if (newMonths.has(month)) {
      newMonths.delete(month);
    } else {
      newMonths.add(month);
    }
    setSelectedMonths(newMonths);
  };

  const handleYearToggle = (year: number | 'older') => {
    const newYears = new Set(selectedYears);
    if (newYears.has(year)) {
      newYears.delete(year);
    } else {
      newYears.add(year);
    }
    setSelectedYears(newYears);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      if (newWidth >= 250 && newWidth <= 600) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      // Save to localStorage
      localStorage.setItem('sidebar-width', sidebarWidth.toString());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, sidebarWidth]);

  return (
    <div className="app">
      <Sidebar
        key={refreshKey}
        selectedNote={selectedNote}
        onSelectNote={handleSelectNote}
        refreshTrigger={sidebarRefreshTrigger}
        selectedMonths={selectedMonths}
        selectedYears={selectedYears}
        onMonthToggle={handleMonthToggle}
        onYearToggle={handleYearToggle}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        width={sidebarWidth}
      />
      <div 
        className="sidebar-divider"
        onMouseDown={handleMouseDown}
        style={{ cursor: isDragging ? 'col-resize' : 'col-resize' }}
      />
      <div className="main-content">
        <TagInput note={selectedNote} onTagsChanged={handleSidebarRefresh} />
        <MarkdownEditor note={selectedNote} onNoteUpdate={handleNoteUpdate} />
      </div>
    </div>
  );
};
