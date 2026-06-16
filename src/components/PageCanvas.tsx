import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, visibleSize, type EditorPage } from '../state/store';
import {
  renderPageToCanvas,
  extractTextRuns,
  inspectFonts,
  groupRunsIntoLines,
  registerEmbeddedFont,
  embeddedFontFamily,
  cssStackFor,
  BASELINE_RATIO,
  type AnyElement,
  type ElementPatch,
  type TextElement,
  type TextRun,
} from '../lib/pdf';
import { sampleBackground, sampleTextColor, sampleColorAt } from '../lib/utils/color';
import { nearestBaseline } from '../lib/utils/align';
import { uid } from '../lib/utils/id';
import { ElementView } from './ElementView';
import { Type, Check, X } from 'lucide-react';

const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2.5);
// Caps that keep the page bitmap inside every browser's canvas limits, so even an
// extreme zoom renders softened-but-visible content instead of failing to all-white.
const MAX_BITMAP_DIM = 8192;
const MAX_BITMAP_AREA = 16_000_000;
// Highest magnification (1000 %). Mirrors the clamp in the store's setZoom.
const MAX_ZOOM = 10;
const MIN_ZOOM = 0.25;

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
  // Scan tool: the line whose font panel is open, plus its sampled colours.
  const [pickedRun, setPickedRun] = useState<number | null>(null);
  const [pickInfo, setPickInfo] = useState<{ color: string; bg: string } | null>(null);
  // Active alignment guide (a baseline in view-points) shown while moving text.
  const [alignGuideY, setAlignGuideY] = useState<number | null>(null);
  // Baselines of the last scanned lines, kept across tool switches for snapping.
  const [scanBaselines, setScanBaselines] = useState<number[]>([]);
  // Coalesces a burst of arrow-key nudges into a single undo step: the element id
  // whose burst is in progress, and the timer that ends the burst after a pause.
  const nudgeActiveId = useRef<string | null>(null);
  const nudgeTimer = useRef<number | null>(null);

  const rotation = page ? (((page.baseRotation + page.addedRotation) % 360) + 360) % 360 : 0;
  const view = page ? visibleSize(page) : { width: 1, height: 1 };
  const scale = fitScale * zoom;

  // Never carry a transient edit across a page switch.
  const pageId = page?.id;
  useEffect(() => {
    setEditingId(null);
    setPickedRun(null);
    setAlignGuideY(null);
    setScanBaselines([]);
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
      setPickedRun(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const pdfPage = await engine.getPage(pageSourceKey, pageSourceIndex);
        const r = await extractTextRuns(pdfPage, rotation);
        if (cancelled) return;
        const lines = groupRunsIntoLines(r);
        setRuns(lines); // show the clickable boxes immediately
        setPickedRun(null);
        setScanId((n) => n + 1); // replay the scan sweep once per real scan
        // Remember each line's baseline so a moved text box can snap onto it.
        setScanBaselines(lines.map((l) => l.y + l.fontSize * BASELINE_RATIO));

        // Then inspect each line's font: confirm whether the PDF embeds it (so it
        // can be reused 1:1) and attach the ORIGINAL program when it does. The
        // readable name already comes from extractTextRuns; commonObjs is a fallback.
        // Always records `embedded` (even when nothing resolves) so the panel never
        // stays stuck on the neutral "checking" badge.
        const infos = await inspectFonts(pdfPage, lines.map((l) => l.fontName));
        if (cancelled) return;
        const enriched = lines.map((l) => {
          const info = infos.get(l.fontName);
          let embeddedFontId = l.embeddedFontId;
          if (info?.embedded && info.data) {
            const id = `${pageSourceKey}#${pageSourceIndex}#${l.fontName}`;
            registerEmbeddedFont({ id, data: info.data, mimetype: info.mimetype || 'font/opentype' });
            embeddedFontId = id;
          }
          return { ...l, fontLabel: l.fontLabel ?? info?.displayName, embedded: info?.embedded ?? false, embeddedFontId };
        });
        if (!cancelled) setRuns(enriched);
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
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number((old * factor).toFixed(2))));
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

  // Baselines a selected text box can snap to: scanned lines + other text boxes.
  const getAlignTargets = useCallback(
    (excludeId: string | null): number[] => {
      const ts = [...scanBaselines];
      if (page) {
        for (const el of page.elements) {
          if (el.type === 'text' && el.id !== excludeId) ts.push(el.y + el.size * BASELINE_RATIO);
        }
      }
      return ts;
    },
    [page, scanBaselines],
  );

  // Arrow keys nudge the selected element for precise alignment (Shift = 10 pt).
  // A vertical nudge snaps a text box onto a neighbouring baseline; hold Alt to
  // bypass the snap. Ignored while typing in a text box or any input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!page || editingId) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      const selId = useStore.getState().selectedElementId;
      if (!selId) return;
      const target = page.elements.find((el) => el.id === selId);
      if (!target) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      let nx = target.x;
      let ny = target.y;
      if (e.key === 'ArrowLeft') nx -= step;
      else if (e.key === 'ArrowRight') nx += step;
      else if (e.key === 'ArrowUp') ny -= step;
      else ny += step;

      let guide: number | null = null;
      if (target.type === 'text' && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const snap = nearestBaseline(ny + target.size * BASELINE_RATIO, getAlignTargets(selId), 4);
        if (snap != null) {
          ny = snap - target.size * BASELINE_RATIO;
          guide = snap;
        }
      }
      // Snapshot once at the start of a burst (or when the target changes) so a
      // single undo reverts the whole run of nudges — matching addElement's model.
      if (nudgeActiveId.current !== selId) {
        commit();
        nudgeActiveId.current = selId;
      }
      const patch: ElementPatch = { x: nx, y: ny };
      if (target.type === 'ink') {
        const dx = nx - target.x;
        const dy = ny - target.y;
        patch.points = target.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      }
      updateElement(page.id, selId, patch);
      setAlignGuideY(guide);
      // End the burst (and clear the guide) after a short pause.
      if (nudgeTimer.current) window.clearTimeout(nudgeTimer.current);
      nudgeTimer.current = window.setTimeout(() => {
        nudgeActiveId.current = null;
        setAlignGuideY(null);
      }, 500);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, editingId, updateElement, commit, getAlignTargets]);

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
      setPickedRun(null);
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

  // ── scan tool: inspect a detected line, then adopt its exact typeface ──
  // Sample the line's real text colour and the page background directly from the
  // rendered canvas. Sampling uses the canvas's ACTUAL pixels-per-view-point (it may
  // be rendered at a capped resolution at high zoom, so scale·DPR would mis-point).
  const sampleRun = (run: TextRun): { color: string; bg: string } => {
    const canvas = canvasRef.current;
    const box = { x: run.x, y: run.y, width: Math.max(run.width, 24), height: run.height };
    const px = canvas ? canvas.width / view.width : scale * DPR;
    return {
      color: canvas ? sampleTextColor(canvas, box, px) : '#111111',
      bg: canvas ? sampleBackground(canvas, box, px) : '#ffffff',
    };
  };

  // Clicking a detected line opens its font panel (showing the real typeface, size,
  // colour and whether it can be reused 1:1) instead of editing blindly.
  const pickRun = (idx: number) => {
    const run = runs[idx];
    if (!run) return;
    setPickInfo(sampleRun(run));
    setPickedRun(idx);
  };

  // "Originalschrift übernehmen": drop a text box at the line, in its EXACT typeface,
  // size, style and colour, pre-filled with the line's text and ready to edit. With
  // `cover` it also hides the original glyphs (sampled background); without it the
  // user covers the original themselves with the brush.
  const adoptRun = (idx: number, cover: boolean) => {
    const run = runs[idx];
    if (!run || !page) return;
    const { color, bg } = pickInfo ?? sampleRun(run);
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
      family: run.family, // metric fallback if the original font can't be embedded
      size: run.fontSize,
      bold: run.bold,
      italic: run.italic,
      color,
      align: 'left',
      lineHeight: 1.15,
      coverColor: cover ? bg : undefined, // hides the original glyphs on screen + export
      embeddedFontId: run.embeddedFontId, // reuse the ORIGINAL typeface when captured
    };
    addElement(page.id, el); // commits history + selects the new element
    setPickedRun(null);
    setEditingId(el.id); // open the editor right away (text pre-selected, ready to type)
  };

  // A detected line is "consumed" once a text box has been adopted at its position,
  // so its clickable box never reappears (and a second adopt can't stack on it).
  const runIsTaken = useCallback(
    (run: TextRun) =>
      !!page &&
      page.elements.some(
        (e) =>
          e.type === 'text' &&
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
              // Text stays clickable in scan mode so an in-place edit can be
              // re-opened (clicking a covered line edits the existing field again).
              interactive={activeTool === 'select' || editingId === el.id || (activeTool === 'edit-text' && el.type === 'text')}
              editTextMode={activeTool === 'edit-text'}
              alignBaselines={getAlignTargets(el.id)}
              onAlignGuide={setAlignGuideY}
              onStartEdit={() => startEditElement(el.id)}
              onEndEdit={endTextEdit}
              updateElement={updateElement}
              commit={commit}
            />
          ))}

          {draft && <DraftView el={draft} scale={scale} />}

          {/* Alignment guide: a line at the baseline a text box is snapping to. */}
          {alignGuideY != null && <div className="align-guide" style={{ top: alignGuideY * scale }} />}

          {activeTool === 'edit-text' && (
            <>
              {runs.length > 0 && <div key={scanId} className="scan-sweep" />}
              {runs.map((run, i) => {
                if (runIsTaken(run)) return null;
                return <RunBox key={i} run={run} scale={scale} active={pickedRun === i} onPick={() => pickRun(i)} />;
              })}
            </>
          )}
        </div>

        {/* Font panel for the picked line — sits above the overlay so it isn't clipped. */}
        {activeTool === 'edit-text' && pickedRun != null && runs[pickedRun] && (
          <FontInfoPanel
            run={runs[pickedRun]}
            scale={scale}
            color={pickInfo?.color ?? '#111111'}
            stageW={view.width * scale}
            stageH={view.height * scale}
            onAdopt={(cover) => adoptRun(pickedRun, cover)}
            onClose={() => setPickedRun(null)}
          />
        )}
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
 * A clickable box over a detected line of existing PDF text. Clicking it calls
 * `pickRun`, which opens the font panel for the line (real typeface, size, style,
 * colour and whether it is embedded). The box previews the line in its own font and
 * shows the detected point size on hover.
 */
function RunBox({ run, scale, active, onPick }: { run: TextRun; scale: number; active: boolean; onPick: () => void }) {
  const box: React.CSSProperties = {
    left: run.x * scale,
    top: run.y * scale,
    width: Math.max(run.width, 24) * scale,
    height: run.height * scale,
    fontFamily: embeddedFontFamily(run.embeddedFontId) ?? cssStackFor(run.family),
    fontSize: run.fontSize * scale,
    fontWeight: run.bold ? 700 : 400,
    fontStyle: run.italic ? 'italic' : 'normal',
  };
  return (
    <div
      className={`run-box ${active ? 'active' : ''}`}
      style={box}
      onPointerDown={(e) => {
        // preventDefault stops the browser's default focus-on-mousedown, which would
        // otherwise immediately blur an editor we open right after.
        e.preventDefault();
        e.stopPropagation();
        onPick();
      }}
      title={`„${run.str}“ · ${Math.round(run.fontSize)} pt · klicken für Schrift-Infos`}
    >
      <span className="run-tag">{Math.round(run.fontSize)}</span>
    </div>
  );
}

/**
 * Panel shown when a scanned line is clicked. It reveals the line's REAL typeface,
 * size, style and colour, and whether the PDF embeds the font (so it can be reused
 * 1:1). "Originalschrift übernehmen" drops a text box in exactly that font.
 */
function FontInfoPanel({
  run,
  scale,
  color,
  stageW,
  stageH,
  onAdopt,
  onClose,
}: {
  run: TextRun;
  scale: number;
  color: string;
  stageW: number;
  stageH: number;
  onAdopt: (cover: boolean) => void;
  onClose: () => void;
}) {
  const previewFamily = embeddedFontFamily(run.embeddedFontId) ?? cssStackFor(run.family);
  const width = 256;
  const left = Math.max(4, Math.min(run.x * scale, stageW - width - 4));
  const estH = 168;
  const below = (run.y + run.height) * scale + 8;
  const top = below + estH > stageH ? Math.max(4, run.y * scale - estH - 8) : below;
  const styleBits = [run.bold ? 'Fett' : null, run.italic ? 'Kursiv' : null].filter(Boolean).join(' · ');

  return (
    <div className="font-panel" style={{ left, top, width }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="font-panel-head">
        <Type size={14} />
        <span>Erkannte Schrift</span>
        <button className="font-panel-x" onClick={onClose} title="Schließen">
          <X size={14} />
        </button>
      </div>
      <div className="font-panel-name" style={{ fontFamily: previewFamily }}>
        {run.fontLabel || 'Unbekannt'}
      </div>
      <div className={`font-panel-badge ${run.embedded === true ? 'ok' : run.embedded === false ? 'warn' : 'neutral'}`}>
        {run.embedded === true ? (
          <>
            <Check size={13} /> Originalschrift verfügbar – exakt nutzbar
          </>
        ) : run.embedded === false ? (
          <>nicht eingebettet – ähnlichste Schrift wird genutzt</>
        ) : (
          <>Schrift wird geprüft …</>
        )}
      </div>
      <div className="font-panel-meta">
        <span>{Math.round(run.fontSize)} pt</span>
        {styleBits && <span>{styleBits}</span>}
        <span className="font-panel-swatch" style={{ background: color }} title={color} />
      </div>
      <div className="font-panel-actions">
        <button className="btn primary" onClick={() => onAdopt(true)}>
          Originalschrift übernehmen
        </button>
        <button className="btn ghost sm" onClick={() => onAdopt(false)} title="Feld ohne Hintergrund-Abdeckung einfügen">
          ohne Abdeckung
        </button>
      </div>
    </div>
  );
}
