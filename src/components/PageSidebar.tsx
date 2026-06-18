import { useEffect, useRef } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore, visibleSize, type EditorPage } from '../state/store';
import { useUI } from '../state/ui';
import { renderPageToCanvas } from '../lib/pdf';
import { RotateCw, Copy, Trash2, Plus, PanelLeftClose, LayoutGrid } from 'lucide-react';

const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2.5);

function Thumbnail({ page, thumbZoom }: { page: EditorPage; thumbZoom: number }) {
  const engine = useStore((s) => s.engine);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotation = (((page.baseRotation + page.addedRotation) % 360) + 360) % 360;

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Larger zoom ⇒ render at a higher resolution so the text becomes legible.
    const target = 150 * thumbZoom * DPR;
    if (page.blank) {
      const ctx = canvas.getContext('2d');
      const { width, height } = visibleSize(page);
      const scale = target / Math.max(width, height);
      canvas.width = Math.max(1, Math.floor(width * scale));
      canvas.height = Math.max(1, Math.floor(height * scale));
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
  }, [engine, page, rotation, thumbZoom]);

  return <canvas ref={canvasRef} className="thumb-canvas" />;
}

function SortablePage({ page, index, thumbZoom }: { page: EditorPage; index: number; thumbZoom: number }) {
  const currentPageId = useStore((s) => s.currentPageId);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const rotatePage = useStore((s) => s.rotatePage);
  const duplicatePage = useStore((s) => s.duplicatePage);
  const deletePage = useStore((s) => s.deletePage);
  const insertBlankAfter = useStore((s) => s.insertBlankAfter);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const active = page.id === currentPageId;

  return (
    <div ref={setNodeRef} style={style} className={`thumb ${active ? 'active' : ''}`}>
      <div
        className="thumb-frame"
        {...attributes}
        {...listeners}
        onClick={() => setCurrentPage(page.id)}
        role="button"
        tabIndex={0}
      >
        <Thumbnail page={page} thumbZoom={thumbZoom} />
      </div>
      <div className="thumb-meta">
        <span className="thumb-num">{index + 1}</span>
        <div className="thumb-actions">
          <button title="Drehen" onClick={() => rotatePage(page.id, 90)}>
            <RotateCw size={13} />
          </button>
          <button title="Leere Seite danach" onClick={() => insertBlankAfter(page.id)}>
            <Plus size={13} />
          </button>
          <button title="Duplizieren" onClick={() => duplicatePage(page.id)}>
            <Copy size={13} />
          </button>
          <button title="Löschen" className="danger" onClick={() => deletePage(page.id)}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function PageSidebar() {
  const pages = useStore((s) => s.pages);
  const reorderPages = useStore((s) => s.reorderPages);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const setOrganizer = useUI((s) => s.setOrganizer);
  const thumbZoom = useUI((s) => s.thumbZoom);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Grow the panel as thumbnails are zoomed so the page text can be read.
  const sidebarWidth = Math.round(190 + (thumbZoom - 1) * 150);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = pages.findIndex((p) => p.id === active.id);
    const to = pages.findIndex((p) => p.id === over.id);
    if (from >= 0 && to >= 0) reorderPages(from, to);
  };

  if (!sidebarOpen) {
    return (
      <button className="sidebar-reopen" onClick={toggleSidebar} title="Seitenleiste einblenden">
        <PanelLeftClose size={16} style={{ transform: 'rotate(180deg)' }} />
      </button>
    );
  }

  return (
    <aside className="sidebar" style={{ width: sidebarWidth }}>
      <div className="sidebar-head">
        <span>Seiten · {pages.length}</span>
        <div className="sidebar-head-actions">
          <button className="btn ghost icon" onClick={() => setOrganizer(true)} title="Seiten anordnen (Vollbild)">
            <LayoutGrid size={15} />
          </button>
          <button className="btn ghost icon" onClick={toggleSidebar} title="Einklappen">
            <PanelLeftClose size={15} />
          </button>
        </div>
      </div>
      <div className="sidebar-list">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            {pages.map((p, i) => (
              <SortablePage key={p.id} page={p} index={i} thumbZoom={thumbZoom} />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </aside>
  );
}
