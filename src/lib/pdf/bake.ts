import {
  PDFDocument,
  PDFPage,
  PDFFont,
  PDFImage,
  StandardFonts,
  rgb,
  degrees,
  LineCapStyle,
  BlendMode,
} from 'pdf-lib';
import type { AnyElement, TextElement, RectElement, EllipseElement, ShapeElement, CalloutElement, HighlightElement, ImageElement, InkElement, FontFamilyKey } from './types';
import { standardFontFor, firstBaselineOffset, coverRectFor } from './fonts';
import { baseFamilyOf, fontFileUrl } from './fontCatalog';
import { getEmbeddedFont } from './embeddedFonts';
import { shapeOutline, isStrokeOnlyShape, calloutOutline, calloutTailHeight, CALLOUT_PAD, type Pt } from './shapes';
import { placeBox, placeRotatedBox, rotateViewPoint, axisAngleDeg, type ToPdfPoint, type BoxPlacement } from './coords';

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

/**
 * Dash pattern (in points) for a stroke of the given width, or undefined for a solid
 * line. Scaled by the stroke width so the rhythm stays proportional at any thickness;
 * 'dotted' uses a zero-length dash with a round cap so each mark renders as a dot.
 */
function dashArrayFor(dash: 'solid' | 'dashed' | 'dotted' | undefined, width: number): number[] | undefined {
  const w = Math.max(0.5, width);
  if (dash === 'dashed') return [w * 2.6, w * 2];
  if (dash === 'dotted') return [0.01, w * 1.8];
  return undefined;
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

  /** Bake every element of a page, respecting z-order. Hidden elements are skipped. */
  async bakePage(page: PDFPage, elements: AnyElement[], toPdfPoint: ToPdfPoint): Promise<void> {
    const ordered = [...elements].filter((e) => !e.hidden).sort((a, b) => a.z - b.z);
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
      case 'shape':
        return this.drawShape(page, el, toPdfPoint);
      case 'callout':
        return this.drawCallout(page, el, toPdfPoint);
      case 'image':
      case 'signature':
        return this.drawImage(page, el, toPdfPoint);
      case 'ink':
        return this.drawInk(page, el, toPdfPoint);
      case 'text':
        return this.drawText(page, el, toPdfPoint);
    }
  }

  /** A free-rotation-aware SVG path from view-space points (shapes & callouts). */
  private pathFromPoints(points: Pt[], closed: boolean, rotation: number, cx: number, cy: number, toPdfPoint: ToPdfPoint): string {
    const conv = (p: Pt): [number, number] =>
      rotation ? toPdfPoint(...rotateViewPoint(p.x, p.y, cx, cy, rotation)) : toPdfPoint(p.x, p.y);
    // drawSvgPath treats the path's y as growing downward, so each content point's y
    // is negated; with x=y=0 origin and unit scale the point lands 1:1 (see drawInk).
    const d = points.map((p, i) => {
      const c = conv(p);
      return `${i === 0 ? 'M' : 'L'} ${c[0].toFixed(2)} ${(-c[1]).toFixed(2)}`;
    }).join(' ');
    return closed ? `${d} Z` : d;
  }

  private drawShape(page: PDFPage, el: ShapeElement, toPdfPoint: ToPdfPoint): void {
    const rot = el.rotation ?? 0;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const { points, closed } = shapeOutline(el.shape, el.x, el.y, el.width, el.height, el.flip ?? false);
    const d = this.pathFromPoints(points, closed, rot, cx, cy, toPdfPoint);
    const hasFill = !isStrokeOnlyShape(el.shape) && !!el.fill;
    const hasStroke = !!el.stroke && el.strokeWidth > 0;
    page.drawSvgPath(d, {
      x: 0,
      y: 0,
      color: hasFill ? rgbColor(el.fill!) : undefined,
      opacity: hasFill ? el.opacity : undefined,
      borderColor: hasStroke ? rgbColor(el.stroke!) : undefined,
      borderWidth: hasStroke ? el.strokeWidth : undefined,
      borderOpacity: hasStroke ? el.opacity : undefined,
      borderDashArray: hasStroke ? dashArrayFor(el.dash, el.strokeWidth) : undefined,
      borderLineCap: LineCapStyle.Round,
    });
  }

  private async drawCallout(page: PDFPage, el: CalloutElement, toPdfPoint: ToPdfPoint): Promise<void> {
    const rot = el.rotation ?? 0;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const { points, closed } = calloutOutline(el.x, el.y, el.width, el.height);
    const d = this.pathFromPoints(points, closed, rot, cx, cy, toPdfPoint);
    const hasStroke = !!el.stroke && el.strokeWidth > 0;
    page.drawSvgPath(d, {
      x: 0,
      y: 0,
      color: rgbColor(el.fill),
      opacity: el.opacity,
      borderColor: hasStroke ? rgbColor(el.stroke!) : undefined,
      borderWidth: hasStroke ? el.strokeWidth : undefined,
      borderOpacity: hasStroke ? el.opacity : undefined,
      borderLineCap: LineCapStyle.Round,
    });
    // Text inside the bubble, leaving room for the tail strip + padding. The text
    // pivots around the WHOLE callout's centre so it stays aligned under rotation.
    const tailH = calloutTailHeight(el.height);
    const pad = CALLOUT_PAD;
    await this.bakeTextBlock(page, toPdfPoint, {
      x: el.x + pad,
      y: el.y + pad,
      width: Math.max(1, el.width - 2 * pad),
      height: Math.max(1, el.height - tailH - 2 * pad),
      rotation: rot,
      pivotX: cx,
      pivotY: cy,
      text: el.text,
      size: el.size,
      lineHeight: el.lineHeight,
      align: el.align,
      color: el.color,
      opacity: el.opacity,
      family: el.family,
      bold: el.bold,
      italic: el.italic,
      clip: true,
    });
  }

  /**
   * Place an element's box, honouring its free rotation when present. With no
   * rotation this is exactly {@link placeBox} (snapped right angle) so unrotated
   * exports stay identical; with a rotation it composes the free angle on top.
   */
  private placeEl(el: { x: number; y: number; width: number; height: number; rotation?: number }, toPdfPoint: ToPdfPoint): BoxPlacement {
    return el.rotation
      ? placeRotatedBox(toPdfPoint, el.x, el.y, el.width, el.height, el.rotation)
      : placeBox(toPdfPoint, el.x, el.y, el.width, el.height);
  }

  private drawRect(page: PDFPage, el: RectElement, toPdfPoint: ToPdfPoint): void {
    const p = this.placeEl(el, toPdfPoint);
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
    const p = this.placeEl(el, toPdfPoint);
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
    const p = this.placeEl(el, toPdfPoint);
    // The centre is the rotation pivot, so a free rotation never moves it.
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
    const p = this.placeEl(el, toPdfPoint);
    page.drawImage(img, {
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      rotate: degrees(p.rotateDeg),
      opacity: el.opacity,
    });
    // Optional decorative border, drawn as the box outline so dashed/dotted styles
    // and free rotation all compose like the other vector elements. The outline is
    // inset by half the stroke width so the border sits *inside* the box edge,
    // matching the on-screen CSS border (box-sizing: border-box). Round caps are
    // required for the dotted pattern (a zero-length dash) to render as dots.
    const bw = el.borderWidth ?? 0;
    if (el.borderColor && bw > 0) {
      const rot = el.rotation ?? 0;
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const inset = bw / 2;
      const corners: Pt[] = [
        { x: el.x + inset, y: el.y + inset },
        { x: el.x + el.width - inset, y: el.y + inset },
        { x: el.x + el.width - inset, y: el.y + el.height - inset },
        { x: el.x + inset, y: el.y + el.height - inset },
      ];
      const d = this.pathFromPoints(corners, true, rot, cx, cy, toPdfPoint);
      page.drawSvgPath(d, {
        x: 0,
        y: 0,
        borderColor: rgbColor(el.borderColor),
        borderWidth: bw,
        borderOpacity: el.opacity,
        borderDashArray: dashArrayFor(el.borderStyle, bw),
        borderLineCap: LineCapStyle.Round,
      });
    }
  }

  private drawInk(page: PDFPage, el: InkElement, toPdfPoint: ToPdfPoint): void {
    if (el.points.length < 2) return;
    const rot = el.rotation ?? 0;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const conv = (p: { x: number; y: number }) =>
      rot ? toPdfPoint(...rotateViewPoint(p.x, p.y, cx, cy, rot)) : toPdfPoint(p.x, p.y);

    // The whole freehand path is stroked in ONE operation (pdf-lib's drawSvgPath).
    // This keeps a translucent stroke even where it overlaps itself (no per-segment
    // darkening), and lets dashed/dotted styles and a highlighter's Multiply blend
    // apply to the line as a whole. drawSvgPath flips the Y axis (SVG is y-down), so
    // each content point's y is negated; with x=y=0 and unit scale it lands 1:1.
    const d = el.points
      .map((p, i) => {
        const c = conv(p);
        return `${i === 0 ? 'M' : 'L'} ${c[0].toFixed(2)} ${(-c[1]).toFixed(2)}`;
      })
      .join(' ');
    page.drawSvgPath(d, {
      x: 0,
      y: 0,
      borderColor: rgbColor(el.color),
      borderWidth: el.strokeWidth,
      borderOpacity: el.opacity,
      borderLineCap: LineCapStyle.Round,
      borderDashArray: dashArrayFor(el.dash, el.strokeWidth),
      blendMode: el.highlight ? BlendMode.Multiply : undefined,
    });
  }

  private async drawText(page: PDFPage, el: TextElement, toPdfPoint: ToPdfPoint): Promise<void> {
    // 1) Hide the original glyphs when this edit replaces existing PDF text. The cover
    //    is PAGE-anchored: it stays over the original line even when the replacement
    //    box was moved, shrunk or rotated afterwards. Geometry comes from the ONE
    //    shared rule (coverRectFor), so it matches the editor's on-screen cover
    //    exactly (see PageCanvas CoverView).
    if (el.coverColor) {
      const r = coverRectFor(el);
      const corners: Pt[] = [
        { x: r.x, y: r.y },
        { x: r.x + r.width, y: r.y },
        { x: r.x + r.width, y: r.y + r.height },
        { x: r.x, y: r.y + r.height },
      ];
      const d = this.pathFromPoints(corners, true, 0, 0, 0, toPdfPoint);
      page.drawSvgPath(d, { x: 0, y: 0, color: rgbColor(el.coverColor), opacity: el.opacity });
    }
    await this.bakeTextBlock(page, toPdfPoint, {
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      rotation: el.rotation ?? 0,
      text: el.text,
      size: el.size,
      lineHeight: el.lineHeight,
      align: el.align,
      color: el.color,
      opacity: el.opacity,
      family: el.family,
      bold: el.bold,
      italic: el.italic,
      embeddedFontId: el.embeddedFontId,
      list: el.list,
    });
  }

  /**
   * Draw a block of lines for a text field or a callout. Fidelity order: the original
   * captured font (true 1:1 for scanned text) → the chosen web font → the metric
   * standard font, which also backstops glyphs a custom subset can't encode so the
   * export never breaks. Supports free rotation (around `pivot`, default the block's
   * own centre) and optional bullet/number list markers.
   */
  private async bakeTextBlock(page: PDFPage, toPdfPoint: ToPdfPoint, o: TextBlockOptions): Promise<void> {
    const fontEl = { family: o.family, bold: o.bold, italic: o.italic, embeddedFontId: o.embeddedFontId } as TextElement;
    const origFont = await this.embeddedFont(fontEl);
    const webFont = origFont ? null : await this.webFont(fontEl);
    const stdFont = await this.standardFont(fontEl);
    const unicodeFont = origFont ?? webFont; // carries its own glyphs (full Unicode)
    const color = rgbColor(o.color);
    const rawLines = o.text.length ? o.text.split('\n') : [''];
    const list = o.list && o.list !== 'none' ? o.list : null;
    const markerGap = o.size * 0.35;

    const rot = o.rotation ?? 0;
    const cx = o.pivotX ?? o.x + o.width / 2;
    const cy = o.pivotY ?? o.y + o.height / 2;

    const drawAt = (vx: number, vy: number, text: string) => {
      let anchor: [number, number];
      let rotateDeg: number;
      if (rot) {
        anchor = toPdfPoint(...rotateViewPoint(vx, vy, cx, cy, rot));
        const next = toPdfPoint(...rotateViewPoint(vx + 1, vy, cx, cy, rot));
        rotateDeg = (Math.atan2(next[1] - anchor[1], next[0] - anchor[0]) * 180) / Math.PI;
      } else {
        anchor = toPdfPoint(vx, vy);
        rotateDeg = axisAngleDeg(toPdfPoint, vx, vy);
      }
      const draw = (font: PDFFont, t: string) =>
        page.drawText(t, { x: anchor[0], y: anchor[1], size: o.size, font, color, opacity: o.opacity, rotate: degrees(rotateDeg) });
      try {
        if (unicodeFont) draw(unicodeFont, text);
        else draw(stdFont, sanitizeWinAnsi(text));
      } catch {
        try {
          draw(stdFont, sanitizeWinAnsi(text));
        } catch {
          /* a single unrenderable line must never abort the export */
        }
      }
    };

    const measureFont = unicodeFont ?? stdFont;
    let num = 0;
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
      // Clip overflowing lines to the box (callouts have a fixed bubble height, so the
      // export must match the on-screen `overflow:hidden`; text fields auto-grow, so
      // they pass clip=false and nothing is dropped).
      if (o.clip && i * o.size * o.lineHeight + o.size > o.height) break;
      // Same baseline the editor draws on screen (font ascent + half a line of leading),
      // so the exported text sits exactly where it was placed — and on the same line as
      // any neighbour it was aligned to.
      const baselineY = o.y + i * o.size * o.lineHeight + firstBaselineOffset(o.size, o.lineHeight);
      if (list) {
        num++;
        const marker = list === 'bullet' ? '•' : `${num}.`;
        // Right-align the marker just left of the text column (hanging in the margin),
        // exactly like the on-screen marker column, so screen and export agree. Measure
        // with the SAME font the marker is drawn in, or it lands off-column.
        let mw = o.size * 0.5;
        try {
          mw = measureFont.widthOfTextAtSize(marker, o.size);
        } catch {
          /* keep the estimate */
        }
        drawAt(o.x - markerGap - mw, baselineY, marker);
        if (raw) {
          const x0 = lineX(o.x, o.width, raw, o.align, measureFont, o.size);
          drawAt(x0, baselineY, raw);
        }
      } else if (raw) {
        const x0 = lineX(o.x, o.width, raw, o.align, measureFont, o.size);
        drawAt(x0, baselineY, raw);
      }
    }
  }
}

/** Options for {@link Baker.bakeTextBlock}: a positioned, styled run of lines. */
interface TextBlockOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  /** rotation pivot in view space; defaults to the block's own centre */
  pivotX?: number;
  pivotY?: number;
  text: string;
  size: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  color: string;
  opacity: number;
  family: FontFamilyKey;
  bold: boolean;
  italic: boolean;
  embeddedFontId?: string;
  list?: 'none' | 'bullet' | 'number';
  /** clip lines that don't fit the box height (fixed-height callouts; off for text). */
  clip?: boolean;
}

/** Left edge of a line given alignment, measured with the active font. */
function lineX(x: number, width: number, line: string, align: 'left' | 'center' | 'right', font: PDFFont, size: number): number {
  if (align === 'left') return x;
  let textWidth: number;
  try {
    textWidth = font.widthOfTextAtSize(line, size);
  } catch {
    return x; // measurement failed → fall back to left alignment
  }
  return align === 'center' ? x + (width - textWidth) / 2 : x + width - textWidth;
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
