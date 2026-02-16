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
      loadSuggestedTags();
      loadAllTags();
      setPlaceholders({});
    } else {
      setNoteTags([]);
      setSuggestedTags([]);
      setPlaceholders({});
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

    if (onTagsChanged) {
      onTagsChanged();
    }
  };

  // When a user clicks an active tag:
  // - optimistically remove it from the displayed active tags
  // - add a placeholder in the same slot so it appears as a suggested-pill there
  // - call backend to remove the tag
  // - the placeholder remains until mouse leaves it; on mouseleave we clear placeholder and refresh suggestions
  const handleActiveTagClick = async (index: number, tagId: number, tag: Tag) => {
    if (!note) return;

    // Optimistically update UI: remove from noteTags locally
    const newNoteTags = [...noteTags];
    // remove the element at index (if still present)
    if (index >= 0 && index < newNoteTags.length && newNoteTags[index].tagId === tagId) {
      newNoteTags.splice(index, 1);
      setNoteTags(newNoteTags);
    } else {
      // fallback: filter out by tagId
      setNoteTags(prev => prev.filter(nt => nt.tagId !== tagId));
    }

    // Place placeholder at the same index so it appears in-place as a suggested pill
    setPlaceholders(prev => ({ ...prev, [index]: tag }));

    // Fire backend removal (don't immediately reload suggestions; placeholder holds the spot)
    await window.electronAPI.removeTagFromNote(note.id, tagId);

    // Notify parent (sidebar) that tags changed
    if (onTagsChanged) {
      onTagsChanged();
    }
  };

  // Clicking a placeholder should re-add the tag at the original position
  const handlePlaceholderClick = async (index: number, tag: Tag) => {
    if (!note) return;
    const normalized = normalizeTagName(tag.name);
    const position = index; // try to reinsert at same position
    await window.electronAPI.addTagToNote(note.id, normalized, position);

    // remove placeholder
    setPlaceholders(prev => {
      const copy = { ...prev };
      delete copy[index];
      return copy;
    });

    // reload canonical lists
    await loadNoteTags();
    await loadSuggestedTags();

    if (onTagsChanged) {
      onTagsChanged();
    }
  };

  // When the mouse leaves the placeholder, clear it and refresh suggestions
  const handlePlaceholderMouseLeave = async (index: number) => {
    setPlaceholders(prev => {
      const copy = { ...prev };
      delete copy[index];
      return copy;
    });

    // refresh suggestions so the tag moves to its default suggested position (or vanishes)
    await loadSuggestedTags();
    // Ensure note tags are in sync
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

  // Build a rendering sequence that preserves placeholder slots and noteTags order.
  // We'll render positions from 0 up to (noteTags.length + numberOfPlaceholders),
  // placing either a noteTag (if exists at that index) or a placeholder (if one exists),
  // or nothing.
  const placeholderIndices = Object.keys(placeholders).map(k => parseInt(k, 10));
  const slotsCount = Math.max(noteTags.length + placeholderIndices.length, Math.max(...placeholderIndices, -1) + 1, noteTags.length);

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
        {Array.from({ length: slotsCount }).map((_, slotIdx) => {
          // If there's a placeholder for this slot, render it as a suggested pill
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

          // Otherwise, if there's a noteTag at this index, render it as active
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
                  // clicking an active tag removes it and creates a placeholder at this slot
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

        {/* Render suggested tags (external suggested area) */}
        {suggestedTags.map(tag => (
          <div
            key={tag.id}
            className="tag-pill suggested"
            onClick={() => handlePlaceholderClick(noteTags.length, tag)} // add at end if user clicks suggested
          >
            {tag.name}
          </div>
        ))}
      </div>
    </div>
  );
};
