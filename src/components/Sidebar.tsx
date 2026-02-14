import React, { useState, useEffect } from 'react';
import { Note, SearchResult } from '../shared/types';
import './Sidebar.css';

interface SidebarProps {
  onSelectNote: (note: Note) => void;
  selectedNote: Note | null;
  onNotesUpdate?: () => void;
}

type ViewMode = 'date' | 'category';
type SearchMode = 'none' | 'text' | 'tag';

export const Sidebar: React.FC<SidebarProps> = ({ onSelectNote, selectedNote }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('none');
  const [viewMode, setViewMode] = useState<ViewMode>('date');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [dateNotes, setDateNotes] = useState<Note[]>([]);
  const [categoryNotes, setCategoryNotes] = useState<{ [tagName: string]: Note[] }>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [totalNotes, setTotalNotes] = useState(0);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const notesPerPage = 20;

  // Load notes based on view mode
  useEffect(() => {
    if (searchMode === 'none') {
      if (viewMode === 'date') {
        loadDateNotes();
      } else {
        loadCategoryNotes();
      }
    }
  }, [viewMode, currentPage, searchMode]);

  const loadDateNotes = async () => {
    const result = await window.electronAPI.getNotesPage(currentPage, notesPerPage);
    setDateNotes(result.notes);
    setTotalNotes(result.total);
  };

  const loadCategoryNotes = async () => {
    const notes = await window.electronAPI.getNotesByPrimaryTag();
    setCategoryNotes(notes);
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

  const toggleCategory = (category: string) => {
    const newCollapsed = new Set(collapsedCategories);
    if (newCollapsed.has(category)) {
      newCollapsed.delete(category);
    } else {
      newCollapsed.add(category);
    }
    setCollapsedCategories(newCollapsed);
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
      {Object.entries(categoryNotes).map(([tagName, notes]) => (
        <div key={tagName} className="category-group">
          <div
            className="category-header"
            onClick={() => toggleCategory(tagName)}
          >
            <span className="category-arrow">
              {collapsedCategories.has(tagName) ? '▶' : '▼'}
            </span>
            <span className="category-name">{tagName}</span>
            <span className="category-count">({notes.length})</span>
          </div>
          
          {!collapsedCategories.has(tagName) && (
            <div className="category-notes">
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
          )}
        </div>
      ))}
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
