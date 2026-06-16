/**
 * Coordinate helpers that translate the editor's "view-point" space
 * (top-left origin, scale 1, inside the rotated visible page) into pdf-lib
 * content-space draw calls (bottom-left origin).
 *
 * We never hard-code rotation tables. Instead the caller supplies `toPdfPoint`,
 * a function that maps a view point to a content point (in the browser this is
 * pdf.js `viewport.convertToPdfPoint`, which is correct for any /Rotate). We then
 * derive the box origin, size and rotation from the converted corners. This works
 * for 0/90/180/270 pages and keeps the math in one tested place.
 */

export type ToPdfPoint = (vx: number, vy: number) => [number, number];

export interface BoxPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  /** rotation for pdf-lib `degrees(...)`, snapped to 0/90/180/270 */
  rotateDeg: number;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Snap an angle (degrees) to the nearest right angle to absorb float fuzz. */
export function snapRightAngle(deg: number): number {
  const norm = ((deg % 360) + 360) % 360;
  const snapped = Math.round(norm / 90) * 90;
  return snapped % 360;
}

/**
 * Convert a view-space, axis-aligned rectangle (top-left x,y,w,h) into a
 * pdf-lib placement (content-space origin + size + rotation).
 *
 * The origin is the content image of the rectangle's *visual bottom-left* corner,
 * which is exactly the anchor pdf-lib expects for a box that is then rotated.
 */
export function placeBox(toPdfPoint: ToPdfPoint, x: number, y: number, w: number, h: number): BoxPlacement {
  const bl = toPdfPoint(x, y + h); // visual bottom-left
  const br = toPdfPoint(x + w, y + h); // visual bottom-right
  const tl = toPdfPoint(x, y); // visual top-left

  const width = dist(bl[0], bl[1], br[0], br[1]);
  const height = dist(bl[0], bl[1], tl[0], tl[1]);
  const rotateDeg = snapRightAngle((Math.atan2(br[1] - bl[1], br[0] - bl[0]) * 180) / Math.PI);

  return { x: bl[0], y: bl[1], width, height, rotateDeg };
}

/** Angle (snapped degrees) of the view-space +x direction, in content space. */
export function axisAngleDeg(toPdfPoint: ToPdfPoint, x: number, y: number): number {
  const a = toPdfPoint(x, y);
  const b = toPdfPoint(x + 1, y);
  return snapRightAngle((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI);
}

/**
 * Build a view→content transform from the page's *unrotated* size and total
 * rotation. Derived (and unit-tested) for all four right angles:
 *
 *   rot=0:   cx = vx,       cy = Hu - vy
 *   rot=90:  cx = vy,       cy = vx
 *   rot=180: cx = Wu - vx,  cy = vy
 *   rot=270: cx = Wu - vy,  cy = Hu - vx
 *
 * `Wu`/`Hu` are the MediaBox width/height (NOT swapped for rotation); `rotation`
 * is the page's clockwise display rotation in degrees.
 */
export function makeToPdfPoint(unrotatedWidth: number, unrotatedHeight: number, rotation: number): ToPdfPoint {
  const Wu = unrotatedWidth;
  const Hu = unrotatedHeight;
  const rot = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
  switch (rot) {
    case 90:
      return (vx, vy) => [vy, vx];
    case 180:
      return (vx, vy) => [Wu - vx, vy];
    case 270:
      return (vx, vy) => [Wu - vy, Hu - vx];
    case 0:
    default:
      return (vx, vy) => [vx, Hu - vy];
  }
}

/** A simple rot-0 mapping for environments without a pdf.js viewport (tests). */
export function topLeftToBottomLeft(pageHeight: number): ToPdfPoint {
  return (vx, vy) => [vx, pageHeight - vy];
}
