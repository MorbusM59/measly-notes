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

  // Draggable / layout state and constraints
  const SIDEBAR_MIN = 216;
  const TAG_MIN = 250;
  const TAG_DEFAULT = 350;
  const SUGGESTED_MIN = 100;
  const UTILITY_FIXED = 150;
  const DIVIDER_W = 8;
  const APP_MIN_WIDTH = 790;
  const APP_MIN_HEIGHT = 550;

  // Sidebar sizing / drag
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('sidebar-width');
    const val = saved ? parseInt(saved, 10) : 320;
    return Math.max(SIDEBAR_MIN, val);
  });
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);

  // Top-row widths: explicit tagInput and suggested columns
  const [tagWidth, setTagWidth] = useState<number>(() => {
    const saved = localStorage.getItem('tag-input-width');
    return saved ? parseInt(saved, 10) : TAG_DEFAULT;
  });
  const [suggestedWidth, setSuggestedWidth] = useState<number>(() => {
    const saved = localStorage.getItem('tag-suggestions-width');
    return saved ? parseInt(saved, 10) : 240;
  });

  // Only left divider (between tag and suggested) is draggable
  const [isDraggingLeftDivider, setIsDraggingLeftDivider] = useState(false);

  // Global editor preview/edit mode
  const [showPreview, setShowPreview] = useState<boolean>(() => {
    return localStorage.getItem('markdown-show-preview') === 'true';
  });

  const appRef = useRef<HTMLDivElement | null>(null);

  // Keep selected note behavior as before
  useEffect(() => {
    (async () => {
      try {
        const last = await window.electronAPI.getLastEditedNote();
        if (last) setSelectedNote(last);
      } catch (err) {
        console.warn('Could not get last edited note', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (nextNoteToSelect) setSelectedNote(nextNoteToSelect);
      else setSelectedNote(null);
    }
    setRefreshKey(k => k + 1);
    setSidebarRefreshTrigger(t => t + 1);
  };

  // Utilities
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  // Recalculate tag/suggested widths to preserve ratio when availableMain changes
  const adjustTagAndSuggestedForMain = (availableMain: number, prevTag: number, prevSug: number) => {
    // Ensure availableMain >= TAG_MIN + SUGGESTED_MIN else we'll end up with small values
    const minSum = TAG_MIN + SUGGESTED_MIN;
    if (availableMain <= minSum) {
      // Just give mins (resulting layout may force scroll)
      return { t: TAG_MIN, s: SUGGESTED_MIN };
    }
    const totalPrev = prevTag + prevSug;
    let t = Math.round((prevTag / totalPrev) * availableMain);
    let s = availableMain - t;

    // enforce minima
    if (t < TAG_MIN) {
      t = TAG_MIN;
      s = availableMain - t;
      if (s < SUGGESTED_MIN) {
        s = SUGGESTED_MIN;
        t = availableMain - s;
      }
    }
    if (s < SUGGESTED_MIN) {
      s = SUGGESTED_MIN;
      t = availableMain - s;
      if (t < TAG_MIN) {
        t = TAG_MIN;
        s = availableMain - t;
      }
    }

    return { t, s };
  };

  // Sidebar dragging: update sidebarWidth and proportionally resize tag/suggested
  useEffect(() => {
    if (!isDraggingSidebar) return;

    const handleMove = (e: MouseEvent) => {
      if (!appRef.current) return;
      const rect = appRef.current.getBoundingClientRect();
      const newSidebar = clamp(Math.round(e.clientX - rect.left), SIDEBAR_MIN, Math.max(SIDEBAR_MIN, rect.width - (TAG_MIN + SUGGESTED_MIN + UTILITY_FIXED + DIVIDER_W * 3)));
      const prevMain = rect.width - sidebarWidth - (DIVIDER_W * 3) - UTILITY_FIXED;
      const newMain = rect.width - newSidebar - (DIVIDER_W * 3) - UTILITY_FIXED;
      if (prevMain <= 0 || newMain <= 0) {
        setSidebarWidth(newSidebar);
        return;
      }
      const adjusted = adjustTagAndSuggestedForMain(newMain, tagWidth, suggestedWidth);
      setSidebarWidth(newSidebar);
      setTagWidth(adjusted.t);
      setSuggestedWidth(adjusted.s);
    };

    const handleUp = () => {
      setIsDraggingSidebar(false);
      localStorage.setItem('sidebar-width', String(sidebarWidth));
      localStorage.setItem('tag-input-width', String(tagWidth));
      localStorage.setItem('tag-suggestions-width', String(suggestedWidth));
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingSidebar, sidebarWidth, tagWidth, suggestedWidth]);

  // Left divider drag (between tag and suggested)
  useEffect(() => {
    if (!isDraggingLeftDivider) return;

    const handleMove = (e: MouseEvent) => {
      if (!appRef.current) return;
      const rect = appRef.current.getBoundingClientRect();
      // mainLeft = left edge of tag column (after sidebar + d-sidebar)
      const mainLeft = rect.left + sidebarWidth + DIVIDER_W;
      const mainRight = rect.right - (UTILITY_FIXED + DIVIDER_W * 2); // reserve right divider + utility
      const availableMain = Math.max(0, Math.round(mainRight - mainLeft));
      let newTag = clamp(Math.round(e.clientX - mainLeft), TAG_MIN, Math.max(TAG_MIN, availableMain - SUGGESTED_MIN));
      let newSug = availableMain - newTag;
      if (newSug < SUGGESTED_MIN) {
        newSug = SUGGESTED_MIN;
        newTag = availableMain - newSug;
      }
      setTagWidth(newTag);
      setSuggestedWidth(newSug);
    };

    const handleUp = () => {
      setIsDraggingLeftDivider(false);
      localStorage.setItem('tag-input-width', String(tagWidth));
      localStorage.setItem('tag-suggestions-width', String(suggestedWidth));
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingLeftDivider, sidebarWidth, tagWidth, suggestedWidth]);

  // Window resize: preserve ratio of tag / suggested until minima
  useEffect(() => {
    const handleResize = () => {
      if (!appRef.current) return;
      const rect = appRef.current.getBoundingClientRect();
      // Total width available to the two middle columns:
      const availableMain = rect.width - sidebarWidth - (DIVIDER_W * 3) - UTILITY_FIXED;
      if (availableMain <= 0) return;
      const adjusted = adjustTagAndSuggestedForMain(availableMain, tagWidth, suggestedWidth);
      setTagWidth(adjusted.t);
      setSuggestedWidth(adjusted.s);
    };

    window.addEventListener('resize', handleResize);
    // run once
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarWidth]);

  // Enforce app minimum sizes (CSS will cause scroll when below)
  const gridTemplateColumns = `${sidebarWidth}px ${DIVIDER_W}px ${tagWidth}px ${DIVIDER_W}px ${suggestedWidth}px ${DIVIDER_W}px ${UTILITY_FIXED}px`;
  const gridTemplateRows = 'auto 1fr';
  const gridTemplateAreas = `
    "sidebar d-sidebar taginput d-left suggested d-right utility"
    "sidebar d-sidebar viewer  viewer    viewer    viewer    viewer"
  `;

  // the rest of the app behavior stays the same as before; pass refreshTrigger down
  return (
    <div
      className="app app-grid"
      ref={appRef}
      style={{
        gridTemplateColumns,
        gridTemplateRows,
        gridTemplateAreas,
        position: 'relative',
        minWidth: APP_MIN_WIDTH,
        minHeight: APP_MIN_HEIGHT,
      }}
    >
      {/* Sidebar */}
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

      {/* Sidebar divider (draggable) */}
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

      {/* Tag input */}
      <div className="tag-input-grid" style={{ gridArea: 'taginput' }}>
        <TagInput note={selectedNote} onTagsChanged={handleSidebarRefresh} refreshTrigger={sidebarRefreshTrigger} />
      </div>

      {/* Left divider between tag and suggested (draggable) */}
      <div
        className="grid-divider divider-left"
        style={{ gridArea: 'd-left' }}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDraggingLeftDivider(true);
        }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize suggested tags"
      />

      {/* Suggested */}
      <div className="suggested-grid" style={{ gridArea: 'suggested' }}>
        <SuggestedPanel
          note={selectedNote}
          width={suggestedWidth}
          onTagsChanged={handleSidebarRefresh}
          refreshTrigger={sidebarRefreshTrigger}
        />
      </div>

      {/* Right divider (fixed, not draggable) */}
      <div
        className="grid-divider divider-right"
        style={{ gridArea: 'd-right' }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Fixed separator"
      />

      {/* Utility fixed */}
      <div className="utility-grid" style={{ gridArea: 'utility' }}>
        <div className="utility-area" aria-hidden="true" />
      </div>

      {/* Viewer/editor */}
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
