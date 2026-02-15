import { contextBridge, ipcRenderer } from 'electron';
import { IElectronAPI } from './shared/types';

const electronAPI: IElectronAPI = {
  createNote: (title: string) => ipcRenderer.invoke('create-note', title),
  saveNote: (id: number, content: string) => ipcRenderer.invoke('save-note', id, content), // returns Note
  updateNoteTitle: (id: number, title: string) => ipcRenderer.invoke('update-note-title', id, title),
  loadNote: (id: number) => ipcRenderer.invoke('load-note', id),
  getAllNotes: () => ipcRenderer.invoke('get-all-notes'),
  getNotesPage: (page: number, perPage: number) => ipcRenderer.invoke('get-notes-page', page, perPage),
  deleteNote: (id: number) => ipcRenderer.invoke('delete-note', id),
  
  // Tag operations
  addTagToNote: (noteId: number, tagName: string, position: number) => ipcRenderer.invoke('add-tag-to-note', noteId, tagName, position),
  removeTagFromNote: (noteId: number, tagId: number) => ipcRenderer.invoke('remove-tag-from-note', noteId, tagId),
  reorderNoteTags: (noteId: number, tagIds: number[]) => ipcRenderer.invoke('reorder-note-tags', noteId, tagIds),
  getNoteTags: (noteId: number) => ipcRenderer.invoke('get-note-tags', noteId),
  getAllTags: () => ipcRenderer.invoke('get-all-tags'),
  getTopTags: (limit: number) => ipcRenderer.invoke('get-top-tags', limit),
  
  // Search operations
  searchNotes: (query: string) => ipcRenderer.invoke('search-notes', query),
  searchNotesByTag: (tagName: string) => ipcRenderer.invoke('search-notes-by-tag', tagName),
  
  // Category view operations
  getNotesByPrimaryTag: () => ipcRenderer.invoke('get-notes-by-primary-tag'),
  getCategoryHierarchy: () => ipcRenderer.invoke('get-category-hierarchy'),
  getLastEditedNote: () => ipcRenderer.invoke('get-last-edited-note'),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
