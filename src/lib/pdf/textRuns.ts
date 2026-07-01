import type { TextRun } from './types';

/**
 * Pure text-run post-processing for the scan tool: merging pdf.js character runs
 * into clickable lines and recognising SPACED / TRACKED text. Kept free of any
 * pdf.js import so the logic also runs (and is tested) under plain Node.
 */

/**
 * Merge raw character runs into editable *line blocks*. pdf.js emits many short
 * runs per visual line; the scan editor is far nicer when a whole line (or form
 * field) is one click target. Runs are grouped when they share a baseline AND are
 * horizontally adjacent — a large gap starts a new block so separate columns or
 * form fields stay independent.
 *
 * Assembly is spacing-aware: a heading written with wide tracking
 * ("B U S I N E S S P L A N") arrives as many single-character pieces with
 * uniform gaps. Treating those gaps as word spaces used to corrupt the line into
 * a mix of glued and spaced letters — instead, the gap pattern is recognised, the
 * characters are joined without fake spaces, and the median gap is kept as the
 * line's `letterSpacing`, so the editor and the export imitate the real style.
 */
export function groupRunsIntoLines(runs: TextRun[]): TextRun[] {
  if (runs.length <= 1) return runs;
  const baseline = (r: TextRun) => r.y + r.fontSize;
  const sorted = [...runs].sort((a, b) => {
    const db = baseline(a) - baseline(b);
    if (Math.abs(db) > Math.min(a.fontSize, b.fontSize) * 0.5) return db;
    return a.x - b.x;
  });

  // Pass 1: cluster pieces that share a baseline and are horizontally adjacent
  // (same thresholds as the previous single-pass merge, tracked via the cluster's
  // running max font size, top and last right edge).
  interface Cluster {
    pieces: TextRun[];
    top: number;
    bottom: number;
    fs: number;
    lastRight: number;
    maxRight: number;
  }
  const clusters: Cluster[] = [];
  let cur: Cluster | null = null;
  for (const r of sorted) {
    const sameLine =
      cur &&
      Math.abs(baseline(r) - (cur.top + cur.fs)) <= Math.min(r.fontSize, cur.fs) * 0.5 &&
      r.x - cur.lastRight <= cur.fs * 2.2;
    if (cur && sameLine) {
      cur.pieces.push(r);
      cur.top = Math.min(cur.top, r.y);
      cur.bottom = Math.max(cur.bottom, r.y + r.height);
      cur.fs = Math.max(cur.fs, r.fontSize);
      cur.lastRight = r.x + r.width;
      cur.maxRight = Math.max(cur.maxRight, r.x + r.width);
    } else {
      cur = { pieces: [r], top: r.y, bottom: r.y + r.height, fs: r.fontSize, lastRight: r.x + r.width, maxRight: r.x + r.width };
      clusters.push(cur);
    }
  }

  // Pass 2: assemble each cluster into one line, with tracked-heading detection.
  return clusters.map((c) => {
    const first = c.pieces[0];
    const base: TextRun = {
      ...first,
      y: c.top,
      height: c.bottom - c.top,
      width: c.maxRight - first.x,
      fontSize: c.fs,
    };
    if (c.pieces.length === 1) return base;

    const gaps: number[] = [];
    for (let i = 1; i < c.pieces.length; i++) {
      gaps.push(c.pieces[i].x - (c.pieces[i - 1].x + c.pieces[i - 1].width));
    }

    // Tracked heading: mostly single-character pieces with a consistent positive gap.
    const singles = c.pieces.filter((p) => [...p.str.trim()].length === 1).length;
    let tracking = 0;
    if (c.pieces.length >= 5 && singles / c.pieces.length >= 0.8) {
      const pos = gaps.filter((g) => g > 0).sort((a, b) => a - b);
      const median = pos.length ? pos[Math.floor(pos.length / 2)] : 0;
      if (median > c.fs * 0.04 && median < c.fs * 1.2) tracking = median;
    }

    let str = first.str;
    for (let i = 1; i < c.pieces.length; i++) {
      const piece = c.pieces[i];
      const gap = gaps[i - 1];
      const needsSpace = tracking
        ? gap > tracking * 2.5 + c.fs * 0.05 // only a clearly larger gap is a real word break
        : gap > c.fs * 0.18 && !str.endsWith(' ') && !piece.str.startsWith(' ');
      str += (needsSpace ? ' ' : '') + piece.str;
    }

    return {
      ...base,
      str,
      // The gap is measured in (possibly stretched) page space; letterSpacing is
      // stored unstretched, exactly like the PDF's own Tc under Tz.
      letterSpacing: tracking ? tracking / (first.stretchX ?? 1) : undefined,
    };
  });
}

/**
 * Recognise text that spells out wide tracking with literal spaces —
 * "B U S I N E S S P L A N" — and collapse it back to its real characters.
 * pdf.js inserts such pseudo-spaces itself for TJ-spaced headings that arrive as
 * ONE item, and the line grouping above may have added them for borderline gaps.
 * Runs of 2+ spaces mark real word breaks and survive as a single space. The
 * caller turns the reclaimed width into a `letterSpacing` so the visual style is
 * imitated exactly instead of typing fake spaces.
 */
export function detrackText(str: string): { text: string; tracked: boolean } {
  const tokens = str.split(' ').filter((t) => t.length > 0);
  if (tokens.length >= 5 && tokens.filter((t) => [...t].length === 1).length / tokens.length >= 0.8) {
    const text = str
      .trim()
      .split(/ {2,}/) // runs of 2+ spaces are real word breaks and survive as one space
      .map((word) => word.replace(/ /g, '')) // single spaces are letter gaps and disappear
      .join(' ');
    if ([...text].length >= 4) return { text, tracked: true };
  }
  return { text: str, tracked: false };
}
