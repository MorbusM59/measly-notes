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

  // Top-row suggestions / utility sizing and drag
  const [suggestionsWidth, setSuggestionsWidth] = useState<number>(() => {
    const saved = localStorage.getItem('tag-suggestions-width');
    return saved ? parseInt(saved, 10) : 240;
  });
  const [utilityWidth, setUtilityWidth] = useState<number>(() => {
    const saved = localStorage.getItem('tag-utility-width');
    return saved ? parseInt(saved, 10) : 180;
  });

  const [isDraggingDividerLeft, setIsDraggingDividerLeft] = useState(false);
  const [isDraggingDividerRight, setIsDraggingDividerRight] = useState(false);

  // Global editor preview/edit mode (true = preview/view, false = edit)
  const [showPreview, setShowPreview] = useState<boolean>(() => {
    return localStorage.getItem('markdown-show-preview') === 'true';
  });

  // App grid ref (used for divider calculations)
  const appRef = useRef<HTMLDivElement | null>(null);

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

  // Global keyboard shortcuts
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
    setSidebarRefreshTrigger(t => t + 1);
  };

  const handleSidebarRefresh = () => {
    setSidebarRefreshTrigger(t => t + 1);
  };

  const handleMonthToggle = (month: number, event: React.MouseEvent) => {
    if (month === CLEAR_MONTHS_SIGNAL && event.type === 'contextmenu') {
      setSelectedMonths(new Set());
      return;
    }

    handleMultiSelect(month, event, selectedMonths, FILTER_MONTHS, setSelectedMonths);
  };

  const handleYearToggle = (year: YearValue, event: React.MouseEvent) => {
    if (year === CLEAR_YEARS_SIGNAL && event.type === 'contextmenu') {
      setSelectedYears(new Set());
      return;
    }

    if (year !== CLEAR_YEARS_SIGNAL) {
      handleMultiSelect(year, event, selectedYears, FILTER_YEARS, setSelectedYears);
    }
  };

  const handleNoteDelete = async (deletedNoteId: number, nextNoteToSelect?: Note | null) => {
    if (selectedNote?.id === deletedNoteId) {
      if (nextNoteToSelect) {
        setSelectedNote(nextNoteToSelect);
      } else {
        setSelectedNote(null);
      }
    }

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
      if (newWidth >= 200 && newWidth <= 700) {
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

  // Top-row dividers drag handling
  useEffect(() => {
    if (!isDraggingDividerLeft && !isDraggingDividerRight) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!appRef.current) return;
      const rect = appRef.current.getBoundingClientRect();

      if (isDraggingDividerLeft) {
        const divider2Width = 8;
        let newSuggested = Math.round(rect.right - (utilityWidth + divider2Width) - e.clientX);
        const min = 120;
        const max = Math.min(800, Math.round(rect.width - 240));
        if (newSuggested < min) newSuggested = min;
        if (newSuggested > max) newSuggested = max;
        setSuggestionsWidth(newSuggested);
      }

      if (isDraggingDividerRight) {
        let newUtility = Math.round(rect.right - e.clientX);
        const min = 100;
        const max = Math.min(600, Math.round(rect.width - 240));
        if (newUtility < min) newUtility = min;
        if (newUtility > max) newUtility = max;
        setUtilityWidth(newUtility);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingDividerLeft(false);
      setIsDraggingDividerRight(false);
      localStorage.setItem('tag-suggestions-width', suggestionsWidth.toString());
      localStorage.setItem('tag-utility-width', utilityWidth.toString());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingDividerLeft, isDraggingDividerRight, suggestionsWidth, utilityWidth]);

  // Grid: include divider columns explicitly (they occupy grid space)
  const gridTemplateColumns = `${sidebarWidth}px 10px 1fr 4px ${suggestionsWidth}px 4px ${utilityWidth}px`;
  const gridTemplateRows = 'auto 1fr';
  const gridTemplateAreas = `
    "sidebar d-sidebar taginput d-left suggested d-right utility"
    "sidebar d-sidebar viewer  viewer    viewer    viewer    viewer"
  `;

  return (
    <div
      className="app app-grid"
      ref={appRef}
      style={{
        gridTemplateColumns,
        gridTemplateRows,
        gridTemplateAreas,
        position: 'relative',
      }}
    >
      {/* Sidebar area */}
      <div className="sidebar" style={{ gridArea: 'sidebar' }}>
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
      </div>

      {/* Sidebar divider now occupies its own grid column (d-sidebar) */}
      <div
        className="grid-divider divider-sidebar"
        style={{ gridArea: 'd-sidebar' }}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDraggingSidebar(true);
        }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />

      {/* Tag input top-left area */}
      <div className="tag-input-grid" style={{ gridArea: 'taginput' }}>
        <TagInput note={selectedNote} onTagsChanged={handleSidebarRefresh} />
      </div>

      {/* Divider between Tag input and Suggested (full grid area) */}
      <div
        className="grid-divider divider-left"
        style={{ gridArea: 'd-left' }}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDraggingDividerLeft(true);
        }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize suggested tags"
      />

      {/* Suggested area */}
      <div className="suggested-grid" style={{ gridArea: 'suggested' }}>
        <SuggestedPanel
          note={selectedNote}
          width={suggestionsWidth}
          onTagsChanged={handleSidebarRefresh}
          refreshTrigger={sidebarRefreshTrigger}
        />
      </div>

      {/* Divider between Suggested and Utility */}
      <div
        className="grid-divider divider-right"
        style={{ gridArea: 'd-right' }}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDraggingDividerRight(true);
        }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize utility area"
      />

      {/* Utility area (empty for now) */}
      <div className="utility-grid" style={{ gridArea: 'utility' }}>
        <div className="utility-area" aria-hidden="true" />
      </div>

      {/* Viewer/editor area */}
      <div className="viewer" style={{ gridArea: 'viewer' }}>
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