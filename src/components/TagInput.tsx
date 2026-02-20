import React, { useEffect, useRef, useState } from 'react';
import { Note, Tag, NoteTag } from '../shared/types';
import './TagInput.scss';

interface TagInputProps {
  note: Note | null;
  onTagsChanged?: () => void;
}

/*
  TagInput: input on top, active tags below.
  - Clicking an active tag "arms" removal for that tag.
  - The armed tag is only removed once the mouse leaves that tag.
  - Clicking the same active tag again while still hovering cancels the armed removal.
*/

export const TagInput: React.FC<TagInputProps> = ({ note, onTagsChanged }) => {
  const [inputValue, setInputValue] = useState('');
  const [noteTags, setNoteTags] = useState<NoteTag[]>([]);
  const [placeholders, setPlaceholders] = useState<Record<number, Tag>>({});
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // which index is currently armed for deletion (clicked, awaiting mouseleave)
  const [deleteArmedIndex, setDeleteArmedIndex] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // normalize on the frontend too (defensive)
  const normalizeTagName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');

  useEffect(() => {
    if (note) {
      loadNoteTags();
      setPlaceholders({});
      setDeleteArmedIndex(null);
    } else {
      setNoteTags([]);
      setPlaceholders({});
      setDeleteArmedIndex(null);
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

  // Arm / disarm deletion on click (no immediate removal)
  const handleActiveTagClick = (index: number) => {
    setDeleteArmedIndex(prev => (prev === index ? null : index));
  };

  // On mouse leave, if this tag is armed, remove it and show placeholder
  const handleActiveTagMouseLeave = async (index: number, tag: Tag, tagId: number) => {
    if (deleteArmedIndex !== index) {
      return;
    }

    if (!note) return;

    try {
      await window.electronAPI.removeTagFromNote(note.id, tagId);
    } catch (err) {
      console.warn('Failed to remove tag', err);
      setDeleteArmedIndex(null);
      return;
    }

    setPlaceholders(prev => ({ ...prev, [index]: tag }));
    setDeleteArmedIndex(null);

    await loadNoteTags();

    if (onTagsChanged) onTagsChanged();
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
              const armed = deleteArmedIndex === slotIdx;
              return (
                <div
                  key={noteTag.tagId}
                  className={`tag-pill active${armed ? ' armed' : ''}`}
                  draggable
                  onDragStart={() => handleDragStart(slotIdx)}
                  onDragOver={(e) => handleDragOver(e)}
                  onDrop={(e) => handleDrop(e, slotIdx)}
                  onClick={() => handleActiveTagClick(slotIdx)}
                  onMouseLeave={() =>
                    handleActiveTagMouseLeave(slotIdx, noteTag.tag as Tag, noteTag.tagId)
                  }
                  title={armed ? 'Release mouse to remove tag' : 'Click to arm removal'}
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
