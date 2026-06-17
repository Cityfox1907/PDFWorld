import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, visibleSize, MAX_ZOOM, MIN_ZOOM, type EditorPage } from '../state/store';
import {
  renderPageRegion,
  extractTextRuns,
  inspectFonts,
  groupRunsIntoLines,
  registerEmbeddedFont,
  embeddedFontFamily,
  cssStackFor,
  matchCatalogFontKey,
  isGenericFontLabel,
  isInternalFontName,
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
import { Type, Check, X, Plus } from 'lucide-react';

const DEVICE_PIXEL_RATIO = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
// Density at which the visible window is rasterised. We render at (at least) the
// display's own pixel density so every screen pixel gets its own vector sample —
// glyph edges stay knife-sharp, never an upscaled blur. A touch of supersampling on
// low-DPI screens smooths anti-aliasing; capped so huge monitors stay within limits.
const TARGET_DENSITY = Math.min(Math.max(DEVICE_PIXEL_RATIO, 2), 3);
// Caps that keep the *window* bitmap inside every browser's canvas limits. Because we
// only ever rasterise the visible window (never the whole zoomed page), these are
// effectively never hit at normal viewport sizes, so density stays at the target.
const MAX_BITMAP_DIM = 8192;
const MAX_BITMAP_AREA = 16_000_000;
// Extra CSS px rendered just outside the viewport so small scrolls reveal already-
// sharp content instead of a blank edge while the next window render lands.
const OVERSCAN = 128;
// Magnification limits (25 %–2000 %) come from the store so the clamp lives once.
// How close (in screen pixels) a text baseline must be to a neighbour's before the
// alignment guide lights up. Small, because the guide is a pure visual confirmation
// of exact alignment — it never snaps or pulls the box.
const ALIGN_TOL = 1.5;

export function PageCanvas() {
  const pages = useStore((s) => s.pages);
  const currentPageId = useStore((s) => s.currentPageId);
  const page = useMemo(() => pages.find((p) => p.id === currentPageId) ?? pages[0], [pages, currentPageId]);

  const zoom = useStore((s) => s.zoom);
  const engine = useStore((s) => s.engine);
  const activeTool = useStore((s) => s.activeTool);
  const tool = useStore((s) => s.tool);
  const addElement = useStore((s) => s.addElement);
  const addElements = useStore((s) => s.addElements);
  const updateElement = useStore((s) => s.updateElement);
  const deleteElement = useStore((s) => s.deleteElement);
  const commit = useStore((s) => s.commit);
  const selectElement = useStore((s) => s.selectElement);
  const setTool = useStore((s) => s.setTool);
  const setToolDefaults = useStore((s) => s.setToolDefaults);
  const addRecentColor = useStore((s) => s.addRecentColor);
  const showToast = useStore((s) => s.showToast);

  const areaRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // The page-window currently painted on the canvas, in scale-independent view-point
  // space, plus the density it was rasterised at. Used to (a) re-stretch the existing
  // bitmap instantly during a zoom and (b) map view-points → canvas pixels for colour
  // sampling, since the canvas now covers only the window, not the whole page.
  const regionRef = useRef<{ vx: number; vy: number; vw: number; vh: number; renderScale: number; dpr: number } | null>(null);
  // Monotonic id so a slower render can detect it was superseded and bail.
  const renderTokenRef = useRef(0);
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

  // ── Render the visible page-window (lossless zoom) ────────────────────────
  // We rasterise ONLY the part of the page inside the scroll viewport, at full
  // device density, and lay that bitmap over its spot on the stage. Because the
  // window never grows past the screen, the bitmap never hits the canvas-area cap
  // that used to force resolution down at high zoom — so glyph edges stay razor
  // sharp at any magnification, exactly like a native PDF viewer. The off-screen
  // render is blitted in one synchronous step, so the canvas never flashes white.
  const paintViewport = useCallback(async () => {
    const canvas = canvasRef.current;
    const area = areaRef.current;
    const stage = stageRef.current;
    if (!canvas || !area || !stage || !page) return;
    const token = ++renderTokenRef.current;

    const stageW = view.width * scale;
    const stageH = view.height * scale;
    if (stageW < 1 || stageH < 1) return;

    // Visible window of the stage in stage-local CSS px, padded by OVERSCAN, clamped
    // to the page. getBoundingClientRect folds in scroll position and the centring
    // margin, so this stays correct however the stage is laid out.
    const areaRect = area.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const left = Math.max(0, areaRect.left - stageRect.left - OVERSCAN);
    const top = Math.max(0, areaRect.top - stageRect.top - OVERSCAN);
    const right = Math.min(stageW, areaRect.right - stageRect.left + OVERSCAN);
    const bottom = Math.min(stageH, areaRect.bottom - stageRect.top + OVERSCAN);
    const cssW = right - left;
    const cssH = bottom - top;
    if (cssW < 1 || cssH < 1) return;

    // Full target density; lowered only if the window itself is enormous.
    let dpr = Math.min(TARGET_DENSITY, MAX_BITMAP_DIM / cssW, MAX_BITMAP_DIM / cssH, Math.sqrt(MAX_BITMAP_AREA / (cssW * cssH)));
    dpr = Math.max(0.5, dpr);

    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    // Scale-independent geometry so a later zoom can re-stretch this same bitmap.
    const region = { vx: left / scale, vy: top / scale, vw: cssW / scale, vh: cssH / scale, renderScale: scale, dpr };

    const place = () => {
      canvas.style.left = `${region.vx * scale}px`;
      canvas.style.top = `${region.vy * scale}px`;
      canvas.style.width = `${region.vw * scale}px`;
      canvas.style.height = `${region.vh * scale}px`;
    };

    if (page.blank) {
      const ctx = canvas.getContext('2d', { alpha: false });
      canvas.width = bw;
      canvas.height = bh;
      if (ctx) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, bw, bh);
      }
      place();
      regionRef.current = region;
      return;
    }

    try {
      const pdfPage = await engine.getPage(page.sourceKey, page.sourceIndex);
      if (token !== renderTokenRef.current) return;
      const off = document.createElement('canvas');
      off.width = bw;
      off.height = bh;
      await renderPageRegion(pdfPage, off, scale * dpr, rotation, left * dpr, top * dpr);
      if (token !== renderTokenRef.current) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      // Resize + reposition + blit together: the on-screen canvas never goes blank.
      canvas.width = bw;
      canvas.height = bh;
      ctx.drawImage(off, 0, 0);
      place();
      regionRef.current = region;
    } catch {
      /* superseded by a newer render */
    }
  }, [engine, page, scale, rotation, view.width, view.height]);

  // Drive the window render: immediate on a page / rotation / size change (clearing
  // the stale page first so it can't flash), debounced on a pure zoom so the stretched
  // preview leads and the crisp re-render lands once the gesture settles.
  const renderSigRef = useRef('');
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !page) return;
    const sig = `${page.id}|${rotation}|${Math.round(view.width)}x${Math.round(view.height)}`;
    const onlyZoom = renderSigRef.current === sig;
    renderSigRef.current = sig;
    if (!onlyZoom) {
      regionRef.current = null; // the old bitmap belongs to the previous page/layout
      const ctx = canvas.getContext('2d', { alpha: false });
      if (ctx) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    const t = window.setTimeout(() => void paintViewport(), onlyZoom ? 120 : 0);
    return () => window.clearTimeout(t);
  }, [paintViewport, page, rotation, view.width, view.height]);

  // Re-render the window after scrolling so freshly revealed area becomes sharp.
  // Coalesced to one render per frame + a short settle so a fast flick doesn't thrash
  // pdf.js; the OVERSCAN margin keeps the edge covered until the next render lands.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let raf = 0;
    let settle = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        window.clearTimeout(settle);
        settle = window.setTimeout(() => void paintViewport(), 60);
      });
    };
    area.addEventListener('scroll', schedule, { passive: true });
    return () => {
      area.removeEventListener('scroll', schedule);
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [paintViewport]);

  // During a zoom (before the debounced sharp render lands) keep the existing window
  // bitmap glued to its page position and stretched to the new scale — a smooth,
  // flash-free transition that mirrors a continuous re-render.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const region = regionRef.current;
    if (!canvas || !region) return;
    canvas.style.left = `${region.vx * scale}px`;
    canvas.style.top = `${region.vy * scale}px`;
    canvas.style.width = `${region.vw * scale}px`;
    canvas.style.height = `${region.vh * scale}px`;
  }, [scale]);

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
          // The real font name from the PDF (info.displayName, taken from the font's
          // own /BaseFont) is the most accurate. Prefer it whenever the run-level
          // label is only a generic family ("Sans-Serif") so the panel never shows a
          // placeholder when a true name is available — and refine the fallback family.
          const realName = info?.displayName;
          const useReal = !!realName && !isGenericFontLabel(realName) && !isInternalFontName(realName) && (!l.fontLabel || isGenericFontLabel(l.fontLabel));
          const fontLabel = useReal ? realName : (l.fontLabel ?? realName);
          const family = (useReal && matchCatalogFontKey(realName)) || l.family;
          return { ...l, family, fontLabel, embedded: info?.embedded ?? false, embeddedFontId };
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

  // Arrow keys nudge the selected element pixel-for-pixel for precise placement:
  // each press moves exactly one screen pixel (Shift = 10), independent of the zoom,
  // so a deeply zoomed-in field can be inched into place. A neighbour-baseline guide
  // only *appears* when the text's own baseline lands on another line — it never
  // pulls the box. Ignored while typing, and locked elements stay put.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!page || editingId) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      const selId = useStore.getState().selectedElementId;
      if (!selId) return;
      const target = page.elements.find((el) => el.id === selId);
      if (!target || target.locked) return;
      e.preventDefault();
      // One CSS pixel in view-points; coarse step with Shift.
      const step = (e.shiftKey ? 10 : 1) / scale;
      let nx = target.x;
      let ny = target.y;
      if (e.key === 'ArrowLeft') nx -= step;
      else if (e.key === 'ArrowRight') nx += step;
      else if (e.key === 'ArrowUp') ny -= step;
      else ny += step;

      // Visual-only alignment hint: show the guide when the (unrotated) text baseline
      // coincides with a neighbour's, then it vanishes again as you move on.
      let guide: number | null = null;
      if (target.type === 'text' && !target.rotation) {
        const near = nearestBaseline(ny + target.size * BASELINE_RATIO, getAlignTargets(selId), ALIGN_TOL / scale);
        if (near != null) guide = near;
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
  }, [page, editingId, updateElement, commit, getAlignTargets, scale]);

  const evToView = (e: { clientX: number; clientY: number }) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  // Map view-points → rendered-canvas pixels for colour sampling. The canvas now holds
  // only the visible window, so reads go through the last render's origin + density
  // (`px` = bitmap px per view-point, `ox`/`oy` = the window's top-left in bitmap px).
  const sampleMap = () => {
    const r = regionRef.current;
    if (r) {
      const px = r.renderScale * r.dpr;
      return { px, ox: r.vx * px, oy: r.vy * px };
    }
    return { px: scale * TARGET_DENSITY, ox: 0, oy: 0 };
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
        // Insert the line exactly where the I-beam sits: the click point becomes the
        // vertical middle of the first line (not the box top), so text lands on the
        // line you pointed at instead of dropping below it.
        x: start.x,
        y: start.y - tool.textSize * 0.5,
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
    if (activeTool === 'cut') {
      startCut(start, e);
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
    // The cursor is always inside the rendered window, so the read is accurate.
    const { px, ox, oy } = sampleMap();
    const color = canvas ? sampleColorAt(canvas, start.x, start.y, px, ox, oy) : '#ffffff';
    setToolDefaults({ brushColor: color });
    addRecentColor(color); // make the sampled tone reusable in any colour picker
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

  // ── cut-out tool: marquee a region, snapshot its pixels into a movable image and
  // cover the original spot with its own background so the piece reads as "cut out". ──
  const startCut = (start: { x: number; y: number }, e: React.PointerEvent) => {
    if (!page) return;
    const move = (ev: PointerEvent) => {
      const p = evToView(ev);
      const x = Math.min(start.x, p.x);
      const y = Math.min(start.y, p.y);
      setDraft({
        id: 'draft-cut',
        type: 'rect',
        x,
        y,
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
        opacity: 1,
        z: nextZ(page),
        fill: null,
        stroke: 'var(--accent)',
        strokeWidth: 1,
        radius: 0,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft((d) => {
        if (d && d.width > 4 && d.height > 4) cutRegion(d.x, d.y, d.width, d.height);
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const cutRegion = (x: number, y: number, w: number, h: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !page) return;
    // Map the view-space rectangle to bitmap pixels via the last render's origin +
    // density, then clamp to what's actually painted (the visible window).
    const { px, ox, oy } = sampleMap();
    const sx = Math.max(0, Math.round(x * px - ox));
    const sy = Math.max(0, Math.round(y * px - oy));
    const ex = Math.min(canvas.width, Math.round((x + w) * px - ox));
    const ey = Math.min(canvas.height, Math.round((y + h) * px - oy));
    const cw = ex - sx;
    const ch = ey - sy;
    if (cw <= 1 || ch <= 1) {
      showToast('Bereich liegt ausserhalb des sichtbaren Fensters.', 'error');
      return;
    }
    const off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    const octx = off.getContext('2d');
    if (!octx) return;
    octx.drawImage(canvas, sx, sy, cw, ch, 0, 0, cw, ch);
    let src: string;
    try {
      src = off.toDataURL('image/png');
    } catch {
      showToast('Bereich konnte nicht ausgeschnitten werden.', 'error');
      return;
    }

    // The exact view-space rect that was captured (after clamping).
    const vx = (sx + ox) / px;
    const vy = (sy + oy) / px;
    const vw = cw / px;
    const vh = ch / px;

    const bg = sampleBackground(canvas, { x: vx, y: vy, width: vw, height: vh }, px, ox, oy);
    const z = nextZ(page);
    // Cover the hole with the region's own background, the snapshot floats on top.
    const cover: AnyElement = {
      id: uid('el'), type: 'rect', x: vx, y: vy, width: vw, height: vh,
      opacity: 1, z, fill: bg, stroke: null, strokeWidth: 0, radius: 0,
    };
    const piece: AnyElement = {
      id: uid('el'), type: 'image', x: vx, y: vy, width: vw, height: vh,
      opacity: 1, z: z + 1, src, aspect: vw / vh,
    };
    addElements(page.id, [cover, piece], piece.id); // one undo step, piece selected
    setTool('select');
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
  // rendered canvas via sampleMap(), which maps view-points to the window bitmap's
  // own origin + density (the canvas covers only the visible window, not the page).
  const sampleRun = (run: TextRun): { color: string; bg: string } => {
    const canvas = canvasRef.current;
    const box = { x: run.x, y: run.y, width: Math.max(run.width, 24), height: run.height };
    const { px, ox, oy } = sampleMap();
    return {
      color: canvas ? sampleTextColor(canvas, box, px, ox, oy) : '#111111',
      bg: canvas ? sampleBackground(canvas, box, px, ox, oy) : '#ffffff',
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

  // "Neues Feld darunter": drop an EMPTY text box directly beneath the detected line,
  // in the SAME typeface (original 1:1 when embedded), fixed at 9 pt and the line's
  // own ink colour — ready to type. Ideal for writing an answer under a label.
  const addFieldBelow = (idx: number) => {
    const run = runs[idx];
    if (!run || !page) return;
    const { color } = pickInfo ?? sampleRun(run);
    const size = 9;
    const gap = Math.max(2, run.fontSize * 0.3);
    const el: TextElement = {
      id: uid('el'),
      type: 'text',
      x: run.x,
      y: run.y + run.height + gap,
      width: Math.max(run.width, 120),
      height: Math.max(size * 1.4, 14),
      opacity: 1,
      z: nextZ(page),
      text: '',
      family: run.family, // metric fallback if the original font can't be embedded
      size,
      bold: run.bold,
      italic: run.italic,
      color,
      align: 'left',
      lineHeight: 1.3,
      embeddedFontId: run.embeddedFontId, // reuse the ORIGINAL typeface when captured
    };
    addElement(page.id, el);
    setPickedRun(null);
    setEditingId(el.id);
  };

  // Adopt the line's detected ink colour as the default for new text everywhere.
  const useDetectedColor = (color: string) => {
    setToolDefaults({ textColor: color });
    addRecentColor(color);
    showToast('Farbe für neuen Text übernommen', 'success');
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
      <div ref={stageRef} className="canvas-stage" style={{ width: view.width * scale, height: view.height * scale }}>
        {/* Geometry (left/top/width/height) is set imperatively per render so React
            re-renders never clobber the window placement; see paintViewport. */}
        <canvas ref={canvasRef} className="page-canvas" />
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

          {/* Alignment guide: appears only while a text baseline sits exactly on a neighbour's. */}
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
            onAddBelow={() => addFieldBelow(pickedRun)}
            onUseColor={useDetectedColor}
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
  onAddBelow,
  onUseColor,
  onClose,
}: {
  run: TextRun;
  scale: number;
  color: string;
  stageW: number;
  stageH: number;
  onAdopt: (cover: boolean) => void;
  onAddBelow: () => void;
  onUseColor: (color: string) => void;
  onClose: () => void;
}) {
  const previewFamily = embeddedFontFamily(run.embeddedFontId) ?? cssStackFor(run.family);
  const width = 268;
  const left = Math.max(4, Math.min(run.x * scale, stageW - width - 4));
  const estH = 256;
  const below = (run.y + run.height) * scale + 8;
  const top = below + estH > stageH ? Math.max(4, run.y * scale - estH - 8) : below;
  const styleBits = [run.bold ? 'Fett' : null, run.italic ? 'Kursiv' : null].filter(Boolean).join(' · ');
  const sample = (run.str || 'Aa Bb Cc 0123').trim().slice(0, 28);

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
      {/* The detected line drawn in its OWN typeface — an immediate, honest preview. */}
      <div
        className="font-panel-preview"
        style={{ fontFamily: previewFamily, fontWeight: run.bold ? 700 : 400, fontStyle: run.italic ? 'italic' : 'normal', color }}
      >
        {sample}
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
        <button
          className="font-panel-swatch"
          style={{ background: color }}
          title="Diese Schriftfarbe für neuen Text übernehmen"
          onClick={() => onUseColor(color)}
        />
      </div>
      <div className="font-panel-actions">
        <button className="btn primary" onClick={() => onAdopt(true)}>
          Originalschrift übernehmen
        </button>
        <button className="btn" onClick={onAddBelow} title="Leeres Textfeld in gleicher Schrift (9 pt) direkt unter dieser Zeile anlegen">
          <Plus size={14} /> Neues Feld darunter · 9 pt
        </button>
        <button className="btn ghost sm" onClick={() => onAdopt(false)} title="Feld ohne Hintergrund-Abdeckung einfügen">
          ohne Abdeckung einfügen
        </button>
      </div>
    </div>
  );
}
