import { useRef } from 'react';
import { useStore, visibleSize } from '../state/store';
import { useUI } from '../state/ui';
import type { ToolId } from '../state/store';
import type { ImageElement } from '../lib/pdf';
import { uid } from '../lib/utils/id';
import {
  MousePointer2,
  ScanText,
  Type,
  Paintbrush,
  Highlighter,
  Pencil,
  Square,
  Circle,
  Eraser,
  ImagePlus,
  PenTool,
  type LucideIcon,
} from 'lucide-react';

interface ToolDef {
  id: ToolId;
  icon: LucideIcon;
  label: string;
  key?: string;
}

const TOP: ToolDef[] = [
  { id: 'select', icon: MousePointer2, label: 'Auswählen', key: 'V' },
  { id: 'edit-text', icon: ScanText, label: 'Text scannen & bearbeiten', key: 'E' },
  { id: 'text', icon: Type, label: 'Text einfügen', key: 'T' },
  { id: 'brush', icon: Paintbrush, label: 'Hintergrund-Pinsel', key: 'C' },
  { id: 'highlight', icon: Highlighter, label: 'Markieren', key: 'H' },
  { id: 'draw', icon: Pencil, label: 'Zeichnen', key: 'D' },
  { id: 'rect', icon: Square, label: 'Rechteck', key: 'R' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'O' },
  { id: 'redact', icon: Eraser, label: 'Schwärzen', key: 'B' },
];

export function ToolRail() {
  const activeTool = useStore((s) => s.activeTool);
  const setTool = useStore((s) => s.setTool);
  const addElement = useStore((s) => s.addElement);
  const pages = useStore((s) => s.pages);
  const currentPageId = useStore((s) => s.currentPageId);
  const openSignature = useUI((s) => s.openSignature);
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

      <div className="rail-sep" />

      <button className="rail-btn" onClick={() => imgRef.current?.click()} title="Bild einfügen">
        <ImagePlus size={19} />
        <span className="rail-tip">Bild</span>
      </button>
      <button className="rail-btn" onClick={openSignature} title="Unterschrift">
        <PenTool size={19} />
        <span className="rail-tip">Unterschrift</span>
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
