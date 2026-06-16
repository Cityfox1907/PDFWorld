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
import { RotateCw, Copy, Trash2, Plus, PanelLeftClose } from 'lucide-react';

function Thumbnail({ page }: { page: EditorPage }) {
  const engine = useStore((s) => s.engine);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotation = (((page.baseRotation + page.addedRotation) % 360) + 360) % 360;

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (page.blank) {
      const ctx = canvas.getContext('2d');
      const { width, height } = visibleSize(page);
      const scale = 120 / Math.max(width, height);
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
        const scale = 130 / Math.max(view.width, view.height);
        await renderPageToCanvas(pdfPage, canvas, scale, rotation);
      } catch {
        /* ignore render race */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, page, rotation]);

  return <canvas ref={canvasRef} className="thumb-canvas" />;
}

function SortablePage({ page, index }: { page: EditorPage; index: number }) {
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
        <Thumbnail page={page} />
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
  const insertBlankAfter = useStore((s) => s.insertBlankAfter);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const toggleSidebar = useUI((s) => s.toggleSidebar);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>Seiten · {pages.length}</span>
        <button className="btn ghost icon" onClick={toggleSidebar} title="Einklappen">
          <PanelLeftClose size={15} />
        </button>
      </div>
      <div className="sidebar-list">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            {pages.map((p, i) => (
              <SortablePage key={p.id} page={p} index={i} />
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <div className="sidebar-foot">
        <button className="btn ghost" onClick={() => insertBlankAfter(null)}>
          <Plus size={15} /> Leere Seite
        </button>
      </div>
    </aside>
  );
}
