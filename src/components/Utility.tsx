import React, { useState, useRef, useEffect } from 'react';
import './Utility.scss';

interface UtilityProps {
  onActionComplete?: () => void;
  onExportPdf?: (chooseFolder?: boolean) => Promise<void>;
  currentHistoryCount?: number;
  hasSelectedNote?: boolean;
  onClearCurrentHistory?: () => void | Promise<void>;
  onClearAllHistory?: () => void | Promise<void>;
}

export const Utility: React.FC<UtilityProps> = ({
  onActionComplete,
  onExportPdf,
  currentHistoryCount = 0,
  hasSelectedNote = false,
  onClearCurrentHistory,
  onClearAllHistory,
}) => {
  const [armedState, setArmedState] = useState<'none' | 'current' | 'all'>('none');
  const historyGroupRef = useRef<HTMLDivElement>(null);

  const handleSync = async () => {
    try {
      await window.electronAPI.triggerSync();
      onActionComplete?.();
    } catch (err) {
      console.warn('triggerSync failed', err);
    }
  };

  const handleImport = async () => {
    try {
      await window.electronAPI.importFolder();
      onActionComplete?.();
    } catch (err) {
      console.warn('importFolder failed', err);
    }
  };

  const handleClean = async () => {
    try {
      await window.electronAPI.purgeTrash();
      onActionComplete?.();
    } catch (err) {
      console.warn('purgeTrash failed', err);
    }
  };

  const handleExportClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    try {
      if (onExportPdf) {
        await onExportPdf(event.shiftKey);
      }
    } catch (err) {
      console.warn('exportPdf failed', err);
    }
  };

  const handleHistoryRightClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.shiftKey) {
      // Handle "all" history
      if (armedState === 'all') {
        onClearAllHistory?.();
        setArmedState('none');
      } else {
        setArmedState('all');
      }
    } else {
      // Handle "current" history
      if (armedState === 'current') {
        if (canClearCurrentHistory) {
          onClearCurrentHistory?.();
        }
        setArmedState('none');
      } else {
        setArmedState('current');
      }
    }
  };

  const handleMouseLeave = () => {
    setArmedState('none');
  };

  const canClearCurrentHistory = hasSelectedNote && currentHistoryCount > 0;
  const isArmedForAll = armedState === 'all';
  const isArmedForCurrent = armedState === 'current' && canClearCurrentHistory;

  let historyButtonTitle = 'Right-click to arm history clearing. Shift + Right-click to arm for all notes.';
  if (isArmedForCurrent) {
    historyButtonTitle = 'Right-click again to clear history for this note.';
  } else if (isArmedForAll) {
    historyButtonTitle = 'Shift + Right-click again to clear history for ALL notes.';
  }

  return (
    <div className="utility-panel">
      <button
        className="utility-btn"
        type="button"
        onClick={handleSync}
        title="Sync data folder"
        aria-label="Sync data folder"
      >
        <span className="utility-icon utility-icon--sync" />
      </button>
      <button
        className="utility-btn"
        type="button"
        onClick={handleImport}
        title="Import from folder"
        aria-label="Import from folder"
      >
        <span className="utility-icon utility-icon--import" />
      </button>
      <button
        className="utility-btn"
        type="button"
        onClick={handleExportClick}
        title="Export to PDF. Shift-click to choose folder"
        aria-label="Export to PDF"
      >
        <span className="utility-icon utility-icon--pdf" />
      </button>
      <button
        className="utility-btn utility-btn--danger"
        type="button"
        onClick={handleClean}
        title="Permanently purge Trash"
        aria-label="Permanently purge Trash"
      >
        <span className="utility-icon utility-icon--clean" />
      </button>

      <div
        className="utility-history-group"
        onMouseLeave={handleMouseLeave}
      >
        <button
          className={`utility-btn ${isArmedForCurrent || isArmedForAll ? 'utility-btn--armed' : ''}`}
          type="button"
          onClick={() => setArmedState('none')}
          onContextMenu={handleHistoryRightClick}
          title={historyButtonTitle}
          aria-label="Manage edit history"
        >
          <span className="utility-icon utility-icon--history" />
          {currentHistoryCount > 0 && <span className="history-count-badge">{currentHistoryCount}</span>}
        </button>
      </div>
    </div>
  );
};

export default Utility;
