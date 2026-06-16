/** Normalise a CSS-ish color to #rrggbb; falls back to black. */
export function toHex(input: string): string {
  if (!input) return '#000000';
  let h = input.trim();
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
): string {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#ffffff';

  const pad = Math.max(2, Math.round(2 * scale));
  const samples: [number, number][] = [];
  const left = Math.round(box.x * scale);
  const top = Math.round(box.y * scale);
  const right = Math.round((box.x + box.width) * scale);
  const bottom = Math.round((box.y + box.height) * scale);
  const midY = Math.round((box.y + box.height / 2) * scale);

  // Probe just left/right of the run, and above/below, where background is clean.
  samples.push([left - pad, midY], [right + pad, midY]);
  samples.push([left + 1, top - pad], [left + 1, bottom + pad]);

  const counts = new Map<string, number>();
  for (const [px, py] of samples) {
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
    try {
      const d = ctx.getImageData(px, py, 1, 1).data;
      const hex = `#${d[0].toString(16).padStart(2, '0')}${d[1].toString(16).padStart(2, '0')}${d[2]
        .toString(16)
        .padStart(2, '0')}`;
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    } catch {
      /* cross-origin or out of range */
    }
  }

  let best = '#ffffff';
  let bestCount = 0;
  for (const [hex, count] of counts) {
    if (count > bestCount) {
      best = hex;
      bestCount = count;
    }
  }
  return best;
}

/** Sample the darkest pixel within a text box — a good estimate of glyph color. */
export function sampleTextColor(
  canvas: HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
  scale: number,
): string {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#111111';
  const x = Math.max(0, Math.round(box.x * scale));
  const y = Math.max(0, Math.round(box.y * scale));
  const w = Math.min(canvas.width - x, Math.round(box.width * scale));
  const h = Math.min(canvas.height - y, Math.round(box.height * scale));
  if (w <= 0 || h <= 0) return '#111111';
  try {
    const data = ctx.getImageData(x, y, w, h).data;
    let br = 0;
    let bg = 0;
    let bb = 0;
    let bestLum = 256;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < bestLum) {
        bestLum = lum;
        br = r;
        bg = g;
        bb = b;
      }
    }
    return `#${br.toString(16).padStart(2, '0')}${bg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`;
  } catch {
    return '#111111';
  }
}
