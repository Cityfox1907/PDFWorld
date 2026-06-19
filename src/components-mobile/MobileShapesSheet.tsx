import { useStore, type ToolId } from '../state/store';
import type { ShapeKind } from '../lib/pdf';
import { MobileSheet } from './MobileSheet';
import { ParallelogramIcon, TrapezoidIcon } from '../components/shapeIcons';
import {
  Square,
  Circle,
  Triangle,
  TriangleRight,
  Diamond,
  Pentagon,
  Hexagon,
  Octagon,
  Star,
  Heart,
  Cloud,
  Plus,
  ChevronRight,
  ArrowRight,
  ArrowLeftRight,
  Minus,
  type LucideIcon,
} from 'lucide-react';

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
  { tool: 'shape', shapeKind: 'right-triangle', icon: TriangleRight, label: 'Rechtw. Dreieck' },
  { tool: 'shape', shapeKind: 'diamond', icon: Diamond, label: 'Raute' },
  { tool: 'shape', shapeKind: 'pentagon', icon: Pentagon, label: 'Fünfeck' },
  { tool: 'shape', shapeKind: 'hexagon', icon: Hexagon, label: 'Sechseck' },
  { tool: 'shape', shapeKind: 'octagon', icon: Octagon, label: 'Achteck' },
  { tool: 'shape', shapeKind: 'parallelogram', icon: ParallelogramIcon, label: 'Parallelogramm' },
  { tool: 'shape', shapeKind: 'trapezoid', icon: TrapezoidIcon, label: 'Trapez' },
  { tool: 'shape', shapeKind: 'star', icon: Star, label: 'Stern' },
  { tool: 'shape', shapeKind: 'heart', icon: Heart, label: 'Herz' },
  { tool: 'shape', shapeKind: 'cloud', icon: Cloud, label: 'Wolke' },
  { tool: 'shape', shapeKind: 'cross', icon: Plus, label: 'Kreuz' },
  { tool: 'shape', shapeKind: 'chevron', icon: ChevronRight, label: 'Chevron' },
  { tool: 'shape', shapeKind: 'arrow', icon: ArrowRight, label: 'Pfeil' },
  { tool: 'shape', shapeKind: 'double-arrow', icon: ArrowLeftRight, label: 'Doppelpfeil' },
  { tool: 'shape', shapeKind: 'line', icon: Minus, label: 'Linie' },
];

export function MobileShapesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const activeTool = useStore((s) => s.activeTool);
  const shapeKind = useStore((s) => s.tool.shapeKind);
  const setTool = useStore((s) => s.setTool);
  const setToolDefaults = useStore((s) => s.setToolDefaults);
  const showToast = useStore((s) => s.showToast);

  const pick = (s: ShapeChoice) => {
    if (s.shapeKind) setToolDefaults({ shapeKind: s.shapeKind });
    setTool(s.tool);
    onClose();
    showToast('Auf die Seite tippen, um die Form zu platzieren', 'info');
  };

  return (
    <MobileSheet open={open} onClose={onClose} title="Form einfügen">
      <div className="m-shape-grid">
        {SHAPES.map((s) => {
          const active = s.tool === 'shape' ? activeTool === 'shape' && shapeKind === s.shapeKind : activeTool === s.tool;
          return (
            <button key={s.label} className={`m-shape ${active ? 'active' : ''}`} onClick={() => pick(s)}>
              <s.icon size={26} />
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>
    </MobileSheet>
  );
}
