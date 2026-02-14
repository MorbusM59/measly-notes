import React, { useState, useEffect } from 'react';
import { Note, SearchResult, CategoryHierarchy } from '../shared/types';
import './Sidebar.css';

interface SidebarProps {
  onSelectNote: (note: Note) => void;
  selectedNote: Note | null;
  onNotesUpdate?: () => void;
  refreshTrigger?: number;
}

type ViewMode = 'date' | 'category';
type SearchMode = 'none' | 'text' | 'tag';

export const Sidebar: React.FC<SidebarProps> = ({ onSelectNote, selectedNote, refreshTrigger }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('none');
  const [viewMode, setViewMode] = useState<ViewMode>('date');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [dateNotes, setDateNotes] = useState<Note[]>([]);
  const [categoryHierarchy, setCategoryHierarchy] = useState<CategoryHierarchy>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [totalNotes, setTotalNotes] = useState(0);
  const [collapsedPrimary, setCollapsedPrimary] = useState<Set<string>>(new Set());
  const [collapsedSecondary, setCollapsedSecondary] = useState<Set<string>>(new Set());
  const notesPerPage = 20;

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
    const hierarchy = await window.electronAPI.getCategoryHierarchy();
    setCategoryHierarchy(hierarchy);
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
    const newCollapsed = new Set(collapsedPrimary);
    
    // Close all other primary categories
    if (!newCollapsed.has(category)) {
      // Open this one, close all others
      newCollapsed.clear();
      setCollapsedSecondary(new Set());  // Also clear secondary collapsed state
    } else {
      // Close this one
      newCollapsed.add(category);
    }
    
    setCollapsedPrimary(newCollapsed);
  };

  const toggleSecondaryCategory = (primaryTag: string, secondaryTag: string) => {
    const key = `${primaryTag}:${secondaryTag}`;
    const newCollapsed = new Set(collapsedSecondary);
    
    // Close all other secondary categories within this primary
    const primaryPrefix = `${primaryTag}:`;
    const toRemove: string[] = [];
    
    newCollapsed.forEach(k => {
      if (k.startsWith(primaryPrefix) && k !== key) {
        toRemove.push(k);
      }
    });
    
    toRemove.forEach(k => newCollapsed.delete(k));
    
    // Toggle this one
    if (newCollapsed.has(key)) {
      newCollapsed.delete(key);
    } else {
      newCollapsed.add(key);
    }
    
    setCollapsedSecondary(newCollapsed);
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
          <div className="note-title">{result.note.title}</div>
          {result.snippet && (
            <div className="note-snippet">{result.snippet}</div>
          )}
          <div className="note-date">{new Date(result.note.updatedAt).toLocaleDateString()}</div>
        </div>
      ))}
    </div>
  );

  const renderDateView = () => (
    <div className="date-view">
      <div className="notes-list">
        {dateNotes.map(note => (
          <div
            key={note.id}
            className={`note-item ${selectedNote?.id === note.id ? 'selected' : ''}`}
            onClick={() => onSelectNote(note)}
          >
            <div className="note-title">{note.title}</div>
            <div className="note-date">{new Date(note.updatedAt).toLocaleDateString()}</div>
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

  const renderCategoryView = () => (
    <div className="category-view">
      {Object.entries(categoryHierarchy).map(([primaryTag, primaryData]) => {
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
                              <div className="note-title">{note.title}</div>
                              <div className="note-date">{new Date(note.updatedAt).toLocaleDateString()}</div>
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
                                  <div className="note-title">{note.title}</div>
                                  <div className="note-date">{new Date(note.updatedAt).toLocaleDateString()}</div>
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
                    <div className="note-title">{note.title}</div>
                    <div className="note-date">{new Date(note.updatedAt).toLocaleDateString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="sidebar">
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
            onClick={() => setViewMode('date')}
          >
            Date
          </button>
          <button
            className={`toggle-btn ${viewMode === 'category' ? 'active' : ''}`}
            onClick={() => setViewMode('category')}
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
    </div>
  );
};
