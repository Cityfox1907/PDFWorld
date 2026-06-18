import { useEffect } from 'react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { TopBar } from './TopBar';
import { ToolRail } from './ToolRail';
import { PageSidebar } from './PageSidebar';
import { ElementsPanel } from './ElementsPanel';
import { PageCanvas } from './PageCanvas';
import { Inspector } from './Inspector';
import { SignatureModal } from './SignatureModal';
import { ImageEditorModal } from './ImageEditor';
import { SaveDialog } from './SaveDialog';
import { PageOrganizer } from './PageOrganizer';

export function Workspace() {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const setTool = useStore((s) => s.setTool);
  const selectedElementId = useStore((s) => s.selectedElementId);
  const currentPageId = useStore((s) => s.currentPageId);
  const deleteElement = useStore((s) => s.deleteElement);
  const duplicateElement = useStore((s) => s.duplicateElement);
  const copyElement = useStore((s) => s.copyElement);
  const pasteElement = useStore((s) => s.pasteElement);
  const openSaveDialog = useUI((s) => s.openSaveDialog);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While a modal editor owns the keyboard, suspend global shortcuts so e.g. undo
      // can't mutate the page underneath the open image editor.
      if (useStore.getState().imageEditor || useUI.getState().signatureOpen) return;
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
      // Element clipboard / duplicate (only outside text inputs, so editing keeps the
      // browser's own copy/paste). Cut = copy + remove.
      if (mod && currentPageId) {
        const k = e.key.toLowerCase();
        if (k === 'c' && selectedElementId) {
          e.preventDefault();
          copyElement(currentPageId, selectedElementId);
          return;
        }
        if (k === 'x' && selectedElementId) {
          e.preventDefault();
          copyElement(currentPageId, selectedElementId);
          deleteElement(currentPageId, selectedElementId);
          return;
        }
        if (k === 'd' && selectedElementId) {
          e.preventDefault();
          duplicateElement(currentPageId, selectedElementId);
          return;
        }
        if (k === 'v') {
          e.preventDefault();
          pasteElement(currentPageId);
          return;
        }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementId && currentPageId) {
        e.preventDefault();
        deleteElement(currentPageId, selectedElementId);
        return;
      }
      const map: Record<string, Parameters<typeof setTool>[0]> = {
        v: 'select',
        e: 'edit-text',
        t: 'text',
        x: 'cut',
        c: 'brush',
        h: 'highlight',
        d: 'draw',
        r: 'rect',
        o: 'ellipse',
        b: 'redact',
      };
      const tool = map[e.key.toLowerCase()];
      if (tool && !mod) setTool(tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, setTool, selectedElementId, currentPageId, deleteElement, duplicateElement, copyElement, pasteElement, openSaveDialog]);

  return (
    <div className="workspace">
      <TopBar />
      <div className="workspace-body">
        <PageSidebar />
        <ToolRail />
        <ElementsPanel />
        <PageCanvas />
        <Inspector />
      </div>
      <SignatureModal />
      <ImageEditorModal />
      <SaveDialog />
      <PageOrganizer />
    </div>
  );
}
