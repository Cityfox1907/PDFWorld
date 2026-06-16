import { useStore } from './state/store';
import { Home } from './components/Home';
import { Workspace } from './components/Workspace';
import { Toast } from './components/Toast';

export function App() {
  const status = useStore((s) => s.status);
  return (
    <>
      {status === 'ready' ? <Workspace /> : <Home />}
      <Toast />
    </>
  );
}
