export interface Note {
  id: number;
  title: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface IElectronAPI {
  createNote: (title: string) => Promise<Note>;
  saveNote: (id: number, content: string) => Promise<void>;
  loadNote: (id: number) => Promise<string>;
  getAllNotes: () => Promise<Note[]>;
  deleteNote: (id: number) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
