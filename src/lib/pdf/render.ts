import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
// Vite resolves this to a hashed URL and serves the worker as a module.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { TextRun } from './types';
import { classifyFont, prettyFontName, BASELINE_RATIO } from './fonts';
import { matchCatalogFontKey, fontDef } from './fontCatalog';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

/** Parse PDF bytes with pdf.js for rendering and text extraction. */
export async function loadPdfjs(data: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js transfers/detaches the buffer, so hand it a private copy.
  // `fontExtraProperties` keeps each embedded font's program (`.data`) available
  // after binding, so the scan editor can reuse the *original* typeface 1:1.
  //
  // In the browser, point pdf.js at the standard-font + CMap data staged under public/
  // (see scripts/patch-pdfjs.mjs). PDFs that reference the 14 non-embedded standard fonts
  // (Helvetica, Times, …) need this data; without it, font loading fails inside the worker
  // and getTextContent throws — which is exactly what broke the text-scan tool. Skipped
  // under Node (the engine tests), which has no such URL space and resolves fonts itself.
  const inBrowser = typeof window !== 'undefined';
  const fontData = inBrowser
    ? {
        standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
        cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
        cMapPacked: true,
      }
    : {};
  const task = pdfjs.getDocument({ data: data.slice(), fontExtraProperties: true, ...fontData });
  return task.promise;
}

/** What the scan editor learns about a page font: its name, whether the PDF
 *  embeds it, and (when embedded) the raw program for 1:1 reuse. */
export interface FontInspection {
  /** raw PDF font name as pdf.js reports it (subset prefix included) */
  rawName: string;
  /** readable label for the UI (subset prefix + PostScript suffixes stripped) */
  displayName: string;
  /** true when the font program is embedded in the source PDF */
  embedded: boolean;
  /** the embedded font program — present only when `embedded` is true */
  data?: Uint8Array;
  /** mime type of `data`, e.g. "font/opentype" */
  mimetype?: string;
  /** pdf.js's own weight/slant verdict (from the font descriptor flags), when known —
   *  authoritative where a /BaseFont name doesn't spell out "Bold"/"Italic". */
  bold?: boolean;
  italic?: boolean;
}

/**
 * Inspect the fonts used on a page, keyed by the pdf.js font name that
 * `getTextContent` reports per run. For every requested font it reports the real
 * name and whether the PDF embeds it; embedded fonts additionally carry their raw
 * program so the editor can reuse the *original* typeface 1:1. The operator list
 * is run once to guarantee the fonts are resolved into `commonObjs`.
 * Never throws — a failure just yields fewer (or no) entries.
 */
export async function inspectFonts(
  page: PDFPageProxy,
  fontNames: string[],
): Promise<Map<string, FontInspection>> {
  const out = new Map<string, FontInspection>();
  const names = [...new Set(fontNames.filter(Boolean))];
  if (!names.length) return out;
  try {
    // Ensure every font referenced on the page is resolved on the main thread.
    if (!names.every((n) => page.commonObjs.has(n))) {
      await page.getOperatorList();
    }
    for (const name of names) {
      try {
        if (!page.commonObjs.has(name)) continue;
        const f = page.commonObjs.get(name) as
          | { name?: string; data?: Uint8Array; mimetype?: string; missingFile?: boolean; bold?: boolean; italic?: boolean; black?: boolean }
          | null;
        if (!f) continue;
        const embedded = !f.missingFile && !!f.data && f.data.length > 0;
        const rawName = f.name || name;
        out.set(name, {
          rawName,
          displayName: prettyFontName(rawName),
          embedded,
          data: embedded ? f.data : undefined,
          mimetype: embedded ? f.mimetype || 'font/opentype' : undefined,
          // pdf.js fills these from the font descriptor (fontExtraProperties); they catch
          // a Bold/Italic face whose name doesn't say so.
          bold: typeof f.bold === 'boolean' ? f.bold || !!f.black : undefined,
          italic: typeof f.italic === 'boolean' ? f.italic : undefined,
        });
      } catch {
        /* this font stays undescribed → caller falls back to a standard font */
      }
    }
  } catch {
    /* operator list failed → return whatever we have (possibly empty) */
  }
  return out;
}

/** Total display rotation = the page's own /Rotate plus any user-added rotation. */
export function totalRotation(page: PDFPageProxy, addedRotation: number): number {
  return (((page.rotate + addedRotation) % 360) + 360) % 360;
}

/** Render a page into a canvas at the given scale. Returns the device viewport. */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation: number,
): Promise<{ width: number; height: number }> {
  const viewport = page.getViewport({ scale, rotation });
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2D context unavailable');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return { width: viewport.width, height: viewport.height };
}

/**
 * Render ONLY a sub-rectangle of a page into `canvas`, rasterised 1:1 to the device.
 *
 * This is the key to lossless zoom: instead of drawing the whole (huge) page at the
 * zoom level — which forces the bitmap resolution down once it hits the browser's
 * canvas-area limit and makes glyphs blurry — we rasterise just the visible window
 * at full device density. Every on-screen pixel gets its own vector sample, so text
 * stays knife-sharp at any magnification, exactly like a native PDF viewer.
 *
 * `deviceScale` is the view-point → bitmap-pixel factor (pageScale · devicePixelRatio).
 * `offsetX` / `offsetY` are the bitmap-pixel coordinates of the region's top-left
 * inside the full page; the page raster is shifted by them so the requested window
 * lands at the canvas origin. The canvas backing store must already be sized to the
 * region (in device pixels).
 */
export async function renderPageRegion(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  deviceScale: number,
  rotation: number,
  offsetX: number,
  offsetY: number,
): Promise<void> {
  const viewport = page.getViewport({ scale: deviceScale, rotation });
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2D context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    // Translate the full-page raster so the visible window maps to (0,0) on the canvas.
    transform: [1, 0, 0, 1, -offsetX, -offsetY],
  }).promise;
}

/** Visible (rotation-aware) page size in points at scale 1. */
export function pageViewSize(page: PDFPageProxy, rotation: number): { width: number; height: number } {
  const vp = page.getViewport({ scale: 1, rotation });
  return { width: vp.width, height: vp.height };
}

/**
 * Extract existing text as runs in view-point space (top-left origin, scale 1)
 * so the editor can offer true in-place editing. Adjacent characters from pdf.js
 * are already grouped into runs.
 */
export async function extractTextRuns(page: PDFPageProxy, rotation: number): Promise<TextRun[]> {
  const viewport = page.getViewport({ scale: 1, rotation });
  let content: Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
  try {
    content = await page.getTextContent();
  } catch (e) {
    // Label WHERE it failed so the scan diagnostic can pinpoint the cause precisely.
    throw new Error(`getTextContent: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`, { cause: e });
  }
  const runs: TextRun[] = [];

  // Defensive: never let a malformed / non-iterable items array crash the whole scan.
  const items = Array.isArray(content?.items) ? content.items : [];
  for (const item of items) {
    if (!('str' in item)) continue;
    const str = item.str;
    if (!str || !str.trim()) continue;

    const m = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontSize = Math.hypot(m[2], m[3]) || Math.abs(m[3]) || 12;
    const x = m[4];
    const baselineY = m[5];

    const styleFamily = content.styles?.[item.fontName]?.fontFamily as string | undefined;
    const rawName = styleFamily ?? item.fontName;
    const { family: baseFamily, bold, italic } = classifyFont(rawName);
    // Prefer an exact catalogue match (Arial, Times New Roman, Roboto, …) so the
    // displayed name AND the typeface used both reflect the document's real font.
    // Only when the name is unknown do we fall back to the metric family.
    const matchedKey = matchCatalogFontKey(rawName);
    const family = matchedKey ?? baseFamily;

    const width = item.width || str.length * fontSize * 0.5;
    const height = fontSize * 1.18;

    runs.push({
      str,
      x,
      // Top of the glyph box using the shared ascent ratio, so the bake layer
      // re-draws this line on EXACTLY its original baseline (no vertical shift).
      y: baselineY - fontSize * BASELINE_RATIO,
      width,
      height,
      fontSize,
      family,
      bold,
      italic,
      fontName: item.fontName,
      // Readable typeface name shown in the scan editor's font panel. A catalogue
      // match gives the canonical label (so a generic "sans-serif" never appears in
      // the wrong style); otherwise the cleaned-up raw name.
      fontLabel: matchedKey ? fontDef(matchedKey).label : prettyFontName(rawName),
    });
  }

  return runs;
}

/**
 * Merge raw character runs into editable *line blocks*. pdf.js emits many short
 * runs per visual line; the scan editor is far nicer when a whole line (or form
 * field) is one click target. Runs are grouped when they share a baseline AND are
 * horizontally adjacent — a large gap starts a new block so separate columns or
 * form fields stay independent.
 */
export function groupRunsIntoLines(runs: TextRun[]): TextRun[] {
  if (runs.length <= 1) return runs;
  const baseline = (r: TextRun) => r.y + r.fontSize;
  const sorted = [...runs].sort((a, b) => {
    const db = baseline(a) - baseline(b);
    if (Math.abs(db) > Math.min(a.fontSize, b.fontSize) * 0.5) return db;
    return a.x - b.x;
  });

  const lines: TextRun[] = [];
  let cur: TextRun | null = null;
  let curRight = 0;

  for (const r of sorted) {
    const sameLine =
      cur &&
      Math.abs(baseline(r) - baseline(cur)) <= Math.min(r.fontSize, cur.fontSize) * 0.5 &&
      r.x - curRight <= cur.fontSize * 2.2;

    if (cur && sameLine) {
      const gap = r.x - curRight;
      const needsSpace = gap > cur.fontSize * 0.18 && !cur.str.endsWith(' ') && !r.str.startsWith(' ');
      cur.str += (needsSpace ? ' ' : '') + r.str;
      const top = Math.min(cur.y, r.y);
      const bottom = Math.max(cur.y + cur.height, r.y + r.height);
      cur.y = top;
      cur.height = bottom - top;
      cur.width = Math.max(curRight, r.x + r.width) - cur.x;
      cur.fontSize = Math.max(cur.fontSize, r.fontSize);
      curRight = r.x + r.width;
    } else {
      cur = { ...r };
      lines.push(cur);
      curRight = r.x + r.width;
    }
  }
  return lines;
}
