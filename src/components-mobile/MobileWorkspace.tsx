import './mobile.css';
import { useEffect } from 'react';
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

  // The layers overview is just one of the single-value mobile sheets, but the shared
  // ElementsPanel renders only when elementsPanelOpen is set (and that flag also lights up
  // the canvas element outlines). Mirror the two so exactly one sheet is ever open.
  useEffect(() => {
    setElementsPanel(sheet === 'layers');
  }, [sheet, setElementsPanel]);

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
