import { useCallback, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { FileUp, ScanText, Paintbrush, FormInput, Layers, ShieldCheck, Loader2 } from 'lucide-react';

const FEATURES = [
  { icon: ScanText, title: 'Text scannen & bearbeiten', desc: 'Bestehenden Text antippen — Schrift, Grösse, Stil und Farbe werden automatisch erkannt und übernommen.' },
  { icon: Paintbrush, title: 'Hintergrund-Pinsel', desc: 'Nimmt die exakte Hintergrundfarbe auf und überdeckt Inhalte unsichtbar.' },
  { icon: Layers, title: 'Seiten verwalten & zoomen', desc: 'Zusammenführen, sortieren, drehen — und in der Übersicht in die Texte hineinzoomen.' },
  { icon: FormInput, title: 'Formulare & Signatur', desc: 'Formularfelder ausfüllen, unterschreiben und Bilder platzieren.' },
];

export function Home() {
  const loadFile = useStore((s) => s.loadFile);
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return;
      void loadFile(file);
    },
    [loadFile],
  );

  const loading = status === 'loading';

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-head">
          <div className="home-badge">
            <ShieldCheck size={14} />
            100% lokal · nichts wird hochgeladen
          </div>
          <h1>
            PDF<span>World</span>
          </h1>
          <p className="home-sub">
            Die Light-Version von Adobe Acrobat. Bearbeite PDFs verlustfrei — direkt in deinem Browser.
          </p>
        </header>

        <div
          className={`dropzone ${dragging ? 'drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        >
          <div className="dropzone-icon">{loading ? <Loader2 size={28} className="spin" /> : <FileUp size={28} />}</div>
          <div className="dropzone-title">{loading ? 'PDF wird geöffnet…' : 'PDF hierher ziehen oder klicken'}</div>
          <div className="dropzone-hint">Deine Datei verlässt dein Gerät zu keinem Zeitpunkt.</div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {error && <div className="home-error">{error}</div>}

        <div className="home-features">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <div className="feature-icon">
                <f.icon size={18} />
              </div>
              <div>
                <div className="feature-title">{f.title}</div>
                <div className="feature-desc">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <footer className="home-foot">
          PDFWorld · entwickelt für maximale Qualität · powered by Fiko
        </footer>
      </div>
    </div>
  );
}
