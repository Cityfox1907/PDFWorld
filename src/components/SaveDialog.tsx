import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { downloadBytes, baseName } from '../lib/utils/file';
import { X, Save, FolderInput, Loader2 } from 'lucide-react';

/**
 * Minimal typings for the File System Access API (Chromium). When present it lets
 * the user pick both the file name AND the destination folder via the native save
 * dialog; otherwise we fall back to a normal download into the browser's folder.
 */
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}
interface WritableFileStream {
  write(data: BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
}
interface SaveFileHandle {
  createWritable(): Promise<WritableFileStream>;
}
type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>;

/** Access showSaveFilePicker without a global augmentation (avoids lib.dom clashes). */
function getSaveFilePicker(): SaveFilePicker | undefined {
  if (typeof window === 'undefined') return undefined;
  const fn = (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof fn === 'function' ? (fn as SaveFilePicker) : undefined;
}

export function SaveDialog() {
  const open = useUI((s) => s.saveDialogOpen);
  const close = useUI((s) => s.closeSaveDialog);
  const fileName = useStore((s) => s.fileName);
  const buildExportBytes = useStore((s) => s.buildExportBytes);
  const exporting = useStore((s) => s.exporting);
  const showToast = useStore((s) => s.showToast);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const picker = getSaveFilePicker();
  const canPick = !!picker;
  const busyAll = busy || exporting;

  useEffect(() => {
    if (open) setName(`${baseName(fileName) || 'dokument'}-bearbeitet`);
  }, [open, fileName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyAll) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, busyAll]);

  if (!open) return null;
  const cleanName = (n: string) => n.replace(/\.pdf$/i, '').trim() || 'dokument';

  const finish = (sizeBytes: number) => {
    showToast(`Gespeichert · ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`, 'success');
    close();
  };

  const saveWithPicker = async () => {
    if (busyAll) return;
    if (!picker) return;
    // showSaveFilePicker must run inside the click gesture — open it first.
    let handle: SaveFileHandle;
    try {
      handle = await picker({
        suggestedName: `${cleanName(name)}.pdf`,
        types: [{ description: 'PDF-Dokument', accept: { 'application/pdf': ['.pdf'] } }],
      });
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return; // user cancelled the dialog
      console.error(err);
      showToast('Speichern fehlgeschlagen.', 'error');
      return;
    }
    setBusy(true);
    try {
      const bytes = await buildExportBytes();
      if (!bytes) return; // build failed → toast already shown
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const writable = await handle.createWritable();
      await writable.write(new Blob([ab], { type: 'application/pdf' }));
      await writable.close();
      finish(bytes.length);
    } catch (err) {
      console.error(err);
      showToast('Speichern fehlgeschlagen.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveWithDownload = async () => {
    if (busyAll) return;
    setBusy(true);
    try {
      const bytes = await buildExportBytes();
      if (!bytes) return;
      downloadBytes(bytes, `${cleanName(name)}.pdf`);
      finish(bytes.length);
    } finally {
      setBusy(false);
    }
  };

  const save = canPick ? saveWithPicker : saveWithDownload;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busyAll) close();
      }}
    >
      <div className="modal save-modal">
        <div className="modal-head">
          <h3>Speichern</h3>
          <button className="btn ghost icon" onClick={close} disabled={busyAll} title="Schliessen">
            <X size={16} />
          </button>
        </div>

        <label className="save-label">Dateiname</label>
        <div className="save-name-row">
          <input
            className="field save-name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
          <span className="save-ext">.pdf</span>
        </div>
        <p className="insp-hint">
          {canPick
            ? 'Im nächsten Schritt wählst du den Speicherort auf deinem Gerät.'
            : 'Die Datei wird in deinen Standard-Download-Ordner gespeichert.'}
        </p>

        <div className="modal-actions">
          <button className="btn ghost" onClick={close} disabled={busyAll}>
            Abbrechen
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={busyAll}>
            {busyAll ? <Loader2 size={16} className="spin" /> : canPick ? <FolderInput size={16} /> : <Save size={16} />}
            {busyAll ? 'Speichert…' : canPick ? 'Speicherort wählen…' : 'Herunterladen'}
          </button>
        </div>
      </div>
    </div>
  );
}
