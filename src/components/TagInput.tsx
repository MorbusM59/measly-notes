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
  const inputRef = useRef<HTMLInputElement>(null);

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

  const loadSuggestedTags = async () => {
    if (!note) return;
    const topTags = await window.electronAPI.getTopTags(12);
    const currentTagIds = new Set((await window.electronAPI.getNoteTags(note.id)).map(t => t.tagId));
    setSuggestedTags(topTags.filter(tag => !currentTagIds.has(tag.id)));
  };

  const loadAllTags = async () => {
    const tags = await window.electronAPI.getAllTags();
    setAllTags(tags);
  };

  const handleAddTag = async () => {
    if (!note || !inputValue.trim()) return;

    const position = noteTags.length;
    await window.electronAPI.addTagToNote(note.id, inputValue.trim(), position);
    setInputValue('');
    await loadNoteTags();
    await loadSuggestedTags();
    inputRef.current?.focus();
    
    // Notify parent to refresh sidebar
    if (onTagsChanged) {
      onTagsChanged();
    }
  };

  const handleRemoveTag = async (tagId: number) => {
    if (!note) return;
    await window.electronAPI.removeTagFromNote(note.id, tagId);
    await loadNoteTags();
    await loadSuggestedTags();
    
    // Notify parent to refresh sidebar
    if (onTagsChanged) {
      onTagsChanged();
    }
  };

  const handleAddSuggestedTag = async (tagName: string) => {
    if (!note) return;
    const position = noteTags.length;
    await window.electronAPI.addTagToNote(note.id, tagName, position);
    await loadNoteTags();
    await loadSuggestedTags();
    
    // Notify parent to refresh sidebar
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
    
    // Notify parent to refresh sidebar
    if (onTagsChanged) {
      onTagsChanged();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTag();
    }
  };

  // Get autocomplete suggestions
  const getAutocompleteSuggestion = (): string | null => {
    if (!inputValue.trim()) return null;
    
    const input = inputValue.toLowerCase();
    const matchingTag = allTags.find(tag => 
      tag.name.toLowerCase().startsWith(input) && 
      !noteTags.some(nt => nt.tagId === tag.id)
    );
    
    return matchingTag ? matchingTag.name : null;
  };

  const autocompleteSuggestion = getAutocompleteSuggestion();

  if (!note) {
    return null;
  }

  return (
    <div className="tag-input-container">
      <div className="tag-input-wrapper">
        <input
          ref={inputRef}
          type="text"
          className="tag-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Add tag..."
        />
        {autocompleteSuggestion && (
          <div className="autocomplete-hint">
            {autocompleteSuggestion}
          </div>
        )}
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
            #{noteTag.tag?.name}
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
            ${tag.name}
          </div>
        ))}
      </div>
    </div>
  );
};
