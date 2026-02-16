import React, { useState, useEffect } from 'react';
import { Note } from '../shared/types';
import { Sidebar } from './Sidebar';
import { MarkdownEditor } from './MarkdownEditor';
import { TagInput } from './TagInput';
import { FILTER_MONTHS, FILTER_YEARS, CLEAR_MONTHS_SIGNAL, CLEAR_YEARS_SIGNAL, YearValue, handleMultiSelect } from '../shared/filterConstants';
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

  // Global editor preview/edit mode (true = preview/view, false = edit)
  const [showPreview, setShowPreview] = useState<boolean>(() => {
    return localStorage.getItem('markdown-show-preview') === 'true';
  });

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

  // On start, open the last edited note if available
  useEffect(() => {
    (async () => {
      try {
        const last = await window.electronAPI.getLastEditedNote();
        if (last) {
          setSelectedNote(last);
        }
      } catch (err) {
        console.warn('Could not get last edited note', err);
      }
    })();
  }, []);

  // Helper to toggle preview mode and force-save before entering preview
  const togglePreview = async (next: boolean) => {
    // If entering preview mode, force a save first (so preview renders current content).
    if (next && (window as any).forceSaveCurrentNote) {
      try {
        await (window as any).forceSaveCurrentNote();
      } catch (err) {
        console.warn('forceSaveCurrentNote failed', err);
      }
    }

    setShowPreview(next);
    localStorage.setItem('markdown-show-preview', String(next));
  };

  // Global keyboard shortcuts:
  // - Ctrl+Enter to create new note
  // - Shift+Enter to toggle edit/view (global)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        handleCreateNote();
        return;
      }
      if (e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        // Use the togglePreview helper so we force-save when entering preview
        togglePreview(!showPreview);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showPreview]);

  const handleCreateNote = async () => {
    // Force save the current note before creating a new one
    if ((window as any).forceSaveCurrentNote) {
      await (window as any).forceSaveCurrentNote();
    }

    // Ensure edit mode for newly-created note
    setShowPreview(false);
    localStorage.setItem('markdown-show-preview', 'false');
    
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
    // also refresh sidebar so dates/tags reflect immediately
    setSidebarRefreshTrigger(t => t + 1);
  };

  const handleSidebarRefresh = () => {
    setSidebarRefreshTrigger(t => t + 1);
  };

  const handleMonthToggle = (month: number, event: React.MouseEvent) => {
    // Special case: right-click clear signal
    if (month === CLEAR_MONTHS_SIGNAL && event.type === 'contextmenu') {
      setSelectedMonths(new Set());
      return;
    }

    handleMultiSelect(month, event, selectedMonths, FILTER_MONTHS, setSelectedMonths);
  };

  const handleYearToggle = (year: YearValue, event: React.MouseEvent) => {
    // Special case: right-click clear signal
    if (year === CLEAR_YEARS_SIGNAL && event.type === 'contextmenu') {
      setSelectedYears(new Set());
      return;
    }

    if (year !== CLEAR_YEARS_SIGNAL) {
      handleMultiSelect(year, event, selectedYears, FILTER_YEARS, setSelectedYears);
    }
  };

  const handleNoteDelete = async (deletedNoteId: number, nextNoteToSelect?: Note | null) => {
    // If the deleted note was selected, select the next note or clear selection
    if (selectedNote?.id === deletedNoteId) {
      if (nextNoteToSelect) {
        setSelectedNote(nextNoteToSelect);
      } else {
        setSelectedNote(null);
      }
    }
    
    // Refresh the sidebar
    setRefreshKey(k => k + 1);
    setSidebarRefreshTrigger(t => t + 1);
  };

  // Sidebar divider mouse down handler
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  // Drag handling effect
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
        onNoteDelete={handleNoteDelete}
      />
      <div 
        className="sidebar-divider"
        onMouseDown={handleMouseDown}
      />
      <div className="main-content">
        <TagInput note={selectedNote} onTagsChanged={handleSidebarRefresh} />
        <MarkdownEditor
          note={selectedNote}
          onNoteUpdate={handleNoteUpdate}
          showPreview={showPreview}
          onTogglePreview={(next: boolean) => togglePreview(next)}
        />
      </div>
    </div>
  );
};
