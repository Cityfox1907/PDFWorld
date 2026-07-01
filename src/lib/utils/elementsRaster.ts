import {
  shapeOutline,
  calloutOutline,
  calloutTailHeight,
  isStrokeOnlyShape,
  CALLOUT_PAD,
  textFaceCss,
  cssStackFor,
  coverInsets,
  firstBaselineOffset,
  type AnyElement,
  type TextElement,
  type CalloutElement,
  type ImageElement,
  type InkElement,
  type ShapeElement,
} from '../pdf';

/**
 * Rasterise a page's overlay elements onto a canvas region — the canvas twin of
 * ElementView (screen) and Baker (export). The cut/copy tool uses this so a lifted
 * region contains what the user actually SEES: the original page PLUS every
 * drawing, cover, text box and image placed on it afterwards — not just the
 * source PDF. Geometry, fonts, dashes, blend modes and z-order all mirror the
 * other two renderers, so the flattened piece is indistinguishable from the live
 * page.
 */

/** Canvas dash pattern for a stroke style — mirrors the bake layer's dashArrayFor. */
function dashFor(dash: 'solid' | 'dashed' | 'dotted' | undefined, width: number): number[] {
  const w = Math.max(0.5, width);
  if (dash === 'dashed') return [w * 2.6, w * 2];
  if (dash === 'dotted') return [0.01, w * 1.8];
  return [];
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

/** CSS shorthand font for a text/callout element at scale 1 (view-points). */
function elementFont(el: TextElement | CalloutElement): string {
  const face =
    el.type === 'text'
      ? textFaceCss(el.family, el.embeddedFontId, el.bold, el.italic)
      : {
          fontFamily: cssStackFor(el.family),
          fontWeight: el.bold ? 700 : 400,
          fontStyle: el.italic ? 'italic' : 'normal',
        };
  return `${face.fontStyle} ${face.fontWeight} ${el.size}px ${face.fontFamily}`;
}

/** Run `draw` inside the element's free-rotation frame (pivot = its own centre). */
function withRotation(ctx: CanvasRenderingContext2D, el: AnyElement, draw: () => void): void {
  if (!el.rotation) {
    draw();
    return;
  }
  ctx.save();
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  ctx.translate(cx, cy);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  draw();
  ctx.restore();
}

function tracePoints(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], closed: boolean): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  if (closed) ctx.closePath();
}

/**
 * One line of text with optional letter-spacing (unstretched points) and horizontal
 * stretch, anchored at (x, baselineY) — the same convention as the CSS renderer
 * (spacing laid out first, scaleX applied on top) and the PDF export (Tc under Tz).
 * Uses the canvas' native letterSpacing when available; otherwise falls back to
 * per-character placement so older browsers still render the spacing.
 */
function fillLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baselineY: number,
  letterSpacing: number,
  stretchX: number,
): void {
  if (!letterSpacing && stretchX === 1) {
    ctx.fillText(text, x, baselineY);
    return;
  }
  ctx.save();
  ctx.translate(x, baselineY);
  if (stretchX !== 1) ctx.scale(stretchX, 1);
  if (letterSpacing && 'letterSpacing' in ctx) {
    const c = ctx as CanvasRenderingContext2D & { letterSpacing: string };
    c.letterSpacing = `${letterSpacing}px`;
    ctx.fillText(text, 0, 0);
    c.letterSpacing = '0px';
  } else if (letterSpacing) {
    let cx = 0;
    for (const ch of text) {
      ctx.fillText(ch, cx, 0);
      cx += ctx.measureText(ch).width + letterSpacing;
    }
  } else {
    ctx.fillText(text, 0, 0);
  }
  ctx.restore();
}

/** Visual width of a text line incl. spacing and stretch (for center/right align). */
function lineSpan(ctx: CanvasRenderingContext2D, line: string, letterSpacing: number, stretchX: number): number {
  const chars = [...line].length;
  return (ctx.measureText(line).width + letterSpacing * Math.max(0, chars - 1)) * stretchX;
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  o: {
    x: number;
    y: number;
    width: number;
    text: string;
    size: number;
    lineHeight: number;
    align: 'left' | 'center' | 'right';
    letterSpacing?: number;
    stretchX?: number;
    list?: 'none' | 'bullet' | 'number';
  },
): void {
  const ls = o.letterSpacing ?? 0;
  const sx = o.stretchX ?? 1;
  const lines = o.text.length ? o.text.split('\n') : [''];
  lines.forEach((line, i) => {
    const baselineY = o.y + i * o.size * o.lineHeight + firstBaselineOffset(o.size, o.lineHeight);
    if (o.list && o.list !== 'none') {
      const marker = o.list === 'bullet' ? '•' : `${i + 1}.`;
      const mw = ctx.measureText(marker).width;
      ctx.fillText(marker, o.x - o.size * 0.35 - mw, baselineY);
    }
    if (!line) return;
    const span = lineSpan(ctx, line, ls, sx);
    const x0 = o.align === 'center' ? o.x + (o.width - span) / 2 : o.align === 'right' ? o.x + o.width - span : o.x;
    fillLine(ctx, line, x0, baselineY, ls, sx);
  });
}

function drawText(ctx: CanvasRenderingContext2D, t: TextElement): void {
  // Page-anchored background cover of an in-place replacement — drawn below its own
  // text and NEVER rotated with the box, mirroring CoverView / the bake layer.
  if (t.coverColor) {
    const r = t.coverRect ?? { x: t.x, y: t.y, width: t.width, height: t.height };
    const pad = coverInsets(t.size);
    ctx.fillStyle = t.coverColor;
    ctx.fillRect(r.x - pad.x, r.y - pad.y, r.width + pad.x * 2, r.height + pad.y * 2);
  }
  ctx.font = elementFont(t);
  ctx.fillStyle = t.color;
  withRotation(ctx, t, () =>
    drawTextBlock(ctx, {
      x: t.x,
      y: t.y,
      width: t.width,
      text: t.text,
      size: t.size,
      lineHeight: t.lineHeight,
      align: t.align,
      letterSpacing: t.letterSpacing,
      stretchX: t.stretchX,
      list: t.list,
    }),
  );
}

function drawCallout(ctx: CanvasRenderingContext2D, c: CalloutElement): void {
  withRotation(ctx, c, () => {
    const { points, closed } = calloutOutline(c.x, c.y, c.width, c.height);
    tracePoints(ctx, points, closed);
    ctx.fillStyle = c.fill;
    ctx.fill();
    if (c.stroke && c.strokeWidth > 0) {
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = c.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    const tailH = calloutTailHeight(c.height);
    const pad = CALLOUT_PAD;
    ctx.save();
    ctx.beginPath();
    ctx.rect(c.x + pad, c.y + pad, Math.max(0, c.width - 2 * pad), Math.max(0, c.height - tailH - 2 * pad));
    ctx.clip();
    ctx.font = elementFont(c);
    ctx.fillStyle = c.color;
    drawTextBlock(ctx, {
      x: c.x + pad,
      y: c.y + pad,
      width: Math.max(1, c.width - 2 * pad),
      text: c.text,
      size: c.size,
      lineHeight: c.lineHeight,
      align: c.align,
    });
    ctx.restore();
  });
}

function drawInk(ctx: CanvasRenderingContext2D, el: InkElement): void {
  if (el.points.length < 2) return;
  withRotation(ctx, el, () => {
    if (el.highlight) ctx.globalCompositeOperation = 'multiply';
    tracePoints(ctx, el.points, false);
    ctx.strokeStyle = el.color;
    ctx.lineWidth = el.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(dashFor(el.dash, el.strokeWidth));
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

function drawShape(ctx: CanvasRenderingContext2D, el: ShapeElement): void {
  withRotation(ctx, el, () => {
    const { points, closed } = shapeOutline(el.shape, el.x, el.y, el.width, el.height, el.flip ?? false);
    tracePoints(ctx, points, closed);
    if (!isStrokeOnlyShape(el.shape) && el.fill) {
      ctx.fillStyle = el.fill;
      ctx.fill();
    }
    if (el.stroke && el.strokeWidth > 0) {
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash(dashFor(el.dash, el.strokeWidth));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
}

function drawImageEl(ctx: CanvasRenderingContext2D, el: ImageElement, im: HTMLImageElement | undefined): void {
  if (!im) return;
  withRotation(ctx, el, () => {
    ctx.drawImage(im, el.x, el.y, el.width, el.height);
    const bw = el.borderWidth ?? 0;
    if (el.borderColor && bw > 0) {
      // Inset by half the stroke so the border sits inside the box edge, like CSS.
      ctx.strokeStyle = el.borderColor;
      ctx.lineWidth = bw;
      ctx.lineCap = 'round';
      ctx.setLineDash(dashFor(el.borderStyle, bw));
      ctx.strokeRect(el.x + bw / 2, el.y + bw / 2, el.width - bw, el.height - bw);
      ctx.setLineDash([]);
    }
  });
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (r > 0 && typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function drawOne(ctx: CanvasRenderingContext2D, el: AnyElement, images: Map<string, HTMLImageElement>): void {
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  switch (el.type) {
    case 'rect':
      withRotation(ctx, el, () => {
        drawRoundedRect(ctx, el.x, el.y, el.width, el.height, el.radius);
        if (el.fill) {
          ctx.fillStyle = el.fill;
          ctx.fill();
        }
        if (el.stroke && el.strokeWidth > 0) {
          ctx.strokeStyle = el.stroke;
          ctx.lineWidth = el.strokeWidth;
          ctx.stroke();
        }
      });
      break;
    case 'ellipse':
      withRotation(ctx, el, () => {
        ctx.beginPath();
        ctx.ellipse(el.x + el.width / 2, el.y + el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
        if (el.fill) {
          ctx.fillStyle = el.fill;
          ctx.fill();
        }
        if (el.stroke && el.strokeWidth > 0) {
          ctx.strokeStyle = el.stroke;
          ctx.lineWidth = el.strokeWidth;
          ctx.stroke();
        }
      });
      break;
    case 'highlight':
      ctx.globalCompositeOperation = 'multiply';
      withRotation(ctx, el, () => {
        ctx.fillStyle = el.color;
        ctx.fillRect(el.x, el.y, el.width, el.height);
      });
      break;
    case 'shape':
      drawShape(ctx, el);
      break;
    case 'ink':
      drawInk(ctx, el);
      break;
    case 'image':
    case 'signature':
      drawImageEl(ctx, el, images.get(el.src));
      break;
    case 'text':
      drawText(ctx, el);
      break;
    case 'callout':
      drawCallout(ctx, el);
      break;
  }
  ctx.restore();
}

/**
 * Paint every visible overlay element of a page onto `ctx`, mapped so that the
 * view-point region (vx, vy) lands at the canvas origin at `density` bitmap pixels
 * per view-point. Bitmaps and typefaces are preloaded first, so the paint itself is
 * synchronous and never draws with a missing image or a fallback face.
 */
export async function drawElementsRegion(
  ctx: CanvasRenderingContext2D,
  elements: AnyElement[],
  vx: number,
  vy: number,
  density: number,
): Promise<void> {
  const ordered = [...elements].filter((e) => !e.hidden).sort((a, b) => a.z - b.z);
  if (!ordered.length) return;

  const images = new Map<string, HTMLImageElement>();
  await Promise.all(
    ordered.map(async (el) => {
      if ((el.type === 'image' || el.type === 'signature') && !images.has(el.src)) {
        const im = await loadImage(el.src);
        if (im) images.set(el.src, im);
      }
      if (el.type === 'text' || el.type === 'callout') {
        try {
          await document.fonts.load(elementFont(el), el.text || 'x');
        } catch {
          /* not a loadable web face — the system fallback measures fine */
        }
      }
    }),
  );

  ctx.save();
  ctx.setTransform(density, 0, 0, density, -vx * density, -vy * density);
  for (const el of ordered) drawOne(ctx, el, images);
  ctx.restore();
}
