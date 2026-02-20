import React, { useState, useEffect, useRef } from 'react';
import { Note, Tag, NoteTag } from '../shared/types';
import './TagInput.scss';

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
  const [placeholders, setPlaceholders] = useState<Record<number, Tag>>({});

  const inputRef = useRef<HTMLInputElement>(null);

  // Divider / suggestions resizing
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [suggestionsWidth, setSuggestionsWidth] = useState<number>(() => {
    const saved = localStorage.getItem('tag-suggestions-width');
    return saved ? parseInt(saved, 10) : 240;
  });
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);

  // normalize on the frontend too (defensive)
  const normalizeTagName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');

  // Load tags when note changes
  useEffect(() => {
    if (note) {
      loadNoteTags();
      loadSuggestedTags();
      loadAllTags();
      setPlaceholders({});
    } else {
      setNoteTags([]);
      setSuggestedTags([]);
      setPlaceholders({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);

  const loadNoteTags = async () => {
    if (!note) return;
    const tags = await window.electronAPI.getNoteTags(note.id);
    setNoteTags(tags);
  };

  const loadSuggestedTags = async () => {
    if (!note) return;
    const topTags = await window.electronAPI.getTopTags(30);
    const currentTagIds = new Set((await window.electronAPI.getNoteTags(note.id)).map(t => t.tagId));
    const filtered = topTags.filter(tag => !currentTagIds.has(tag.id));
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    setSuggestedTags(filtered.slice(0, 15));
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
    await loadSuggestedTags();

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

    await loadSuggestedTags();
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

    if (onTagsChanged) {
      onTagsChanged();
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

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingDivider(true);
  };

  useEffect(() => {
    if (!isDraggingDivider) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let newWidth = Math.round(rect.right - e.clientX);
      const min = 120;
      const max = Math.min(600, Math.round(rect.width - 120));
      if (newWidth < min) newWidth = min;
      if (newWidth > max) newWidth = max;
      setSuggestionsWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingDivider(false);
      localStorage.setItem('tag-suggestions-width', suggestionsWidth.toString());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingDivider, suggestionsWidth]);

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
    <div className="tag-input-container" ref={containerRef}>
      <div className="tag-left">
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

      <div
        className="tag-input-divider"
        onMouseDown={handleDividerMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={suggestionsWidth}
      />

      <div
        className="suggested-section"
        style={{ width: suggestionsWidth }}
      >
        <div className="suggested-tags" aria-hidden={suggestedTags.length === 0}>
          {suggestedTags.map(tag => (
            <div
              key={tag.id}
              className="tag-pill suggested"
              onClick={() => handlePlaceholderClick(noteTags.length, tag)}
            >
              {tag.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
