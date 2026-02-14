import React, { useState, useEffect } from 'react';
import { Note } from '../shared/types';
import './App.css';

export const App: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [content, setContent] = useState('');
  const [newNoteTitle, setNewNoteTitle] = useState('');

  useEffect(() => {
    loadNotes();
  }, []);

  const loadNotes = async () => {
    const allNotes = await window.electronAPI.getAllNotes();
    setNotes(allNotes);
  };

  const handleCreateNote = async () => {
    if (!newNoteTitle.trim()) return;
    
    const note = await window.electronAPI.createNote(newNoteTitle);
    setNotes([note, ...notes]);
    setNewNoteTitle('');
    setSelectedNote(note);
    setContent('');
  };

  const handleSelectNote = async (note: Note) => {
    setSelectedNote(note);
    const noteContent = await window.electronAPI.loadNote(note.id);
    setContent(noteContent);
  };

  const handleSaveNote = async () => {
    if (!selectedNote) return;
    
    await window.electronAPI.saveNote(selectedNote.id, content);
    await loadNotes();
  };

  const handleDeleteNote = async (id: number) => {
    await window.electronAPI.deleteNote(id);
    if (selectedNote?.id === id) {
      setSelectedNote(null);
      setContent('');
    }
    await loadNotes();
  };

  return (
    <div className="app">
      <div className="sidebar">
        <div className="new-note">
          <input
            type="text"
            placeholder="New note title..."
            value={newNoteTitle}
            onChange={(e) => setNewNoteTitle(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleCreateNote()}
          />
          <button onClick={handleCreateNote}>Create</button>
        </div>
        <div className="notes-list">
          {notes.map((note) => (
            <div
              key={note.id}
              className={`note-item ${selectedNote?.id === note.id ? 'selected' : ''}`}
              onClick={() => handleSelectNote(note)}
            >
              <div className="note-title">{note.title}</div>
              <div className="note-date">{new Date(note.updatedAt).toLocaleDateString()}</div>
              <button
                className="delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteNote(note.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="editor">
        {selectedNote ? (
          <>
            <div className="editor-header">
              <h2>{selectedNote.title}</h2>
              <button onClick={handleSaveNote}>Save</button>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Start typing..."
            />
          </>
        ) : (
          <div className="empty-state">
            <p>Select a note or create a new one</p>
          </div>
        )}
      </div>
    </div>
  );
};
