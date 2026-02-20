import React, { useEffect, useRef, useState } from 'react';
import { Note, Tag, NoteTag } from '../shared/types';
import './TagInput.scss';

interface TagInputProps {
  note: Note | null;
  onTagsChanged?: () => void;
}

/*
  Simplified TagInput:
  - Input bar on top
  - Active tags (and any placeholders) displayed below
  - No "Add" button (use Enter)
  - No suggestions/resize logic here (handled at app level)
*/

export const TagInput: React.FC<TagInputProps> = ({ note, onTagsChanged }) => {
  const [inputValue, setInputValue] = useState('');
  const [noteTags, setNoteTags] = useState<NoteTag[]>([]);
  const [placeholders, setPlaceholders] = useState<Record<number, Tag>>({});
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // normalize on the frontend too (defensive)
  const normalizeTagName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');

  useEffect(() => {
    if (note) {
      loadNoteTags();
      setPlaceholders({});
    } else {
      setNoteTags([]);
      setPlaceholders({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);

  const loadNoteTags = async () => {
    if (!note) return;
    const tags = await window.electronAPI.getNoteTags(note.id);
    setNoteTags(tags);
  };

  const handleAddTag = async () => {
    if (!note || !inputValue.trim()) return;

    const normalized = normalizeTagName(inputValue);
    if (!normalized) return;

    const position = noteTags.length;
    await window.electronAPI.addTagToNote(note.id, normalized, position);
    setInputValue('');
    await loadNoteTags();
    inputRef.current?.focus();

    if (onTagsChanged) onTagsChanged();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTag();
    }
  };

  const handleActiveTagClick = async (index: number, tagId: number, tag: Tag) => {
    if (!note) return;

    const newNoteTags = [...noteTags];
    if (index >= 0 && index < newNoteTags.length && newNoteTags[index].tagId === tagId) {
      newNoteTags.splice(index, 1);
      setNoteTags(newNoteTags);
    } else {
      setNoteTags(prev => prev.filter(nt => nt.tagId !== tagId));
    }

    setPlaceholders(prev => ({ ...prev, [index]: tag }));
    await window.electronAPI.removeTagFromNote(note.id, tagId);

    if (onTagsChanged) {
      onTagsChanged();
    }
  };

  const handlePlaceholderClick = async (index: number, tag: Tag) => {
    if (!note) return;
    const normalized = normalizeTagName(tag.name);
    const position = index;
    await window.electronAPI.addTagToNote(note.id, normalized, position);

    setPlaceholders(prev => {
      const copy = { ...prev };
      delete copy[index];
      return copy;
    });

    await loadNoteTags();

    if (onTagsChanged) {
      onTagsChanged();
    }
  };

  const handlePlaceholderMouseLeave = async (index: number) => {
    setPlaceholders(prev => {
      const copy = { ...prev };
      delete copy[index];
      return copy;
    });

    await loadNoteTags();
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

    const newTags = [...noteTags];
    const [moved] = newTags.splice(draggedIndex, 1);
    newTags.splice(targetIndex, 0, moved);

    await window.electronAPI.reorderNoteTags(note.id, newTags.map(nt => nt.tagId));
    await loadNoteTags();
    setDraggedIndex(null);

    if (onTagsChanged) onTagsChanged();
  };

  const placeholderIndices = Object.keys(placeholders).map(k => parseInt(k, 10));
  const slotsCount = Math.max(
    noteTags.length + placeholderIndices.length,
    Math.max(...(placeholderIndices.length ? placeholderIndices : [-1]), -1) + 1,
    noteTags.length
  );

  if (!note) {
    return null;
  }

  return (
    <div className="tag-input-container">
      <div className="tag-input-section">
        <div className="tag-input-bar">
          <div className="tag-input-wrapper">
            <input
              ref={inputRef}
              type="text"
              className="tag-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type to add tag..."
              aria-label="Tag input"
            />
          </div>
        </div>

        <div className="tags-display" aria-live="polite">
          {Array.from({ length: slotsCount }).map((_, slotIdx) => {
            if (placeholders[slotIdx]) {
              const tag = placeholders[slotIdx];
              return (
                <div
                  key={`ph-${slotIdx}-${tag.id}`}
                  className="tag-pill suggested placeholder"
                  onClick={() => handlePlaceholderClick(slotIdx, tag)}
                  onMouseLeave={() => handlePlaceholderMouseLeave(slotIdx)}
                >
                  {tag.name}
                </div>
              );
            }

            const noteTag = noteTags[slotIdx];
            if (noteTag) {
              return (
                <div
                  key={noteTag.tagId}
                  className="tag-pill active"
                  draggable
                  onDragStart={() => handleDragStart(slotIdx)}
                  onDragOver={(e) => handleDragOver(e)}
                  onDrop={(e) => handleDrop(e, slotIdx)}
                  onClick={() => {
                    if (noteTag.tag) {
                      handleActiveTagClick(slotIdx, noteTag.tagId, noteTag.tag);
                    }
                  }}
                  title="Click to remove tag"
                >
                  {noteTag.tag?.name}
                </div>
              );
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
};
