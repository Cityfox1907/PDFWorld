import { useRef } from 'react';
import { useStore } from '../state/store';
import { Undo2, Redo2, ZoomIn, ZoomOut, Download, FilePlus2, FolderOpen, Loader2 } from 'lucide-react';

export function TopBar() {
  const fileName = useStore((s) => s.fileName);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const exportPdf = useStore((s) => s.exportPdf);
  const exporting = useStore((s) => s.exporting);
  const mergeFile = useStore((s) => s.mergeFile);
  const reset = useStore((s) => s.reset);
  const mergeRef = useRef<HTMLInputElement>(null);

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
          <button className="seg-btn" onClick={() => setZoom(zoom - 0.15)} title="Verkleinern">
            <ZoomOut size={16} />
          </button>
          <button className="seg-btn zoom-label" onClick={() => setZoom(1)} title="Zoom zurücksetzen">
            {Math.round(zoom * 100)}%
          </button>
          <button className="seg-btn" onClick={() => setZoom(zoom + 0.15)} title="Vergrössern">
            <ZoomIn size={16} />
          </button>
        </div>
      </div>

      <div className="topbar-right">
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
        <button className="btn primary" onClick={() => void exportPdf()} disabled={exporting}>
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
