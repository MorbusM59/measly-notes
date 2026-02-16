import type { IElectronAPI } from './types';

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

export {};