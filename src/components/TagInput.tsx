import React, { useEffect, useRef, useState } from 'react';
import { Note, Tag, NoteTag } from '../shared/types';
import './TagInput.scss';

interface TagInputProps {
  note: Note | null;
  onTagsChanged?: () => void;
  refreshTrigger?: number;
}

/*
  TagInput: simplified active-tags-only rendering (no lingering "ghost" placeholders).
  Deletion UX: first click arms, second click deletes immediately.
  Moving mouse away cancels the arm.
  refreshTrigger: when parent increments this, component reloads tags.
*/

export const TagInput: React.FC<TagInputProps> = ({ note, onTagsChanged, refreshTrigger }) => {
  const [inputValue, setInputValue] = useState('');
  const [noteTags, setNoteTags] = useState<NoteTag[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // which index is currently armed for deletion (clicked once)
  const [deleteArmedIndex, setDeleteArmedIndex] = useState<number | null>(null);
  // when set, we're renaming this tagId and inputValue holds the draft name
  const [renamingTagId, setRenamingTagId] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // defensive normalization
  const normalizeTagName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');

  useEffect(() => {
    if (note) {
      loadNoteTags();
      setDeleteArmedIndex(null);
    } else {
      setNoteTags([]);
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
      // If we're renaming an existing tag, call rename flow
      if (renamingTagId !== null) {
        const newName = inputValue.trim();
        if (!newName) return;
        try {
          window.electronAPI.renameTag(renamingTagId, newName).then((res) => {
            if (res && res.ok) {
              setRenamingTagId(null);
              setInputValue('');
              loadNoteTags();
              if (onTagsChanged) onTagsChanged();
            } else {
              console.warn('Rename failed', res?.error);
            }
          });
        } catch (err) {
          console.warn('renameTag call failed', err);
        }
        return;
      }

      handleAddTag();
    }
    if (e.key === 'Escape') {
      // cancel rename mode
      if (renamingTagId !== null) {
        setRenamingTagId(null);
        setInputValue('');
      }
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

      // No placeholder/ghost behavior anymore — simply reload active tags
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
          {noteTags.map((noteTag, slotIdx) => {
            const tag = noteTag.tag as Tag;
            const armed = deleteArmedIndex === slotIdx;
            return (
              <div
                key={noteTag.tagId}
                className={`tag-pill active${armed ? ' armed' : ''}`}
                draggable
                onDragStart={() => handleDragStart(slotIdx)}
                onDragOver={(e) => handleDragOver(e)}
                onDrop={(e) => handleDrop(e, slotIdx)}
                onClick={() => handleActiveTagClick(slotIdx, tag, noteTag.tagId)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  // start renaming: load tag name into input and focus
                  setRenamingTagId(noteTag.tagId);
                  setInputValue(tag?.name ?? '');
                  setTimeout(() => inputRef.current?.focus(), 10);
                }}
                onMouseLeave={() => handleActiveTagMouseLeave(slotIdx)}
                title={armed ? 'Click again to delete or move cursor away to cancel' : 'Click to arm deletion'}
              >
                {tag?.name}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
