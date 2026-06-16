/**
 * Alignment helper for the editor: snap a moving text element onto the baseline of
 * a neighbouring line so side-by-side texts never look vertically offset.
 *
 * All values are in view-points (the editor's zoom-independent unit). `targets`
 * are candidate baselines (from scanned lines + other text boxes); `base` is the
 * moving element's current baseline. Returns the nearest baseline within
 * `threshold`, or null when nothing is close enough (so the move stays free).
 */
export function nearestBaseline(base: number, targets: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDist = threshold;
  for (const t of targets) {
    const d = Math.abs(t - base);
    if (d <= bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}
