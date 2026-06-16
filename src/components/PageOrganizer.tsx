import { useEffect, useRef } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore, visibleSize, type EditorPage } from '../state/store';
import { useUI } from '../state/ui';
import { renderPageToCanvas } from '../lib/pdf';
import { X, RotateCw, Copy, Trash2, Plus } from 'lucide-react';

const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2.5);

/**
 * Full-window page organiser. The sidebar is great for a handful of pages but
 * cramped for 30–40; this lays every page out in a roomy multi-column grid so
 * reordering many pages by drag & drop is effortless. Reuses the same store
 * actions (reorder / rotate / duplicate / delete / insert) as the sidebar.
 */

function OrganizerThumb({ page }: { page: EditorPage }) {
  const engine = useStore((s) => s.engine);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotation = (((page.baseRotation + page.addedRotation) % 360) + 360) % 360;

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const target = 320 * DPR;
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
  }, [engine, page, rotation]);

  return <canvas ref={canvasRef} className="org-canvas" />;
}

function OrganizerCard({ page, index }: { page: EditorPage; index: number }) {
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
    <div ref={setNodeRef} style={style} className={`org-card ${active ? 'active' : ''}`}>
      <div
        className="org-frame"
        {...attributes}
        {...listeners}
        onClick={() => setCurrentPage(page.id)}
        role="button"
        tabIndex={0}
      >
        <OrganizerThumb page={page} />
      </div>
      <div className="org-meta">
        <span className="org-num">Seite {index + 1}</span>
        <div className="org-actions">
          <button title="Drehen" onClick={() => rotatePage(page.id, 90)}>
            <RotateCw size={14} />
          </button>
          <button title="Leere Seite danach" onClick={() => insertBlankAfter(page.id)}>
            <Plus size={14} />
          </button>
          <button title="Duplizieren" onClick={() => duplicatePage(page.id)}>
            <Copy size={14} />
          </button>
          <button title="Löschen" className="danger" onClick={() => deletePage(page.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function PageOrganizer() {
  const open = useUI((s) => s.organizerOpen);
  const setOrganizer = useUI((s) => s.setOrganizer);
  const pages = useStore((s) => s.pages);
  const reorderPages = useStore((s) => s.reorderPages);
  const insertBlankAfter = useStore((s) => s.insertBlankAfter);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOrganizer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOrganizer]);

  if (!open) return null;

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = pages.findIndex((p) => p.id === active.id);
    const to = pages.findIndex((p) => p.id === over.id);
    if (from >= 0 && to >= 0) reorderPages(from, to);
  };

  return (
    <div className="organizer">
      <div className="organizer-head">
        <div className="organizer-title">
          <h2>Seiten anordnen</h2>
          <span className="organizer-sub">
            {pages.length} Seite{pages.length === 1 ? '' : 'n'} · per Drag &amp; Drop sortieren
          </span>
        </div>
        <div className="organizer-head-actions">
          <button className="btn ghost" onClick={() => insertBlankAfter(null)}>
            <Plus size={16} /> Leere Seite
          </button>
          <button className="btn primary" onClick={() => setOrganizer(false)}>
            <X size={16} /> Fertig
          </button>
        </div>
      </div>
      <div className="organizer-grid-wrap">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div className="organizer-grid">
              {pages.map((p, i) => (
                <OrganizerCard key={p.id} page={p} index={i} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
