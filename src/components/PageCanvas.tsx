import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, visibleSize, type EditorPage } from '../state/store';
import {
  renderPageToCanvas,
  extractTextRuns,
  groupRunsIntoLines,
  cssStackFor,
  type AnyElement,
  type TextElement,
  type TextRun,
} from '../lib/pdf';
import { sampleBackground, sampleTextColor, sampleColorAt } from '../lib/utils/color';
import { uid } from '../lib/utils/id';
import { ElementView } from './ElementView';

const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2.5);
// Caps that keep the page bitmap inside every browser's canvas limits, so even an
// extreme zoom renders softened-but-visible content instead of failing to all-white.
const MAX_BITMAP_DIM = 8192;
const MAX_BITMAP_AREA = 16_000_000;

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
  const [scanId, setScanId] = useState(0);

  const rotation = page ? (((page.baseRotation + page.addedRotation) % 360) + 360) % 360 : 0;
  const view = page ? visibleSize(page) : { width: 1, height: 1 };
  const scale = fitScale * zoom;

  // Never carry a transient edit across a page switch.
  const pageId = page?.id;
  useEffect(() => {
    setEditingId(null);
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

  // ── Render the page bitmap ────────────────────────────────────────────────
  // The visible canvas is always *styled* at view·scale, so during a zoom the
  // previous bitmap is simply stretched (smooth, never blank). The crisp bitmap
  // is rendered off-screen first and blitted in a single synchronous step — so
  // the on-screen canvas is never cleared to white — and zoom re-renders are
  // debounced so a fast pinch doesn't thrash pdf.js. The bitmap resolution is
  // capped so a huge zoom can't blow past the browser's canvas limits.
  const renderSigRef = useRef('');
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !page) return;
    let cancelled = false;

    const cssW = view.width * scale;
    const cssH = view.height * scale;

    const renderNow = async () => {
      if (cssW < 1 || cssH < 1) return;
      let dpr = Math.min(DPR, MAX_BITMAP_DIM / cssW, MAX_BITMAP_DIM / cssH, Math.sqrt(MAX_BITMAP_AREA / (cssW * cssH)));
      dpr = Math.max(0.5, dpr);

      if (page.blank) {
        const ctx = canvas.getContext('2d', { alpha: false });
        canvas.width = Math.max(1, Math.round(cssW * dpr));
        canvas.height = Math.max(1, Math.round(cssH * dpr));
        if (ctx) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        return;
      }

      try {
        const pdfPage = await engine.getPage(page.sourceKey, page.sourceIndex);
        if (cancelled) return;
        const off = document.createElement('canvas');
        await renderPageToCanvas(pdfPage, off, scale * dpr, rotation);
        if (cancelled) return;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;
        // Resize + blit happen together: the on-screen canvas is never left blank.
        canvas.width = off.width;
        canvas.height = off.height;
        ctx.drawImage(off, 0, 0);
      } catch {
        /* render race — a newer render superseded this one */
      }
    };

    // Immediate for a page/rotation/size change; debounced for a pure zoom so the
    // smooth stretched preview leads and the sharp re-render lands once settled.
    const sig = `${page.id}|${rotation}|${Math.round(view.width)}x${Math.round(view.height)}`;
    const onlyZoom = renderSigRef.current === sig;
    renderSigRef.current = sig;

    // On a genuine page/rotation change clear to white first, so the previous page
    // never flashes stretched or mis-rotated into the new frame. A pure zoom keeps
    // the old bitmap (stretched) for a seamless, flash-free transition.
    if (!onlyZoom) {
      const ctx = canvas.getContext('2d', { alpha: false });
      if (ctx) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

    const t = window.setTimeout(() => void renderNow(), onlyZoom ? 120 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [engine, page, scale, rotation, view.width, view.height]);

  // Load existing text runs when entering edit-text mode. Depends on the page
  // *source* (not its element list) so adding overlay edits never re-triggers a
  // costly re-scan or wipes the boxes mid-edit.
  const pageSourceKey = page?.sourceKey;
  const pageSourceIndex = page?.sourceIndex;
  const pageBlank = page?.blank ?? false;
  useEffect(() => {
    if (activeTool !== 'edit-text' || pageSourceKey === undefined || pageSourceIndex === undefined || pageBlank) {
      setRuns([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const pdfPage = await engine.getPage(pageSourceKey, pageSourceIndex);
        const r = await extractTextRuns(pdfPage, rotation);
        if (!cancelled) {
          setRuns(groupRunsIntoLines(r));
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
        const selEl = page.elements.find((el) => el.id === selId);
        if (isAbandonedText(selEl)) deleteElement(page.id, selId);
      }
      selectElement(null);
      return;
    }
    if (activeTool === 'edit-text') {
      // Clicking empty space leaves the current in-place edit; the line boxes stay.
      setEditingId(null);
      selectElement(null);
      return;
    }
    if (activeTool === 'text') {
      // Keep focus for the editor we open below (see RunBox preventDefault note).
      e.preventDefault();
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
    // Use the canvas's real pixel density (capped at high zoom) for accurate reads.
    const px = canvas ? canvas.width / view.width : scale * DPR;
    const color = canvas ? sampleColorAt(canvas, start.x, start.y, px) : '#ffffff';
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

  // ── scan tool: turn a detected line into an in-place, immediately-editable field ──
  // Clicking a line samples its real text colour and the page background behind it,
  // then drops a text element that *covers* the original glyphs and opens straight in
  // edit mode. The inspector instantly shows font, size, colour & style for it.
  const editRun = (idx: number) => {
    const run = runs[idx];
    if (!run || !page) return;
    const canvas = canvasRef.current;
    const box = { x: run.x, y: run.y, width: Math.max(run.width, 24), height: run.height };
    // Sample at the canvas's *actual* pixels-per-view-point (it may be rendered at a
    // capped resolution at high zoom, so scale·DPR would point at the wrong pixels).
    const px = canvas ? canvas.width / view.width : scale * DPR;
    const coverColor = canvas ? sampleBackground(canvas, box, px) : '#ffffff';
    const color = canvas ? sampleTextColor(canvas, box, px) : '#111111';
    const el: TextElement = {
      id: uid('el'),
      type: 'text',
      x: run.x,
      y: run.y,
      width: Math.max(run.width, 24),
      height: Math.max(run.height, run.fontSize * 1.25),
      opacity: 1,
      z: nextZ(page),
      text: run.str,
      family: run.family,
      size: run.fontSize,
      bold: run.bold,
      italic: run.italic,
      color,
      align: 'left',
      lineHeight: 1.15,
      coverColor, // hides the original glyphs on screen and on export
    };
    addElement(page.id, el); // commits history + selects the new element
    setEditingId(el.id); // open the editor right away (text pre-selected, ready to type)
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
              interactive={activeTool === 'select' || editingId === el.id}
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
                if (runIsCovered(run)) return null;
                return <RunBox key={i} run={run} scale={scale} onEdit={() => editRun(i)} />;
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
 * A clickable box over a detected line of existing PDF text. Clicking it hands the
 * line to `editRun`, which drops an in-place, immediately-editable text field on top
 * (matching font, size, style, colour and background). The box previews the line in
 * its own font and shows the detected point size on hover.
 */
function RunBox({ run, scale, onEdit }: { run: TextRun; scale: number; onEdit: () => void }) {
  const box: React.CSSProperties = {
    left: run.x * scale,
    top: run.y * scale,
    width: Math.max(run.width, 24) * scale,
    height: run.height * scale,
    fontFamily: cssStackFor(run.family),
    fontSize: run.fontSize * scale,
    fontWeight: run.bold ? 700 : 400,
    fontStyle: run.italic ? 'italic' : 'normal',
  };
  return (
    <div
      className="run-box"
      style={box}
      onPointerDown={(e) => {
        // preventDefault stops the browser's default focus-on-mousedown, which would
        // otherwise immediately blur the in-place editor we open in onEdit().
        e.preventDefault();
        e.stopPropagation();
        onEdit();
      }}
      title={`„${run.str}“ · ${Math.round(run.fontSize)} pt · klicken zum Bearbeiten`}
    >
      <span className="run-tag">{Math.round(run.fontSize)}</span>
    </div>
  );
}
