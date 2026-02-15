export interface Note {
  id: number;
  title: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  lastEdited?: string | null; // ISO timestamp for last content edit
}

export interface Tag {
  id: number;
  name: string;
}

export interface NoteTag {
  noteId: number;
  tagId: number;
  position: number;
  tag?: Tag;
}

export interface SearchResult {
  note: Note;
  snippet?: string;
  matchType: 'title' | 'content' | 'tag';
}

export interface CategoryHierarchy {
  [primaryTag: string]: {
    notes: Note[];  // Notes with only primary tag
    secondary: {
      [secondaryTag: string]: {
        notes: Note[];  // Notes with primary + secondary but no tertiary
        tertiary: {
          [tertiaryTag: string]: Note[];  // Notes with all three tags
        };
      };
    };
  };
}

export interface CategoryData {
  hierarchy: CategoryHierarchy;
  uncategorizedNotes: Note[];
}

export interface IElectronAPI {
  createNote: (title: string) => Promise<Note>;
  saveNote: (id: number, content: string) => Promise<Note | null>; // returns updated Note
  updateNoteTitle: (id: number, title: string) => Promise<void>;
  loadNote: (id: number) => Promise<string>;
  getAllNotes: () => Promise<Note[]>;
  getNotesPage: (page: number, perPage: number) => Promise<{ notes: Note[]; total: number }>;
  deleteNote: (id: number) => Promise<void>;
  
  // Tag operations
  addTagToNote: (noteId: number, tagName: string, position: number) => Promise<NoteTag>;
  removeTagFromNote: (noteId: number, tagId: number) => Promise<void>;
  reorderNoteTags: (noteId: number, tagIds: number[]) => Promise<void>;
  getNoteTags: (noteId: number) => Promise<NoteTag[]>;
  getAllTags: () => Promise<Tag[]>;
  getTopTags: (limit: number) => Promise<Tag[]>;
  
  // Search operations
  searchNotes: (query: string) => Promise<SearchResult[]>;
  searchNotesByTag: (tagName: string) => Promise<SearchResult[]>;
  
  // Category view operations
  getNotesByPrimaryTag: () => Promise<{ [tagName: string]: Note[] }>;
  getCategoryHierarchy: () => Promise<CategoryData>;

  // Last edited helper
  getLastEditedNote: () => Promise<Note | null>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
