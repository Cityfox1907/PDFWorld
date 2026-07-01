import { useEffect, useMemo, useRef, useState } from 'react';
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
import { renderPageToCanvas, BLANK_SOURCE } from '../lib/pdf';
import { X, RotateCw, Copy, Trash2, Plus, FilePlus2, XCircle } from 'lucide-react';

const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2.5);

/**
 * Full-window page organiser. The sidebar is great for a handful of pages but
 * cramped for 30–40; this lays every page out in a roomy multi-column grid so
 * reordering many pages by drag & drop is effortless. Reuses the same store
 * actions (reorder / rotate / duplicate / delete / insert) as the sidebar.
 *
 * Pages coming from the SAME source PDF share a very subtle accent colour, and
 * several pages can be selected at once (drag a marquee, or ⌘/Ctrl- & Shift-click)
 * to rotate / duplicate / delete / reorder them together.
 */

/** A small palette of calm accents to distinguish the different merged PDFs. */
const SOURCE_TINTS = ['#0a84ff', '#34c759', '#ff9f0a', '#af52de', '#ff375f', '#30b0c7', '#ffd60a', '#bf5af2'];

/** Map each distinct (non-blank) source PDF to a tint — only when ≥2 PDFs are present. */
function computeSourceTints(pages: EditorPage[]): Map<string, string> {
  const order: string[] = [];
  for (const p of pages) {
    if (p.blank || p.sourceKey === BLANK_SOURCE) continue;
    if (!order.includes(p.sourceKey)) order.push(p.sourceKey);
  }
  const map = new Map<string, string>();
  if (order.length >= 2) order.forEach((key, i) => map.set(key, SOURCE_TINTS[i % SOURCE_TINTS.length]));
  return map;
}

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

function OrganizerCard({
  page,
  index,
  tint,
  selected,
  onSelect,
}: {
  page: EditorPage;
  index: number;
  tint?: string;
  selected: boolean;
  /** Only the modifier keys matter, so mouse AND keyboard activation both fit. */
  onSelect: (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, id: string) => void;
}) {
  const currentPageId = useStore((s) => s.currentPageId);
  const rotatePage = useStore((s) => s.rotatePage);
  const duplicatePage = useStore((s) => s.duplicatePage);
  const deletePage = useStore((s) => s.deletePage);
  const insertBlankAfter = useStore((s) => s.insertBlankAfter);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  if (tint) {
    (style as Record<string, string>)['--src-tint'] = tint;
    (style as Record<string, string>)['--src-line'] = `${tint}7a`;
    (style as Record<string, string>)['--src-soft'] = `${tint}14`;
  }
  const active = page.id === currentPageId;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-page-id={page.id}
      className={`org-card ${active ? 'active' : ''} ${selected ? 'selected' : ''} ${tint ? 'tinted' : ''}`}
    >
      <div
        className="org-frame"
        {...attributes}
        {...listeners}
        onClick={(e) => onSelect(e, page.id)}
        onKeyDown={(e) => {
          // role="button" needs real keyboard activation, not just focusability.
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(e, page.id);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Seite ${index + 1} auswählen`}
      >
        {tint && <span className="org-srcbar" />}
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

type ClientRect = { x: number; y: number; w: number; h: number };

export function PageOrganizer() {
  const open = useUI((s) => s.organizerOpen);
  const setOrganizer = useUI((s) => s.setOrganizer);
  const pages = useStore((s) => s.pages);
  const movePages = useStore((s) => s.movePages);
  const insertBlankAfter = useStore((s) => s.insertBlankAfter);
  const mergeFile = useStore((s) => s.mergeFile);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const rotatePages = useStore((s) => s.rotatePages);
  const duplicatePages = useStore((s) => s.duplicatePages);
  const deletePages = useStore((s) => s.deletePages);
  const mergeRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const [marquee, setMarquee] = useState<ClientRect | null>(null);

  const tints = useMemo(() => computeSourceTints(pages), [pages]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Esc closes; clear the selection whenever the organiser is closed.
  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      anchorRef.current = null;
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOrganizer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOrganizer]);

  // Drop ids from the selection once their pages disappear (e.g. after a delete).
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => pages.some((p) => p.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pages]);

  if (!open) return null;

  const selectedIds = pages.filter((p) => selected.has(p.id)).map((p) => p.id);

  const onSelect = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, id: string) => {
    const idx = pages.findIndex((p) => p.id === id);
    if (e.shiftKey && anchorRef.current) {
      // Range select from the anchor to the clicked card.
      const a = pages.findIndex((p) => p.id === anchorRef.current);
      if (a >= 0 && idx >= 0) {
        const [lo, hi] = a < idx ? [a, idx] : [idx, a];
        setSelected(new Set(pages.slice(lo, hi + 1).map((p) => p.id)));
      }
    } else if (e.metaKey || e.ctrlKey) {
      // Toggle this card in/out of the selection.
      setSelected((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
      anchorRef.current = id;
    } else {
      // Plain click: focus just this page.
      setSelected(new Set([id]));
      anchorRef.current = id;
      setCurrentPage(id);
    }
  };

  // ── marquee selection over the grid background ──
  const onWrapPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.org-card')) return; // a card starts a drag, not a marquee
    const wrap = wrapRef.current;
    if (!wrap) return;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? new Set(selected) : new Set<string>();
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
      moved = true;
      const left = Math.min(sx, ev.clientX);
      const top = Math.min(sy, ev.clientY);
      const right = Math.max(sx, ev.clientX);
      const bottom = Math.max(sy, ev.clientY);
      setMarquee({ x: left, y: top, w: right - left, h: bottom - top });
      const next = new Set(base);
      wrap.querySelectorAll<HTMLElement>('[data-page-id]').forEach((card) => {
        const r = card.getBoundingClientRect();
        if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) next.add(card.dataset.pageId!);
      });
      setSelected(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarquee(null);
      if (!moved && !additive) {
        setSelected(new Set()); // a plain click on empty space clears the selection
        anchorRef.current = null;
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    // Drag the whole selection when the grabbed card is part of it; else just that card.
    const group = selected.has(activeId) && selected.size > 1 ? selectedIds : [activeId];
    if (group.includes(overId)) return; // dropped onto itself / a member of the block
    movePages(group, overId);
  };

  const clearSel = () => {
    setSelected(new Set());
    anchorRef.current = null;
  };

  return (
    <div className="organizer">
      <div className="organizer-head">
        <div className="organizer-title">
          <h2>Seiten anordnen</h2>
          <span className="organizer-sub">
            {selected.size > 0
              ? `${selected.size} ausgewählt · mit ⌘/Strg- oder Shift-Klick oder Rahmen ziehen`
              : `${pages.length} Seite${pages.length === 1 ? '' : 'n'} · Drag & Drop · mehrere mit ⌘/Strg/Shift oder Rahmen wählen`}
          </span>
        </div>
        <div className="organizer-head-actions">
          {selected.size > 0 && (
            <>
              <button className="btn ghost" onClick={() => rotatePages(selectedIds, 90)} title="Ausgewählte Seiten drehen">
                <RotateCw size={16} /> Drehen
              </button>
              <button className="btn ghost" onClick={() => duplicatePages(selectedIds)} title="Ausgewählte Seiten duplizieren">
                <Copy size={16} /> Duplizieren
              </button>
              <button className="btn ghost danger" onClick={() => deletePages(selectedIds)} title="Ausgewählte Seiten löschen">
                <Trash2 size={16} /> Löschen
              </button>
              <button className="btn ghost" onClick={clearSel} title="Auswahl aufheben">
                <XCircle size={16} /> Auswahl aufheben
              </button>
              <span className="organizer-divider" />
            </>
          )}
          <button className="btn ghost" onClick={() => insertBlankAfter(null)}>
            <Plus size={16} /> Leere Seite
          </button>
          <button className="btn ghost" onClick={() => mergeRef.current?.click()} title="Ein weiteres PDF ans Ende anfügen">
            <FilePlus2 size={16} /> PDF anfügen
          </button>
          <button className="btn primary" onClick={() => setOrganizer(false)}>
            <X size={16} /> Fertig
          </button>
          <input
            ref={mergeRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void mergeFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <div className="organizer-grid-wrap" ref={wrapRef} onPointerDown={onWrapPointerDown}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div className="organizer-grid">
              {pages.map((p, i) => (
                <OrganizerCard
                  key={p.id}
                  page={p}
                  index={i}
                  tint={tints.get(p.sourceKey)}
                  selected={selected.has(p.id)}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
      {marquee && (
        <div className="org-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
      )}
    </div>
  );
}
