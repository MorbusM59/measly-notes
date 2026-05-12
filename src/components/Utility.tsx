import React, { useRef } from 'react';
import './Utility.scss';

interface UtilityProps {
  onActionComplete?: (purgedNoteIds?: number[]) => void;
  onExportPdf?: (chooseFolder?: boolean) => Promise<void>;
  onExportMd?: (chooseFolder?: boolean) => Promise<void>;
  
  autoSaveEnabled?: boolean;
  onToggleAutoSave?: () => void;

  hasSelectedNote?: boolean;

  logBase?: number;
  onLogBaseChange?: (base: number) => void;
}

export const Utility: React.FC<UtilityProps> = ({
  onActionComplete,
  onExportPdf,
  onExportMd,
  autoSaveEnabled = true,
  onToggleAutoSave,
  hasSelectedNote = false,
  logBase = 10,
  onLogBaseChange,
}) => {
  const [isEditingBase, setIsEditingBase] = React.useState(false);
  const [baseInput, setBaseInput] = React.useState(logBase.toString());
  const [trashArmed, setTrashArmed] = React.useState(false);
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

  const handleCleanClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    if (!trashArmed) {
      setTrashArmed(true);
      return;
    }

    try {
      const result = await window.electronAPI.purgeTrash();
      onActionComplete?.(result?.purgedNoteIds);
    } catch (err) {
      console.warn('purgeTrash failed', err);
    } finally {
      setTrashArmed(false);
    }
  };

  const handleExportClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    try {
      if (onExportPdf) {
        await onExportPdf(false);
      }
    } catch (err) {
      console.warn('exportPdf failed', err);
    }
  };

  const handleExportContextMenu = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      if (onExportPdf) {
        await onExportPdf(true);
      }
    } catch (err) {
      console.warn('exportPdf failed', err);
    }
  };

  const handleExportMdClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    try {
      if (onExportMd) {
        await onExportMd(false);
      }
    } catch (err) {
      console.warn('exportMd failed', err);
    }
  };

  const handleExportMdContextMenu = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      if (onExportMd) {
        await onExportMd(true);
      }
    } catch (err) {
      console.warn('exportMd failed', err);
    }
  };

  let historyButtonTitle = autoSaveEnabled ? "Auto-Save: ON" : "Auto-Save: OFF";

  return (
    <div className="utility-panel">
      <button
        className="utility-btn"
        type="button"
        onClick={handleSync}
        title="Sync data folder"
        aria-label="Sync data folder"
      >
        <i className="fa-solid fa-sync" aria-hidden="true" />
      </button>
      <button
        className="utility-btn"
        type="button"
        onClick={handleImport}
        title="Import from folder"
        aria-label="Import from folder"
      >
        <i className="fa-solid fa-file-import" aria-hidden="true" />
      </button>
      <button
        className="utility-btn"
        type="button"
        onClick={handleExportClick}
        onContextMenu={handleExportContextMenu}
        title="Export to PDF. Right-click to choose folder"
        aria-label="Export to PDF"
      >
        <i className="fa-solid fa-file-pdf" aria-hidden="true" />
      </button>
      <button
        className="utility-btn"
        type="button"
        onClick={handleExportMdClick}
        onContextMenu={handleExportMdContextMenu}
        title="Export to Markdown. Right-click to choose folder"
        aria-label="Export to Markdown"
      >
        <i className="fa-solid fa-file-code" aria-hidden="true" />
      </button>
      <button
        className={`utility-btn${trashArmed ? ' utility-btn--armed' : ''}`}
        type="button"
        onClick={handleCleanClick}
        onPointerLeave={() => setTrashArmed(false)}
        title={trashArmed ? 'Click again to permanently purge Trash' : 'Empty Trash'}
        aria-label="Empty Trash"
      >
        <i className="fa-solid fa-trash-can" aria-hidden="true" />
      </button>
      <div
        ref={historyGroupRef}
        className="utility-history-group"
      >
        {isEditingBase ? (
          <input
            className="utility-btn utility-btn--history"
            style={{ width: '40px', padding: '0 4px', textAlign: 'center', background: 'var(--markdown-editor-background)', color: 'var(--markdown-editor-foreground)', border: 'none' }}
            autoFocus
            value={baseInput}
            onChange={e => setBaseInput(e.target.value)}
            onBlur={() => {
              setIsEditingBase(false);
              setBaseInput(logBase.toString());
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const parsed = parseFloat(baseInput);
                if (!isNaN(parsed) && parsed > 0 && parsed !== 1) {
                  onLogBaseChange?.(parsed);
                } else {
                  setBaseInput(logBase.toString());
                }
                setIsEditingBase(false);
              } else if (e.key === 'Escape') {
                setIsEditingBase(false);
                setBaseInput(logBase.toString());
              }
            }}
          />
        ) : (
          <button
            className={`utility-btn utility-btn--history ${!autoSaveEnabled ? 'utility-btn--armed' : ''}`}
            type="button"
            onClick={onToggleAutoSave}
            onContextMenu={e => {
              e.preventDefault();
              setIsEditingBase(true);
              setBaseInput(logBase.toString());
            }}
            title={historyButtonTitle}
            aria-label="Toggle Auto-Save"
            disabled={!hasSelectedNote}
          >
            <i className="fa-solid fa-clock-rotate-left" style={{ opacity: autoSaveEnabled ? 1 : 0.5 }} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
};

export default Utility;
