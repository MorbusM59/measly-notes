import React, { useEffect, useState } from 'react';
import { Note, Tag } from '../shared/types';
import './SuggestedPanel.scss';

interface SuggestedPanelProps {
  note: Note | null;
  width: number;
  onTagsChanged?: () => void;
  refreshTrigger?: number;
}

const normalizeTagName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');

export const SuggestedPanel: React.FC<SuggestedPanelProps> = ({ note, width, onTagsChanged, refreshTrigger }) => {
  const [suggestedTags, setSuggestedTags] = useState<Tag[]>([]);

  useEffect(() => {
    if (note) loadSuggestedTags();
    else setSuggestedTags([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, refreshTrigger]);

  const loadSuggestedTags = async () => {
    if (!note) return;
    try {
      const topTags = await window.electronAPI.getTopTags(30);
      const currentTags = await window.electronAPI.getNoteTags(note.id);
      const currentTagIds = new Set(currentTags.map(t => t.tagId));
      const filtered = topTags.filter(t => !currentTagIds.has(t.id));
      filtered.sort((a, b) => a.name.localeCompare(b.name));
      setSuggestedTags(filtered.slice(0, 15));
    } catch (err) {
      console.warn('Failed to load suggested tags', err);
      setSuggestedTags([]);
    }
  };

  const handleAddSuggested = async (tagName: string) => {
    if (!note) return;
    try {
      const normalized = normalizeTagName(tagName);
      const currentTags = await window.electronAPI.getNoteTags(note.id);
      const position = currentTags.length;
      await window.electronAPI.addTagToNote(note.id, normalized, position);
      // reload suggestions and notify parent to refresh siblings
      await loadSuggestedTags();
      if (onTagsChanged) onTagsChanged();
    } catch (err) {
      console.warn('Failed to add suggested tag', err);
    }
  };

  return (
    <div className="suggested-tags" aria-hidden={suggestedTags.length === 0}>
      {suggestedTags.map(tag => (
        <div
          key={`s-${tag.id}`}
          className="tag-pill suggested"
          onClick={() => handleAddSuggested(tag.name)}
          title={`Add ${tag.name}`}
        >
          {tag.name}
        </div>
      ))}
      {suggestedTags.length === 0 && (
        <div className="suggested-empty">No suggestions</div>
      )}
    </div>
  );
};
