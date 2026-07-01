/** Normalise a CSS-ish color to a lowercase #rrggbb; falls back to black. The
 *  lowercase output keeps colour de-duplication and swatch highlighting reliable. */
export function toHex(input: string): string {
  if (!input) return '#000000';
  let h = input.trim().toLowerCase();
  if (h.startsWith('#')) {
    if (h.length === 4) h = '#' + h.slice(1).split('').map((c) => c + c).join('');
    return h.slice(0, 7);
  }
  const m = h.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) {
    const hex = (n: string) => Number(n).toString(16).padStart(2, '0');
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  }
  return '#000000';
}

/**
 * Sample the dominant background color just outside a text box on the rendered
 * canvas. Used so in-place text edits cover the original glyphs with the page's
 * actual background instead of a hard white rectangle.
 */
export function sampleBackground(
  canvas: HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
  scale: number,
  originX = 0,
  originY = 0,
): string {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#ffffff';

  const pad = Math.max(2, Math.round(2 * scale));
  const left = Math.round(box.x * scale - originX);
  const top = Math.round(box.y * scale - originY);
  const right = Math.round((box.x + box.width) * scale - originX);
  const bottom = Math.round((box.y + box.height) * scale - originY);

  // Probe whole strips just outside each edge of the run (where the page
  // background is clean), then take the *mode* colour. Strips beat single points
  // because they survive specks, underlines and anti-aliased glyph edges.
  // Pixels are bucketed at 4-bit per channel so near-identical tones merge, but the
  // returned colour is the exact AVERAGE of the winning bucket's real pixels — a
  // quantised bucket key alone would be up to 15/255 off per channel, which shows
  // as a visible patch on tinted backgrounds.
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  const addStrip = (x0: number, y0: number, w: number, h: number) => {
    const x = Math.max(0, Math.min(canvas.width - 1, x0));
    const y = Math.max(0, Math.min(canvas.height - 1, y0));
    const ww = Math.max(1, Math.min(canvas.width - x, w));
    const hh = Math.max(1, Math.min(canvas.height - y, h));
    try {
      const d = ctx.getImageData(x, y, ww, hh).data;
      for (let i = 0; i < d.length; i += 4) {
        const key = `${d[i] & 0xf0}:${d[i + 1] & 0xf0}:${d[i + 2] & 0xf0}`;
        const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        b.n++;
        b.r += d[i];
        b.g += d[i + 1];
        b.b += d[i + 2];
        buckets.set(key, b);
      }
    } catch {
      /* cross-origin or out of range */
    }
  };

  addStrip(left - pad * 2, top, pad, bottom - top); // left margin
  addStrip(right + pad, top, pad, bottom - top); // right margin
  addStrip(left, top - pad * 2, right - left, pad); // above
  addStrip(left, bottom + pad, right - left, pad); // below

  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const b of buckets.values()) {
    if (!best || b.n > best.n) best = b;
  }
  if (!best) return '#ffffff';
  const hex = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

/**
 * Sample a single point's color on the rendered canvas, in view-point space.
 * Used by the background brush so a stroke perfectly matches the paper/page colour
 * directly under the cursor. Averages a small neighbourhood to cancel anti-alias noise.
 *
 * `originX`/`originY` are the canvas's top-left in bitmap pixels (non-zero when the
 * canvas holds only the visible window of the page rather than the whole page).
 */
export function sampleColorAt(
  canvas: HTMLCanvasElement,
  vx: number,
  vy: number,
  scale: number,
  originX = 0,
  originY = 0,
): string {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#ffffff';
  const cx = Math.round(vx * scale - originX);
  const cy = Math.round(vy * scale - originY);
  const r = Math.max(1, Math.round(2 * scale));
  const x = Math.max(0, cx - r);
  const y = Math.max(0, cy - r);
  const w = Math.min(canvas.width - x, r * 2 + 1);
  const h = Math.min(canvas.height - y, r * 2 + 1);
  if (w <= 0 || h <= 0) return '#ffffff';
  try {
    const data = ctx.getImageData(x, y, w, h).data;
    let rs = 0;
    let gs = 0;
    let bs = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      rs += data[i];
      gs += data[i + 1];
      bs += data[i + 2];
      n++;
    }
    if (!n) return '#ffffff';
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
    return `#${hex(rs)}${hex(gs)}${hex(bs)}`;
  } catch {
    return '#ffffff';
  }
}

/**
 * Estimate a line's glyph colour from the rendered canvas. Anti-aliasing means a
 * single darkest pixel is noisy, so we collect the glyph pixels — the ones that
 * stand out clearly from the (lighter) background — and average them. This is far
 * steadier across black body text and coloured headings alike.
 */
export function sampleTextColor(
  canvas: HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
  scale: number,
  originX = 0,
  originY = 0,
): string {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#111111';
  const x = Math.max(0, Math.round(box.x * scale - originX));
  const y = Math.max(0, Math.round(box.y * scale - originY));
  const w = Math.min(canvas.width - x, Math.round(box.width * scale));
  const h = Math.min(canvas.height - y, Math.round(box.height * scale));
  if (w <= 0 || h <= 0) return '#111111';
  try {
    const data = ctx.getImageData(x, y, w, h).data;
    const lum = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

    // Background ≈ the brightest region; the ink is whatever is clearly darker.
    let maxLum = 0;
    let minLum = 255;
    for (let i = 0; i < data.length; i += 4) {
      const l = lum(i);
      if (l > maxLum) maxLum = l;
      if (l < minLum) minLum = l;
    }
    if (maxLum - minLum < 8) return '#111111'; // no real glyphs in the box
    const threshold = minLum + (maxLum - minLum) * 0.45;

    let rs = 0;
    let gs = 0;
    let bs = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (lum(i) <= threshold) {
        rs += data[i];
        gs += data[i + 1];
        bs += data[i + 2];
        n++;
      }
    }
    if (!n) return '#111111';
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
    return `#${hex(rs)}${hex(gs)}${hex(bs)}`;
  } catch {
    return '#111111';
  }
}
