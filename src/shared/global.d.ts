import type { IElectronAPI } from './types';

declare module '*.scss';

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

export {};