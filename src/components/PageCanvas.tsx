import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, visibleSize, type EditorPage } from '../state/store';
import { useUI } from '../state/ui';
import { viewportBridge } from '../state/viewport';
import {
  renderPageRegion,
  extractTextRuns,
  inspectFonts,
  groupRunsIntoLines,
  registerEmbeddedFont,
  textFaceCss,
  classifyFont,
  resolveFamilyKey,
  isInternalFontName,
  fontDisplayName,
  BASELINE_RATIO,
  firstBaselineOffset,
  shapeOutline,
  pointsToSvgPath,
  isStrokeOnlyShape,
  type AnyElement,
  type ElementPatch,
  type TextElement,
  type CalloutElement,
  type TextRun,
} from '../lib/pdf';
import { sampleBackground, sampleTextColor, sampleColorAt } from '../lib/utils/color';
import { nearestBaseline } from '../lib/utils/align';
import { inkDashArray } from '../lib/utils/ink';
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
// The cut/duplicate tool snapshots a region straight from the PDF (never from the
// screen bitmap) at this minimum density — ~288 DPI, print grade — so the floating
// copy stays razor-sharp regardless of the current zoom. Capped by MAX_BITMAP_* below.
const CUT_MIN_DENSITY = 4;
// Highlighter pen opacity (Multiply blend keeps the text underneath readable).
const HIGHLIGHT_OPACITY = 0.4;
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
  const updateElement = useStore((s) => s.updateElement);
  const deleteElement = useStore((s) => s.deleteElement);
  const commit = useStore((s) => s.commit);
  const selectElement = useStore((s) => s.selectElement);
  const selectElements = useStore((s) => s.selectElements);
  const setTool = useStore((s) => s.setTool);
  const setToolDefaults = useStore((s) => s.setToolDefaults);
  const addRecentColor = useStore((s) => s.addRecentColor);
  const showToast = useStore((s) => s.showToast);
  const pendingTextStyle = useStore((s) => s.pendingTextStyle);
  const setPendingTextStyle = useStore((s) => s.setPendingTextStyle);
  // One-shot "edit this text" signal from the touch chrome (no double-click on a phone).
  const editRequest = useStore((s) => s.editRequest);
  const elementsPanelOpen = useUI((s) => s.elementsPanelOpen);

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
  // Page-turn transition: the last painted page id (to detect a real page change) and
  // the pending slide direction (+1 next, −1 previous) the next paint should animate in.
  const lastPageIdRef = useRef<string | null>(null);
  const enterAnimRef = useRef<-1 | 0 | 1>(0);
  const [fitScale, setFitScale] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnyElement | null>(null);
  // Background-brush magnifier loupe: the sampled point (view-points), where to float the
  // loupe on screen (client px), the active sampling map and the exact colour under the
  // cursor — so the preview shows precisely which pixel/colour the brush will pick up.
  const [loupe, setLoupe] = useState<{
    vx: number;
    vy: number;
    clientX: number;
    clientY: number;
    px: number;
    ox: number;
    oy: number;
    color: string;
  } | null>(null);
  // Rubber-band selection rectangle (view-points) drawn with the select tool.
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // Touch two-tap selection: the first corner the user tapped (view-points). A drag-
  // marquee is unreliable on touch (the browser keeps stealing the gesture as a pan), so
  // on a finger the select tool collects two opposite corners instead — tap, then tap.
  const [tapCorner, setTapCorner] = useState<{ x: number; y: number } | null>(null);
  const [runs, setRuns] = useState<TextRun[]>([]);
  const [scanId, setScanId] = useState(0);
  // Scan tool: the line whose font panel is open, plus its sampled colours.
  const [pickedRun, setPickedRun] = useState<number | null>(null);
  const [pickInfo, setPickInfo] = useState<{ color: string; bg: string } | null>(null);
  // Active alignment guides (view-points) shown while moving text: a baseline (Y)
  // and a left-edge (X), so both horizontal and vertical alignment are confirmed.
  const [alignGuideY, setAlignGuideY] = useState<number | null>(null);
  const [alignGuideX, setAlignGuideX] = useState<number | null>(null);
  // Baselines + left edges of the last scanned lines, kept across tool switches so a
  // moved text box can snap onto the real letters even after leaving the scan tool.
  const [scanBaselines, setScanBaselines] = useState<number[]>([]);
  const [scanLeftEdges, setScanLeftEdges] = useState<number[]>([]);
  // Coalesces a burst of arrow-key nudges into a single undo step: the element id
  // whose burst is in progress, and the timer that ends the burst after a pause.
  const nudgeActiveId = useRef<string | null>(null);
  const nudgeTimer = useRef<number | null>(null);
  // Last edit-request nonce we already acted on, so the same signal fires editing once.
  const editReqRef = useRef(0);

  const rotation = page ? (((page.baseRotation + page.addedRotation) % 360) + 360) % 360 : 0;
  const view = page ? visibleSize(page) : { width: 1, height: 1 };
  const scale = fitScale * zoom;

  // Never carry a transient edit across a page switch.
  const pageId = page?.id;
  useEffect(() => {
    setEditingId(null);
    setPickedRun(null);
    setAlignGuideY(null);
    setAlignGuideX(null);
    setScanBaselines([]);
    setScanLeftEdges([]);
    setTapCorner(null);
  }, [pageId]);

  // An armed two-tap selection corner only makes sense while the select tool is active —
  // switching to any other tool abandons it so a stray first corner never lingers.
  useEffect(() => {
    if (activeTool !== 'select') setTapCorner(null);
  }, [activeTool]);

  // If a selection is made another way while a corner is armed (e.g. tapping an element
  // directly), drop the stale corner so the next empty-space tap doesn't build a rectangle
  // from it. Reading the store directly keeps this independent of the marquee/tap flow.
  const selectedElementId = useStore((s) => s.selectedElementId);
  useEffect(() => {
    if (selectedElementId && tapCorner) setTapCorner(null);
  }, [selectedElementId, tapCorner]);

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
    // Play the gentle slide/fade once the freshly-painted page is on screen (set by the
    // render effect on a real page change), so the swap reads as a smooth page turn.
    const maybeAnimateEnter = () => {
      const dir = enterAnimRef.current;
      if (dir) {
        enterAnimRef.current = 0;
        animatePageEnter(stageRef.current, dir);
      }
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
      maybeAnimateEnter();
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
      maybeAnimateEnter();
    } catch {
      /* superseded by a newer render */
    }
  }, [engine, page, scale, rotation, view.width, view.height]);

  // Drive the window render: immediate on a page / rotation / size change, debounced on a
  // pure zoom so the stretched preview leads and the crisp re-render lands once the
  // gesture settles. We deliberately do NOT clear the canvas to white first — paintViewport
  // resizes and blits the new bitmap in one synchronous step, so holding the previous frame
  // until the new one is ready makes the page swap flash-free (no white flicker).
  const renderSigRef = useRef('');
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !page) return;
    const sig = `${page.id}|${rotation}|${Math.round(view.width)}x${Math.round(view.height)}`;
    const onlyZoom = renderSigRef.current === sig;
    renderSigRef.current = sig;
    // On a true page change, queue a directional slide-in for the next paint and drop the
    // old region (it belonged to the previous page). The direction follows the page order.
    if (lastPageIdRef.current !== null && lastPageIdRef.current !== page.id) {
      const list = useStore.getState().pages;
      const oldIdx = list.findIndex((p) => p.id === lastPageIdRef.current);
      const newIdx = list.findIndex((p) => p.id === page.id);
      enterAnimRef.current = oldIdx >= 0 && newIdx >= 0 && newIdx < oldIdx ? -1 : 1;
    }
    lastPageIdRef.current = page.id;
    if (!onlyZoom) regionRef.current = null;
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
    if (activeTool !== 'edit-text') {
      setRuns([]);
      setPickedRun(null);
      return;
    }
    // The scan tool is active but there is nothing to analyse (a freshly added blank page
    // or a page with no embedded text). Say so, so tapping "Scan" never feels like a no-op.
    if (pageSourceKey === undefined || pageSourceIndex === undefined || pageBlank) {
      setRuns([]);
      setPickedRun(null);
      showToast('Leere Seite – kein Text zum Scannen.', 'info');
      return;
    }
    let cancelled = false;
    void (async () => {
      // Which phase is running, so a failure points to the exact culprit in the toast.
      let phase = 'getPage';
      try {
        const pdfPage = await engine.getPage(pageSourceKey, pageSourceIndex);
        phase = 'extractText';
        const r = await extractTextRuns(pdfPage, rotation);
        if (cancelled) return;
        phase = 'group';
        const lines = groupRunsIntoLines(r);
        setRuns(lines); // show the clickable boxes immediately
        if (lines.length === 0) showToast('Kein bearbeitbarer Text auf dieser Seite gefunden.', 'info');
        setPickedRun(null);
        setScanId((n) => n + 1); // replay the scan sweep once per real scan
        // Remember each line's baseline AND left edge so a moved text box can snap
        // onto the real glyphs (baseline = horizontal, left edge = vertical).
        setScanBaselines(lines.map((l) => l.y + l.fontSize * BASELINE_RATIO));
        setScanLeftEdges(lines.map((l) => l.x));

        // Then inspect each line's font: confirm whether the PDF embeds it (so it
        // can be reused 1:1) and attach the ORIGINAL program when it does. The
        // readable name already comes from extractTextRuns; commonObjs is a fallback.
        // Always records `embedded` (even when nothing resolves) so the panel never
        // stays stuck on the neutral "checking" badge. A failure in THIS refinement
        // (e.g. embedded-font extraction, which is the fragile step on mobile Safari)
        // must never discard the clickable boxes the extraction above already produced
        // — so it runs in its own try and, on error, simply keeps the basic boxes.
        try {
        const infos = await inspectFonts(pdfPage, lines.map((l) => l.fontName));
        if (cancelled) return;
        const enriched = lines.map((l) => {
          const info = infos.get(l.fontName);
          const embedded = info?.embedded ?? false;
          let embeddedFontId = l.embeddedFontId;
          if (embedded && info?.data) {
            const id = `${pageSourceKey}#${pageSourceIndex}#${l.fontName}`;
            registerEmbeddedFont({ id, data: info.data, mimetype: info.mimetype || 'font/opentype' });
            embeddedFontId = id;
          }
          // The font's own /BaseFont name (info.rawName) is the most accurate identity;
          // fall back to the run's pdf.js name. fontDisplayName turns it into the honest
          // label the panel shows: a catalogue name we can reproduce, the embedded
          // original's real name, a generic family, or "Unbekannt".
          const rawForName = info?.rawName ?? l.fontName;
          const fontLabel = fontDisplayName(rawForName, embedded);
          // Family, weight AND style all come from the font's REAL /BaseFont name
          // (info.rawName), which is authoritative. pdf.js only ever reports a *generic*
          // fallback family for a run's style — "serif"/"sans-serif"/"monospace", derived
          // from descriptor flags — never the real name. So a flag-less or non-embedded
          // serif face like DejaVu Serif comes back as "sans-serif" and, classified from
          // that, would be filed (and shown, and fall back) as Helvetica. resolveFamilyKey
          // re-derives the honest family from the real name (catalogue match first, so a
          // known font like Arial/Roboto/Times still maps 1:1). Only a real, informative
          // name earns this: an internal pdf.js placeholder ("g_d0_f1") or a missing
          // inspection leaves the run's own family untouched, so we never *downgrade* a
          // good guess to a blind "sans". Style flags are OR-ed so an already-detected
          // bold/italic is never lost.
          const realStyle = info ? classifyFont(info.rawName) : null;
          const hasRealName = !!info && !isInternalFontName(rawForName);
          const family = hasRealName ? resolveFamilyKey(rawForName) : l.family;
          // Combine every weight/slant signal: the run, the real name's tokens AND pdf.js's
          // descriptor flags — so a Bold/Italic face is caught even when its name is silent.
          const bold = l.bold || !!realStyle?.bold || !!info?.bold;
          const italic = l.italic || !!realStyle?.italic || !!info?.italic;
          return { ...l, family, bold, italic, fontLabel, embedded, embeddedFontId };
        });
        if (!cancelled) setRuns(enriched);
        } catch (err) {
          // Only the font refinement failed; the basic boxes from the extraction stay
          // on screen so the scan tool still works. Log the real cause, never swallow it.
          console.error('Scan-Schriftanalyse fehlgeschlagen – Basis-Boxen bleiben erhalten:', err);
        }
      } catch (err) {
        if (!cancelled) {
          setRuns([]);
          // Phase + error kept in the console for diagnosis; the user sees a clean message.
          console.error(`Textscan fehlgeschlagen [${phase}]:`, err);
          showToast('Text konnte nicht gescannt werden. Bitte erneut versuchen.', 'error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTool, engine, pageSourceKey, pageSourceIndex, pageBlank, rotation, showToast]);

  // ── zoom keeping a chosen anchor point perfectly stationary ──
  // Used by Ctrl/⌘+wheel and trackpad/touch pinch (anchor = the cursor) and by the
  // TopBar +/- buttons (anchor = the centre of the visible window). The maths read the
  // stage's REAL rendered rect before and after the scale change, so the page-point under
  // the anchor lands back under it regardless of the centring margin — the document zooms
  // into that exact spot instead of drifting toward the bottom-right.
  const zoomAround = useCallback((clientX: number, clientY: number, factor: number) => {
    const area = areaRef.current;
    const stage = stageRef.current;
    if (!area || !stage) return;
    const st = useStore.getState();
    const old = st.zoom;
    const next = Math.max(st.minZoom, Math.min(st.maxZoom, Number((old * factor).toFixed(2))));
    if (next === old) return;
    const before = stage.getBoundingClientRect();
    const dx = clientX - before.left; // anchor offset inside the stage (old scale)
    const dy = clientY - before.top;
    const ratio = next / old;
    st.setZoom(next);
    requestAnimationFrame(() => {
      const after = stage.getBoundingClientRect();
      // Where that same page-point now sits, minus where we want it (the anchor).
      area.scrollLeft += after.left + dx * ratio - clientX;
      area.scrollTop += after.top + dy * ratio - clientY;
    });
  }, []);

  // Zoom on the centre of the visible window — the anchor the +/- buttons use so the
  // middle of what you're reading stays put.
  const zoomByCenter = useCallback(
    (factor: number) => {
      const area = areaRef.current;
      if (!area) return;
      const rect = area.getBoundingClientRect();
      zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAround],
  );

  // Expose centre-zoom to the TopBar buttons via the viewport bridge.
  useEffect(() => {
    viewportBridge.zoomByCenter = zoomByCenter;
    return () => {
      if (viewportBridge.zoomByCenter === zoomByCenter) viewportBridge.zoomByCenter = undefined;
    };
  }, [zoomByCenter]);

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

  // ── scroll to switch pages (exactly one page per gesture) ────────────────
  // At a page edge a deliberate scroll turns to the next/previous page. Crucially it
  // flips ONE page per gesture: the moment a flick turns a page it "latches", and the
  // rest of that flick's momentum is ignored until the wheel falls quiet (a clear pause).
  // So a light scroll never skips two or three pages — it always moves exactly one. When
  // zoomed in, the page scrolls normally first and only turns at the very edge.
  // Ctrl/⌘+wheel (zoom) and typing are left untouched.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    // A new gesture begins after the wheel has been quiet for QUIET ms; a turn needs a
    // deliberate NEED px of travel (~one wheel notch) so a stray nudge doesn't flip, yet a
    // single light scroll turns exactly one page.
    const QUIET = 180;
    const NEED = 40;
    let accum = 0;
    let armed = true;
    let lastTs = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return; // pinch/⌘-zoom handled above
      let dy = e.deltaY;
      if (!dy) return;
      // Normalise line / page wheel units to pixels so mice and trackpads feel the same.
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= area.clientHeight;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;

      const now = performance.now();
      if (now - lastTs > QUIET) {
        armed = true; // the previous gesture ended — ready to turn again
        accum = 0;
      }
      lastTs = now;

      const max = area.scrollHeight - area.clientHeight;
      const down = dy > 0;
      const atBottom = area.scrollTop >= max - 1.5;
      const atTop = area.scrollTop <= 1.5;
      // Room left to scroll within the page → let the browser scroll normally.
      if ((down && !atBottom) || (!down && !atTop)) {
        accum = 0;
        return;
      }
      const st = useStore.getState();
      const list = st.pages;
      const idx = list.findIndex((p) => p.id === st.currentPageId);
      const targetIdx = down ? idx + 1 : idx - 1;
      if (idx < 0 || targetIdx < 0 || targetIdx >= list.length) return; // no page past this edge

      // Pressing against the edge with somewhere to go: take over the wheel.
      e.preventDefault();
      if (!armed) return; // already turned this gesture — swallow the leftover momentum
      accum += Math.abs(dy);
      if (accum < NEED) return; // wait for a deliberate amount of scroll
      armed = false; // latch until the wheel goes quiet, so exactly one page turns
      accum = 0;
      st.setCurrentPage(list[targetIdx].id);
      // Land at the top (down) / bottom (up) of the new page once its fit has settled.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          area.scrollTop = down ? 0 : area.scrollHeight;
        }),
      );
    };
    area.addEventListener('wheel', onWheel, { passive: false });
    return () => area.removeEventListener('wheel', onWheel);
  }, []);

  // Baselines a selected text box can snap to: scanned lines + other text boxes.
  const getAlignTargets = useCallback(
    (excludeId: string | null): number[] => {
      const ts = [...scanBaselines];
      if (page) {
        for (const el of page.elements) {
          if (el.type === 'text' && el.id !== excludeId) ts.push(el.y + firstBaselineOffset(el.size, el.lineHeight));
        }
      }
      return ts;
    },
    [page, scanBaselines],
  );

  // Left edges a selected text box can snap to (vertical alignment): scanned lines +
  // other text boxes, so the starts of lists/paragraphs line up to the same column.
  const getAlignTargetsX = useCallback(
    (excludeId: string | null): number[] => {
      const xs = [...scanLeftEdges];
      if (page) {
        for (const el of page.elements) {
          if (el.type === 'text' && el.id !== excludeId) xs.push(el.x);
        }
      }
      return xs;
    },
    [page, scanLeftEdges],
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
      // Nudge every selected (unlocked) element by the same step so a multi-selection
      // moves rigidly, just like dragging it.
      const ids = useStore.getState().selectedElementIds;
      const targets = page.elements.filter((el) => ids.includes(el.id) && !el.locked);
      if (!targets.length) return;
      e.preventDefault();
      // One CSS pixel in view-points; coarse step with Shift.
      const step = (e.shiftKey ? 10 : 1) / scale;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else dy = step;

      // Visual-only alignment hints (single text box only): show a guide when the
      // (unrotated) baseline or left edge coincides with a neighbour's.
      let guideY: number | null = null;
      let guideX: number | null = null;
      const primary = targets.length === 1 ? targets[0] : null;
      if (primary && primary.type === 'text' && !primary.rotation) {
        const nearY = nearestBaseline(primary.y + dy + firstBaselineOffset(primary.size, primary.lineHeight), getAlignTargets(selId), ALIGN_TOL / scale);
        if (nearY != null) guideY = nearY;
        const nearX = nearestBaseline(primary.x + dx, getAlignTargetsX(selId), ALIGN_TOL / scale);
        if (nearX != null) guideX = nearX;
      }
      // Snapshot once at the start of a burst (or when the target changes) so a
      // single undo reverts the whole run of nudges — matching addElement's model.
      if (nudgeActiveId.current !== selId) {
        commit();
        nudgeActiveId.current = selId;
      }
      for (const target of targets) {
        const patch: ElementPatch = { x: target.x + dx, y: target.y + dy };
        if (target.type === 'ink') {
          patch.points = target.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        }
        updateElement(page.id, target.id, patch);
      }
      setAlignGuideY(guideY);
      setAlignGuideX(guideX);
      // End the burst (and clear the guides) after a short pause.
      if (nudgeTimer.current) window.clearTimeout(nudgeTimer.current);
      nudgeTimer.current = window.setTimeout(() => {
        nudgeActiveId.current = null;
        setAlignGuideY(null);
        setAlignGuideX(null);
      }, 500);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, editingId, updateElement, commit, getAlignTargets, getAlignTargetsX, scale]);

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

  // ── background-brush loupe: a live, pixel-zoomed magnifier at the cursor ──
  // Shows exactly which pixel — and which colour — the brush is about to pick up. It's fed
  // from the overlay's pointer move, so it tracks the mouse on the web (on hover, before any
  // click) and the finger on touch (while pressing). The colour read goes through the very
  // same sampler the brush lays down (sampleColorAt + sampleMap), so the preview can never
  // disagree with the result. Reads are coalesced to one per animation frame to stay smooth.
  const loupeRaf = useRef(0);
  const updateBrushLoupe = (e: { clientX: number; clientY: number }) => {
    const clientX = e.clientX;
    const clientY = e.clientY;
    if (loupeRaf.current) return;
    loupeRaf.current = requestAnimationFrame(() => {
      loupeRaf.current = 0;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const v = evToView({ clientX, clientY });
      const { px, ox, oy } = sampleMap();
      const color = sampleColorAt(canvas, v.x, v.y, px, ox, oy);
      setLoupe({ vx: v.x, vy: v.y, clientX, clientY, px, ox, oy, color });
    });
  };
  useEffect(() => () => { if (loupeRaf.current) cancelAnimationFrame(loupeRaf.current); }, []);
  // The loupe belongs to the brush only — drop it the moment another tool takes over.
  useEffect(() => {
    if (activeTool !== 'brush') setLoupe(null);
  }, [activeTool]);

  // ── creating elements by dragging / clicking ──
  const onOverlayPointerDown = (e: React.PointerEvent) => {
    if (!page) return;
    if (e.target !== overlayRef.current) return; // started on an element/handle
    const start = evToView(e);

    if (activeTool === 'select') {
      // Clicking empty space discards an abandoned, never-filled text box first.
      const selId = useStore.getState().selectedElementId;
      if (selId) {
        const selEl = page.elements.find((el) => el.id === selId);
        if (isAbandonedText(selEl)) deleteElement(page.id, selId);
      }
      // On TOUCH a drag-marquee is unreliable (the browser keeps reinterpreting the finger
      // drag as a pan, cutting the selection short), so collect two opposite corners with
      // two taps instead: first tap drops a corner, second tap closes the rectangle and
      // selects everything inside it. On a mouse the familiar drag-marquee is kept.
      if (e.pointerType === 'touch') {
        commitTapSelection(start, e.shiftKey);
        return;
      }
      if (!e.shiftKey) selectElement(null);
      startMarquee(start, e);
      return;
    }
    if (activeTool === 'edit-text') {
      // A tap on (or near) a detected line opens that line's font panel. Resolving the
      // nearest run here — at the overlay level, with a generous fingertip slack — means a
      // tap lands the right line even when the boxes are tiny on a phone (a direct hit on
      // a RunBox is still handled by the box itself). A tap on bare paper just clears.
      const idx = nearestRunIndex(start);
      if (idx != null) {
        pickRun(idx);
        return;
      }
      setEditingId(null);
      setPickedRun(null);
      selectElement(null);
      return;
    }
    if (activeTool === 'text') {
      // Keep focus for the editor we open below (see RunBox preventDefault note).
      e.preventDefault();
      // A typeface armed from the scan panel ("In dieser Schrift schreiben") overrides
      // the tool defaults, so the field lands here in exactly that font/size/style/colour.
      const ps = pendingTextStyle;
      const size = ps?.size ?? tool.textSize;
      const lineHeight = ps?.lineHeight ?? 1.3;
      // Box height = exactly one line, so the rendered glyphs sit centred in it and
      // the click point can map to the line's true vertical middle.
      const lineH = size * lineHeight;
      const el: TextElement = {
        id: uid('el'),
        type: 'text',
        // Insert the line exactly where the I-beam sits: the click point becomes the
        // vertical middle of the first line (not the box top), so the typed text
        // lands precisely where you clicked instead of dropping below it.
        x: start.x,
        y: start.y - lineH / 2,
        // Start compact — the field hugs its content and grows as you type (see the
        // editor's auto-fit), instead of the old over-wide, over-long box.
        width: Math.max(size * 3.6, 40),
        height: lineH,
        opacity: 1,
        z: nextZ(page),
        text: '',
        family: ps?.family ?? tool.textFamily,
        size,
        bold: ps?.bold ?? false,
        italic: ps?.italic ?? false,
        color: ps?.color ?? tool.textColor,
        align: 'left',
        lineHeight,
        embeddedFontId: ps?.embeddedFontId,
        fontLabel: ps?.fontLabel,
      };
      addElement(page.id, el);
      if (ps) setPendingTextStyle(null); // the armed typeface is now consumed
      // Switch to the select tool so the new field becomes interactive (a field
      // created under the text tool would otherwise stay pointer-events:none) and
      // jump straight into editing — the caret is ready, just start typing.
      setTool('select');
      setEditingId(el.id);
      return;
    }
    if (activeTool === 'callout') {
      // Place a speech bubble whose tail points at the click, then edit it right away.
      e.preventDefault();
      const w = 172;
      const h = 96;
      const el: CalloutElement = {
        id: uid('el'),
        type: 'callout',
        x: Math.max(0, start.x - 22),
        y: Math.max(0, start.y - h),
        width: w,
        height: h,
        opacity: 1,
        z: nextZ(page),
        text: '',
        family: tool.textFamily,
        size: 11,
        bold: false,
        italic: false,
        color: '#1d1d1f',
        align: 'left',
        lineHeight: 1.3,
        fill: '#fef3c7',
        stroke: '#f59e0b',
        strokeWidth: 1,
      };
      addElement(page.id, el);
      setTool('select');
      setEditingId(el.id);
      return;
    }
    if (activeTool === 'cut') {
      if (tool.cutMode === 'lasso') startCutLasso(start, e);
      else startCut(start, e);
      return;
    }
    if (activeTool === 'draw') {
      startDrawing(start);
      return;
    }
    if (activeTool === 'brush') {
      // Background brush: a freehand stroke, or a borderless rectangle filled with the
      // sampled page background (so a block can be cleared in one drag). Light up the loupe
      // on the very first contact so a touch user sees the picked pixel from the start.
      updateBrushLoupe(e);
      if (tool.brushMode === 'rect') startBgRect(start, e);
      else startBrush(start, e);
      return;
    }
    if (activeTool === 'highlight' && tool.highlightMode === 'brush') {
      // Marker tool in pen mode: a freehand highlighter stroke with a round nib.
      startHighlightStroke(start, e);
      return;
    }
    startShape(start, e);
  };

  // ── select tool (touch): two-tap rectangle selection ──
  // First tap on empty space arms a corner (and clears any current selection); the second
  // tap closes the rectangle and selects every element it touches. Shift keeps the prior
  // selection so a second rectangle can add to it. A degenerate (near-zero) rectangle just
  // clears, so a stray double-tap never selects the whole page.
  const commitTapSelection = (pt: { x: number; y: number }, additive: boolean) => {
    if (!page) return;
    if (!tapCorner) {
      if (!additive) selectElement(null);
      setTapCorner(pt);
      showToast('Auswahl: jetzt die gegenüberliegende Ecke antippen', 'info');
      return;
    }
    const rect = {
      x: Math.min(tapCorner.x, pt.x),
      y: Math.min(tapCorner.y, pt.y),
      width: Math.abs(pt.x - tapCorner.x),
      height: Math.abs(pt.y - tapCorner.y),
    };
    setTapCorner(null);
    if (rect.width < 4 && rect.height < 4) {
      selectElement(null);
      return;
    }
    const ids = page.elements.filter((el) => !el.hidden && rectsIntersect(rect, el)).map((el) => el.id);
    if (ids.length) {
      const prev = additive ? useStore.getState().selectedElementIds : [];
      selectElements([...prev, ...ids]);
      showToast(`${ids.length} Element${ids.length === 1 ? '' : 'e'} ausgewählt`, 'success');
    } else {
      selectElement(null);
      showToast('Keine Elemente im gewählten Bereich', 'info');
    }
  };

  // The detected line nearest a tap point (view-points), within a finger-sized slack, or
  // null if the tap was on bare paper. Lets the scan tool pick the right line even when
  // the boxes are small and tightly stacked on a phone screen.
  const nearestRunIndex = (pt: { x: number; y: number }): number | null => {
    const pad = 14 / scale;
    let best: number | null = null;
    let bestDist = Infinity;
    runs.forEach((run, i) => {
      if (runIsTaken(run)) return;
      const w = Math.max(run.width, 24);
      if (pt.x < run.x - pad || pt.x > run.x + w + pad || pt.y < run.y - pad || pt.y > run.y + run.height + pad) return;
      const cx = run.x + w / 2;
      const cy = run.y + run.height / 2;
      const d = Math.hypot(pt.x - cx, pt.y - cy);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  };

  // ── select tool: rubber-band marquee over empty page space ──
  // Drag a rectangle to select every element it touches, so several can be moved (or
  // deleted) together. Holding Shift adds the newly-touched elements to the selection.
  const startMarquee = (start: { x: number; y: number }, e: React.PointerEvent) => {
    if (!page) return;
    const additive = e.shiftKey;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = evToView(ev);
      if (!moved && Math.abs(p.x - start.x) + Math.abs(p.y - start.y) <= 3 / scale) return;
      moved = true;
      setMarquee({
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarquee((m) => {
        if (m && moved && (m.width > 3 / scale || m.height > 3 / scale)) {
          const ids = page.elements.filter((el) => !el.hidden && rectsIntersect(m, el)).map((el) => el.id);
          if (ids.length) {
            const prev = additive ? useStore.getState().selectedElementIds : [];
            selectElements([...prev, ...ids]);
          }
        }
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.currentTarget.setPointerCapture?.(e.pointerId);
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

  // ── highlighter pen: a freehand marker stroke with a round (oval) nib ──
  // Same gesture as the background brush, but the stroke is a semi-transparent
  // highlight (Multiply blend in the bake layer) so the text underneath stays legible.
  const startHighlightStroke = (start: { x: number; y: number }, e: React.PointerEvent) => {
    if (!page) return;
    const color = tool.highlightColor;
    const width = tool.highlightWidth;
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
        id: 'draft-highlight',
        type: 'ink',
        x: b.minX,
        y: b.minY,
        width: b.maxX - b.minX,
        height: b.maxY - b.minY,
        opacity: HIGHLIGHT_OPACITY,
        z: nextZ(page),
        points: [...points],
        color,
        strokeWidth: width,
        highlight: true,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft(null);
      // A single tap still leaves a dab; duplicate the point so the bake draws it.
      if (points.length === 1) points.push({ x: start.x + 0.01, y: start.y + 0.01 });
      const b = bounds();
      addElement(page.id, {
        id: uid('el'),
        type: 'ink',
        x: b.minX,
        y: b.minY,
        width: Math.max(1, b.maxX - b.minX),
        height: Math.max(1, b.maxY - b.minY),
        opacity: HIGHLIGHT_OPACITY,
        z: nextZ(page),
        points,
        color,
        strokeWidth: width,
        highlight: true,
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  // ── background brush, rectangle mode: drag a borderless box filled with the page's
  // own background colour (sampled at the click) so a whole block clears in one drag ──
  const startBgRect = (start: { x: number; y: number }, e: React.PointerEvent) => {
    if (!page) return;
    const canvas = canvasRef.current;
    const { px, ox, oy } = sampleMap();
    const color = canvas ? sampleColorAt(canvas, start.x, start.y, px, ox, oy) : '#ffffff';
    setToolDefaults({ brushColor: color });
    addRecentColor(color);
    const move = (ev: PointerEvent) => {
      const p = evToView(ev);
      const x = Math.min(start.x, p.x);
      const y = Math.min(start.y, p.y);
      setDraft({
        id: 'draft-bgrect',
        type: 'rect',
        x,
        y,
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
        opacity: 1,
        z: nextZ(page),
        fill: color,
        stroke: null,
        strokeWidth: 0,
        radius: 0,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft((d) => {
        if (d && d.width > 2 && d.height > 2) {
          addElement(page.id, {
            id: uid('el'),
            type: 'rect',
            x: d.x,
            y: d.y,
            width: d.width,
            height: d.height,
            opacity: 1,
            z: nextZ(page),
            fill: color,
            stroke: null,
            strokeWidth: 0,
            radius: 0,
          });
          // Stay on the brush so several spots can be covered in a row.
        }
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const startShape = (start: { x: number; y: number }, e: React.PointerEvent) => {
    if (!page) return;
    // Vector shapes (Elemente menu) drop with a single CLICK at a comfortable default
    // size — dragging is still honoured for a custom size, but no longer required.
    const clickToPlace = activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'shape';
    // The marking tool stays active after a stroke so you can keep highlighting and
    // freely switch its mode (rectangle ↔ pen) without re-picking the tool.
    const keepActive = activeTool === 'highlight';
    const base = { id: uid('el'), x: start.x, y: start.y, width: 0, height: 0, opacity: 1, z: nextZ(page) };
    const make = (w: number, h: number, x: number, y: number, flip: boolean): AnyElement => {
      if (activeTool === 'highlight')
        return { ...base, type: 'highlight', x, y, width: w, height: h, opacity: 0.4, color: tool.highlightColor };
      if (activeTool === 'ellipse')
        return { ...base, type: 'ellipse', x, y, width: w, height: h, fill: tool.shapeFill, stroke: tool.shapeStroke, strokeWidth: 1.5 };
      if (activeTool === 'redact')
        return { ...base, type: 'rect', x, y, width: w, height: h, fill: '#000000', stroke: null, strokeWidth: 0, radius: 0 };
      if (activeTool === 'shape') {
        const kind = tool.shapeKind;
        const strokeOnly = isStrokeOnlyShape(kind);
        return { ...base, type: 'shape', x, y, width: w, height: h, shape: kind, fill: strokeOnly ? null : tool.shapeFill, stroke: tool.shapeStroke, strokeWidth: strokeOnly ? 2 : 1.5, dash: 'solid', flip };
      }
      return { ...base, type: 'rect', x, y, width: w, height: h, fill: tool.shapeFill, stroke: tool.shapeStroke, strokeWidth: 1.5, radius: 0 };
    };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = evToView(ev);
      if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > 2 / scale) moved = true;
      const x = Math.min(start.x, p.x);
      const y = Math.min(start.y, p.y);
      const flip = (p.x - start.x) * (p.y - start.y) < 0; // dragged ↗ / ↙
      setDraft(make(Math.abs(p.x - start.x), Math.abs(p.y - start.y), x, y, flip));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft((d) => {
        // A click with no drag on a shape tool: place a default-sized shape centred on
        // the click, ready to style and move — no aiming or aspect guesswork needed.
        if (!moved && clickToPlace) {
          const isLine = activeTool === 'shape' && tool.shapeKind === 'line';
          const w = isLine ? 150 : 130;
          const h = isLine ? 90 : 96;
          addElement(page.id, make(w, h, start.x - w / 2, start.y - h / 2, false));
          setTool('select');
          return null;
        }
        if (!d) return null;
        // A line only needs length in one axis; give it a selectable thickness.
        const isLine = d.type === 'shape' && d.shape === 'line';
        const ok = isLine ? Math.max(d.width, d.height) > 6 : d.width > 4 && d.height > 4;
        if (ok) {
          const el = isLine ? { ...d, width: Math.max(d.width, 1), height: Math.max(d.height, 1) } : d;
          addElement(page.id, el);
          if (!keepActive) setTool('select');
        }
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  // ── region-duplicate tool ("Ausschneiden"): marquee a rectangle and lift a free-
  // floating 1:1 copy of it. The ORIGINAL page content is never cut out or covered —
  // the copy simply lies on top, ready to drag away, leaving the document untouched. ──
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
        if (d && d.width > 4 && d.height > 4) void cutRegion(d.x, d.y, d.width, d.height);
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  // Rasterise a page region STRAIGHT FROM THE PDF (not the screen bitmap) at a high,
  // print-grade density, so the duplicate is a 1:1 copy of the original at any zoom —
  // never the screen's current resolution. Returns a lossless PNG data URL, or null
  // (blank pages / render failure) so the caller can fall back to the on-screen copy.
  const captureRegionHiRes = async (vx: number, vy: number, vw: number, vh: number): Promise<string | null> => {
    if (!page || page.blank) return null;
    try {
      const pdfPage = await engine.getPage(page.sourceKey, page.sourceIndex);
      const wanted = Math.max(CUT_MIN_DENSITY, scale * TARGET_DENSITY);
      const cap = Math.min(MAX_BITMAP_DIM / vw, MAX_BITMAP_DIM / vh, Math.sqrt(MAX_BITMAP_AREA / (vw * vh)));
      const density = Math.max(1, Math.min(wanted, cap));
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(vw * density));
      off.height = Math.max(1, Math.round(vh * density));
      await renderPageRegion(pdfPage, off, density, rotation, vx * density, vy * density);
      return off.toDataURL('image/png');
    } catch {
      return null;
    }
  };

  // Fallback copy from the on-screen bitmap (used for blank pages, where there is no
  // PDF content to re-rasterise — the region is just paper colour anyway).
  const captureRegionFromScreen = (vx: number, vy: number, vw: number, vh: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const { px, ox, oy } = sampleMap();
    const sx = Math.max(0, Math.round(vx * px - ox));
    const sy = Math.max(0, Math.round(vy * px - oy));
    const ex = Math.min(canvas.width, Math.round((vx + vw) * px - ox));
    const ey = Math.min(canvas.height, Math.round((vy + vh) * px - oy));
    const cw = ex - sx;
    const ch = ey - sy;
    if (cw <= 1 || ch <= 1) return null;
    const off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    const octx = off.getContext('2d');
    if (!octx) return null;
    octx.drawImage(canvas, sx, sy, cw, ch, 0, 0, cw, ch);
    try {
      return off.toDataURL('image/png');
    } catch {
      return null;
    }
  };

  // ── lasso variant of the cut tool: trace any shape with the mouse held down, and
  // lift a 1:1 copy clipped to exactly that outline (transparent outside). ──
  const startCutLasso = (start: { x: number; y: number }, e: React.PointerEvent) => {
    if (!page) return;
    const pts: { x: number; y: number }[] = [start];
    const bounds = () => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return { minX, minY, maxX, maxY };
    };
    const move = (ev: PointerEvent) => {
      pts.push(evToView(ev));
      const b = bounds();
      setDraft({
        id: 'draft-lasso',
        type: 'ink',
        x: b.minX,
        y: b.minY,
        width: Math.max(1, b.maxX - b.minX),
        height: Math.max(1, b.maxY - b.minY),
        opacity: 1,
        z: nextZ(page),
        points: [...pts],
        color: 'var(--accent)',
        strokeWidth: 1.5 / scale,
        dash: 'dashed',
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft(null);
      if (pts.length > 2) void cutRegionLasso(pts);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  // Clip a captured region PNG to a lasso polygon (keeps only the interior).
  const maskToPolygon = (src: string, pts: { x: number; y: number }[], vx: number, vy: number, vw: number, vh: number): Promise<string | null> =>
    new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas');
        c.width = im.width;
        c.height = im.height;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(im, 0, 0);
        const sx = im.width / vw;
        const sy = im.height / vh;
        ctx.globalCompositeOperation = 'destination-in';
        ctx.beginPath();
        pts.forEach((p, i) => {
          const x = (p.x - vx) * sx;
          const y = (p.y - vy) * sy;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fill();
        try {
          resolve(c.toDataURL('image/png'));
        } catch {
          resolve(null);
        }
      };
      im.onerror = () => resolve(null);
      im.src = src;
    });

  const cutRegionLasso = async (pts: { x: number; y: number }[]) => {
    if (!page) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const vx = Math.max(0, minX);
    const vy = Math.max(0, minY);
    const vw = Math.min(view.width, maxX) - vx;
    const vh = Math.min(view.height, maxY) - vy;
    if (vw <= 2 || vh <= 2) {
      showToast('Bereich ist zu klein.', 'error');
      return;
    }
    const src = (await captureRegionHiRes(vx, vy, vw, vh)) ?? captureRegionFromScreen(vx, vy, vw, vh);
    if (!src) {
      showToast('Bereich konnte nicht ausgeschnitten werden.', 'error');
      return;
    }
    const masked = await maskToPolygon(src, pts, vx, vy, vw, vh);
    if (!masked) {
      showToast('Bereich konnte nicht ausgeschnitten werden.', 'error');
      return;
    }
    addElement(page.id, { id: uid('el'), type: 'image', x: vx, y: vy, width: vw, height: vh, opacity: 1, z: nextZ(page), src: masked, aspect: vw / vh });
    setTool('select');
  };

  const cutRegion = async (x: number, y: number, w: number, h: number) => {
    if (!page) return;
    // Clamp the marquee to the page. We can lift any part of the page (not only the
    // visible window) because the region is re-rendered straight from the PDF.
    const vx = Math.max(0, x);
    const vy = Math.max(0, y);
    const vw = Math.min(view.width, x + w) - vx;
    const vh = Math.min(view.height, y + h) - vy;
    if (vw <= 1 || vh <= 1) {
      showToast('Bereich ist zu klein.', 'error');
      return;
    }

    const src = (await captureRegionHiRes(vx, vy, vw, vh)) ?? captureRegionFromScreen(vx, vy, vw, vh);
    if (!src) {
      showToast('Bereich konnte nicht dupliziert werden.', 'error');
      return;
    }

    // A free-floating, full-quality duplicate of the region. Nothing is removed from
    // or painted over the page — the original content stays exactly as it was.
    const piece: AnyElement = {
      id: uid('el'), type: 'image', x: vx, y: vy, width: vw, height: vh,
      opacity: 1, z: nextZ(page), src, aspect: vw / vh,
    };
    addElement(page.id, piece); // one undo step, piece selected, ready to drag away
    setTool('select');
  };

  const startDrawing = (start: { x: number; y: number }) => {
    if (!page) return;
    // Capture the pen's style once at the gesture start so the live preview and the
    // committed stroke are identical: colour, thickness, opacity and dash pattern.
    const style = {
      color: tool.drawColor,
      strokeWidth: tool.drawWidth,
      opacity: Math.max(0.05, Math.min(1, tool.drawOpacity)),
      highlight: false,
      dash: tool.drawDash,
    };
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
      return { minX, minY, maxX, maxY };
    };
    const move = (ev: PointerEvent) => {
      points.push(evToView(ev));
      const b = bounds();
      setDraft({
        id: 'draft-ink',
        type: 'ink',
        x: b.minX,
        y: b.minY,
        width: b.maxX - b.minX,
        height: b.maxY - b.minY,
        z: nextZ(page),
        points: [...points],
        ...style,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft(null);
      if (points.length > 1) {
        const b = bounds();
        addElement(page.id, {
          id: uid('el'),
          type: 'ink',
          x: b.minX,
          y: b.minY,
          width: Math.max(1, b.maxX - b.minX),
          height: Math.max(1, b.maxY - b.minY),
          z: nextZ(page),
          points,
          ...style,
        });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── starting / ending edits on overlay text elements ──
  const startEditElement = useCallback((id: string) => {
    commit(); // snapshot once before the edit so a single undo reverts the whole change
    setEditingId(id);
  }, [commit]);

  // Leaving the textarea just exits edit mode — the box stays so the user can still
  // tweak font/size in the inspector before typing. An abandoned empty box is only
  // dropped when the user clicks an empty spot (see onOverlayPointerDown).
  const endTextEdit = () => setEditingId(null);

  // On touch there is no double-click, so the mobile context bar raises an editRequest
  // to begin editing the selected text/callout. Consume each nonce once: make the field
  // interactive (select tool), select it, then drop into the inline editor.
  useEffect(() => {
    if (!editRequest || editRequest.n === editReqRef.current) return;
    editReqRef.current = editRequest.n;
    const el = page?.elements.find((e) => e.id === editRequest.id);
    if (!el || (el.type !== 'text' && el.type !== 'callout') || el.locked) return;
    if (activeTool !== 'select') setTool('select');
    selectElement(editRequest.id);
    startEditElement(editRequest.id);
  }, [editRequest, page, activeTool, setTool, selectElement, startEditElement]);

  /** An empty, never-filled new text box or callout (not an in-place edit, which keeps
   *  its cover) — dropped when the user clicks away without typing anything. */
  const isAbandonedText = (el: AnyElement | undefined): boolean => {
    if (!el) return false;
    if (el.type === 'text') return !el.text.trim() && !el.coverColor;
    if (el.type === 'callout') return !el.text.trim();
    return false;
  };

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

  // Scan action: ARM the detected line's IDENTICAL typeface — original font 1:1 when
  // embedded, plus the same size, BOLD / ITALIC style and ink colour — then let the user
  // choose WHERE it lands. No field is dropped here; the next click on the page places an
  // empty text box in exactly this font, ready to type. There is deliberately NO
  // background cover, so the original page content underneath is never painted over.
  const armMatchingField = (idx: number) => {
    const run = runs[idx];
    if (!run || !page) return;
    const { color } = pickInfo ?? sampleRun(run);
    setPendingTextStyle({
      family: run.family, // metric fallback when the original font can't be embedded
      size: run.fontSize, // identical size
      bold: run.bold, // identical weight — bold stays bold
      italic: run.italic, // identical style — italic stays italic
      color,
      lineHeight: 1.15,
      embeddedFontId: run.embeddedFontId, // reuse the ORIGINAL typeface when captured
      fontLabel: run.fontLabel, // carry the real name so the inspector shows it
    });
    setPickedRun(null);
    setTool('text'); // arm placement; the next click drops the field in this font
    showToast('Klicke auf die Stelle, an der der Text eingefügt werden soll', 'info');
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
    <div className={`canvas-area tool-${activeTool}${zoom > 1 ? ' zoomed' : ''}`} ref={areaRef}>
      <div ref={stageRef} className="canvas-stage" style={{ width: view.width * scale, height: view.height * scale }}>
        {/* Geometry (left/top/width/height) is set imperatively per render so React
            re-renders never clobber the window placement; see paintViewport. */}
        <canvas ref={canvasRef} className="page-canvas" />
        <div
          ref={overlayRef}
          className={`overlay ${elementsPanelOpen ? 'reveal' : ''}`}
          style={{ width: view.width * scale, height: view.height * scale }}
          onPointerDown={onOverlayPointerDown}
          // The brush loupe tracks the pointer here: hover on the web (pointer capture keeps
          // it alive during a stroke too), press-and-drag on touch. Leaving the page or
          // lifting a finger dismisses it.
          onPointerMove={activeTool === 'brush' ? updateBrushLoupe : undefined}
          onPointerLeave={loupe ? () => setLoupe(null) : undefined}
          onPointerUp={loupe ? (e) => { if (e.pointerType === 'touch') setLoupe(null); } : undefined}
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
              alignXs={getAlignTargetsX(el.id)}
              onAlignGuide={setAlignGuideY}
              onAlignGuideX={setAlignGuideX}
              onStartEdit={() => startEditElement(el.id)}
              onEndEdit={endTextEdit}
              updateElement={updateElement}
              commit={commit}
            />
          ))}

          {draft && <DraftView el={draft} scale={scale} />}

          {/* Rubber-band selection rectangle (select tool). */}
          {marquee && (
            <div
              className="marquee"
              style={{ left: marquee.x * scale, top: marquee.y * scale, width: marquee.width * scale, height: marquee.height * scale }}
            />
          )}

          {/* First corner of a touch two-tap selection — the next tap closes the box. */}
          {tapCorner && activeTool === 'select' && (
            <div className="tap-corner" style={{ left: tapCorner.x * scale, top: tapCorner.y * scale }} />
          )}

          {/* Alignment guides: horizontal lights up on a shared baseline, vertical on a
              shared left edge — pure confirmation of the snap that just engaged. */}
          {alignGuideY != null && <div className="align-guide" style={{ top: alignGuideY * scale }} />}
          {alignGuideX != null && <div className="align-guide-v" style={{ left: alignGuideX * scale }} />}

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
            onInsert={() => armMatchingField(pickedRun)}
            onUseColor={useDetectedColor}
            onClose={() => setPickedRun(null)}
          />
        )}
      </div>

      {/* Background-brush magnifier: a pixel-zoomed view of the spot under the cursor with
          the exact colour that will be picked up. Rendered through a body portal so it
          floats above everything (and is never clipped by the stage) on web and mobile. */}
      {activeTool === 'brush' && loupe && (
        <BrushLoupe
          canvasRef={canvasRef}
          map={{ px: loupe.px, ox: loupe.ox, oy: loupe.oy }}
          vx={loupe.vx}
          vy={loupe.vy}
          clientX={loupe.clientX}
          clientY={loupe.clientY}
          color={loupe.color}
        />
      )}
    </div>
  );
}

/**
 * Magnifier loupe for the background brush. It blits a tiny square of the rendered page
 * bitmap — centred on the pixel the brush will sample — into a small round canvas at a
 * heavy, nearest-neighbour zoom, marks the exact centre pixel, and prints the colour that
 * will be laid down. It floats just off the cursor (web) or above the finger (touch) via a
 * body portal, so it is never hidden behind the pointer and never clipped by the page.
 */
function BrushLoupe({
  canvasRef,
  map,
  vx,
  vy,
  clientX,
  clientY,
  color,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  map: { px: number; ox: number; oy: number };
  vx: number;
  vy: number;
  clientX: number;
  clientY: number;
  color: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const SIZE = 132; // on-screen diameter (CSS px)
  const SRC = 15; // source bitmap pixels across — odd, so there is a true centre pixel

  useLayoutEffect(() => {
    const lc = ref.current;
    if (!lc) return;
    const ctx = lc.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (lc.width !== Math.round(SIZE * dpr)) {
      lc.width = Math.round(SIZE * dpr);
      lc.height = Math.round(SIZE * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false; // crisp pixel grid, not a blur
    // Neutral backdrop so the few pixels past the rendered window still read cleanly.
    ctx.fillStyle = '#f2f2f3';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const canvas = canvasRef.current;
    if (canvas) {
      // The exact bitmap pixel the brush samples (same maths as sampleColorAt).
      const cx = Math.round(vx * map.px - map.ox);
      const cy = Math.round(vy * map.px - map.oy);
      const half = (SRC - 1) / 2;
      try {
        ctx.drawImage(canvas, cx - half, cy - half, SRC, SRC, 0, 0, SIZE, SIZE);
      } catch {
        /* tainted / out of range — keep the backdrop */
      }
    }
    // Outline the centre pixel (white under, dark over) so it reads on any background.
    const cell = SIZE / SRC;
    const o = ((SRC - 1) / 2) * cell;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeRect(o - 1, o - 1, cell + 2, cell + 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeRect(o, o, cell, cell);
  }, [canvasRef, map.px, map.ox, map.oy, vx, vy]);

  // Float just off the cursor; flip below when there isn't room above (top edge / touch).
  // The stack is the canvas plus the hex chip plus the gap, so reserve a touch more than
  // SIZE before deciding the loupe would clip off the top.
  const OFFSET = 28;
  const below = clientY < SIZE + 70;
  const style: React.CSSProperties = {
    left: clientX,
    top: clientY,
    transform: `translate(-50%, ${below ? `${OFFSET}px` : `calc(-100% - ${OFFSET}px)`})`,
  };
  return createPortal(
    <div className="brush-loupe" style={style} aria-hidden>
      <canvas ref={ref} className="brush-loupe-canvas" style={{ width: SIZE, height: SIZE }} />
      <span className="brush-loupe-hex" style={{ background: color }}>
        {color.toUpperCase()}
      </span>
    </div>,
    document.body,
  );
}

function nextZ(page: EditorPage): number {
  return page.elements.reduce((m, e) => Math.max(m, e.z), 0) + 1;
}

/**
 * Smooth page-turn: a quick, subtle slide + fade of the whole stage (canvas + overlay)
 * so switching pages feels fluid instead of a hard cut. `dir` is +1 for the next page
 * (slides up from just below) and −1 for the previous one (slides down from above). Uses
 * the Web Animations API, so it leaves no lingering inline transform when it finishes.
 */
function animatePageEnter(stage: HTMLElement | null, dir: number): void {
  if (!stage || typeof stage.animate !== 'function') return;
  // Drop any in-flight turn so rapid paging doesn't stack animations.
  stage.getAnimations?.().forEach((a) => a.cancel());
  stage.animate(
    [
      { opacity: 0.5, transform: `translateY(${dir * 12}px)` },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: 200, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
  );
}

/** Axis-aligned overlap test between the marquee and an element's box (view-points). */
function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
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
      <svg
        className="draft"
        style={{
          left: el.x * scale,
          top: el.y * scale,
          width: el.width * scale,
          height: el.height * scale,
          opacity: el.opacity,
          mixBlendMode: el.highlight ? 'multiply' : undefined,
        }}
      >
        <path
          d={d}
          fill="none"
          stroke={el.color}
          strokeWidth={el.strokeWidth * scale}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={inkDashArray(el.dash, el.strokeWidth * scale)}
        />
      </svg>
    );
  }
  if (el.type === 'ellipse') return <div className="draft" style={{ ...style, borderRadius: '50%', border: `1.5px solid ${el.stroke ?? '#111'}`, background: el.fill ?? 'transparent' }} />;
  if (el.type === 'highlight') return <div className="draft" style={{ ...style, background: el.color, mixBlendMode: 'multiply' }} />;
  if (el.type === 'rect') return <div className="draft" style={{ ...style, border: el.stroke ? `1.5px solid ${el.stroke}` : 'none', background: el.fill ?? 'transparent' }} />;
  if (el.type === 'shape') {
    const { points, closed } = shapeOutline(el.shape, 0, 0, el.width * scale, el.height * scale, el.flip ?? false);
    return (
      <svg className="draft" style={{ left: el.x * scale, top: el.y * scale, width: el.width * scale, height: el.height * scale }}>
        <path
          d={pointsToSvgPath(points, closed)}
          fill={isStrokeOnlyShape(el.shape) ? 'none' : el.fill ?? 'none'}
          stroke={el.stroke ?? 'none'}
          strokeWidth={el.strokeWidth * scale}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    );
  }
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
    ...textFaceCss(run.family, run.embeddedFontId, run.bold, run.italic),
    fontSize: run.fontSize * scale,
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
  onInsert,
  onUseColor,
  onClose,
}: {
  run: TextRun;
  scale: number;
  color: string;
  stageW: number;
  stageH: number;
  onInsert: () => void;
  onUseColor: (color: string) => void;
  onClose: () => void;
}) {
  const face = textFaceCss(run.family, run.embeddedFontId, run.bold, run.italic);
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
      <div className="font-panel-name" style={{ fontFamily: face.fontFamily }}>
        {run.fontLabel || 'Unbekannt'}
      </div>
      {/* The detected line drawn in its OWN typeface — an immediate, honest preview. */}
      <div className="font-panel-preview" style={{ ...face, color }}>
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
        <button
          className="btn primary"
          onClick={onInsert}
          title="Diese Schrift übernehmen – anschliessend auf die Stelle klicken, an der das Textfeld eingefügt werden soll (ohne Hintergrund-Abdeckung)"
        >
          <Plus size={14} /> In dieser Schrift schreiben
        </button>
        <p className="font-panel-foot">Danach auf die gewünschte Stelle klicken · ohne Abdeckung</p>
      </div>
    </div>
  );
}
