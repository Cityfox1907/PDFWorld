import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
// Vite resolves this to a hashed URL and serves the worker as a module.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { TextRun } from './types';
import { classifyFont, BASELINE_RATIO } from './fonts';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

/** Parse PDF bytes with pdf.js for rendering and text extraction. */
export async function loadPdfjs(data: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js transfers/detaches the buffer, so hand it a private copy.
  // `fontExtraProperties` keeps each embedded font's program (`.data`) available
  // after binding, so the scan editor can reuse the *original* typeface 1:1.
  const task = pdfjs.getDocument({ data: data.slice(), fontExtraProperties: true });
  return task.promise;
}

/**
 * Capture the raw program of embedded fonts used on a page, keyed by the pdf.js
 * font name that `getTextContent` reports per run. Returns only fonts that are
 * actually embedded (standard/non-embedded fonts report `missingFile`). The
 * operator list is run once to guarantee the fonts are resolved into `commonObjs`.
 * Never throws — a failure just yields fewer (or no) captured fonts.
 */
export async function captureEmbeddedFonts(
  page: PDFPageProxy,
  fontNames: string[],
): Promise<Map<string, { data: Uint8Array; mimetype: string }>> {
  const out = new Map<string, { data: Uint8Array; mimetype: string }>();
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
          | { data?: Uint8Array; mimetype?: string; missingFile?: boolean }
          | null;
        if (!f || f.missingFile || !f.data || !f.data.length) continue;
        out.set(name, { data: f.data, mimetype: f.mimetype || 'font/opentype' });
      } catch {
        /* this font stays uncaptured → caller falls back to a standard font */
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
  const content = await page.getTextContent();
  const runs: TextRun[] = [];

  for (const item of content.items) {
    if (!('str' in item)) continue;
    const str = item.str;
    if (!str || !str.trim()) continue;

    const m = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontSize = Math.hypot(m[2], m[3]) || Math.abs(m[3]) || 12;
    const x = m[4];
    const baselineY = m[5];

    const styleFamily = content.styles?.[item.fontName]?.fontFamily as string | undefined;
    const { family, bold, italic } = classifyFont(styleFamily ?? item.fontName);

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
