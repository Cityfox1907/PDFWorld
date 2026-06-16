import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
// Vite resolves this to a hashed URL and serves the worker as a module.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { TextRun } from './types';
import { classifyFont } from './fonts';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

/** Parse PDF bytes with pdf.js for rendering and text extraction. */
export async function loadPdfjs(data: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js transfers/detaches the buffer, so hand it a private copy.
  const task = pdfjs.getDocument({ data: data.slice() });
  return task.promise;
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
      y: baselineY - fontSize, // top of the glyph box
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
