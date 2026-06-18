import { useEffect, useRef, useState } from 'react';
import { useStore, visibleSize } from '../state/store';
import { useUI } from '../state/ui';
import type { ToolId } from '../state/store';
import type { ImageElement, ShapeKind } from '../lib/pdf';
import { uid } from '../lib/utils/id';
import {
  MousePointer2,
  ScanText,
  Type,
  Scissors,
  Paintbrush,
  Highlighter,
  Pencil,
  Square,
  Circle,
  Triangle,
  Diamond,
  Star,
  ArrowRight,
  Minus,
  Shapes,
  Eraser,
  ImagePlus,
  PenTool,
  Layers,
  type LucideIcon,
} from 'lucide-react';

interface ToolDef {
  id: ToolId;
  icon: LucideIcon;
  label: string;
  key?: string;
}

// Tools above the "Elemente" shapes menu.
const TOP: ToolDef[] = [
  { id: 'select', icon: MousePointer2, label: 'Auswählen', key: 'V' },
  { id: 'edit-text', icon: ScanText, label: 'Text scannen & bearbeiten', key: 'E' },
  { id: 'text', icon: Type, label: 'Text einfügen', key: 'T' },
  { id: 'cut', icon: Scissors, label: 'Ausschneiden', key: 'X' },
  { id: 'brush', icon: Paintbrush, label: 'Hintergrund-Pinsel', key: 'C' },
  { id: 'highlight', icon: Highlighter, label: 'Markieren', key: 'H' },
  { id: 'draw', icon: Pencil, label: 'Zeichnen', key: 'D' },
];

/** A shape choice inside the "Elemente" menu. Rectangle and ellipse keep their own
 *  element types; the rest are drawn as generic vector shapes (see shapes.ts). */
interface ShapeChoice {
  tool: ToolId;
  shapeKind?: ShapeKind;
  icon: LucideIcon;
  label: string;
}
const SHAPES: ShapeChoice[] = [
  { tool: 'rect', icon: Square, label: 'Rechteck' },
  { tool: 'ellipse', icon: Circle, label: 'Ellipse' },
  { tool: 'shape', shapeKind: 'triangle', icon: Triangle, label: 'Dreieck' },
  { tool: 'shape', shapeKind: 'diamond', icon: Diamond, label: 'Raute' },
  { tool: 'shape', shapeKind: 'star', icon: Star, label: 'Stern' },
  { tool: 'shape', shapeKind: 'arrow', icon: ArrowRight, label: 'Pfeil' },
  { tool: 'shape', shapeKind: 'line', icon: Minus, label: 'Linie' },
];

function ElementsMenu() {
  const activeTool = useStore((s) => s.activeTool);
  const setTool = useStore((s) => s.setTool);
  const setToolDefaults = useStore((s) => s.setToolDefaults);
  const shapeKind = useStore((s) => s.tool.shapeKind);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isShapeTool = activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'shape';
  const pick = (s: ShapeChoice) => {
    if (s.shapeKind) setToolDefaults({ shapeKind: s.shapeKind });
    setTool(s.tool);
    setOpen(false);
  };

  return (
    <div className="rail-menu" ref={ref}>
      <button
        className={`rail-btn ${isShapeTool ? 'active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Elemente · Formen einfügen"
      >
        <Shapes size={19} />
        <span className="rail-tip">Elemente</span>
      </button>
      {open && (
        <div className="rail-flyout">
          <div className="rail-flyout-head">Elemente</div>
          <div className="rail-flyout-grid">
            {SHAPES.map((s) => {
              const active = s.tool === 'shape' ? activeTool === 'shape' && shapeKind === s.shapeKind : activeTool === s.tool;
              return (
                <button
                  key={s.label}
                  className={`rail-flyout-item ${active ? 'active' : ''}`}
                  onClick={() => pick(s)}
                  title={s.label}
                >
                  <s.icon size={18} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function ToolRail() {
  const activeTool = useStore((s) => s.activeTool);
  const setTool = useStore((s) => s.setTool);
  const addElement = useStore((s) => s.addElement);
  const pages = useStore((s) => s.pages);
  const currentPageId = useStore((s) => s.currentPageId);
  const openSignature = useUI((s) => s.openSignature);
  const elementsPanelOpen = useUI((s) => s.elementsPanelOpen);
  const toggleElementsPanel = useUI((s) => s.toggleElementsPanel);
  const imgRef = useRef<HTMLInputElement>(null);

  const placeImage = (file: File) => {
    const page = pages.find((p) => p.id === currentPageId);
    if (!page) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const { width: vw, height: vh } = visibleSize(page);
        const aspect = img.width / img.height;
        let w = Math.min(vw * 0.45, img.width * 0.75);
        let h = w / aspect;
        if (h > vh * 0.45) {
          h = vh * 0.45;
          w = h * aspect;
        }
        const el: ImageElement = {
          id: uid('el'),
          type: 'image',
          x: (vw - w) / 2,
          y: (vh - h) / 2,
          width: w,
          height: h,
          opacity: 1,
          z: page.elements.reduce((m, e) => Math.max(m, e.z), 0) + 1,
          src,
          aspect,
        };
        addElement(page.id, el);
        setTool('select');
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="rail">
      {TOP.map((t) => (
        <button
          key={t.id}
          className={`rail-btn ${activeTool === t.id ? 'active' : ''}`}
          onClick={() => setTool(t.id)}
          title={t.key ? `${t.label} · ${t.key}` : t.label}
        >
          <t.icon size={19} />
          <span className="rail-tip">{t.label}</span>
        </button>
      ))}

      <ElementsMenu />

      <button
        className={`rail-btn ${activeTool === 'redact' ? 'active' : ''}`}
        onClick={() => setTool('redact')}
        title="Schwärzen · B"
      >
        <Eraser size={19} />
        <span className="rail-tip">Schwärzen</span>
      </button>

      <div className="rail-sep" />

      <button className="rail-btn" onClick={() => imgRef.current?.click()} title="Bild einfügen">
        <ImagePlus size={19} />
        <span className="rail-tip">Bild</span>
      </button>
      <button className="rail-btn" onClick={openSignature} title="Unterschrift">
        <PenTool size={19} />
        <span className="rail-tip">Unterschrift</span>
      </button>

      <div className="rail-spacer" />

      <button
        className={`rail-btn ${elementsPanelOpen ? 'active' : ''}`}
        onClick={toggleElementsPanel}
        title="Elemente-Übersicht (alle Bearbeitungen)"
      >
        <Layers size={19} />
        <span className="rail-tip">Elemente-Übersicht</span>
      </button>

      <input
        ref={imgRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) placeImage(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
