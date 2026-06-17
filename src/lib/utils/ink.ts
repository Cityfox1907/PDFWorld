/**
 * SVG `stroke-dasharray` for a freehand stroke style, mirroring the export's
 * {@link dashArrayFor} so the on-screen preview matches the baked PDF exactly.
 * `scaledWidth` is the stroke width already multiplied by the view scale (px), so the
 * pattern stays proportional at any zoom. 'dotted' pairs with a round line cap to draw
 * round dots (a zero-length dash + gap). Returns undefined for a solid line.
 */
export function inkDashArray(
  dash: 'solid' | 'dashed' | 'dotted' | undefined,
  scaledWidth: number,
): string | undefined {
  const w = Math.max(0.5, scaledWidth);
  if (dash === 'dashed') return `${w * 2.6} ${w * 2}`;
  if (dash === 'dotted') return `0 ${w * 1.8}`;
  return undefined;
}
