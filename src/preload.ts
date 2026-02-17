import { contextBridge, ipcRenderer } from 'electron';
import { IElectronAPI, Note, NoteTag, Tag, SearchResult, CategoryHierarchyResult } from './shared/types';

/**
 * Simple runtime validators to avoid passing unexpected values to the main process.
 * These are intentionally minimal — they reduce accidental misuse and make it harder
 * for untrusted renderer code to invoke privileged IPCs with arbitrary payloads.
 */
function assertString(v: unknown, name = 'value'): asserts v is string {
  if (typeof v !== 'string') {
    throw new TypeError(`${name} must be a string`);
  }
}
function assertNonEmptyString(v: unknown, name = 'value'): asserts v is string {
  assertString(v, name);
  if (v.trim().length === 0) throw new TypeError(`${name} must be a non-empty string`);
}
function assertNumber(v: unknown, name = 'value'): asserts v is number {
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new TypeError(`${name} must be a number`);
  }
}
function assertPositiveInteger(v: unknown, name = 'value'): asserts v is number {
  assertNumber(v, name);
  if (!Number.isInteger(v) || v < 0) throw new TypeError(`${name} must be a non-negative integer`);
}
function assertStringArray(v: unknown, name = 'value'): asserts v is string[] {
  if (!Array.isArray(v)) throw new TypeError(`${name} must be an array`);
  for (const [i, item] of v.entries()) {
    if (typeof item !== 'string') throw new TypeError(`${name}[${i}] must be a string`);
  }
}

/**
 * Minimal, safe wrappers that call ipcRenderer.invoke after validating inputs.
 * Keep surface area small and explicit.
 */
const electronAPI: IElectronAPI & {
  setSpellcheckerLanguages: (langs: string[]) => Promise<{ ok: boolean; error?: string }>;
} = {
  // Notes
  createNote: async (title: string) => {
    assertString(title, 'title');
    // allow empty titles (editor enforces '# '), but coerce to string
    return (await ipcRenderer.invoke('create-note', String(title))) as Note;
  },

  saveNote: async (id: number, content: string) => {
    assertPositiveInteger(id, 'id');
    assertString(content, 'content');
    return (await ipcRenderer.invoke('save-note', id, content)) as Note | null;
  },

  updateNoteTitle: async (id: number, title: string) => {
    assertPositiveInteger(id, 'id');
    assertString(title, 'title');
    return (await ipcRenderer.invoke('update-note-title', id, title)) as void;
  },

  loadNote: async (id: number) => {
    assertPositiveInteger(id, 'id');
    return (await ipcRenderer.invoke('load-note', id)) as string;
  },

  getAllNotes: async () => {
    return (await ipcRenderer.invoke('get-all-notes')) as Note[];
  },

  getNotesPage: async (page: number, perPage: number) => {
    assertPositiveInteger(page, 'page');
    assertPositiveInteger(perPage, 'perPage');
    return (await ipcRenderer.invoke('get-notes-page', page, perPage)) as { notes: Note[]; total: number };
  },

  deleteNote: async (id: number) => {
    assertPositiveInteger(id, 'id');
    return (await ipcRenderer.invoke('delete-note', id)) as void;
  },

  // Tags
  addTagToNote: async (noteId: number, tagName: string, position: number) => {
    assertPositiveInteger(noteId, 'noteId');
    assertNonEmptyString(tagName, 'tagName');
    assertNumber(position, 'position');
    return (await ipcRenderer.invoke('add-tag-to-note', noteId, tagName, position)) as NoteTag;
  },

  removeTagFromNote: async (noteId: number, tagId: number) => {
    assertPositiveInteger(noteId, 'noteId');
    assertPositiveInteger(tagId, 'tagId');
    return (await ipcRenderer.invoke('remove-tag-from-note', noteId, tagId)) as void;
  },

  reorderNoteTags: async (noteId: number, tagIds: number[]) => {
    assertPositiveInteger(noteId, 'noteId');
    if (!Array.isArray(tagIds)) throw new TypeError('tagIds must be an array');
    tagIds.forEach((id, idx) => {
      if (typeof id !== 'number' || !Number.isInteger(id)) throw new TypeError(`tagIds[${idx}] must be an integer`);
    });
    return (await ipcRenderer.invoke('reorder-note-tags', noteId, tagIds)) as void;
  },

  getNoteTags: async (noteId: number) => {
    assertPositiveInteger(noteId, 'noteId');
    return (await ipcRenderer.invoke('get-note-tags', noteId)) as NoteTag[];
  },

  getAllTags: async () => {
    return (await ipcRenderer.invoke('get-all-tags')) as Tag[];
  },

  getTopTags: async (limit: number) => {
    assertPositiveInteger(limit, 'limit');
    return (await ipcRenderer.invoke('get-top-tags', limit)) as Tag[];
  },

  // Search
  searchNotes: async (query: string) => {
    assertString(query, 'query');
    return (await ipcRenderer.invoke('search-notes', query)) as SearchResult[];
  },

  searchNotesByTag: async (tagName: string) => {
    assertNonEmptyString(tagName, 'tagName');
    return (await ipcRenderer.invoke('search-notes-by-tag', tagName)) as SearchResult[];
  },

  // Category / last edited helpers
  getNotesByPrimaryTag: async () => {
    return (await ipcRenderer.invoke('get-notes-by-primary-tag')) as { [tagName: string]: Note[] };
  },

  getCategoryHierarchy: async () => {
    return (await ipcRenderer.invoke('get-category-hierarchy')) as CategoryHierarchyResult;
  },

  getLastEditedNote: async () => {
    return (await ipcRenderer.invoke('get-last-edited-note')) as Note | null;
  },

  // Runtime spellchecker control (routes to main)
  setSpellcheckerLanguages: async (langs: string[]) => {
    assertStringArray(langs, 'langs');
    try {
      const res = await ipcRenderer.invoke('set-spellchecker-languages', langs);
      return res as { ok: boolean; error?: string };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
export {}; // module
