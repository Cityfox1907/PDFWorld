import { useStore } from '../state/store';
import type { AnyElement, ElementPatch, TextElement, FontFamilyKey } from '../lib/pdf';
import { FormPanel } from './FormPanel';
import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, Copy, BringToFront, SendToBack, Trash2 } from 'lucide-react';

const FAMILIES: { id: FontFamilyKey; label: string }[] = [
  { id: 'sans', label: 'Sans (Helvetica/Arial)' },
  { id: 'serif', label: 'Serif (Times)' },
  { id: 'mono', label: 'Mono (Courier)' },
];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="insp-group">
      <div className="insp-title">{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="insp-row">{children}</div>;
}

export function Inspector() {
  const activeTool = useStore((s) => s.activeTool);
  const pages = useStore((s) => s.pages);
  const currentPageId = useStore((s) => s.currentPageId);
  const selectedId = useStore((s) => s.selectedElementId);
  const updateElement = useStore((s) => s.updateElement);
  const deleteElement = useStore((s) => s.deleteElement);
  const duplicateElement = useStore((s) => s.duplicateElement);
  const reorderElement = useStore((s) => s.reorderElement);
  const commit = useStore((s) => s.commit);
  const tool = useStore((s) => s.tool);
  const setToolDefaults = useStore((s) => s.setToolDefaults);

  if (activeTool === 'forms') {
    return (
      <aside className="inspector">
        <FormPanel />
      </aside>
    );
  }

  const page = pages.find((p) => p.id === currentPageId);
  const el = page?.elements.find((e) => e.id === selectedId) ?? null;

  const set = (patch: ElementPatch, doCommit = true) => {
    if (!page || !el) return;
    updateElement(page.id, el.id, patch);
    if (doCommit) commit();
  };

  return (
    <aside className="inspector">
      {!el && <ToolSettings />}

      {el && (
        <>
          <Group title="Position & Grösse">
            <Row>
              <label>X</label>
              <input className="field" type="number" value={Math.round(el.x)} onChange={(e) => set({ x: Number(e.target.value) }, false)} onBlur={commit} />
              <label>Y</label>
              <input className="field" type="number" value={Math.round(el.y)} onChange={(e) => set({ y: Number(e.target.value) }, false)} onBlur={commit} />
            </Row>
            <Row>
              <label>B</label>
              <input className="field" type="number" value={Math.round(el.width)} onChange={(e) => set({ width: Number(e.target.value) }, false)} onBlur={commit} />
              <label>H</label>
              <input className="field" type="number" value={Math.round(el.height)} onChange={(e) => set({ height: Number(e.target.value) }, false)} onBlur={commit} />
            </Row>
            <Row>
              <label>Deckkraft</label>
              <input type="range" min={10} max={100} value={Math.round(el.opacity * 100)} onChange={(e) => set({ opacity: Number(e.target.value) / 100 }, false)} onMouseUp={commit} />
              <span className="insp-val">{Math.round(el.opacity * 100)}%</span>
            </Row>
          </Group>

          {el.type === 'text' && <TextProps el={el} set={set} />}
          {el.type === 'rect' && <ShapeProps el={el} set={set} radius />}
          {el.type === 'ellipse' && <ShapeProps el={el} set={set} />}
          {el.type === 'highlight' && (
            <Group title="Markierung">
              <Row>
                <label>Farbe</label>
                <input className="swatch" type="color" value={el.color} onChange={(e) => set({ color: e.target.value })} />
              </Row>
            </Group>
          )}
          {el.type === 'ink' && (
            <Group title="Zeichnung">
              <Row>
                <label>Farbe</label>
                <input className="swatch" type="color" value={el.color} onChange={(e) => set({ color: e.target.value })} />
                <label>Stärke</label>
                <input type="range" min={1} max={12} step={0.5} value={el.strokeWidth} onChange={(e) => set({ strokeWidth: Number(e.target.value) }, false)} onMouseUp={commit} />
              </Row>
            </Group>
          )}

          <Group title="Aktionen">
            <div className="insp-actions">
              <button className="btn ghost" onClick={() => page && duplicateElement(page.id, el.id)}>
                <Copy size={15} /> Duplizieren
              </button>
              <button className="btn ghost" onClick={() => page && reorderElement(page.id, el.id, 'front')}>
                <BringToFront size={15} /> Vorne
              </button>
              <button className="btn ghost" onClick={() => page && reorderElement(page.id, el.id, 'back')}>
                <SendToBack size={15} /> Hinten
              </button>
              <button className="btn ghost danger" onClick={() => page && deleteElement(page.id, el.id)}>
                <Trash2 size={15} /> Löschen
              </button>
            </div>
          </Group>
        </>
      )}
    </aside>
  );

  function ToolSettings() {
    if (activeTool === 'text') {
      return (
        <Group title="Text-Werkzeug">
          <Row>
            <label>Schrift</label>
            <select className="field" value={tool.textFamily} onChange={(e) => setToolDefaults({ textFamily: e.target.value as FontFamilyKey })}>
              {FAMILIES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </Row>
          <Row>
            <label>Grösse</label>
            <input className="field" type="number" value={tool.textSize} onChange={(e) => setToolDefaults({ textSize: Number(e.target.value) })} />
            <label>Farbe</label>
            <input className="swatch" type="color" value={tool.textColor} onChange={(e) => setToolDefaults({ textColor: e.target.value })} />
          </Row>
          <p className="insp-hint">Auf die Seite klicken, um Text einzufügen.</p>
        </Group>
      );
    }
    if (activeTool === 'highlight') {
      return (
        <Group title="Markieren">
          <Row>
            <label>Farbe</label>
            <input className="swatch" type="color" value={tool.highlightColor} onChange={(e) => setToolDefaults({ highlightColor: e.target.value })} />
          </Row>
          <p className="insp-hint">Über Text ziehen, um ihn zu markieren.</p>
        </Group>
      );
    }
    if (activeTool === 'draw') {
      return (
        <Group title="Zeichnen">
          <Row>
            <label>Farbe</label>
            <input className="swatch" type="color" value={tool.drawColor} onChange={(e) => setToolDefaults({ drawColor: e.target.value })} />
            <label>Stärke</label>
            <input type="range" min={1} max={12} step={0.5} value={tool.drawWidth} onChange={(e) => setToolDefaults({ drawWidth: Number(e.target.value) })} />
          </Row>
        </Group>
      );
    }
    if (activeTool === 'rect' || activeTool === 'ellipse') {
      return (
        <Group title={activeTool === 'rect' ? 'Rechteck' : 'Ellipse'}>
          <Row>
            <label>Füllung</label>
            <input className="swatch" type="color" value={tool.shapeFill} onChange={(e) => setToolDefaults({ shapeFill: e.target.value })} />
            <label>Rand</label>
            <input className="swatch" type="color" value={tool.shapeStroke} onChange={(e) => setToolDefaults({ shapeStroke: e.target.value })} />
          </Row>
        </Group>
      );
    }
    if (activeTool === 'redact') {
      return (
        <Group title="Schwärzen">
          <p className="insp-hint">Ziehe einen Bereich, um ihn mit einem schwarzen Balken abzudecken.</p>
        </Group>
      );
    }
    if (activeTool === 'edit-text') {
      return (
        <Group title="Text bearbeiten">
          <p className="insp-hint">Klicke auf bestehenden Text in der Seite, um ihn zu ändern. Die Schrift wird automatisch erkannt.</p>
        </Group>
      );
    }
    return (
      <Group title="Auswahl">
        <p className="insp-hint">Wähle ein Werkzeug links oder klicke auf ein Element, um seine Eigenschaften zu bearbeiten.</p>
      </Group>
    );
  }
}

function TextProps({ el, set }: { el: TextElement; set: (p: ElementPatch) => void }) {
  return (
    <Group title="Text">
      <Row>
        <select className="field" value={el.family} onChange={(e) => set({ family: e.target.value as FontFamilyKey })}>
          {FAMILIES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </Row>
      <Row>
        <input className="field" type="number" value={el.size} onChange={(e) => set({ size: Number(e.target.value) })} />
        <input className="swatch" type="color" value={el.color} onChange={(e) => set({ color: e.target.value })} />
        <button className={`btn icon ${el.bold ? 'primary' : 'ghost'}`} onClick={() => set({ bold: !el.bold })}>
          <Bold size={15} />
        </button>
        <button className={`btn icon ${el.italic ? 'primary' : 'ghost'}`} onClick={() => set({ italic: !el.italic })}>
          <Italic size={15} />
        </button>
      </Row>
      <Row>
        <button className={`btn icon ${el.align === 'left' ? 'primary' : 'ghost'}`} onClick={() => set({ align: 'left' })}>
          <AlignLeft size={15} />
        </button>
        <button className={`btn icon ${el.align === 'center' ? 'primary' : 'ghost'}`} onClick={() => set({ align: 'center' })}>
          <AlignCenter size={15} />
        </button>
        <button className={`btn icon ${el.align === 'right' ? 'primary' : 'ghost'}`} onClick={() => set({ align: 'right' })}>
          <AlignRight size={15} />
        </button>
      </Row>
      {el.coverColor && (
        <Row>
          <label>Hintergrund</label>
          <input className="swatch" type="color" value={el.coverColor} onChange={(e) => set({ coverColor: e.target.value })} />
          <span className="insp-hint" style={{ margin: 0 }}>überdeckt das Original</span>
        </Row>
      )}
    </Group>
  );
}

function ShapeProps({ el, set, radius }: { el: Extract<AnyElement, { type: 'rect' | 'ellipse' }>; set: (p: ElementPatch) => void; radius?: boolean }) {
  return (
    <Group title={el.type === 'rect' ? 'Rechteck' : 'Ellipse'}>
      <Row>
        <label>Füllung</label>
        <input className="swatch" type="color" value={el.fill ?? '#ffffff'} onChange={(e) => set({ fill: e.target.value })} />
        <button className="btn ghost" onClick={() => set({ fill: null })}>
          ohne
        </button>
      </Row>
      <Row>
        <label>Rand</label>
        <input className="swatch" type="color" value={el.stroke ?? '#111111'} onChange={(e) => set({ stroke: e.target.value })} />
        <input className="field" type="number" min={0} max={20} value={el.strokeWidth} onChange={(e) => set({ strokeWidth: Number(e.target.value) })} />
      </Row>
      {radius && el.type === 'rect' && (
        <Row>
          <label>Radius</label>
          <input className="field" type="number" min={0} max={60} value={el.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
        </Row>
      )}
    </Group>
  );
}
