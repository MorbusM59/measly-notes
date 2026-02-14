import { contextBridge, ipcRenderer } from 'electron';
import { IElectronAPI } from './shared/types';

const electronAPI: IElectronAPI = {
  createNote: (title: string) => ipcRenderer.invoke('create-note', title),
  saveNote: (id: number, content: string) => ipcRenderer.invoke('save-note', id, content),
  loadNote: (id: number) => ipcRenderer.invoke('load-note', id),
  getAllNotes: () => ipcRenderer.invoke('get-all-notes'),
  deleteNote: (id: number) => ipcRenderer.invoke('delete-note', id),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
