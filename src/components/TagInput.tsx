import React, { useEffect, useRef, useState } from 'react';
import { Note, Tag, NoteTag } from '../shared/types';
import './TagInput.scss';

interface TagInputProps {
  note: Note | null;
  onTagsChanged?: () => void;
  refreshTrigger?: number;
}

/*
  TagInput: input on top, active tags below.
  Deletion UX: first click arms, second click deletes immediately.
  Moving mouse away cancels the arm.
  refreshTrigger: when parent increments this, component reloads tags.
*/

export const TagInput: React.FC<TagInputProps> = ({ note, onTagsChanged, refreshTrigger }) => {
  const [inputValue, setInputValue] = useState('');
  const [noteTags, setNoteTags] = useState<NoteTag[]>([]);
  const [placeholders, setPlaceholders] = useState<Record<number, Tag>>({});
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // which index is currently armed for deletion (clicked once)
  const [deleteArmedIndex, setDeleteArmedIndex] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // defensive normalization
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

  // reload when parent signals refresh (sibling panel changed tags)
  useEffect(() => {
    if (note) {
      loadNoteTags();
      setDeleteArmedIndex(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

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
      e.preventDefault();
      handleAddTag();
    }
  };

  // Click behavior:
  // - If click on a tag when it's not armed -> arm it
  // - If click on a tag when it's already armed -> delete it immediately
  const handleActiveTagClick = async (index: number, tag: Tag, tagId: number) => {
    if (!note) return;

    if (deleteArmedIndex === index) {
      // second click -> delete immediately
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
      return;
    }

    // first click -> arm
    setDeleteArmedIndex(index);
  };

  // Mouse leave cancels the armed deletion (do not delete)
  const handleActiveTagMouseLeave = (index: number) => {
    if (deleteArmedIndex === index) {
      setDeleteArmedIndex(null);
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
              const armed = deleteArmedIndex === slotIdx;
              return (
                <div
                  key={noteTag.tagId}
                  className={`tag-pill active${armed ? ' armed' : ''}`}
                  draggable
                  onDragStart={() => handleDragStart(slotIdx)}
                  onDragOver={(e) => handleDragOver(e)}
                  onDrop={(e) => handleDrop(e, slotIdx)}
                  onClick={() => handleActiveTagClick(slotIdx, noteTag.tag as Tag, noteTag.tagId)}
                  onMouseLeave={() => handleActiveTagMouseLeave(slotIdx)}
                  title={armed ? 'Click again to delete or move cursor away to cancel' : 'Click to arm deletion'}
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
