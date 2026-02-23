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
  const [viewMode, setViewMode] = useState<'latest' | 'active' | 'archived' | 'trash'>('latest');

  // Draggable / layout state and constraints
  const SIDEBAR_MIN = 220;
  const TAG_MIN = 250;
  const TAG_DEFAULT = 350;
  const SUGGESTED_MIN = 150;
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

  // Keep a ref of the last user-set ratio (tag / (tag + suggested)).
  // This is used during window resize to preserve the user's relative sizes.
  const ratioRef = useRef<number>(tagWidth / Math.max(1, tagWidth + suggestedWidth));

  // Only left divider (between tag and suggested) is draggable
  const [isDraggingLeftDivider, setIsDraggingLeftDivider] = useState(false);

  // Global editor preview/edit mode
  const [showPreview, setShowPreview] = useState<boolean>(() => {
    return localStorage.getItem('markdown-show-preview') === 'true';
  });

  const appRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Keep selected note behavior as before
  useEffect(() => {
    (async () => {
      try {
        const last = await window.electronAPI.getLastEditedNote();
        if (last && isMountedRef.current) setSelectedNote(last);
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
      // Use Escape to toggle preview/edit mode instead of Shift+Enter
      if (e.key === 'Escape') {
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

    if (!isMountedRef.current) return;
    setShowPreview(false);
    localStorage.setItem('markdown-show-preview', 'false');

    const note = await window.electronAPI.createNote('Untitled');
    const initialContent = '# ';
    await window.electronAPI.saveNote(note.id, initialContent);

    if (!isMountedRef.current) return;
    setSelectedNote(note);
    setRefreshKey(k => k + 1);
  };

  const handleSelectNote = async (note: Note) => {
    try {
      await (window as any).electronAPI.requestForceSave();
    } catch (err) {
      console.warn('requestForceSave failed on note select', err);
    }
    if (isMountedRef.current) setSelectedNote(note);
  };

  const handleNoteUpdate = (updatedNote: Note) => {
    setSelectedNote(updatedNote);
    setRefreshKey(k => k + 1);
    setSidebarRefreshTrigger(t => t + 1);
  };

  const handleSidebarRefresh = () => {
    (async () => {
      setSidebarRefreshTrigger(t => t + 1);
      // If the selected note became 'deleted' or 'archived', switch to category view so it's visible
      try {
        if (!selectedNote) return;
        const tags = await window.electronAPI.getNoteTags(selectedNote.id);
        if (!tags || tags.length === 0) return;
        const primary = tags[0].tag?.name?.trim().toLowerCase();
        if (primary === 'deleted' || primary === 'archived') {
          if (viewMode === 'latest') {
            setViewMode(primary === 'deleted' ? 'trash' : 'archived');
          }
        }
      } catch (err) {
        // non-fatal
      }
    })();
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

  // When user drags the sidebar, we proportionally adjust tag/suggested to keep ratioRef.
  useEffect(() => {
    if (!isDraggingSidebar) return;

    const handleMove = (e: MouseEvent) => {
      if (!appRef.current) return;
      const rect = appRef.current.getBoundingClientRect();
      // clamp sidebar between minimum and something reasonable
      const maxSidebar = Math.max(SIDEBAR_MIN, rect.width - (TAG_MIN + SUGGESTED_MIN + UTILITY_FIXED + DIVIDER_W * 3));
      const newSidebar = clamp(Math.round(e.clientX - rect.left), SIDEBAR_MIN, maxSidebar);

      const availableMain = rect.width - newSidebar - (DIVIDER_W * 3) - UTILITY_FIXED;
      if (availableMain <= 0) {
        setSidebarWidth(newSidebar);
        return;
      }

      // Preserve the last user ratio (ratioRef); compute new widths from it but enforce minima
      const minSum = TAG_MIN + SUGGESTED_MIN;
      let newTag = Math.round(ratioRef.current * availableMain);
      let newSug = availableMain - newTag;

      if (newTag < TAG_MIN) {
        newTag = TAG_MIN;
        newSug = Math.max(SUGGESTED_MIN, availableMain - newTag);
      }
      if (newSug < SUGGESTED_MIN) {
        newSug = SUGGESTED_MIN;
        newTag = Math.max(TAG_MIN, availableMain - newSug);
      }

      setSidebarWidth(newSidebar);
      setTagWidth(newTag);
      setSuggestedWidth(newSug);
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
  }, [isDraggingSidebar]);

  // Left divider drag (between tag and suggested) � update ratioRef on drag end.
  useEffect(() => {
    if (!isDraggingLeftDivider) return;

    const handleMove = (e: MouseEvent) => {
      if (!appRef.current) return;
      const rect = appRef.current.getBoundingClientRect();
      const mainLeft = rect.left + sidebarWidth + DIVIDER_W;
      const mainRight = rect.right - (UTILITY_FIXED + DIVIDER_W * 2);
      const availableMain = Math.max(0, Math.round(mainRight - mainLeft));
      let newTag = clamp(Math.round(e.clientX - mainLeft), TAG_MIN, Math.max(TAG_MIN, availableMain - SUGGESTED_MIN));
      let newSug = Math.max(SUGGESTED_MIN, availableMain - newTag);

      // If availableMain smaller than minima, keep minima as best-effort.
      if (availableMain < TAG_MIN + SUGGESTED_MIN) {
        // distribute with priorities: keep tag at least TAG_MIN
        newTag = clamp(newTag, TAG_MIN, Math.max(TAG_MIN, availableMain - SUGGESTED_MIN));
        newSug = availableMain - newTag;
      }

      setTagWidth(newTag);
      setSuggestedWidth(newSug);
    };

    const handleUp = () => {
      setIsDraggingLeftDivider(false);
      // update ratioRef to the user's new ratio
      ratioRef.current = tagWidth / Math.max(1, tagWidth + suggestedWidth);
      localStorage.setItem('tag-input-width', String(tagWidth));
      localStorage.setItem('tag-suggestions-width', String(suggestedWidth));
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingLeftDivider]);

  // Window resize: preserve the last user ratio (ratioRef) and adjust tag/suggested accordingly.
  useEffect(() => {
    const handleResize = () => {
      if (!appRef.current) return;
      const rect = appRef.current.getBoundingClientRect();

      // compute available width for tag+suggested given current sidebar and fixed utility
      const availableMain = rect.width - sidebarWidth - (DIVIDER_W * 3) - UTILITY_FIXED;
      if (availableMain <= 0) return;

      const minSum = TAG_MIN + SUGGESTED_MIN;

      // If availableMain is large enough, use the stored ratio to compute widths.
      if (availableMain >= minSum) {
        let newTag = Math.round(ratioRef.current * availableMain);
        let newSug = availableMain - newTag;

        // enforce minima
        if (newTag < TAG_MIN) {
          newTag = TAG_MIN;
          newSug = Math.max(SUGGESTED_MIN, availableMain - newTag);
        }
        if (newSug < SUGGESTED_MIN) {
          newSug = SUGGESTED_MIN;
          newTag = Math.max(TAG_MIN, availableMain - newSug);
        }

        setTagWidth(newTag);
        setSuggestedWidth(newSug);
        return;
      }

      // If we don't have enough space for minima, fall back to minima distribution:
      setTagWidth(TAG_MIN);
      setSuggestedWidth(Math.max(SUGGESTED_MIN, availableMain - TAG_MIN));
    };

    window.addEventListener('resize', handleResize);
    // run once to ensure values consistent on load
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarWidth]);

  // Save ratio whenever user updates the widths programmatically (keeps ratioRef reasonably up-to-date)
  useEffect(() => {
    ratioRef.current = tagWidth / Math.max(1, tagWidth + suggestedWidth);
  }, [tagWidth, suggestedWidth]);

  // Grid columns and areas
  const gridTemplateColumns = `${sidebarWidth}px ${DIVIDER_W}px ${tagWidth}px ${DIVIDER_W}px ${suggestedWidth}px ${DIVIDER_W}px ${UTILITY_FIXED}px`;
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
          onNotesUpdate={handleSidebarRefresh}
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
        <div className="utility-area">
          <button
            className="toolbar-btn"
            title="Export to PDF (Shift+click to choose folder)"
            onClick={async (e) => {
              const reselect = e.shiftKey;
              try {
                // Determine export folder (persist in localStorage)
                const saved = localStorage.getItem('pdf-export-folder');
                let folder = saved && !reselect ? saved : null;
                if (!folder) {
                  folder = await (window as any).electronAPI.selectExportFolder();
                  if (!folder) return; // user cancelled
                  localStorage.setItem('pdf-export-folder', folder);
                }

                // Export whatever is currently visible (edit or view) � do not switch modes.

                // compute visible padding from the element we will export (preview or textarea)
                const previewEl = document.querySelector('.markdown-preview') as HTMLElement | null;
                const textareaEl = document.querySelector('.markdown-textarea') as HTMLTextAreaElement | null;
                // choose element to export based on current mode (showPreview)
                const origCandidate = showPreview ? (previewEl ?? textareaEl) : (textareaEl ?? previewEl);
                const container = origCandidate ?? document.querySelector('.editor-content') as HTMLElement | null;
                const style = container ? window.getComputedStyle(container) : null;
                const padTop = style ? parseFloat(style.paddingTop || '0') : 0;
                const padRight = style ? parseFloat(style.paddingRight || '0') : 0;
                const padBottom = style ? parseFloat(style.paddingBottom || '0') : 0;
                const padLeft = style ? parseFloat(style.paddingLeft || '0') : 0;

                // Create a print-only ghost element that copies `.editor-content` and sits at top-left
                // so printing produces a tightly-packed PDF without offsets. We inject print CSS
                // that hides all other content and sizes the ghost to the A4 printable width.
                // Use the selected preview or textarea element as the export source
                const orig = origCandidate as HTMLElement | null;
                if (!orig) return;

                // Remove any existing ghost
                const existingGhost = document.getElementById('pdf-export-ghost');
                if (existingGhost) existingGhost.remove();

                const ghost = document.createElement('div');
                ghost.id = 'pdf-export-ghost';

                // If the source is a textarea (edit mode), create a printable div that preserves
                // the textarea's text styling but renders as normal flow content to avoid line splitting.
                let clone: HTMLElement;
                try {
                  const isTextarea = orig.tagName === 'TEXTAREA' || orig.classList.contains('markdown-textarea');
                  if (isTextarea) {
                    const ta = orig as HTMLTextAreaElement;
                    const computed = window.getComputedStyle(ta);
                    const fontFamily = computed.fontFamily || 'monospace';
                    const fontSize = computed.fontSize || '16px';
                    // compute integer pixel line-height to avoid subpixel rounding issues
                    const lineHeight = computed.lineHeight;
                    let lhPx = 0;
                    if (lineHeight && lineHeight !== 'normal') {
                      lhPx = Math.round(parseFloat(lineHeight));
                    } else {
                      lhPx = Math.round(parseFloat(fontSize) * 1.2);
                    }

                    const printable = document.createElement('div');
                    printable.className = 'pdf-export-textarea-clone';
                    // Use textContent to preserve plaintext and newlines
                    printable.textContent = ta.value;
                    // Apply inline styles to mimic the textarea visual (but render as flow content)
                    printable.style.whiteSpace = 'pre-wrap';
                    printable.style.wordBreak = 'break-word';
                    printable.style.fontFamily = fontFamily;
                    printable.style.fontSize = fontSize;
                    printable.style.lineHeight = `${lhPx}px`;
                    printable.style.color = computed.color || '#000';
                    printable.style.background = 'white';
                    printable.style.padding = computed.padding || '0';
                    printable.style.margin = '0';
                    printable.style.overflow = 'visible';
                    // prevent page breaks inside this block
                    printable.style.pageBreakInside = 'avoid';
                    printable.style.breakInside = 'avoid';
                    ghost.appendChild(printable);
                    clone = printable;
                  } else {
                    // clone the selected element (preview) normally
                    clone = orig.cloneNode(true) as HTMLElement;
                    clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
                    // copy textarea values inside preview if any
                    try {
                      const origTextareas = Array.from(orig.querySelectorAll('textarea')) as HTMLTextAreaElement[];
                      const cloneTextareas = Array.from(clone.querySelectorAll('textarea')) as HTMLTextAreaElement[];
                      for (let i = 0; i < origTextareas.length; i++) {
                        const ota = origTextareas[i];
                        const cta = cloneTextareas[i];
                        if (cta && ota) {
                          cta.value = ota.value;
                          cta.textContent = ota.value;
                        }
                      }
                      } catch (err) {
                        console.warn('App: failed copying textarea values into clone', err);
                      }
                    ghost.appendChild(clone);
                  }
                } catch (err) {
                  // fallback to cloning orig
                  clone = orig.cloneNode(true) as HTMLElement;
                  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
                  ghost.appendChild(clone);
                }
                // keep hidden until print
                ghost.style.display = 'none';
                document.body.appendChild(ghost);

                // compute CSS that makes only the ghost visible during print and sizes it to A4 printable width
                const css = `
                  /* PDF export temporary styles */
                  @media print {
                    @page { size: A4; margin: calc(1cm + ${padTop}px) calc(1cm + ${padRight}px) calc(1cm + ${padBottom}px) calc(1cm + ${padLeft}px); }
                    html, body { margin: 0; background: white !important; }
                    /* hide everything except our ghost */
                    body > *:not(#pdf-export-ghost) { display: none !important; }
                    /* show ghost and its contents */
                    #pdf-export-ghost { display: block !important; position: relative !important; margin: 0 !important; background: white !important; }
                    /* width: A4 page width minus left/right page margins (1cm + visible padding each) */
                    #pdf-export-ghost { width: calc(210mm - ( (1cm + ${padLeft}px) + (1cm + ${padRight}px) )); }
                    /* remove borders and shadows from the ghost container itself, but preserve styling of nested elements */
                    #pdf-export-ghost { box-shadow: none !important; -webkit-box-shadow: none !important; border: none !important; outline: none !important; background: white !important; }

                    /* Printing tweaks to avoid splitting lines across pages. Preserve nested element styling,
                       but prevent page breaks inside block-level content where possible. Also ensure overflow
                       is visible so lines aren't clipped. */
                    #pdf-export-ghost, #pdf-export-ghost * { -webkit-print-color-adjust: exact !important; }
                    #pdf-export-ghost p,
                    #pdf-export-ghost pre,
                    #pdf-export-ghost code,
                    #pdf-export-ghost li,
                    #pdf-export-ghost h1,
                    #pdf-export-ghost h2,
                    #pdf-export-ghost h3,
                    #pdf-export-ghost h4,
                    #pdf-export-ghost h5,
                    #pdf-export-ghost h6,
                    #pdf-export-ghost blockquote {
                      page-break-inside: avoid !important;
                      break-inside: avoid !important;
                      -webkit-column-break-inside: avoid !important;
                      overflow: visible !important;
                    }
                    /* Avoid orphaning single lines across pages */
                    #pdf-export-ghost * { widows: 2; orphans: 2; }
                  }
                `;
                const styleEl = document.createElement('style');
                styleEl.id = 'pdf-export-style';
                styleEl.appendChild(document.createTextNode(css));
                document.head.appendChild(styleEl);

                // build file name: YY-MM-DD_<title truncated to 50>.pdf
                const now = new Date();
                const yy = String(now.getFullYear()).slice(-2);
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                const dd = String(now.getDate()).padStart(2, '0');
                const datePart = `${yy}-${mm}-${dd}`;
                const rawTitle = (selectedNote?.title ?? 'Untitled').trim() || 'Untitled';
                const sanitize = (s: string) => s.replace(/[<>:"/\\|?*]+/g, '_');
                const truncated = sanitize(rawTitle).substring(0, 50);
                const fileName = `${datePart}_${truncated}.pdf`;

                const res = await (window as any).electronAPI.exportPdf(folder, fileName);

                // clean up temporary styles and ghost element
                try {
                  const ex = document.getElementById('pdf-export-style'); if (ex) ex.remove();
                    } catch (err) {
                      console.warn('App: failed to create printable clone, falling back to node clone', err);
                    }
                try {
                  const g = document.getElementById('pdf-export-ghost'); if (g) g.remove();
                } catch (err) {
                  console.warn('App: cleanup of temporary export elements failed', err);
                }

                if (!res || !res.ok) {
                  console.warn('PDF export failed', res?.error);
                } else {
                  console.log('Exported PDF to', res.path);
                }

                // no temporary preview switching; nothing to restore here
              } catch (err) {
                console.warn('Export PDF error', err);
              }
            }}
          >
            Export PDF
          </button>
        </div>
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
