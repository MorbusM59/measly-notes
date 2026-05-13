import './index.css';
import '@fortawesome/fontawesome-free/css/all.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';

if (!(window as any).electronAPI) {
  const warnOnce = new Set<string>();
  const createFallback = (prop: string) => (...args: any[]) => {
    if (!warnOnce.has(prop)) {
      warnOnce.add(prop);
      console.warn(`[renderer] electronAPI.${prop} is unavailable. Preload script may not be loaded.`);
    }
    return Promise.reject(new Error(`electronAPI.${prop} is unavailable`));
  };

  (window as any).electronAPI = new Proxy({}, {
    get: (_target, prop: string) => {
      if (prop === 'onOpenMdFile') {
        return (_callback: any) => ({ unsubscribe: () => {} });
      }
      if (prop === 'getPathForFile') {
        return (_file: File) => '';
      }
      return createFallback(prop);
    },
  });
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(React.createElement(App));
}
