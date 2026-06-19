import './mobile.css';
import { useEffect } from 'react';
import { useStore, MAX_ZOOM, MIN_ZOOM } from '../state/store';
import { useUI } from '../state/ui';
import { useMobileUi } from './mobileUi';
// Reused engine-level components — shared, unmodified, identical behaviour to desktop.
import { PageCanvas } from '../components/PageCanvas';
import { Inspector } from '../components/Inspector';
import { ElementsPanel } from '../components/ElementsPanel';
import { SignatureModal } from '../components/SignatureModal';
import { ImageEditorModal } from '../components/ImageEditor';
import { SaveDialog } from '../components/SaveDialog';
import { PageOrganizer } from '../components/PageOrganizer';
// Mobile-only chrome.
import { MobileTopBar } from './MobileTopBar';
import { MobileDock } from './MobileDock';
import { MobileContextBar } from './MobileContextBar';
import { MobilePageNav } from './MobilePageNav';
import { MobileSheet } from './MobileSheet';
import { MobileMenu } from './MobileMenu';
import { MobileShapesSheet } from './MobileShapesSheet';

/**
 * The touch-first shell. It wraps the shared, unmodified PageCanvas (which is already
 * pointer/pinch driven) with mobile chrome — a compact header, a scrolling tool dock, a
 * contextual action strip and bottom sheets that host the very same Inspector, layers
 * panel and modals the desktop uses. The desktop Workspace is never mounted here, so the
 * web experience is left exactly as it was.
 */
export function MobileWorkspace() {
  const sheet = useMobileUi((s) => s.sheet);
  const closeSheet = useMobileUi((s) => s.close);
  const setElementsPanel = useUI((s) => s.setElementsPanel);
  const setZoomLimits = useStore((s) => s.setZoomLimits);

  // The layers overview is just one of the single-value mobile sheets, but the shared
  // ElementsPanel renders only when elementsPanelOpen is set (and that flag also lights up
  // the canvas element outlines). Mirror the two so exactly one sheet is ever open.
  useEffect(() => {
    setElementsPanel(sheet === 'layers');
  }, [sheet, setElementsPanel]);

  // On a phone, "fit to screen" (zoom = 1) is the smallest sensible magnification — a
  // page pinched any smaller is just a useless speck floating in grey. So clamp the
  // lower bound to 1 here (restored to the desktop 25 % when this shell unmounts).
  useEffect(() => {
    setZoomLimits(1, MAX_ZOOM);
    return () => setZoomLimits(MIN_ZOOM, MAX_ZOOM);
  }, [setZoomLimits]);

  // Kill the browser's OWN pinch / double-tap / gesture zoom so only the document
  // magnifies (via the canvas's JS pinch), never the toolbar or tabs. iOS Safari fires
  // gesture* events for native zoom; suppressing them — plus any 2-finger move that the
  // canvas itself didn't already claim — keeps the app chrome rock-steady.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    const onTouchMove = (e: TouchEvent) => {
      // The canvas runs its own pinch-zoom (and calls preventDefault there); everywhere
      // else a second finger must not zoom the page.
      if (e.touches.length > 1) {
        const target = e.target as Element | null;
        if (!target || !target.closest('.canvas-area')) e.preventDefault();
      }
    };
    document.addEventListener('gesturestart', stop as EventListener);
    document.addEventListener('gesturechange', stop as EventListener);
    document.addEventListener('gestureend', stop as EventListener);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      document.removeEventListener('gesturestart', stop as EventListener);
      document.removeEventListener('gesturechange', stop as EventListener);
      document.removeEventListener('gestureend', stop as EventListener);
      document.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  return (
    <div className="m-app">
      <MobileTopBar />

      <div className="m-canvas">
        <PageCanvas />
        <MobilePageNav />
      </div>

      <MobileContextBar />
      <MobileDock />

      {/* Element / tool properties — hosts the shared Inspector verbatim. */}
      <MobileSheet open={sheet === 'props'} onClose={closeSheet} height="tall">
        <Inspector />
      </MobileSheet>

      {/* Shapes picker. */}
      <MobileShapesSheet open={sheet === 'shapes'} onClose={closeSheet} />

      {/* Overflow menu. */}
      <MobileMenu open={sheet === 'menu'} onClose={closeSheet} />

      {/* Layers overview — hosts the shared ElementsPanel (kept in sync above). */}
      <MobileSheet open={sheet === 'layers'} onClose={closeSheet} height="tall">
        <ElementsPanel />
      </MobileSheet>

      {/* Shared modals / full-screen organiser — already overlay-based. */}
      <SignatureModal />
      <ImageEditorModal />
      <SaveDialog />
      <PageOrganizer />
    </div>
  );
}
