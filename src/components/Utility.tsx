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

  // Purge moved to Trash toggle in Sidebar; keep Utility focused on other actions.

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
      {/* Placeholder 'Clean' button kept for visual parity; actual purge lives on the Trash toggle */}
      <button
        className="toolbar-btn danger trash-btn"
        title="Permanently purge Trash"
        onClick={(e) => { e.preventDefault(); /* placeholder no-op */ }}
      >
        Clean
      </button>
    </div>
  );
};

export default Utility;
