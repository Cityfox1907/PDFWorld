import { useEffect } from 'react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { TopBar } from './TopBar';
import { ToolRail } from './ToolRail';
import { PageSidebar } from './PageSidebar';
import { PageCanvas } from './PageCanvas';
import { Inspector } from './Inspector';
import { SignatureModal } from './SignatureModal';
import { SaveDialog } from './SaveDialog';
import { PageOrganizer } from './PageOrganizer';

export function Workspace() {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const setTool = useStore((s) => s.setTool);
  const selectedElementId = useStore((s) => s.selectedElementId);
  const currentPageId = useStore((s) => s.currentPageId);
  const deleteElement = useStore((s) => s.deleteElement);
  const openSaveDialog = useUI((s) => s.openSaveDialog);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        openSaveDialog();
        return;
      }
      if (typing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementId && currentPageId) {
        e.preventDefault();
        deleteElement(currentPageId, selectedElementId);
        return;
      }
      const map: Record<string, Parameters<typeof setTool>[0]> = {
        v: 'select',
        e: 'edit-text',
        t: 'text',
        c: 'brush',
        h: 'highlight',
        d: 'draw',
        r: 'rect',
        o: 'ellipse',
        b: 'redact',
      };
      const tool = map[e.key.toLowerCase()];
      if (tool) setTool(tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, setTool, selectedElementId, currentPageId, deleteElement, openSaveDialog]);

  return (
    <div className="workspace">
      <TopBar />
      <div className="workspace-body">
        <PageSidebar />
        <ToolRail />
        <PageCanvas />
        <Inspector />
      </div>
      <SignatureModal />
      <SaveDialog />
      <PageOrganizer />
    </div>
  );
}
