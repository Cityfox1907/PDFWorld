/**
 * A tiny bridge so chrome outside the canvas (the TopBar zoom buttons) can drive the
 * canvas's own zoom-around logic, which alone knows the scroll viewport and the page
 * placement. PageCanvas registers `zoomByCenter` on mount; the buttons call it. This
 * keeps the magnification anchored on the centre of the visible window instead of the
 * page's top-left, so the document no longer drifts to the bottom-right while zooming.
 */
export const viewportBridge: {
  /** Zoom by `factor`, keeping the centre of the visible window stationary. */
  zoomByCenter?: (factor: number) => void;
} = {};
