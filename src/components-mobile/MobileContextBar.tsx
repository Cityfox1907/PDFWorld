import { useStore, type ToolId } from '../state/store';
import { useMobileUi } from './mobileUi';
import { SlidersHorizontal, Copy, Trash2, Layers } from 'lucide-react';

// Tools whose behaviour is shaped by options in the inspector (colour, size, mode …).
const TOOLS_WITH_OPTIONS: Partial<Record<ToolId, string>> = {
  text: 'Text',
  callout: 'Sprechblase',
  highlight: 'Marker',
  draw: 'Zeichnen',
  rect: 'Rechteck',
  ellipse: 'Ellipse',
  shape: 'Form',
  cut: 'Ausschneiden',
  brush: 'Pinsel',
};

/**
 * A contextual strip that appears just above the tool dock. It surfaces the most likely
 * next action without opening a sheet: edit a selected element's properties, duplicate or
 * delete it, or open the active tool's options. It taps the same store actions the desktop
 * inspector uses, so behaviour stays identical.
 */
export function MobileContextBar() {
  const selectedId = useStore((s) => s.selectedElementId);
  const selectedIds = useStore((s) => s.selectedElementIds);
  const currentPageId = useStore((s) => s.currentPageId);
  const activeTool = useStore((s) => s.activeTool);
  const deleteElement = useStore((s) => s.deleteElement);
  const deleteElements = useStore((s) => s.deleteElements);
  const duplicateElement = useStore((s) => s.duplicateElement);
  const openSheet = useMobileUi((s) => s.open);

  const openProps = () => openSheet('props');

  if (selectedIds.length > 1 && currentPageId) {
    return (
      <div className="m-context">
        <span className="m-context-label">
          <Layers size={16} /> {selectedIds.length} Elemente
        </span>
        <div className="m-context-actions">
          <button className="m-ctx-btn" onClick={openProps}>
            <SlidersHorizontal size={17} /> Bearbeiten
          </button>
          <button className="m-ctx-btn danger" onClick={() => deleteElements(currentPageId, selectedIds)}>
            <Trash2 size={17} /> Löschen
          </button>
        </div>
      </div>
    );
  }

  if (selectedId && currentPageId) {
    return (
      <div className="m-context">
        <button className="m-ctx-btn primary" onClick={openProps}>
          <SlidersHorizontal size={17} /> Eigenschaften
        </button>
        <div className="m-context-actions">
          <button className="m-ctx-btn" onClick={() => duplicateElement(currentPageId, selectedId)} aria-label="Duplizieren">
            <Copy size={17} />
          </button>
          <button className="m-ctx-btn danger" onClick={() => deleteElement(currentPageId, selectedId)} aria-label="Löschen">
            <Trash2 size={17} />
          </button>
        </div>
      </div>
    );
  }

  const optionLabel = TOOLS_WITH_OPTIONS[activeTool];
  if (optionLabel) {
    return (
      <div className="m-context">
        <button className="m-ctx-btn primary wide" onClick={openProps}>
          <SlidersHorizontal size={17} /> {optionLabel} · Optionen
        </button>
      </div>
    );
  }

  return null;
}
