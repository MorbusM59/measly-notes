import React from 'react';
import './Utility.scss';

interface UtilityProps {
  onActionComplete?: () => void;
  onExportPdf?: (chooseFolder?: boolean) => Promise<void>;
}

export const Utility: React.FC<UtilityProps> = ({ onActionComplete, onExportPdf }) => {
  const handleSync = async () => {
    try {
      const res = await (window as any).electronAPI.triggerSync();
      console.log('Sync result', res);
      onActionComplete?.();
    } catch (err) {
      console.warn('triggerSync failed', err);
    }
  };

  const handleImport = async () => {
    try {
      const res = await (window as any).electronAPI.importFolder();
      console.log('Import result', res);
      onActionComplete?.();
    } catch (err) {
      console.warn('importFolder failed', err);
    }
  };

  const handlePurge = async () => {
    try {
      // confirm with user
      // Use simple confirm for now; UI modal can be added later
      if (!confirm('Permanently delete all notes in Trash? This cannot be undone.')) return;
      const res = await (window as any).electronAPI.purgeTrash();
      console.log('Purge result', res);
      onActionComplete?.();
    } catch (err) {
      console.warn('purgeTrash failed', err);
    }
  };

  const handleExportClick = async (e: React.MouseEvent) => {
    try {
      const reselect = e.shiftKey;
      if (onExportPdf) await onExportPdf(reselect);
    } catch (err) {
      console.warn('exportPdf failed', err);
    }
  };

  return (
    <div className="utility-controls">
      <button className="toolbar-btn sync-btn" title="Sync data folder" onClick={handleSync}>Sync</button>
      <button className="toolbar-btn import-btn" title="Import from folder" onClick={handleImport}>Import</button>
      <button className="toolbar-btn pdf-btn" title="Export to PDF (Shift+click to choose folder)" onClick={handleExportClick}>PDF</button>
      <button className="toolbar-btn danger trash-btn" title="Permanently purge Trash" onClick={handlePurge}>Clean</button>
    </div>
  );
};

export default Utility;
