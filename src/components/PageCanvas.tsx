import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, visibleSize, type EditorPage } from '../state/store';
import {
  renderPageToCanvas,
  extractTextRuns,
  groupRunsIntoLines,
  cssFontFor,
  type AnyElement,
  type TextElement,
  type TextRun,
} from '../lib/pdf';
import { sampleBackground, sampleTextColor, sampleColorAt } from '../lib/utils/color';
import { uid } from '../lib/utils/id';
import { ElementView } from './ElementView';

const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2.5);

interface SampledColors {
  cover: string;
  text: string;
}

export function PageCanvas() {
  const pages = useStore((s) => s.pages);
  const currentPageId = useStore((s) => s.currentPageId);
  const page = useMemo(() => pages.find((p) => p.id === currentPageId) ?? pages[0], [pages, currentPageId]);

  const zoom = useStore((s) => s.zoom);
  const engine = useStore((s) => s.engine);
  const activeTool = useStore((s) => s.activeTool);
  const tool = useStore((s) => s.tool);
  const addElement = useStore((s) => s.addElement);
  const updateElement = useStore((s) => s.updateElement);
  const deleteElement = useStore((s) => s.deleteElement);
  const commit = useStore((s) => s.commit);
  const selectElement = useStore((s) => s.selectElement);
  const setTool = useStore((s) => s.setTool);
  const setToolDefaults = useStore((s) => s.setToolDefaults);

  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnyElement | null>(null);
  const [runs, setRuns] = useState<TextRun[]>([]);
  const [editingRun, setEditingRun] = useState<number | null>(null);
  const [scanId, setScanId] = useState(0);
  const [editColors, setEditColors] = useState<SampledColors>({ cover: '#ffffff', text: '#111111' });

  const rotation = page ? (((page.baseRotation + page.addedRotation) % 360) + 360) % 360 : 0;
  const view = page ? visibleSize(page) : { width: 1, height: 1 };
  const scale = fitScale * zoom;

  // Never carry a transient edit across a page switch.
  const pageId = page?.id;
  useEffect(() => {
    setEditingId(null);
    setEditingRun(null);
  }, [pageId]);

  // Fit the page to the available area whenever the page or viewport changes.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area || !page) return;
    const compute = () => {
      const avail = area.clientWidth - 80;
      const availH = area.clientHeight - 80;
      const byW = avail / view.width;
      const byH = availH / view.height;
      setFitScale(Math.max(0.2, Math.min(2, Math.min(byW, byH))));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(area);
    return () => ro.disconnect();
  }, [page, view.width, view.height]);

  // Render the page bitmap.
  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas || !page) return;
    if (page.blank) {
      const ctx = canvas.getContext('2d');
      canvas.width = Math.floor(view.width * scale * DPR);
      canvas.height = Math.floor(view.height * scale * DPR);
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
        await renderPageToCanvas(pdfPage, canvas, scale * DPR, rotation);
      } catch {
        /* render race */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, page, scale, rotation, view.width, view.height]);

  // Load existing text runs when entering edit-text mode. Depends on the page
  // *source* (not its element list) so adding overlay edits never re-triggers a
  // costly re-scan or wipes the line currently being edited.
  const pageSourceKey = page?.sourceKey;
  const pageSourceIndex = page?.sourceIndex;
  const pageBlank = page?.blank ?? false;
  useEffect(() => {
    if (activeTool !== 'edit-text' || pageSourceKey === undefined || pageSourceIndex === undefined || pageBlank) {
      setRuns([]);
      setEditingRun(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const pdfPage = await engine.getPage(pageSourceKey, pageSourceIndex);
        const r = await extractTextRuns(pdfPage, rotation);
        if (!cancelled) {
          setRuns(groupRunsIntoLines(r));
          setEditingRun(null);
          setScanId((n) => n + 1); // replay the scan sweep once per real scan
        }
      } catch {
        if (!cancelled) setRuns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTool, engine, pageSourceKey, pageSourceIndex, pageBlank, rotation]);

  // ── zoom by Ctrl/⌘+wheel (also trackpad pinch) and two-finger touch pinch ──
  const zoomAround = useCallback((clientX: number, clientY: number, factor: number) => {
    const area = areaRef.current;
    if (!area) return;
    const st = useStore.getState();
    const old = st.zoom;
    const next = Math.max(0.25, Math.min(4, Number((old * factor).toFixed(2))));
    if (next === old) return;
    const rect = area.getBoundingClientRect();
    const ax = clientX - rect.left + area.scrollLeft;
    const ay = clientY - rect.top + area.scrollTop;
    const ratio = next / old;
    st.setZoom(next);
    requestAnimationFrame(() => {
      area.scrollLeft = ax * ratio - (clientX - rect.left);
      area.scrollTop = ay * ratio - (clientY - rect.top);
    });
  }, []);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return; // plain wheel keeps scrolling the page
      e.preventDefault();
      zoomAround(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    };

    let pinchDist = 0;
    const touchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const touchMid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinchDist = touchDist(e.touches);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchDist > 0) {
        e.preventDefault();
        const d = touchDist(e.touches);
        if (d > 0 && Math.abs(d - pinchDist) > 1) {
          const mid = touchMid(e.touches);
          zoomAround(mid.x, mid.y, d / pinchDist);
          pinchDist = d;
        }
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchDist = 0;
    };

    area.addEventListener('wheel', onWheel, { passive: false });
    area.addEventListener('touchstart', onTouchStart, { passive: false });
    area.addEventListener('touchmove', onTouchMove, { passive: false });
    area.addEventListener('touchend', onTouchEnd);
    return () => {
      area.removeEventListener('wheel', onWheel);
      area.removeEventListener('touchstart', onTouchStart);
      area.removeEventListener('touchmove', onTouchMove);
      area.removeEventListener('touchend', onTouchEnd);
    };
  }, [zoomAround]);

  const evToView = (e: { clientX: number; clientY: number }) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  // ── creating elements by dragging / clicking ──
  const onOverlayPointerDown = (e: React.PointerEvent) => {
    if (!page) return;
    if (e.target !== overlayRef.current) return; // started on an element/handle
    const start = evToView(e);

    if (activeTool === 'select') {
      // Clicking empty space discards an abandoned, never-filled text box.
      const selId = useStore.getState().selectedElementId;
      if (selId) {
        const selEl = page.elements.find((e) => e.id === selId);
        if (isAbandonedText(selEl)) deleteElement(page.id, selId);
      }
      selectElement(null);
      return;
    }
    if (activeTool === 'text') {
      const el: TextElement = {
        id: uid('el'),
        type: 'text',
        x: start.x,
        y: start.y,
        width: 240,
        height: Math.max(tool.textSize * 1.4, 22),
        opacity: 1,
        z: nextZ(page),
        text: '',
        family: tool.textFamily,
        size: tool.textSize,
        bold: false,
        italic: false,
        color: tool.textColor,
        align: 'left',
        lineHeight: 1.3,
      };
      addElement(page.id, el);
      // Switch to the select tool so the new field becomes interactive (a field
      // created under the text tool would otherwise stay pointer-events:none) and
      // jump straight into editing — the caret is ready, just start typing.
      setTool('select');
      setEditingId(el.id);
      return;
    }
    if (activeTool === 'draw') {
      startDrawing(start);
      return;
    }
    if (activeTool === 'brush') {
      startBrush(start, e);
      return;
    }
    startShape(start, e);
  };

  // ── background cover brush: paints a stroke in the page's own background colour ──
  const startBrush = (start: { x: number; y: number }, e: React.PointerEvent) => {
    if (!page) return;
    const canvas = canvasRef.current;
    // Sample the exact colour directly under the cursor so the cover is invisible.
    const color = canvas ? sampleColorAt(canvas, start.x, start.y, scale * DPR) : '#ffffff';
    setToolDefaults({ brushColor: color });
    const width = tool.brushWidth;
    const points: { x: number; y: number }[] = [start];
    const bounds = () => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const pad = width / 2;
      return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    };
    const move = (ev: PointerEvent) => {
      points.push(evToView(ev));
      const b = bounds();
      setDraft({
        id: 'draft-brush',
        type: 'ink',
        x: b.minX,
        y: b.minY,
        width: b.maxX - b.minX,
        height: b.maxY - b.minY,
        opacity: 1,
        z: nextZ(page),
        points: [...points],
        color,
        strokeWidth: width,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft(null);
      // A single click should still stamp a dot; duplicate the point so bake draws it.
      if (points.length === 1) points.push({ x: start.x + 0.01, y: start.y + 0.01 });
      const b = bounds();
      addElement(page.id, {
        id: uid('el'),
        type: 'ink',
        x: b.minX,
        y: b.minY,
        width: Math.max(1, b.maxX - b.minX),
        height: Math.max(1, b.maxY - b.minY),
        opacity: 1,
        z: nextZ(page),
        points,
        color,
        strokeWidth: width,
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const startShape = (start: { x: number; y: number }, e: React.PointerEvent) => {
    if (!page) return;
    const base = { id: uid('el'), x: start.x, y: start.y, width: 0, height: 0, opacity: 1, z: nextZ(page) };
    const make = (w: number, h: number, x: number, y: number): AnyElement => {
      if (activeTool === 'highlight')
        return { ...base, type: 'highlight', x, y, width: w, height: h, opacity: 0.4, color: tool.highlightColor };
      if (activeTool === 'ellipse')
        return { ...base, type: 'ellipse', x, y, width: w, height: h, fill: tool.shapeFill, stroke: tool.shapeStroke, strokeWidth: 1.5 };
      if (activeTool === 'redact')
        return { ...base, type: 'rect', x, y, width: w, height: h, fill: '#000000', stroke: null, strokeWidth: 0, radius: 0 };
      return { ...base, type: 'rect', x, y, width: w, height: h, fill: tool.shapeFill, stroke: tool.shapeStroke, strokeWidth: 1.5, radius: 0 };
    };
    const move = (ev: PointerEvent) => {
      const p = evToView(ev);
      const x = Math.min(start.x, p.x);
      const y = Math.min(start.y, p.y);
      setDraft(make(Math.abs(p.x - start.x), Math.abs(p.y - start.y), x, y));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft((d) => {
        if (d && d.width > 4 && d.height > 4) {
          addElement(page.id, d);
          setTool('select');
        }
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const startDrawing = (start: { x: number; y: number }) => {
    if (!page) return;
    const points: { x: number; y: number }[] = [start];
    const move = (ev: PointerEvent) => {
      points.push(evToView(ev));
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      setDraft({
        id: 'draft-ink',
        type: 'ink',
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        opacity: 1,
        z: nextZ(page),
        points: [...points],
        color: tool.drawColor,
        strokeWidth: tool.drawWidth,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft(null);
      if (points.length > 1) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        addElement(page.id, {
          id: uid('el'),
          type: 'ink',
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
          opacity: 1,
          z: nextZ(page),
          points,
          color: tool.drawColor,
          strokeWidth: tool.drawWidth,
        });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── starting / ending edits on overlay text elements ──
  const startEditElement = (id: string) => {
    commit(); // snapshot once before the edit so a single undo reverts the whole change
    setEditingId(id);
  };

  // Leaving the textarea just exits edit mode — the box stays so the user can still
  // tweak font/size in the inspector before typing. An abandoned empty box is only
  // dropped when the user clicks an empty spot (see onOverlayPointerDown).
  const endTextEdit = () => setEditingId(null);

  /** An empty, never-filled new text box (not an in-place edit, which keeps its cover). */
  const isAbandonedText = (el: AnyElement | undefined): boolean =>
    !!el && el.type === 'text' && !el.text.trim() && !el.coverColor;

  // ── in-place editing of existing PDF text (scan tool) ──
  const beginRunEdit = (idx: number) => {
    const run = runs[idx];
    const canvas = canvasRef.current;
    if (run && canvas) {
      const box = { x: run.x, y: run.y, width: Math.max(run.width, 24), height: run.height };
      setEditColors({
        cover: sampleBackground(canvas, box, scale * DPR),
        text: sampleTextColor(canvas, box, scale * DPR),
      });
    }
    setEditingRun(idx);
  };

  const commitRunEdit = (idx: number, newText: string) => {
    setEditingRun(null);
    const run = runs[idx];
    if (!run || !page) return;
    if (newText === run.str) return; // unchanged — leave the original glyphs untouched
    const el: TextElement = {
      id: uid('el'),
      type: 'text',
      x: run.x,
      y: run.y,
      width: Math.max(run.width, 24),
      height: run.height,
      opacity: 1,
      z: nextZ(page),
      text: newText,
      family: run.family,
      size: run.fontSize,
      bold: run.bold,
      italic: run.italic,
      color: editColors.text,
      align: 'left',
      lineHeight: 1.15,
      coverColor: editColors.cover, // hides the original glyphs on screen and on export
    };
    addElement(page.id, el);
  };

  // A detected line is "consumed" once an in-place edit already covers it, so its
  // clickable box never reappears (and a second edit can't stack on the first).
  const runIsCovered = useCallback(
    (run: TextRun) =>
      !!page &&
      page.elements.some(
        (e) =>
          e.type === 'text' &&
          !!e.coverColor &&
          Math.abs(e.x - run.x) <= 2 &&
          Math.abs(e.y - run.y) <= Math.max(2, run.fontSize * 0.6),
      ),
    [page],
  );

  if (!page) return <div className="canvas-area" ref={areaRef} />;

  const sorted = [...page.elements].sort((a, b) => a.z - b.z);

  return (
    <div className={`canvas-area tool-${activeTool}`} ref={areaRef}>
      <div className="canvas-stage" style={{ width: view.width * scale, height: view.height * scale }}>
        <canvas ref={canvasRef} className="page-canvas" style={{ width: view.width * scale, height: view.height * scale }} />
        <div
          ref={overlayRef}
          className="overlay"
          style={{ width: view.width * scale, height: view.height * scale }}
          onPointerDown={onOverlayPointerDown}
        >
          {sorted.map((el) => (
            <ElementView
              key={el.id}
              el={el}
              pageId={page.id}
              scale={scale}
              editing={editingId === el.id}
              onStartEdit={() => startEditElement(el.id)}
              onEndEdit={endTextEdit}
              updateElement={updateElement}
              commit={commit}
            />
          ))}

          {draft && <DraftView el={draft} scale={scale} />}

          {activeTool === 'edit-text' && (
            <>
              {runs.length > 0 && <div key={scanId} className="scan-sweep" />}
              {runs.map((run, i) => {
                if (editingRun !== i && runIsCovered(run)) return null;
                return (
                  <RunBox
                    key={i}
                    run={run}
                    scale={scale}
                    editing={editingRun === i}
                    colors={editColors}
                    onEdit={() => beginRunEdit(i)}
                    onCommit={(text) => commitRunEdit(i, text)}
                    onCancel={() => setEditingRun(null)}
                  />
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function nextZ(page: EditorPage): number {
  return page.elements.reduce((m, e) => Math.max(m, e.z), 0) + 1;
}

/** Lightweight preview while dragging out a new shape / stroke. */
function DraftView({ el, scale }: { el: AnyElement; scale: number }) {
  const style: React.CSSProperties = {
    left: el.x * scale,
    top: el.y * scale,
    width: el.width * scale,
    height: el.height * scale,
    opacity: el.opacity,
  };
  if (el.type === 'ink') {
    const d = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x - el.x) * scale} ${(p.y - el.y) * scale}`).join(' ');
    return (
      <svg className="draft" style={{ left: el.x * scale, top: el.y * scale, width: el.width * scale, height: el.height * scale }}>
        <path d={d} fill="none" stroke={el.color} strokeWidth={el.strokeWidth * scale} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (el.type === 'ellipse') return <div className="draft" style={{ ...style, borderRadius: '50%', border: `1.5px solid ${el.stroke ?? '#111'}`, background: el.fill ?? 'transparent' }} />;
  if (el.type === 'highlight') return <div className="draft" style={{ ...style, background: el.color, mixBlendMode: 'multiply' }} />;
  if (el.type === 'rect') return <div className="draft" style={{ ...style, border: el.stroke ? `1.5px solid ${el.stroke}` : 'none', background: el.fill ?? 'transparent' }} />;
  return <div className="draft" style={style} />;
}

/**
 * Clickable box over an existing text run. Clicking turns it into an inline
 * textarea pre-filled with the original text (all selected, ready to retype) that
 * matches the font, size, style and colour and hides the original behind the
 * sampled background — so the edit blends in seamlessly.
 */
function RunBox({
  run,
  scale,
  editing,
  colors,
  onEdit,
  onCommit,
  onCancel,
}: {
  run: TextRun;
  scale: number;
  editing: boolean;
  colors: SampledColors;
  onEdit: () => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(run.str);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) {
      setValue(run.str);
      // focus + select once on entering edit mode (not on every keystroke)
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.select();
      }
    }
  }, [editing, run.str]);

  const box: React.CSSProperties = {
    left: run.x * scale,
    top: run.y * scale,
    width: Math.max(run.width, 24) * scale,
    height: run.height * scale,
    fontFamily: cssFontFor(run.family),
    fontSize: run.fontSize * scale,
    fontWeight: run.bold ? 700 : 400,
    fontStyle: run.italic ? 'italic' : 'normal',
    lineHeight: 1.15,
  };

  if (editing) {
    return (
      <textarea
        className="run-input"
        ref={taRef}
        value={value}
        style={{ ...box, color: colors.text, background: colors.cover }}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onCommit(value)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onCommit(value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
    );
  }
  return (
    <div
      className="run-box"
      style={box}
      onPointerDown={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      title={`„${run.str}“ · ${Math.round(run.fontSize)} pt · klicken zum Bearbeiten`}
    >
      <span className="run-tag">{Math.round(run.fontSize)}</span>
    </div>
  );
}
