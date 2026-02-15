import React, { useState, useEffect } from 'react';
import { Note } from '../shared/types';
import { Sidebar } from './Sidebar';
import { MarkdownEditor } from './MarkdownEditor';
import { TagInput } from './TagInput';
import { FILTER_MONTHS, FILTER_YEARS, CLEAR_MONTHS_SIGNAL, CLEAR_YEARS_SIGNAL } from '../shared/filterConstants';
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

  const handleMonthToggle = (month: number, event: React.MouseEvent) => {
    // Special case: right-click clear signal
    if (month === CLEAR_MONTHS_SIGNAL && event.type === 'contextmenu') {
      setSelectedMonths(new Set());
      return;
    }

    const currentSelection = selectedMonths;
    
    if (event.ctrlKey || event.metaKey) {
      // Toggle individual button
      const newMonths = new Set(currentSelection);
      if (newMonths.has(month)) {
        newMonths.delete(month);
      } else {
        newMonths.add(month);
      }
      setSelectedMonths(newMonths);
    } else if (event.shiftKey && currentSelection.size === 1) {
      // Range select from the single selected button to clicked button
      const anchor = Array.from(currentSelection)[0];
      const anchorIndex = FILTER_MONTHS.indexOf(anchor);
      const clickIndex = FILTER_MONTHS.indexOf(month);
      const start = Math.min(anchorIndex, clickIndex);
      const end = Math.max(anchorIndex, clickIndex);
      const rangeMonths = FILTER_MONTHS.slice(start, end + 1);
      setSelectedMonths(new Set(rangeMonths));
    } else if (event.shiftKey && currentSelection.size > 1) {
      // With multiple selected, shift behaves like ctrl (add single)
      const newMonths = new Set(currentSelection);
      if (!newMonths.has(month)) {
        newMonths.add(month);
      }
      setSelectedMonths(newMonths);
    } else {
      // Plain click — exclusive select (or deselect if already sole selection)
      if (currentSelection.size === 1 && currentSelection.has(month)) {
        setSelectedMonths(new Set()); // deselect
      } else {
        setSelectedMonths(new Set([month])); // exclusive select
      }
    }
  };

  const handleYearToggle = (year: number | 'older', event: React.MouseEvent) => {
    // Special case: right-click clear signal
    if ((year as any) === CLEAR_YEARS_SIGNAL && event.type === 'contextmenu') {
      setSelectedYears(new Set());
      return;
    }

    const currentSelection = selectedYears;
    
    if (event.ctrlKey || event.metaKey) {
      // Toggle individual button
      const newYears = new Set(currentSelection);
      if (newYears.has(year)) {
        newYears.delete(year);
      } else {
        newYears.add(year);
      }
      setSelectedYears(newYears);
    } else if (event.shiftKey && currentSelection.size === 1) {
      // Range select from the single selected button to clicked button
      const anchor = Array.from(currentSelection)[0];
      const anchorIndex = FILTER_YEARS.indexOf(anchor);
      const clickIndex = FILTER_YEARS.indexOf(year);
      const start = Math.min(anchorIndex, clickIndex);
      const end = Math.max(anchorIndex, clickIndex);
      const rangeYears = FILTER_YEARS.slice(start, end + 1);
      setSelectedYears(new Set(rangeYears));
    } else if (event.shiftKey && currentSelection.size > 1) {
      // With multiple selected, shift behaves like ctrl (add single)
      const newYears = new Set(currentSelection);
      if (!newYears.has(year)) {
        newYears.add(year);
      }
      setSelectedYears(newYears);
    } else {
      // Plain click — exclusive select (or deselect if already sole selection)
      if (currentSelection.size === 1 && currentSelection.has(year)) {
        setSelectedYears(new Set()); // deselect
      } else {
        setSelectedYears(new Set([year])); // exclusive select
      }
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
        onNoteDelete={handleNoteDelete}
      />
      <div 
        className="sidebar-divider"
        onMouseDown={handleMouseDown}
      />
      <div className="main-content">
        <TagInput note={selectedNote} onTagsChanged={handleSidebarRefresh} />
        <MarkdownEditor note={selectedNote} onNoteUpdate={handleNoteUpdate} />
      </div>
    </div>
  );
};
