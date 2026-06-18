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
    case 'star':
      return { points: starPoints(x, y, w, h), closed: true };
    case 'arrow':
      return { points: arrowPoints(x, y, w, h), closed: true };
    case 'line':
      // `flip` carries the drag direction so a line drawn ↗ / ↙ keeps its slope
      // instead of always running top-left → bottom-right within its box.
      return flip
        ? { points: [{ x: x + w, y }, { x, y: y + h }], closed: false }
        : { points: [{ x, y }, { x: x + w, y: y + h }], closed: false };
  }
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
