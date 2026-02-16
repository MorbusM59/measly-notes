import React, { useState, useEffect, useRef } from 'react';
import { Note, Tag, NoteTag } from '../shared/types';
import './TagInput.css';

interface TagInputProps {
  note: Note | null;
  onTagsChanged?: () => void;
}

export const TagInput: React.FC<TagInputProps> = ({ note, onTagsChanged }) => {
  const [inputValue, setInputValue] = useState('');
  const [noteTags, setNoteTags] = useState<NoteTag[]>([]);
  const [suggestedTags, setSuggestedTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // normalize on the frontend too (defensive)
  const normalizeTagName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');

  // Load tags when note changes
  useEffect(() => {
    if (note) {
      loadNoteTags();
      loadSuggestedTags();
      loadAllTags();
    } else {
      setNoteTags([]);
      setSuggestedTags([]);
    }
  }, [note]);

  const loadNoteTags = async () => {
    if (!note) return;
    const tags = await window.electronAPI.getNoteTags(note.id);
    setNoteTags(tags);
  };

  /**
   * Suggested tags handling:
   * - Get recent/popular tags from DB (the DB now filters to recent notes)
   * - Remove tags already attached to this note
   * - Sort alphabetically
   * - Limit display to top 15
   */
  const loadSuggestedTags = async () => {
    if (!note) return;
    // fetch more than 15 so that after filtering we can still show up to 15 options
    const topTags = await window.electronAPI.getTopTags(30);
    const currentTagIds = new Set((await window.electronAPI.getNoteTags(note.id)).map(t => t.tagId));
    const filtered = topTags.filter(tag => !currentTagIds.has(tag.id));
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    setSuggestedTags(filtered.slice(0, 20));
  };

  const loadAllTags = async () => {
    const tags = await window.electronAPI.getAllTags();
    setAllTags(tags);
  };

  const handleAddTag = async () => {
    if (!note || !inputValue.trim()) return;

    const normalized = normalizeTagName(inputValue);
    if (!normalized) return;

    const position = noteTags.length;
    await window.electronAPI.addTagToNote(note.id, normalized, position);
    setInputValue('');
    await loadNoteTags();
    await loadSuggestedTags();
    inputRef.current?.focus();

    if (onTagsChanged) {
      onTagsChanged();
    }
  };

  const handleRemoveTag = async (tagId: number) => {
    if (!note) return;
    await window.electronAPI.removeTagFromNote(note.id, tagId);
    await loadNoteTags();
    await loadSuggestedTags();
    
    if (onTagsChanged) {
      onTagsChanged();
    }
  };

  const handleAddSuggestedTag = async (tagName: string) => {
    if (!note) return;
    const normalized = normalizeTagName(tagName);
    const position = noteTags.length;
    await window.electronAPI.addTagToNote(note.id, normalized, position);
    await loadNoteTags();
    await loadSuggestedTags();
    
    if (onTagsChanged) {
      onTagsChanged();
    }
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (!note || draggedIndex === null || draggedIndex === targetIndex) return;

    // Reorder tags
    const newTags = [...noteTags];
    const [removed] = newTags.splice(draggedIndex, 1);
    newTags.splice(targetIndex, 0, removed);

    // Update positions in database
    const tagIds = newTags.map(t => t.tagId);
    await window.electronAPI.reorderNoteTags(note.id, tagIds);
    
    setDraggedIndex(null);
    await loadNoteTags();
    
    if (onTagsChanged) {
      onTagsChanged();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTag();
    }
  };

  const handleDeleteNote = async () => {
    if (!note) return;

    if (!deleteArmed) {
      setDeleteArmed(true);
    } else {
      await window.electronAPI.deleteNote(note.id);
      setDeleteArmed(false);
      
      if (onTagsChanged) {
        onTagsChanged();
      }
    }
  };

  const handleDeleteMouseLeave = () => {
    setDeleteArmed(false);
  };

  if (!note) {
    return null;
  }

  return (
    <div className="tag-input-container">
      <div className="tag-input-bar">
        <div className="tag-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="tag-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Add tag (spaces will become '-')"
          />
        </div>
        <button
          className={`delete-note-btn ${deleteArmed ? 'delete-armed' : ''}`}
          onClick={handleDeleteNote}
          onMouseLeave={handleDeleteMouseLeave}
          title={deleteArmed ? 'Click again to confirm deletion' : 'Delete note'}
        >
          ×
        </button>
      </div>
      
      <div className="tags-display">
        {noteTags.map((noteTag, index) => (
          <div
            key={noteTag.tagId}
            className="tag-pill active"
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e)}
            onDrop={(e) => handleDrop(e, index)}
          >
            {noteTag.tag?.name}
            <button
              className="tag-remove"
              onClick={() => handleRemoveTag(noteTag.tagId)}
            >
              ×
            </button>
          </div>
        ))}
        
        {suggestedTags.map(tag => (
          <div
            key={tag.id}
            className="tag-pill suggested"
            onClick={() => handleAddSuggestedTag(tag.name)}
          >
            {tag.name}
          </div>
        ))}
      </div>
    </div>
  );
};
