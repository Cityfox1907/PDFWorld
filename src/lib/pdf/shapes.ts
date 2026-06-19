import type { ShapeKind } from './types';

/** A point in view space (top-left origin, y down). */
export interface Pt {
  x: number;
  y: number;
}

/**
 * Vector outline of a shape inside the box (x, y, w, h), in view-point space
 * (top-left origin). Returned as a list of points plus whether the path closes,
 * so the SAME geometry feeds both the on-screen SVG and the lossless export path —
 * they can never drift apart.
 *
 * `line` and `arrow` point along the box diagonal / to the right so a single drag
 * defines them; rotation (handled by the caller) then aims them anywhere.
 */
export function shapeOutline(kind: ShapeKind, x: number, y: number, w: number, h: number, flip = false): { points: Pt[]; closed: boolean } {
  switch (kind) {
    case 'triangle':
      return { points: [{ x: x + w / 2, y }, { x: x + w, y: y + h }, { x, y: y + h }], closed: true };
    case 'right-triangle':
      // Right angle at the bottom-left, hypotenuse running up to the top-right.
      return { points: [{ x, y }, { x, y: y + h }, { x: x + w, y: y + h }], closed: true };
    case 'diamond':
      return {
        points: [
          { x: x + w / 2, y },
          { x: x + w, y: y + h / 2 },
          { x: x + w / 2, y: y + h },
          { x, y: y + h / 2 },
        ],
        closed: true,
      };
    case 'pentagon':
      return { points: regularPolygon(x, y, w, h, 5, -Math.PI / 2), closed: true };
    case 'hexagon':
      // Flat top & bottom (a vertex on each side) — the classic hexagon silhouette.
      return { points: regularPolygon(x, y, w, h, 6, 0), closed: true };
    case 'octagon':
      // Offset so the top, bottom and sides are flat edges (stop-sign look).
      return { points: regularPolygon(x, y, w, h, 8, -Math.PI / 2 + Math.PI / 8), closed: true };
    case 'parallelogram':
      return {
        points: [
          { x: x + w * 0.25, y },
          { x: x + w, y },
          { x: x + w * 0.75, y: y + h },
          { x, y: y + h },
        ],
        closed: true,
      };
    case 'trapezoid':
      return {
        points: [
          { x: x + w * 0.22, y },
          { x: x + w * 0.78, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ],
        closed: true,
      };
    case 'star':
      return { points: starPoints(x, y, w, h), closed: true };
    case 'heart':
      return { points: heartPoints(x, y, w, h), closed: true };
    case 'cloud':
      return { points: cloudPoints(x, y, w, h), closed: true };
    case 'cross':
      return { points: crossPoints(x, y, w, h), closed: true };
    case 'chevron':
      return { points: chevronPoints(x, y, w, h), closed: true };
    case 'arrow':
      return { points: arrowPoints(x, y, w, h), closed: true };
    case 'double-arrow':
      return { points: doubleArrowPoints(x, y, w, h), closed: true };
    case 'line':
      // `flip` carries the drag direction so a line drawn ↗ / ↙ keeps its slope
      // instead of always running top-left → bottom-right within its box.
      return flip
        ? { points: [{ x: x + w, y }, { x, y: y + h }], closed: false }
        : { points: [{ x, y }, { x: x + w, y: y + h }], closed: false };
  }
}

/** Vertices of a regular N-gon inscribed in the box, starting at angle `rot`. */
function regularPolygon(x: number, y: number, w: number, h: number, n: number, rot: number): Pt[] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const ang = rot + (i * 2 * Math.PI) / n;
    pts.push({ x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) });
  }
  return pts;
}

/** Five-pointed star fitted to the box (outer radius = half-box, inner = 40 %). */
function starPoints(x: number, y: number, w: number, h: number): Pt[] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 1 : 0.4;
    pts.push({ x: cx + rx * r * Math.cos(ang), y: cy + ry * r * Math.sin(ang) });
  }
  return pts;
}

/** A plus / cross sign filling the box, with arms one-third of the box thick. */
function crossPoints(x: number, y: number, w: number, h: number): Pt[] {
  const a = w / 3;
  const b = (2 * w) / 3;
  const c = h / 3;
  const d = (2 * h) / 3;
  return [
    { x: x + a, y },
    { x: x + b, y },
    { x: x + b, y: y + c },
    { x: x + w, y: y + c },
    { x: x + w, y: y + d },
    { x: x + b, y: y + d },
    { x: x + b, y: y + h },
    { x: x + a, y: y + h },
    { x: x + a, y: y + d },
    { x, y: y + d },
    { x, y: y + c },
    { x: x + a, y: y + c },
  ];
}

/** A right-pointing chevron (arrow head with a notched tail). */
function chevronPoints(x: number, y: number, w: number, h: number): Pt[] {
  return [
    { x, y },
    { x: x + w * 0.55, y },
    { x: x + w, y: y + h / 2 },
    { x: x + w * 0.55, y: y + h },
    { x, y: y + h },
    { x: x + w * 0.45, y: y + h / 2 },
  ];
}

/** A right-pointing block arrow filling the box (shaft + arrowhead). */
function arrowPoints(x: number, y: number, w: number, h: number): Pt[] {
  const neck = x + w * 0.58; // where the shaft meets the head
  return [
    { x, y: y + h * 0.3 },
    { x: neck, y: y + h * 0.3 },
    { x: neck, y: y + h * 0.06 },
    { x: x + w, y: y + h / 2 },
    { x: neck, y: y + h * 0.94 },
    { x: neck, y: y + h * 0.7 },
    { x, y: y + h * 0.7 },
  ];
}

/** A horizontal double-headed arrow (↔) filling the box. */
function doubleArrowPoints(x: number, y: number, w: number, h: number): Pt[] {
  const hw = w * 0.22; // arrow-head width on each side
  const cy = y + h / 2;
  const top = y + h * 0.32; // shaft top edge
  const bot = y + h * 0.68; // shaft bottom edge
  return [
    { x, y: cy },
    { x: x + hw, y },
    { x: x + hw, y: top },
    { x: x + w - hw, y: top },
    { x: x + w - hw, y },
    { x: x + w, y: cy },
    { x: x + w - hw, y: y + h },
    { x: x + w - hw, y: bot },
    { x: x + hw, y: bot },
    { x: x + hw, y: y + h },
  ];
}

/**
 * A heart fitted to the box, sampled from the classic heart curve and normalised so
 * it exactly fills (x, y, w, h). Enough samples that the straight segments read as a
 * smooth curve at any size; the SAME points feed the export so screen and PDF match.
 */
function heartPoints(x: number, y: number, w: number, h: number): Pt[] {
  const N = 40;
  const raw: Pt[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * 2 * Math.PI;
    const px = 16 * Math.sin(t) ** 3;
    // Negated so the cusp points up in our y-down space.
    const py = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    raw.push({ x: px, y: py });
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  const sx = w / (maxX - minX);
  const sy = h / (maxY - minY);
  return raw.map((p) => ({ x: x + (p.x - minX) * sx, y: y + (p.y - minY) * sy }));
}

/**
 * A cloud: a flat base with four rounded bumps across the top. Each bump is the upper
 * arc of a circle; the bumps overlap so the union reads as a single puffy outline.
 */
function cloudPoints(x: number, y: number, w: number, h: number): Pt[] {
  // Bump centres + radii in normalised box space (y grows downward), tuned so the whole
  // outline stays inside the box: leftmost = 0.24−0.20 = 0.04, rightmost = 0.80+0.16 = 0.96.
  const bumps = [
    { cx: 0.24, cy: 0.6, r: 0.2 },
    { cx: 0.45, cy: 0.44, r: 0.24 },
    { cx: 0.64, cy: 0.46, r: 0.22 },
    { cx: 0.8, cy: 0.6, r: 0.16 },
  ];
  const baseY = y + h * 0.84;
  const pts: Pt[] = [];
  // Top: trace the upper half of each bump, left → right.
  for (const b of bumps) {
    const bcx = x + b.cx * w;
    const bcy = y + b.cy * h;
    const rx = b.r * w;
    const ry = b.r * h;
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI + (i / steps) * Math.PI; // π → 2π = the top half (y-down)
      pts.push({ x: bcx + rx * Math.cos(a), y: bcy + ry * Math.sin(a) });
    }
  }
  // Bottom: flat base back to the start, forming the short straight sides.
  const last = bumps[bumps.length - 1];
  const first = bumps[0];
  pts.push({ x: x + last.cx * w + last.r * w, y: baseY });
  pts.push({ x: x + first.cx * w - first.r * w, y: baseY });
  return pts;
}

/** Padding (view points) between a callout bubble's edge and its text. */
export const CALLOUT_PAD = 8;

/** Height of the bubble's tail strip at the bottom of the box. */
export function calloutTailHeight(h: number): number {
  return Math.min(14, h * 0.22);
}

/**
 * Outline of a speech-bubble: a rounded rectangle with a small downward tail near
 * the left, as a polyline in view space (corners approximated by short segments so
 * the same points drive screen SVG and the export path). The tail occupies the
 * bottom strip of the box; the bubble body fills the rest.
 */
export function calloutOutline(x: number, y: number, w: number, h: number): { points: Pt[]; closed: boolean } {
  const tailH = calloutTailHeight(h);
  const bottom = y + Math.max(8, h - tailH); // bubble body bottom
  const right = x + w;
  const r = Math.max(0, Math.min(12, (bottom - y) / 2, w / 2));
  const pts: Pt[] = [];
  const arc = (ccx: number, ccy: number, a0: number, a1: number) => {
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      pts.push({ x: ccx + r * Math.cos(a), y: ccy + r * Math.sin(a) });
    }
  };
  const HALF = Math.PI / 2;
  arc(x + r, y + r, Math.PI, Math.PI + HALF); // top-left
  arc(right - r, y + r, Math.PI + HALF, 2 * Math.PI); // top-right
  arc(right - r, bottom - r, 0, HALF); // bottom-right
  // bottom edge (right→left) with the tail dipping below
  const baseRight = Math.min(right - r - 2, x + r + 8 + Math.min(24, Math.max(12, w * 0.25)));
  const baseLeft = Math.max(x + r + 2, baseRight - Math.min(24, Math.max(12, w * 0.25)));
  pts.push({ x: baseRight, y: bottom });
  pts.push({ x: baseLeft + 4, y: y + h }); // tail tip
  pts.push({ x: baseLeft, y: bottom });
  arc(x + r, bottom - r, HALF, Math.PI); // bottom-left
  return { points: pts, closed: true };
}

/** Build an SVG path string from view-space points (screen rendering, y down). */
export function pointsToSvgPath(points: Pt[], closed: boolean): string {
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  return closed ? `${d} Z` : d;
}

/** Whether a shape is a pure outline (no fill area), so the inspector hides fill. */
export function isStrokeOnlyShape(kind: ShapeKind): boolean {
  return kind === 'line';
}
