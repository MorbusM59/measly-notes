import React, { useState, useEffect } from 'react';
import { Note, SearchResult, CategoryHierarchy } from '../shared/types';
import { DateFilter } from './DateFilter';
import { YearValue } from '../shared/filterConstants';
import './Sidebar.css';

interface SidebarProps {
  onSelectNote: (note: Note) => void;
  selectedNote: Note | null;
  onNotesUpdate?: () => void;
  refreshTrigger?: number;
  selectedMonths?: Set<number>;
  selectedYears?: Set<number | 'older'>;
  onMonthToggle?: (month: number, event: React.MouseEvent) => void;
  onYearToggle?: (year: YearValue, event: React.MouseEvent) => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  width?: number;
  onNoteDelete?: (noteId: number, nextNoteToSelect?: Note | null) => void;
}

type ViewMode = 'date' | 'category';
type SearchMode = 'none' | 'text' | 'tag';

export const Sidebar: React.FC<SidebarProps> = ({ 
  onSelectNote, 
  selectedNote, 
  refreshTrigger,
  selectedMonths = new Set(),
  selectedYears = new Set(),
  onMonthToggle,
  onYearToggle,
  viewMode: externalViewMode = 'date',
  onViewModeChange,
  width = 320,
  onNoteDelete
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('none');
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>('date');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [dateNotes, setDateNotes] = useState<Note[]>([]);
  const [categoryHierarchy, setCategoryHierarchy] = useState<CategoryHierarchy>({});
  const [uncategorizedNotes, setUncategorizedNotes] = useState<Note[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalNotes, setTotalNotes] = useState(0);
  const [collapsedPrimary, setCollapsedPrimary] = useState<Set<string>>(new Set());
  const [collapsedSecondary, setCollapsedSecondary] = useState<Set<string>>(new Set());
  const [deleteArmedId, setDeleteArmedId] = useState<number | null>(null);
  const notesPerPage = 20;
  
  // Use external viewMode if provided, otherwise use internal
  const viewMode = onViewModeChange ? externalViewMode : internalViewMode;
  
  const handleViewModeChange = (mode: ViewMode) => {
    if (onViewModeChange) {
      onViewModeChange(mode);
    } else {
      setInternalViewMode(mode);
    }
  };

  // Load notes based on view mode
  useEffect(() => {
    if (searchMode === 'none') {
      if (viewMode === 'date') {
        loadDateNotes();
      } else {
        loadCategoryHierarchy();
      }
    }
  }, [viewMode, currentPage, searchMode, refreshTrigger]);

  const loadDateNotes = async () => {
    const result = await window.electronAPI.getNotesPage(currentPage, notesPerPage);
    setDateNotes(result.notes);
    setTotalNotes(result.total);
  };

  const loadCategoryHierarchy = async () => {
    const data = await window.electronAPI.getCategoryHierarchy();
    setCategoryHierarchy(data.hierarchy);
    setUncategorizedNotes(data.uncategorizedNotes);
  };

  // Auto-expand relevant categories when the hierarchy reloads or the selected note changes.
  // This makes tag changes reflect immediately in the menu: the note's primary and
  // secondary will be unfolded and all other primary/secondary entries will be folded in.
  useEffect(() => {
    // Only apply this behavior in category view and when not searching.
    if (viewMode !== 'category' || searchMode !== 'none') return;
    if (!selectedNote) return;
    if (!categoryHierarchy || Object.keys(categoryHierarchy).length === 0) return;

    const allPrimary = Object.keys(categoryHierarchy);
    // Build a flat list of all secondary keys across all primaries: "Primary:Secondary"
    const allSecondaryKeys = allPrimary.flatMap(p => Object.keys(categoryHierarchy[p]?.secondary ?? {}).map(s => `${p}:${s}`));

    let matched = false;

    for (const primary of allPrimary) {
      const pData = categoryHierarchy[primary];
      if (!pData) continue;

      // Primary-only notes
      if (pData.notes.some(n => n.id === selectedNote.id)) {
        // Open this primary (collapse all others)
        setCollapsedPrimary(new Set(allPrimary.filter(p => p !== primary)));
        // Fold in (collapse) all secondaries (for a clean overview)
        setCollapsedSecondary(new Set(allSecondaryKeys));
        matched = true;
        break;
      }

      // Check secondary and tertiary groups
      for (const [secondary, secData] of Object.entries(pData.secondary || {})) {
        // Notes directly under secondary
        if (secData.notes.some(n => n.id === selectedNote.id)) {
          setCollapsedPrimary(new Set(allPrimary.filter(p => p !== primary)));
          // Collapse all secondaries except the target one (so the target secondary is unfolded)
          setCollapsedSecondary(new Set(allSecondaryKeys.filter(k => k !== `${primary}:${secondary}`)));
          matched = true;
          break;
        }

        // Notes under tertiary groups
        for (const [tertiary, tNotes] of Object.entries(secData.tertiary || {})) {
          if (tNotes.some(n => n.id === selectedNote.id)) {
            setCollapsedPrimary(new Set(allPrimary.filter(p => p !== primary)));
            // Unfold the parent secondary and collapse all other secondaries
            setCollapsedSecondary(new Set(allSecondaryKeys.filter(k => k !== `${primary}:${secondary}`)));
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
      if (matched) break;
    }

    // If nothing matched (e.g. uncategorized note), fall back to collapsing all primaries
    // which results in the uncategorized header being visible but everything else folded.
    if (!matched) {
      setCollapsedPrimary(new Set(allPrimary)); // collapse all primaries
      setCollapsedSecondary(new Set(allSecondaryKeys)); // collapse all secondaries
    }
  }, [categoryHierarchy, selectedNote, refreshTrigger, viewMode, searchMode]);

  // Filter notes by date
  const filterNotesByDate = (note: Note): boolean => {
    const hasMonthFilter = selectedMonths.size > 0;
    const hasYearFilter = selectedYears.size > 0;
    
    // If no filters are active, show all notes
    if (!hasMonthFilter && !hasYearFilter) {
      return true;
    }
    
    const noteDate = new Date(note.updatedAt);
    const noteMonth = noteDate.getMonth() + 1; // JavaScript months are 0-indexed
    const noteYear = noteDate.getFullYear();
    
    // Check month filter
    const monthMatch = !hasMonthFilter || selectedMonths.has(noteMonth);
    
    // Check year filter
    let yearMatch = !hasYearFilter;
    if (hasYearFilter) {
      if (selectedYears.has(noteYear)) {
        yearMatch = true;
      } else if (selectedYears.has('older') && noteYear <= 2021) {
        yearMatch = true;
      }
    }
    
    return monthMatch && yearMatch;
  };

  // Filter notes list
  const getFilteredNotes = (notes: Note[]): Note[] => {
    return notes.filter(filterNotesByDate);
  };

  // Filter category hierarchy
  const getFilteredHierarchy = (hierarchy: CategoryHierarchy): CategoryHierarchy => {
    const filtered: CategoryHierarchy = {};
    
    Object.entries(hierarchy).forEach(([primaryTag, primaryData]) => {
      const filteredPrimary = {
        notes: getFilteredNotes(primaryData.notes),
        secondary: {} as CategoryHierarchy[string]['secondary']
      };
      
      Object.entries(primaryData.secondary).forEach(([secondaryTag, secondaryData]) => {
        const filteredSecondary = {
          notes: getFilteredNotes(secondaryData.notes),
          tertiary: {} as CategoryHierarchy[string]['secondary'][string]['tertiary']
        };
        
        Object.entries(secondaryData.tertiary).forEach(([tertiaryTag, notes]) => {
          const filteredTertiary = getFilteredNotes(notes);
          if (filteredTertiary.length > 0) {
            filteredSecondary.tertiary[tertiaryTag] = filteredTertiary;
          }
        });
        
        // Only include secondary if it has notes or tertiary groups
        if (filteredSecondary.notes.length > 0 || Object.keys(filteredSecondary.tertiary).length > 0) {
          filteredPrimary.secondary[secondaryTag] = filteredSecondary;
        }
      });
      
      // Only include primary if it has notes or secondary groups
      if (filteredPrimary.notes.length > 0 || Object.keys(filteredPrimary.secondary).length > 0) {
        filtered[primaryTag] = filteredPrimary;
      }
    });
    
    return filtered;
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchMode('none');
      return;
    }

    if (searchQuery.startsWith('#')) {
      // Tag search
      const tagName = searchQuery.substring(1);
      const results = await window.electronAPI.searchNotesByTag(tagName);
      setSearchResults(results);
      setSearchMode('tag');
    } else {
      // Text search
      const results = await window.electronAPI.searchNotes(searchQuery);
      setSearchResults(results);
      setSearchMode('text');
    }
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchMode('none');
    setSearchResults([]);
  };

  const togglePrimaryCategory = (category: string) => {
    // List of all primary tags available from current hierarchy
    const allPrimary = Object.keys(categoryHierarchy);

    const isCurrentlyCollapsed = collapsedPrimary.has(category);

    if (isCurrentlyCollapsed) {
      // Primary is currently collapsed -> open it and close all others.
      // Represent collapsedPrimary as all primaries except the one to open.
      const newCollapsedPrimary = new Set(allPrimary.filter(p => p !== category));
      setCollapsedPrimary(newCollapsedPrimary);

      // When opening a primary, collapse (fold in) all of its secondary categories
      // so the user sees a clean overview.
      const secondaries = Object.keys(categoryHierarchy[category]?.secondary ?? {});
      const secondaryKeys = secondaries.map(s => `${category}:${s}`);

      // Add these secondary keys to the collapsed set
      setCollapsedSecondary(prev => {
        const next = new Set(prev);
        secondaryKeys.forEach(k => next.add(k));
        return next;
      });

    } else {
      // Primary is currently open -> we should toggle all secondaries under this primary.
      // First, ensure this primary remains the only open primary (collapse all others).
      const newCollapsedPrimary = new Set(allPrimary.filter(p => p !== category));
      setCollapsedPrimary(newCollapsedPrimary);

      // Now toggle secondary groups under this primary:
      const secondaries = Object.keys(categoryHierarchy[category]?.secondary ?? {});
      const secondaryKeys = secondaries.map(s => `${category}:${s}`);

      if (secondaryKeys.length === 0) {
        // Nothing to toggle
        return;
      }

      // Determine if ALL secondaries are currently expanded (i.e., none of their keys are in collapsedSecondary)
      const allExpanded = secondaryKeys.every(k => !collapsedSecondary.has(k));

      const newCollapsedSecondary = new Set(collapsedSecondary);

      if (allExpanded) {
        // All expanded -> collapse them all (add all keys to collapsed set)
        secondaryKeys.forEach(k => newCollapsedSecondary.add(k));
      } else {
        // Not all expanded -> expand them all (remove their keys from collapsed set)
        secondaryKeys.forEach(k => newCollapsedSecondary.delete(k));
      }

      setCollapsedSecondary(newCollapsedSecondary);
    }
  };

  const toggleSecondaryCategory = (primaryTag: string, secondaryTag: string) => {
    const key = `${primaryTag}:${secondaryTag}`;

    // Ensure this primary becomes the only open primary (collapse all others)
    const allPrimary = Object.keys(categoryHierarchy);
    const newCollapsedPrimary = new Set(allPrimary.filter(p => p !== primaryTag));
    setCollapsedPrimary(newCollapsedPrimary);

    // Build the set of secondary keys that belong to this primary
    const secondaries = Object.keys(categoryHierarchy[primaryTag]?.secondary ?? {});
    const secondaryKeys = secondaries.map(s => `${primaryTag}:${s}`);

    const newCollapsedSecondary = new Set(collapsedSecondary);

    if (newCollapsedSecondary.has(key)) {
      // Currently collapsed -> open this one, collapse other secondaries within same primary
      secondaryKeys.forEach(k => {
        if (k !== key) newCollapsedSecondary.add(k);
      });
      newCollapsedSecondary.delete(key);
    } else {
      // Currently open -> collapse this one
      newCollapsedSecondary.add(key);
    }

    setCollapsedSecondary(newCollapsedSecondary);
  };

  const handleDeleteNote = async (e: React.MouseEvent, noteId: number) => {
    e.stopPropagation();
    
    if (deleteArmedId !== noteId) {
      // First click - arm the button
      setDeleteArmedId(noteId);
    } else {
      // Second click - find next note before deleting
      const nextNote = findNextNoteAfterDeletion(noteId);
      
      // Actually delete
      await window.electronAPI.deleteNote(noteId);
      setDeleteArmedId(null);
      
      // Notify parent to handle selection and refresh
      if (onNoteDelete) {
        onNoteDelete(noteId, nextNote);
      }
      
      // Reload the current view
      if (searchMode === 'none') {
        if (viewMode === 'date') {
          await loadDateNotes();
        } else {
          await loadCategoryHierarchy();
        }
      }
    }
  };

  const handleDeleteMouseLeave = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteArmedId(null);
  };

  // Helper function to get all visible notes in current view
  const getAllVisibleNotes = (): Note[] => {
    if (searchMode !== 'none') {
      return searchResults.map(r => r.note);
    }
    
    if (viewMode === 'date') {
      return getFilteredNotes(dateNotes);
    }
    
    // Category view - flatten hierarchy
    const notes: Note[] = [];
    const filteredHierarchy = getFilteredHierarchy(categoryHierarchy);
    
    Object.entries(filteredHierarchy).forEach(([, primaryData]) => {
      // Add secondary notes first
      Object.entries(primaryData.secondary).forEach(([, secondaryData]) => {
        notes.push(...secondaryData.notes);
        // Add tertiary notes
        Object.values(secondaryData.tertiary).forEach(tertiaryNotes => {
          notes.push(...tertiaryNotes);
        });
      });
      // Add primary-only notes last
      notes.push(...primaryData.notes);
    });
    
    // Add uncategorized notes
    const filteredUncategorized = getFilteredNotes(uncategorizedNotes);
    notes.push(...filteredUncategorized);
    
    return notes;
  };

  // Helper function to find next note after deletion
  const findNextNoteAfterDeletion = (deletedNoteId: number): Note | null => {
    const allNotes = getAllVisibleNotes();
    const currentIndex = allNotes.findIndex(n => n.id === deletedNoteId);
    
    if (currentIndex === -1) {
      // Note not found in current view, return null
      return null;
    }
    
    // If there's a note after this one, select it
    if (currentIndex < allNotes.length - 1) {
      return allNotes[currentIndex + 1];
    }
    
    // If this was the last note and there are other notes, select the previous one (now last)
    if (currentIndex > 0) {
      return allNotes[currentIndex - 1];
    }
    
    // No notes left
    return null;
  };

  const totalPages = Math.ceil(totalNotes / notesPerPage);

  const renderSearchResults = () => (
    <div className="search-results">
      <div className="search-header">
        <h3>Search Results ({searchResults.length})</h3>
        <button className="clear-search" onClick={handleClearSearch}>Clear</button>
      </div>
      {searchResults.map(result => (
        <div
          key={result.note.id}
          className={`note-item ${selectedNote?.id === result.note.id ? 'selected' : ''}`}
          onClick={() => onSelectNote(result.note)}
        >
          <div className="note-content">
            <div className="note-title">{result.note.title}</div>
            {result.snippet && (
              <div className="note-snippet">{result.snippet}</div>
            )}
            <div className="note-date">{new Date(result.note.updatedAt).toLocaleDateString()}</div>
          </div>
          <button
            className={`note-delete-btn ${deleteArmedId === result.note.id ? 'delete-armed' : ''}`}
            onClick={(e) => handleDeleteNote(e, result.note.id)}
            onMouseLeave={handleDeleteMouseLeave}
            title={deleteArmedId === result.note.id ? 'Click again to confirm deletion' : 'Delete note'}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );

  const renderDateView = () => {
    const filteredNotes = getFilteredNotes(dateNotes);
    
    return (
      <div className="date-view">
        <div className="notes-list">
          {filteredNotes.map(note => (
            <div
              key={note.id}
              className={`note-item ${selectedNote?.id === note.id ? 'selected' : ''}`}
              onClick={() => onSelectNote(note)}
            >
              <div className="note-content">
                <div className="note-title">{note.title}</div>
                <div className="note-date">{new Date(note.updatedAt).toLocaleDateString()}</div>
              </div>
              <button
                className={`note-delete-btn ${deleteArmedId === note.id ? 'delete-armed' : ''}`}
                onClick={(e) => handleDeleteNote(e, note.id)}
                onMouseLeave={handleDeleteMouseLeave}
                title={deleteArmedId === note.id ? 'Click again to confirm deletion' : 'Delete note'}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        
        {totalPages > 1 && (
          <div className="pagination">
            <button
              className="page-btn"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            >
              &lt;
            </button>
            <span className="page-info">
              {((currentPage - 1) * notesPerPage) + 1}-
              {Math.min(currentPage * notesPerPage, totalNotes)} of {totalNotes}
            </span>
            <button
              className="page-btn"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            >
              &gt;
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderCategoryView = () => {
    const filteredHierarchy = getFilteredHierarchy(categoryHierarchy);
    const filteredUncategorized = getFilteredNotes(uncategorizedNotes);
    
    return (
      <div className="category-view">
        {Object.entries(filteredHierarchy).map(([primaryTag, primaryData]) => {
        const isPrimaryCollapsed = collapsedPrimary.has(primaryTag);
        const primaryNoteCount = primaryData.notes.length + 
          Object.values(primaryData.secondary).reduce((sum, secData) => {
            return sum + secData.notes.length + 
              Object.values(secData.tertiary).reduce((tSum, tNotes) => tSum + tNotes.length, 0);
          }, 0);
        
        return (
          <div key={primaryTag} className="category-group">
            <div
              className="category-header primary"
              onClick={() => togglePrimaryCategory(primaryTag)}
            >
              <span className="category-arrow">
                {isPrimaryCollapsed ? '▶' : '▼'}
              </span>
              <span className="category-name">{primaryTag}</span>
              <span className="category-count">({primaryNoteCount})</span>
            </div>
            
            {!isPrimaryCollapsed && (
              <div className="category-content">
                {/* Secondary tags accordion */}
                {Object.entries(primaryData.secondary).map(([secondaryTag, secondaryData]) => {
                  const secKey = `${primaryTag}:${secondaryTag}`;
                  const isSecondaryCollapsed = collapsedSecondary.has(secKey);
                  const secNoteCount = secondaryData.notes.length + 
                    Object.values(secondaryData.tertiary).reduce((sum, tNotes) => sum + tNotes.length, 0);
                  
                  return (
                    <div key={secKey} className="secondary-group">
                      <div
                        className="category-header secondary"
                        onClick={() => toggleSecondaryCategory(primaryTag, secondaryTag)}
                      >
                        <span className="category-arrow">
                          {isSecondaryCollapsed ? '▶' : '▼'}
                        </span>
                        <span className="category-name">{secondaryTag}</span>
                        <span className="category-count">({secNoteCount})</span>
                      </div>
                      
                      {!isSecondaryCollapsed && (
                        <div className="secondary-content">
                          {/* Notes with primary + secondary but no tertiary */}
                          {secondaryData.notes.map(note => (
                            <div
                              key={note.id}
                              className={`note-item ${selectedNote?.id === note.id ? 'selected' : ''}`}
                              onClick={() => onSelectNote(note)}
                            >
                              <div className="note-content">
                                <div className="note-title">{note.title}</div>
                                <div className="note-date">{new Date(note.updatedAt).toLocaleDateString()}</div>
                              </div>
                              <button
                                className={`note-delete-btn ${deleteArmedId === note.id ? 'delete-armed' : ''}`}
                                onClick={(e) => handleDeleteNote(e, note.id)}
                                onMouseLeave={handleDeleteMouseLeave}
                                title={deleteArmedId === note.id ? 'Click again to confirm deletion' : 'Delete note'}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          
                          {/* Tertiary tags (visual dividers, not accordion) */}
                          {Object.entries(secondaryData.tertiary).map(([tertiaryTag, notes]) => (
                            <div key={tertiaryTag} className="tertiary-group">
                              <div className="tertiary-header">{tertiaryTag}</div>
                              {notes.map(note => (
                                <div
                                  key={note.id}
                                  className={`note-item ${selectedNote?.id === note.id ? 'selected' : ''}`}
                                  onClick={() => onSelectNote(note)}
                                >
                                  <div className="note-content">
                                    <div className="note-title">{note.title}</div>
                                    <div className="note-date">{new Date(note.updatedAt).toLocaleDateString()}</div>
                                  </div>
                                  <button
                                    className={`note-delete-btn ${deleteArmedId === note.id ? 'delete-armed' : ''}`}
                                    onClick={(e) => handleDeleteNote(e, note.id)}
                                    onMouseLeave={handleDeleteMouseLeave}
                                    title={deleteArmedId === note.id ? 'Click again to confirm deletion' : 'Delete note'}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                
                {/* Notes with only primary tag (at the end) */}
                {primaryData.notes.map(note => (
                  <div
                    key={note.id}
                    className={`note-item ${selectedNote?.id === note.id ? 'selected' : ''}`}
                    onClick={() => onSelectNote(note)}
                  >
                    <div className="note-content">
                      <div className="note-title">{note.title}</div>
                      <div className="note-date">{new Date(note.updatedAt).toLocaleDateString()}</div>
                    </div>
                    <button
                      className={`note-delete-btn ${deleteArmedId === note.id ? 'delete-armed' : ''}`}
                      onClick={(e) => handleDeleteNote(e, note.id)}
                      onMouseLeave={handleDeleteMouseLeave}
                      title={deleteArmedId === note.id ? 'Click again to confirm deletion' : 'Delete note'}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      
      {/* Uncategorized notes section */}
      {filteredUncategorized.length > 0 && (
        <div className="category-group">
          <div className="category-header primary uncategorized">
            <span className="category-name">Uncategorized</span>
            <span className="category-count">({filteredUncategorized.length})</span>
          </div>
          <div className="category-content">
            {filteredUncategorized.map(note => (
              <div
                key={note.id}
                className={`note-item ${selectedNote?.id === note.id ? 'selected' : ''}`}
                onClick={() => onSelectNote(note)}
              >
                <div className="note-content">
                  <div className="note-title">{note.title}</div>
                  <div className="note-date">{new Date(note.updatedAt).toLocaleDateString()}</div>
                </div>
                <button
                  className={`note-delete-btn ${deleteArmedId === note.id ? 'delete-armed' : ''}`}
                  onClick={(e) => handleDeleteNote(e, note.id)}
                  onMouseLeave={handleDeleteMouseLeave}
                  title={deleteArmedId === note.id ? 'Click again to confirm deletion' : 'Delete note'}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

  return (
    <div className="sidebar" style={{ width: `${width}px` }}>
      <div className="search-box">
        <input
          type="text"
          placeholder="Search notes or #tag..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyPress={handleSearchKeyPress}
        />
      </div>
      
      {searchMode === 'none' && (
        <div className="view-toggle">
          <button
            className={`toggle-btn ${viewMode === 'date' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('date')}
          >
            Date
          </button>
          <button
            className={`toggle-btn ${viewMode === 'category' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('category')}
          >
            Category
          </button>
        </div>
      )}
      
      <div className="sidebar-content">
        {searchMode !== 'none' ? renderSearchResults() : 
         viewMode === 'date' ? renderDateView() : 
         renderCategoryView()}
      </div>
      
      {searchMode === 'none' && (
        <DateFilter
          selectedMonths={selectedMonths}
          selectedYears={selectedYears}
          onMonthToggle={onMonthToggle}
          onYearToggle={onYearToggle}
        />
      )}
    </div>
  );
};
