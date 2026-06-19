import { useRef } from 'react';
import { useStore, visibleSize, type ToolId } from '../state/store';
import { useUI } from '../state/ui';
import { useMobileUi } from './mobileUi';
import { uid } from '../lib/utils/id';
import { loadEmbeddableImage } from '../lib/utils/file';
import type { ImageElement } from '../lib/pdf';
import {
  MousePointer2,
  ScanText,
  Type,
  Pencil,
  Highlighter,
  Shapes,
  Paintbrush,
  Scissors,
  Eraser,
  ImagePlus,
  PenTool,
  Layers,
  type LucideIcon,
} from 'lucide-react';

interface DockTool {
  id: ToolId;
  icon: LucideIcon;
  label: string;
}

// The flat tools, in the order they appear in the scrolling dock.
const TOOLS: DockTool[] = [
  { id: 'select', icon: MousePointer2, label: 'Wählen' },
  { id: 'edit-text', icon: ScanText, label: 'Scan' },
  { id: 'text', icon: Type, label: 'Text' },
  { id: 'draw', icon: Pencil, label: 'Zeichnen' },
  { id: 'highlight', icon: Highlighter, label: 'Marker' },
  { id: 'brush', icon: Paintbrush, label: 'Pinsel' },
  { id: 'cut', icon: Scissors, label: 'Schneiden' },
  { id: 'redact', icon: Eraser, label: 'Schwärzen' },
];

const SHAPE_TOOLS: ToolId[] = ['rect', 'ellipse', 'shape'];

export function MobileDock() {
  const activeTool = useStore((s) => s.activeTool);
  const setTool = useStore((s) => s.setTool);
  const addElement = useStore((s) => s.addElement);
  const pages = useStore((s) => s.pages);
  const currentPageId = useStore((s) => s.currentPageId);
  const showToast = useStore((s) => s.showToast);
  const openSignature = useUI((s) => s.openSignature);
  const openSheet = useMobileUi((s) => s.open);
  const toggleSheet = useMobileUi((s) => s.toggle);
  const layersOpen = useMobileUi((s) => s.sheet === 'layers');
  const imgRef = useRef<HTMLInputElement>(null);

  const placeImage = async (file: File) => {
    const page = pages.find((p) => p.id === currentPageId);
    if (!page) return;
    const norm = await loadEmbeddableImage(file);
    if (!norm) {
      showToast('Bild konnte nicht geladen werden.', 'error');
      return;
    }
    const { src, width: iw, height: ih } = norm;
    const { width: vw, height: vh } = visibleSize(page);
    const aspect = iw / ih;
    let w = Math.min(vw * 0.6, iw * 0.75);
    let h = w / aspect;
    if (h > vh * 0.6) {
      h = vh * 0.6;
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

  const shapeActive = SHAPE_TOOLS.includes(activeTool);

  return (
    <nav className="m-dock" aria-label="Werkzeuge">
      <div className="m-dock-scroll">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`m-tool ${activeTool === t.id ? 'active' : ''}`}
            onClick={() => setTool(t.id)}
            aria-pressed={activeTool === t.id}
          >
            <t.icon size={22} />
            <span>{t.label}</span>
          </button>
        ))}

        <button className={`m-tool ${shapeActive ? 'active' : ''}`} onClick={() => openSheet('shapes')}>
          <Shapes size={22} />
          <span>Formen</span>
        </button>

        <span className="m-dock-sep" />

        <button className="m-tool" onClick={() => imgRef.current?.click()}>
          <ImagePlus size={22} />
          <span>Bild</span>
        </button>
        <button className="m-tool" onClick={openSignature}>
          <PenTool size={22} />
          <span>Signatur</span>
        </button>
        <button className={`m-tool ${layersOpen ? 'active' : ''}`} onClick={() => toggleSheet('layers')}>
          <Layers size={22} />
          <span>Ebenen</span>
        </button>
      </div>

      <input
        ref={imgRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void placeImage(f);
          e.target.value = '';
        }}
      />
    </nav>
  );
}
