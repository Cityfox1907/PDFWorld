import { useStore } from './state/store';
import { Home } from './components/Home';
import { Workspace } from './components/Workspace';
import { Toast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useIsMobile } from './components-mobile/useIsMobile';
import { MobileWorkspace } from './components-mobile/MobileWorkspace';

export function App() {
  const status = useStore((s) => s.status);
  const isMobile = useIsMobile();
  // The editor gets a dedicated touch-first shell on phones / narrow viewports; the
  // desktop Workspace (and thus the established web experience) is left completely
  // unchanged. The start screen is shared — it is already responsive.
  // The ErrorBoundary wraps everything so a single render crash can never white-screen
  // the app or silently discard unsaved edits — the user can rescue their work first.
  return (
    <ErrorBoundary>
      {status === 'ready' ? isMobile ? <MobileWorkspace /> : <Workspace /> : <Home />}
      <Toast />
    </ErrorBoundary>
  );
}
