import React, { useEffect, useRef, useState } from 'react';
import { Note, NoteTag, Tag } from '../shared/types';
import './TagInput.scss';

interface TagInputProps {
  note: Note | null;
  onTagsChanged?: () => void;
}

export const TagInput: React.FC<TagInputProps> = ({ note, onTagsChanged }) => {
  const [inputValue, setInputValue] = useState('');
  const [noteTags, setNoteTags] = useState<NoteTag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  // placeholders: map from slot index -> Tag that was removed from that slot,
  // rendered in-place as a suggested pill until the mouse leaves that pill.
  const [placeholders, setPlaceholders] = useState<Record<number, Tag>>({});

  const inputRef = useRef<HTMLInputElement>(null);

  // normalize on the frontend too (defensive)
  const normalizeTagName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');

  // Load tags when note changes
  useEffect(() => {
    if (note) {
      loadNoteTags();
      loadAllTags();
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
    inputRef.current?.focus();

    if (onTagsChanged) onTagsChanged();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
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

    if (onTagsChanged) onTagsChanged();
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
    const [removed] = newTags.splice(draggedIndex, 1);
    newTags.splice(targetIndex, 0, removed);

    const tagIds = newTags.map(t => t.tagId);
    await window.electronAPI.reorderNoteTags(note.id, tagIds);

    setDraggedIndex(null);
    await loadNoteTags();

    if (onTagsChanged) onTagsChanged();
  };

  const handleDeleteNote = async () => {
    if (!note) return;

    if (!deleteArmed) {
      setDeleteArmed(true);
    } else {
      await window.electronAPI.deleteNote(note.id);
      setDeleteArmed(false);

      if (onTagsChanged) onTagsChanged();
    }
  };

  if (!note) {
    return null;
  }

  // Build placeholder-aware slots for rendering active tags and placeholders:
  const placeholderIndices = Object.keys(placeholders).map(k => parseInt(k, 10));
  const slotsCount = Math.max(
    noteTags.length + placeholderIndices.length,
    Math.max(...(placeholderIndices.length ? placeholderIndices : [-1]), -1) + 1,
    noteTags.length
  );

  return (
    <div className="tag-input-inner">
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
          />
        </div>
      </div>

      <div className="tags-display">
        {Array.from({ length: slotsCount }).map((_, slotIdx) => {
          if (placeholders[slotIdx]) {
            const tag = placeholders[slotIdx];
            return (
              <div
                key={`ph-${slotIdx}-${tag.id}`}
                className="tag-pill suggested placeholder"
                onClick={() => handlePlaceholderClick(slotIdx, tag)}
                onMouseLeave={() => handlePlaceholderMouseLeave(slotIdx)}
                onMouseEnter={() => {}}
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
                    (async () => {
                      await window.electronAPI.removeTagFromNote(note.id, noteTag.tagId);
                      setPlaceholders(prev => ({ ...prev, [slotIdx]: noteTag.tag as Tag }));
                      await loadNoteTags();
                      if (onTagsChanged) onTagsChanged();
                    })();
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
  );
};
