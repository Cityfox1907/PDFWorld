import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { useMobileUi } from './mobileUi';
import { Undo2, Redo2, Download, Loader2, MoreHorizontal, ChevronLeft } from 'lucide-react';

/**
 * Compact mobile header: back-to-home, the document name, undo/redo, the overflow menu
 * and the primary Save action. Everything else (zoom, theme, append, pages …) lives in
 * the overflow sheet so the bar stays clean on a phone.
 */
export function MobileTopBar() {
  const fileName = useStore((s) => s.fileName);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const reset = useStore((s) => s.reset);
  const exporting = useStore((s) => s.exporting);
  const openSaveDialog = useUI((s) => s.openSaveDialog);
  const openSheet = useMobileUi((s) => s.open);
  const askConfirm = useMobileUi((s) => s.askConfirm);

  const goHome = () => {
    askConfirm({
      title: 'Zur Startseite zurück?',
      message: 'Nicht gespeicherte Änderungen gehen verloren.',
      confirmLabel: 'Verwerfen',
      danger: true,
      onConfirm: () => void reset(),
    });
  };

  return (
    <header className="m-topbar">
      <button className="m-icon-btn" onClick={goHome} aria-label="Zur Startseite">
        <ChevronLeft size={22} />
      </button>
      <div className="m-file" title={typeof fileName === 'string' ? fileName : undefined}>
        {fileName || 'Dokument'}
      </div>
      <div className="m-top-actions">
        <button className="m-icon-btn" onClick={undo} disabled={!canUndo} aria-label="Rückgängig">
          <Undo2 size={20} />
        </button>
        <button className="m-icon-btn" onClick={redo} disabled={!canRedo} aria-label="Wiederherstellen">
          <Redo2 size={20} />
        </button>
        <button className="m-icon-btn" onClick={() => openSheet('menu')} aria-label="Menü">
          <MoreHorizontal size={22} />
        </button>
        <button className="m-save" onClick={openSaveDialog} disabled={exporting} aria-label="Speichern">
          {exporting ? <Loader2 size={18} className="spin" /> : <Download size={18} />}
          <span>Speichern</span>
        </button>
      </div>
    </header>
  );
}
