import { createElement, useEffect, useRef, useState } from 'react';
import { useStore, visibleSize, type EditorPage } from '../state/store';
import { useUI } from '../state/ui';
import { renderPageToCanvas, type AnyElement } from '../lib/pdf';
import {
  Layers,
  PanelLeftClose,
  Type,
  Square,
  Circle,
  Highlighter,
  Pencil,
  Image as ImageIcon,
  PenTool,
  Eye,
  EyeOff,
  Trash2,
  Maximize2,
  Minimize2,
  type LucideIcon,
} from 'lucide-react';

const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2.5);

/** A short, human label for an element row. */
function elementLabel(el: AnyElement): string {
  switch (el.type) {
    case 'text': {
      const t = el.text.trim().replace(/\s+/g, ' ');
      return t ? t.slice(0, 42) : 'Leeres Textfeld';
    }
    case 'rect':
      return el.fill === '#000000' && !el.stroke ? 'Schwärzung' : 'Rechteck';
    case 'ellipse':
      return 'Ellipse';
    case 'highlight':
      return 'Markierung';
    case 'ink':
      return el.highlight ? 'Marker' : 'Zeichnung';
    case 'image':
      return 'Bild';
    case 'signature':
      return 'Unterschrift';
  }
}

function elementIcon(el: AnyElement): LucideIcon {
  switch (el.type) {
    case 'text':
      return Type;
    case 'rect':
      return Square;
    case 'ellipse':
      return Circle;
    case 'highlight':
      return Highlighter;
    case 'ink':
      return el.highlight ? Highlighter : Pencil;
    case 'image':
      return ImageIcon;
    case 'signature':
      return PenTool;
  }
}

/** Marker tint per element type, so the mini-map reads at a glance. */
function elementTint(el: AnyElement): string {
  switch (el.type) {
    case 'text':
      return 'var(--accent)';
    case 'ink':
      return el.highlight ? '#ff9f0a' : '#34c759';
    case 'highlight':
      return '#ff9f0a';
    case 'image':
    case 'signature':
      return '#af52de';
    default:
      return '#0a84ff';
  }
}

/**
 * The page mini-map: the real PDF page rendered small, with a tinted marker over every
 * edit so you see WHERE each element sits. Enlarging it (Maximize) shows the page big
 * enough to read — the "design overview" with the PDF visible behind the markers.
 */
function MiniMap({ page, big }: { page: EditorPage; big: boolean }) {
  const engine = useStore((s) => s.engine);
  const selectedId = useStore((s) => s.selectedElementId);
  const selectElement = useStore((s) => s.selectElement);
  const setTool = useStore((s) => s.setTool);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotation = (((page.baseRotation + page.addedRotation) % 360) + 360) % 360;
  const { width: vw, height: vh } = visibleSize(page);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const target = (big ? 520 : 300) * DPR;
    if (page.blank) {
      const ctx = canvas.getContext('2d');
      const scale = target / Math.max(vw, vh);
      canvas.width = Math.max(1, Math.floor(vw * scale));
      canvas.height = Math.max(1, Math.floor(vh * scale));
      if (ctx) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    void (async () => {
      try {
        const pdfPage = await engine.getPage(page.sourceKey, page.sourceIndex);
        if (cancelled) return;
        const view = pdfPage.getViewport({ scale: 1, rotation });
        const scale = target / Math.max(view.width, view.height);
        await renderPageToCanvas(pdfPage, canvas, scale, rotation);
      } catch {
        /* ignore render race */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, page.sourceKey, page.sourceIndex, page.blank, rotation, vw, vh, big]);

  const pick = (id: string) => {
    setTool('select');
    selectElement(id);
  };

  return (
    <div className={`minimap ${big ? 'big' : ''}`} style={{ aspectRatio: `${vw} / ${vh}` }}>
      <canvas ref={canvasRef} className="minimap-canvas" />
      <div className="minimap-markers">
        {page.elements.map((el) => (
          <button
            key={el.id}
            className={`minimap-mark ${selectedId === el.id ? 'active' : ''} ${el.hidden ? 'hidden' : ''}`}
            style={{
              left: `${(el.x / vw) * 100}%`,
              top: `${(el.y / vh) * 100}%`,
              width: `${(el.width / vw) * 100}%`,
              height: `${(el.height / vh) * 100}%`,
              '--mark-tint': elementTint(el),
            } as React.CSSProperties}
            title={elementLabel(el)}
            onClick={() => pick(el.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ElementRow({ page, el, index }: { page: EditorPage; el: AnyElement; index: number }) {
  const selectedId = useStore((s) => s.selectedElementId);
  const currentPageId = useStore((s) => s.currentPageId);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const selectElement = useStore((s) => s.selectElement);
  const setTool = useStore((s) => s.setTool);
  const updateElement = useStore((s) => s.updateElement);
  const deleteElement = useStore((s) => s.deleteElement);
  const commit = useStore((s) => s.commit);

  const selected = selectedId === el.id;

  const select = () => {
    setTool('select');
    if (currentPageId !== page.id) setCurrentPage(page.id);
    selectElement(el.id);
  };

  const toggleHidden = (e: React.MouseEvent) => {
    e.stopPropagation();
    commit(); // snapshot before the toggle so a single undo restores it
    updateElement(page.id, el.id, { hidden: !el.hidden });
  };

  const remove = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteElement(page.id, el.id);
  };

  return (
    <div
      className={`layer-row ${selected ? 'active' : ''} ${el.hidden ? 'is-hidden' : ''}`}
      onClick={select}
      role="button"
      tabIndex={0}
    >
      <span className="layer-icon" style={{ color: elementTint(el) }}>
        {createElement(elementIcon(el), { size: 15 })}
      </span>
      <span className="layer-label">{elementLabel(el)}</span>
      <span className="layer-num">{index + 1}</span>
      <div className="layer-actions">
        <button title={el.hidden ? 'Einblenden' : 'Ausblenden'} onClick={toggleHidden}>
          {el.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button className="danger" title="Löschen" onClick={remove}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function ElementsPanel() {
  const open = useUI((s) => s.elementsPanelOpen);
  const toggle = useUI((s) => s.toggleElementsPanel);
  const pages = useStore((s) => s.pages);
  const currentPageId = useStore((s) => s.currentPageId);
  const [big, setBig] = useState(false);

  const current = pages.find((p) => p.id === currentPageId) ?? pages[0];
  const total = pages.reduce((n, p) => n + p.elements.length, 0);
  // Show every page that carries edits; the current page first so the mini-map and the
  // list line up at the top.
  const withElements = pages
    .map((p, i) => ({ page: p, number: i + 1 }))
    .filter((x) => x.page.elements.length > 0);

  if (!open) return null;

  return (
    <aside className={`layers ${big ? 'wide' : ''}`}>
      <div className="layers-head">
        <span className="layers-title">
          <Layers size={15} /> Elemente · {total}
        </span>
        <button className="btn ghost icon" onClick={toggle} title="Übersicht schließen">
          <PanelLeftClose size={15} />
        </button>
      </div>

      {current && (
        <div className="layers-map-wrap">
          <div className="layers-map-head">
            <span>Überblick · Seite {pages.indexOf(current) + 1}</span>
            <button
              className="btn ghost icon sm"
              onClick={() => setBig((b) => !b)}
              title={big ? 'Verkleinern' : 'Überblick vergrössern'}
            >
              {big ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
          <MiniMap page={current} big={big} />
        </div>
      )}

      <div className="layers-list">
        {total === 0 && (
          <p className="layers-empty">
            Noch keine Bearbeitungen. Textfelder, Zeichnungen, Formen und Bilder erscheinen
            hier, sobald du sie hinzufügst.
          </p>
        )}
        {withElements.map(({ page, number }) => (
          <div key={page.id} className="layer-group">
            <div className="layer-group-head">Seite {number}</div>
            {[...page.elements]
              .sort((a, b) => b.z - a.z)
              .map((el, i) => (
                <ElementRow key={el.id} page={page} el={el} index={i} />
              ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
