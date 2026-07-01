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
  const deleteElements = useStore((s) => s.deleteElements);
  const duplicateElements = useStore((s) => s.duplicateElements);
  const copyElements = useStore((s) => s.copyElements);
  const pasteClipboard = useStore((s) => s.pasteClipboard);
  const selectElement = useStore((s) => s.selectElement);
  const openSaveDialog = useUI((s) => s.openSaveDialog);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While a modal owns the keyboard, suspend global shortcuts entirely — otherwise
      // Delete removes an element behind the organizer, tool hotkeys switch tools under
      // the save dialog, and undo mutates the page below the image editor.
      const ui = useUI.getState();
      if (useStore.getState().imageEditor || ui.signatureOpen || ui.saveDialogOpen || ui.organizerOpen) return;
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      const mod = e.metaKey || e.ctrlKey;

      // Save always works — it never conflicts with text editing.
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        openSaveDialog();
        return;
      }
      // While typing, the browser's own editing shortcuts (incl. its Cmd+Z text undo)
      // must win — a document-wide undo mid-sentence would silently revert real edits.
      if (typing) return;

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
      // Element clipboard / duplicate — all honour the full multi-selection, exactly
      // like Delete does. Cut = copy + remove.
      const selIds = useStore.getState().selectedElementIds;
      if (mod && currentPageId) {
        const k = e.key.toLowerCase();
        if (k === 'c' && selIds.length) {
          e.preventDefault();
          copyElements(currentPageId, selIds);
          return;
        }
        if (k === 'x' && selIds.length) {
          e.preventDefault();
          copyElements(currentPageId, selIds);
          deleteElements(currentPageId, selIds);
          return;
        }
        if (k === 'd' && selIds.length) {
          e.preventDefault();
          duplicateElements(currentPageId, selIds);
          return;
        }
        if (k === 'v') {
          e.preventDefault();
          pasteClipboard(currentPageId);
          return;
        }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selIds.length && currentPageId) {
        e.preventDefault();
        if (selIds.length > 1) deleteElements(currentPageId, selIds);
        else deleteElement(currentPageId, selIds[0]);
        return;
      }
      // Escape: clear the selection first; with nothing selected, return to Auswählen.
      if (e.key === 'Escape') {
        if (selIds.length) selectElement(null);
        else setTool('select');
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
  }, [undo, redo, setTool, selectedElementId, currentPageId, deleteElement, deleteElements, duplicateElements, copyElements, pasteClipboard, selectElement, openSaveDialog]);

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
