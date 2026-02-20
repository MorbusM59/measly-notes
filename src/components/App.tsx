import React, { useEffect, useRef, useState } from 'react';
import { Note } from '../shared/types';
import { Sidebar } from './Sidebar';
import { MarkdownEditor } from './MarkdownEditor';
import { TagInput } from './TagInput';
import {
  FILTER_MONTHS,
  FILTER_YEARS,
  CLEAR_MONTHS_SIGNAL,
  CLEAR_YEARS_SIGNAL,
  YearValue,
  handleMultiSelect,
} from '../shared/filterConstants';
import './Shared.scss';
import './App.scss';
import { SuggestedPanel } from './SuggestedPanel';

export const App: React.FC = () => {
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set());
  const [selectedYears, setSelectedYears] = useState<Set<number | 'older'>>(new Set());
  const [viewMode, setViewMode] = useState<'date' | 'category'>('date');

  // Sidebar sizing / drag
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('sidebar-width');
    return saved ? parseInt(saved, 10) : 320;
  });
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);

  // Suggestions panel sizing / drag (moved to app level)
  const [suggestionsWidth, setSuggestionsWidth] = useState<number>(() => {
    const saved = localStorage.getItem('tag-suggestions-width');
    return saved ? parseInt(saved, 10) : 240;
  });
  const [isDraggingSuggestionsDivider, setIsDraggingSuggestionsDivider] = useState(false);
  const mainContentRef = useRef<HTMLDivElement | null>(null);

  // Global editor preview/edit mode (true = preview/view, false = edit)
  const [showPreview, setShowPreview] = useState<boolean>(() => {
    return localStorage.getItem('markdown-show-preview') === 'true';
  });

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
    // If entering preview mode, request a force-save first (so preview renders current content).
    if (next) {
      try {
        await (window as any).electronAPI.requestForceSave();
      } catch (err) {
        console.warn('requestForceSave failed', err);
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
        togglePreview(!showPreview);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showPreview]);

  const handleCreateNote = async () => {
    try {
      await (window as any).electronAPI.requestForceSave();
    } catch (err) {
      console.warn('requestForceSave failed', err);
    }

    setShowPreview(false);
    localStorage.setItem('markdown-show-preview', 'false');

    const note = await window.electronAPI.createNote('Untitled');
    const initialContent = '# ';
    await window.electronAPI.saveNote(note.id, initialContent);

    setSelectedNote(note);
    setRefreshKey(k => k + 1);
  };

  // When a note is selected from the sidebar, request a force-save first (flush pending edits),
  // then update selectedNote. This prevents losing the current in-editor state when switching notes.
  const handleSelectNote = async (note: Note) => {
    try {
      await (window as any).electronAPI.requestForceSave();
    } catch (err) {
      console.warn('requestForceSave failed on note select', err);
    }
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
  const handleSidebarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
  };

  // Drag handling effect for sidebar
  useEffect(() => {
    if (!isDraggingSidebar) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      if (newWidth >= 250 && newWidth <= 600) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingSidebar(false);
      localStorage.setItem('sidebar-width', sidebarWidth.toString());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSidebar, sidebarWidth]);

  // Suggestions divider mouse down handler
  const handleSuggestionsDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSuggestionsDivider(true);
  };

  // Drag handling effect for suggestions divider
  useEffect(() => {
    if (!isDraggingSuggestionsDivider) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!mainContentRef.current) return;
      const rect = mainContentRef.current.getBoundingClientRect();
      // suggestions pane is on the right; width = rect.right - clientX
      let newWidth = Math.round(rect.right - e.clientX);
      const min = 120;
      const max = Math.min(600, Math.round(rect.width - 120));
      if (newWidth < min) newWidth = min;
      if (newWidth > max) newWidth = max;
      setSuggestionsWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingSuggestionsDivider(false);
      localStorage.setItem('tag-suggestions-width', suggestionsWidth.toString());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSuggestionsDivider, suggestionsWidth]);

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
        onMouseDown={handleSidebarMouseDown}
        role="separator"
        aria-orientation="vertical"
      />
      <div className="main-content" ref={mainContentRef}>
        <div className="main-column">
          <TagInput note={selectedNote} onTagsChanged={handleSidebarRefresh} />
          <MarkdownEditor
            note={selectedNote}
            onNoteUpdate={handleNoteUpdate}
            showPreview={showPreview}
            onTogglePreview={(next: boolean) => togglePreview(next)}
          />
        </div>

        <div
          className="suggestions-divider"
          onMouseDown={handleSuggestionsDividerMouseDown}
          role="separator"
          aria-orientation="vertical"
        />

        <SuggestedPanel
          note={selectedNote}
          width={suggestionsWidth}
          onTagsChanged={handleSidebarRefresh}
        />
      </div>
    </div>
  );
};
