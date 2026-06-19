import { useRef } from 'react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { useMobileUi } from './mobileUi';
import { MobileSheet } from './MobileSheet';
import { Files, FilePlus2, FolderOpen, Moon, Sun, Layers, type LucideIcon } from 'lucide-react';

function Item({ icon: Icon, title, sub, onClick, danger }: { icon: LucideIcon; title: string; sub?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`m-menu-item ${danger ? 'danger' : ''}`} onClick={onClick}>
      <span className="m-menu-ic">
        <Icon size={20} />
      </span>
      <span className="m-menu-text">
        <span className="m-menu-title">{title}</span>
        {sub && <span className="m-menu-sub">{sub}</span>}
      </span>
    </button>
  );
}

export function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mergeFile = useStore((s) => s.mergeFile);
  const reset = useStore((s) => s.reset);
  const setOrganizer = useUI((s) => s.setOrganizer);
  const openSheet = useMobileUi((s) => s.open);
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const mergeRef = useRef<HTMLInputElement>(null);

  const run = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <MobileSheet open={open} onClose={onClose} title="Menü">
      <div className="m-menu">
        <Item
          icon={Files}
          title="Seiten verwalten"
          sub="Sortieren, drehen, duplizieren, löschen"
          onClick={() => run(() => setOrganizer(true))}
        />
        <Item
          icon={Layers}
          title="Elemente-Übersicht"
          sub="Alle Bearbeitungen dieser Datei"
          onClick={() => run(() => openSheet('layers'))}
        />
        <Item
          icon={FilePlus2}
          title="PDF anfügen"
          sub="Ein weiteres PDF ans Ende hängen"
          onClick={() => mergeRef.current?.click()}
        />
        <Item
          icon={theme === 'dark' ? Sun : Moon}
          title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
          onClick={toggleTheme}
        />
        <Item
          icon={FolderOpen}
          title="Neues Dokument"
          sub="Aktuelles schließen"
          danger
          onClick={() =>
            run(() => {
              if (confirm('Aktuelles Dokument schliessen? Nicht gespeicherte Änderungen gehen verloren.')) void reset();
            })
          }
        />
      </div>

      <input
        ref={mergeRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            void mergeFile(f);
            onClose();
          }
          e.target.value = '';
        }}
      />
    </MobileSheet>
  );
}
