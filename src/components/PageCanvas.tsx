import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

  const rotation = page ? (((page.baseRotation + page.addedRotation) % 360) + 360) % 360 : 0;
  const view = page ? visibleSize(page) : { width: 1, height: 1 };
  const scale = fitScale * zoom;

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

  // Load existing text runs when entering edit-text mode.
  useEffect(() => {
    if (activeTool !== 'edit-text' || !page || page.blank) {
      setRuns([]);
      setEditingRun(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const pdfPage = await engine.getPage(page.sourceKey, page.sourceIndex);
        const r = await extractTextRuns(pdfPage, rotation);
        if (!cancelled) setRuns(groupRunsIntoLines(r));
      } catch {
        if (!cancelled) setRuns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTool, engine, page, rotation]);

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
      selectElement(null);
      return;
    }
    if (activeTool === 'text') {
      const el: TextElement = {
        id: uid('el'),
        type: 'text',
        x: start.x,
        y: start.y,
        width: 220,
        height: tool.textSize * 1.6,
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

  // ── in-place text editing of existing PDF text ──
  const commitRunEdit = (idx: number, newText: string) => {
    setEditingRun(null);
    const run = runs[idx];
    if (!run || !page) return;
    if (newText === run.str) return;
    const box = { x: run.x, y: run.y, width: run.width, height: run.height };
    const canvas = canvasRef.current!;
    const coverColor = sampleBackground(canvas, box, scale * DPR);
    const color = sampleTextColor(canvas, box, scale * DPR);
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
      color,
      align: 'left',
      lineHeight: 1.15,
      coverColor,
    };
    addElement(page.id, el);
  };

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
              onStartEdit={() => setEditingId(el.id)}
              onEndEdit={() => setEditingId(null)}
              updateElement={updateElement}
              commit={commit}
            />
          ))}

          {draft && <DraftView el={draft} scale={scale} />}

          {activeTool === 'edit-text' && (
            <>
              {runs.length > 0 && editingRun === null && <div key={page.id} className="scan-sweep" />}
              {runs.map((run, i) => (
                <RunBox
                  key={i}
                  run={run}
                  scale={scale}
                  editing={editingRun === i}
                  onEdit={() => setEditingRun(i)}
                  onCommit={(text) => commitRunEdit(i, text)}
                  onCancel={() => setEditingRun(null)}
                />
              ))}
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

/** Clickable box over an existing text run; becomes an input when editing. */
function RunBox({
  run,
  scale,
  editing,
  onEdit,
  onCommit,
  onCancel,
}: {
  run: TextRun;
  scale: number;
  editing: boolean;
  onEdit: () => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(run.str);
  useEffect(() => setValue(run.str), [run.str, editing]);

  const style: React.CSSProperties = {
    left: run.x * scale,
    top: run.y * scale,
    width: Math.max(run.width, 24) * scale,
    height: run.height * scale,
    fontFamily: cssFontFor(run.family),
    fontSize: run.fontSize * scale,
    fontWeight: run.bold ? 700 : 400,
    fontStyle: run.italic ? 'italic' : 'normal',
  };

  if (editing) {
    return (
      <input
        className="run-input"
        autoFocus
        value={value}
        style={style}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onCommit(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit(value);
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
      />
    );
  }
  return (
    <div
      className="run-box"
      style={style}
      onPointerDown={onEdit}
      title={`„${run.str}“ · ${Math.round(run.fontSize)} pt · klicken zum Bearbeiten`}
    >
      <span className="run-tag">{Math.round(run.fontSize)}</span>
    </div>
  );
}
