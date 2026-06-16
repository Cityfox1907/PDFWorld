import {
  PDFDocument,
  PDFPage,
  PDFFont,
  PDFImage,
  StandardFonts,
  rgb,
  degrees,
  LineCapStyle,
} from 'pdf-lib';
import type { AnyElement, TextElement, RectElement, EllipseElement, HighlightElement, ImageElement, InkElement } from './types';
import { standardFontFor, BASELINE_RATIO } from './fonts';
import { baseFamilyOf, fontFileUrl } from './fontCatalog';
import { getEmbeddedFont } from './embeddedFonts';
import { placeBox, axisAngleDeg, type ToPdfPoint } from './coords';

/** Where the baseline sits below a line's top, as a fraction of the font size. */
const ASCENT_RATIO = BASELINE_RATIO;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = (hex || '#000000').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function rgbColor(hex: string) {
  const c = hexToRgb(hex);
  return rgb(c.r, c.g, c.b);
}

function dataUrlToBytes(src: string): { bytes: Uint8Array; mime: string } {
  const comma = src.indexOf(',');
  const head = src.slice(0, comma);
  const b64 = src.slice(comma + 1);
  const mime = head.slice(5, head.indexOf(';'));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

/**
 * Bakes overlay elements into a pdf-lib document. One instance per export so that
 * fonts and images are embedded exactly once and shared across pages.
 *
 * Crucially this NEVER rasterises page content: original text, vectors and images
 * stay byte-for-byte intact; we only *add* draw operations on top.
 */
export class Baker {
  private fontCache = new Map<string, PDFFont>();
  private webFontCache = new Map<string, PDFFont | null>();
  private embeddedCache = new Map<string, PDFFont | null>();
  private imageCache = new Map<string, PDFImage>();
  private fontkitReady = false;

  constructor(private doc: PDFDocument) {}

  private async ensureFontkit(): Promise<void> {
    if (this.fontkitReady) return;
    const fontkit = (await import('@pdf-lib/fontkit')).default;
    this.doc.registerFontkit(fontkit);
    this.fontkitReady = true;
  }

  private async standardFont(el: TextElement): Promise<PDFFont> {
    const key = standardFontFor(baseFamilyOf(el.family), el.bold, el.italic);
    const cached = this.fontCache.get(key);
    if (cached) return cached;
    const font = await this.doc.embedFont(key as StandardFonts);
    this.fontCache.set(key, font);
    return font;
  }

  /**
   * Embed the *original* font captured from the source PDF (see embeddedFonts.ts)
   * so replaced text matches glyph for glyph. Returns null when no original font
   * was captured for this element or it can't be embedded — the caller then uses
   * the web/standard font, so the export never breaks.
   */
  private async embeddedFont(el: TextElement): Promise<PDFFont | null> {
    const id = el.embeddedFontId;
    if (!id) return null;
    if (this.embeddedCache.has(id)) return this.embeddedCache.get(id) ?? null;

    const captured = getEmbeddedFont(id);
    let font: PDFFont | null = null;
    if (captured) {
      try {
        await this.ensureFontkit();
        // The captured program is an already-subset font from the source PDF;
        // embed it whole (subset:false) so its glyphs and cmap stay intact.
        font = await this.doc.embedFont(captured.data, { subset: false });
      } catch (err) {
        console.warn('original font embed failed, using fallback:', id, err);
        font = null;
      }
    }
    this.embeddedCache.set(id, font);
    return font;
  }

  /**
   * Fetch + embed the chosen web font (subsetted) so the export matches the editor
   * exactly. Returns null for the built-in standard families and whenever the font
   * cannot be fetched or parsed — the caller then falls back to a standard font, so
   * an offline export or a missing weight never breaks the document.
   */
  private async webFont(el: TextElement): Promise<PDFFont | null> {
    const url = fontFileUrl(el.family, el.bold ? 700 : 400, el.italic);
    if (!url) return null;
    if (this.webFontCache.has(url)) return this.webFontCache.get(url) ?? null;

    let font: PDFFont | null;
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      await this.ensureFontkit();
      font = await this.doc.embedFont(bytes, { subset: true });
    } catch (err) {
      console.warn('web font embed failed, using standard fallback:', el.family, err);
      font = null;
    }
    this.webFontCache.set(url, font);
    return font;
  }

  private async image(src: string): Promise<PDFImage | null> {
    const cached = this.imageCache.get(src);
    if (cached) return cached;
    try {
      const { bytes, mime } = dataUrlToBytes(src);
      const img = mime.includes('png') ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
      this.imageCache.set(src, img);
      return img;
    } catch {
      return null;
    }
  }

  /** Bake every element of a page, respecting z-order. */
  async bakePage(page: PDFPage, elements: AnyElement[], toPdfPoint: ToPdfPoint): Promise<void> {
    const ordered = [...elements].sort((a, b) => a.z - b.z);
    for (const el of ordered) {
      try {
        await this.drawElement(page, el, toPdfPoint);
      } catch (err) {
        // A single bad element must never abort the whole export.
        console.error('bake element failed', el.type, err);
      }
    }
  }

  private async drawElement(page: PDFPage, el: AnyElement, toPdfPoint: ToPdfPoint): Promise<void> {
    switch (el.type) {
      case 'rect':
        return this.drawRect(page, el, toPdfPoint);
      case 'highlight':
        return this.drawHighlight(page, el, toPdfPoint);
      case 'ellipse':
        return this.drawEllipse(page, el, toPdfPoint);
      case 'image':
      case 'signature':
        return this.drawImage(page, el, toPdfPoint);
      case 'ink':
        return this.drawInk(page, el, toPdfPoint);
      case 'text':
        return this.drawText(page, el, toPdfPoint);
    }
  }

  private drawRect(page: PDFPage, el: RectElement, toPdfPoint: ToPdfPoint): void {
    const p = placeBox(toPdfPoint, el.x, el.y, el.width, el.height);
    page.drawRectangle({
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      rotate: degrees(p.rotateDeg),
      color: el.fill ? rgbColor(el.fill) : undefined,
      opacity: el.fill ? el.opacity : undefined,
      borderColor: el.stroke && el.strokeWidth > 0 ? rgbColor(el.stroke) : undefined,
      borderWidth: el.stroke && el.strokeWidth > 0 ? el.strokeWidth : undefined,
      borderOpacity: el.stroke ? el.opacity : undefined,
    });
  }

  private drawHighlight(page: PDFPage, el: HighlightElement, toPdfPoint: ToPdfPoint): void {
    const p = placeBox(toPdfPoint, el.x, el.y, el.width, el.height);
    page.drawRectangle({
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      rotate: degrees(p.rotateDeg),
      color: rgbColor(el.color),
      opacity: el.opacity,
    });
  }

  private drawEllipse(page: PDFPage, el: EllipseElement, toPdfPoint: ToPdfPoint): void {
    const p = placeBox(toPdfPoint, el.x, el.y, el.width, el.height);
    const [cx, cy] = toPdfPoint(el.x + el.width / 2, el.y + el.height / 2);
    page.drawEllipse({
      x: cx,
      y: cy,
      xScale: p.width / 2,
      yScale: p.height / 2,
      rotate: degrees(p.rotateDeg),
      color: el.fill ? rgbColor(el.fill) : undefined,
      opacity: el.fill ? el.opacity : undefined,
      borderColor: el.stroke && el.strokeWidth > 0 ? rgbColor(el.stroke) : undefined,
      borderWidth: el.stroke && el.strokeWidth > 0 ? el.strokeWidth : undefined,
      borderOpacity: el.stroke ? el.opacity : undefined,
    });
  }

  private async drawImage(page: PDFPage, el: ImageElement, toPdfPoint: ToPdfPoint): Promise<void> {
    const img = await this.image(el.src);
    if (!img) return;
    const p = placeBox(toPdfPoint, el.x, el.y, el.width, el.height);
    page.drawImage(img, {
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      rotate: degrees(p.rotateDeg),
      opacity: el.opacity,
    });
  }

  private drawInk(page: PDFPage, el: InkElement, toPdfPoint: ToPdfPoint): void {
    if (el.points.length < 2) return;
    const color = rgbColor(el.color);
    for (let i = 1; i < el.points.length; i++) {
      const a = toPdfPoint(el.points[i - 1].x, el.points[i - 1].y);
      const b = toPdfPoint(el.points[i].x, el.points[i].y);
      page.drawLine({
        start: { x: a[0], y: a[1] },
        end: { x: b[0], y: b[1] },
        thickness: el.strokeWidth,
        color,
        opacity: el.opacity,
        lineCap: LineCapStyle.Round,
      });
    }
  }

  private async drawText(page: PDFPage, el: TextElement, toPdfPoint: ToPdfPoint): Promise<void> {
    // 1) Hide the original glyphs when this edit replaces existing PDF text.
    if (el.coverColor) {
      const cover = placeBox(toPdfPoint, el.x, el.y, el.width, el.height);
      page.drawRectangle({
        x: cover.x,
        y: cover.y,
        width: cover.width,
        height: cover.height,
        rotate: degrees(cover.rotateDeg),
        color: rgbColor(el.coverColor),
      });
    }

    // Fidelity order: the original captured font (true 1:1 for scanned text) →
    // the chosen web font → the metric-compatible standard font. A standard font
    // is always kept ready as a per-line fallback for glyphs a custom subset
    // cannot encode, so the export can never break.
    const origFont = await this.embeddedFont(el);
    const webFont = origFont ? null : await this.webFont(el);
    const stdFont = await this.standardFont(el);
    const unicodeFont = origFont ?? webFont; // carries its own glyphs (full Unicode)
    const color = rgbColor(el.color);
    const lines = el.text.length ? el.text.split('\n') : [''];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const lineTop = el.y + i * el.size * el.lineHeight;
      const baselineY = lineTop + el.size * ASCENT_RATIO;
      const x0 = lineX(el, line, unicodeFont ?? stdFont);
      const anchor = toPdfPoint(x0, baselineY);
      const rotateDeg = axisAngleDeg(toPdfPoint, x0, baselineY);

      const draw = (font: PDFFont, text: string) =>
        page.drawText(text, {
          x: anchor[0],
          y: anchor[1],
          size: el.size,
          font,
          color,
          opacity: el.opacity,
          rotate: degrees(rotateDeg),
        });

      try {
        // Custom fonts carry their own glyphs; standard fonts are WinAnsi, so
        // sanitise unsupported characters to keep them from throwing.
        if (unicodeFont) draw(unicodeFont, line);
        else draw(stdFont, sanitizeWinAnsi(line));
      } catch {
        try {
          draw(stdFont, sanitizeWinAnsi(line));
        } catch {
          /* a single unrenderable line must never abort the export */
        }
      }
    }
  }
}

/** Left edge of a line given the element's alignment, measured with the active font. */
function lineX(el: TextElement, line: string, font: PDFFont): number {
  if (el.align === 'left') return el.x;
  let textWidth: number;
  try {
    textWidth = font.widthOfTextAtSize(line, el.size);
  } catch {
    return el.x; // measurement failed → fall back to left alignment
  }
  return el.align === 'center' ? el.x + (el.width - textWidth) / 2 : el.x + el.width - textWidth;
}

/** Replace characters outside the WinAnsi range so StandardFonts never throw. */
function sanitizeWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // Basic Latin + Latin-1 supplement + a few common typographic glyphs.
    if (code <= 0x7e || (code >= 0xa0 && code <= 0xff) || '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.includes(ch)) {
      out += ch;
    } else {
      out += '?';
    }
  }
  return out;
}
