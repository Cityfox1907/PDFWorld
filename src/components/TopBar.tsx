import { useRef } from 'react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { viewportBridge } from '../state/viewport';
import { Undo2, Redo2, ZoomIn, ZoomOut, Download, FilePlus2, FolderOpen, Loader2, Moon, Sun } from 'lucide-react';

export function TopBar() {
  const fileName = useStore((s) => s.fileName);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const openSaveDialog = useUI((s) => s.openSaveDialog);
  const exporting = useStore((s) => s.exporting);
  const mergeFile = useStore((s) => s.mergeFile);
  const reset = useStore((s) => s.reset);
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const mergeRef = useRef<HTMLInputElement>(null);

  // Multiplicative steps traverse the wide 25 %–2000 % range in a handful of clicks.
  // Route through the canvas so the magnification stays anchored on the centre of the
  // visible window (it falls back to a plain set if the canvas isn't mounted yet).
  const zoomBy = (factor: number) => {
    if (viewportBridge.zoomByCenter) viewportBridge.zoomByCenter(factor);
    else setZoom(zoom * factor);
  };
  // Reset to 100 % from wherever we are, keeping the centre anchored.
  const resetZoom = () => zoomBy(1 / zoom);

  return (
    <div className="topbar">
      <div className="topbar-left">
        <span className="brand">
          PDF<em>World</em>
        </span>
        <span className="file-pill" title={fileName}>
          {fileName || 'Dokument'}
        </span>
      </div>

      <div className="topbar-center">
        <div className="seg">
          <button className="seg-btn" onClick={undo} disabled={!canUndo} title="Rückgängig (⌘Z)">
            <Undo2 size={16} />
          </button>
          <button className="seg-btn" onClick={redo} disabled={!canRedo} title="Wiederherstellen (⌘⇧Z)">
            <Redo2 size={16} />
          </button>
        </div>
        <div className="seg">
          <button className="seg-btn" onClick={() => zoomBy(1 / 1.25)} title="Verkleinern" disabled={zoom <= 0.25}>
            <ZoomOut size={16} />
          </button>
          <button className="seg-btn zoom-label" onClick={resetZoom} title="Zoom zurücksetzen (100 %)">
            {Math.round(zoom * 100)}%
          </button>
          <button className="seg-btn" onClick={() => zoomBy(1.25)} title="Vergrössern (bis 2000 %)" disabled={zoom >= 20}>
            <ZoomIn size={16} />
          </button>
        </div>
      </div>

      <div className="topbar-right">
        <button
          className="btn ghost icon"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button className="btn ghost" onClick={() => mergeRef.current?.click()} title="Weiteres PDF anfügen">
          <FilePlus2 size={16} /> PDF anfügen
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            if (confirm('Aktuelles Dokument schliessen? Nicht gespeicherte Änderungen gehen verloren.')) void reset();
          }}
          title="Neues Dokument"
        >
          <FolderOpen size={16} /> Öffnen
        </button>
        <button className="btn primary" onClick={openSaveDialog} disabled={exporting}>
          {exporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
          {exporting ? 'Speichert…' : 'Speichern'}
        </button>
        <input
          ref={mergeRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void mergeFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
