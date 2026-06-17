import { useStore } from '../state/store';
import type { AnyElement, ElementPatch, TextElement } from '../lib/pdf';
import { FontPicker } from './FontPicker';
import { ColorPicker } from './ColorPicker';
import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, Copy, BringToFront, SendToBack, Trash2, Type, RotateCw, Lock, Unlock } from 'lucide-react';

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
  const addRecentColor = useStore((s) => s.addRecentColor);
  const showToast = useStore((s) => s.showToast);

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
          {el.type === 'text' && <TextProps el={el} set={set} />}
          {el.type === 'rect' && <ShapeProps el={el} set={set} radius />}
          {el.type === 'ellipse' && <ShapeProps el={el} set={set} />}
          {el.type === 'highlight' && (
            <Group title="Markierung">
              <Row>
                <label>Farbe</label>
                <ColorPicker title="Markierungsfarbe" value={el.color} onChange={(c) => set({ color: c })} />
              </Row>
            </Group>
          )}
          {el.type === 'ink' && (
            <Group title={el.highlight ? 'Markierung' : 'Zeichnung'}>
              <Row>
                <label>Farbe</label>
                <ColorPicker title={el.highlight ? 'Markierungsfarbe' : 'Linienfarbe'} value={el.color} onChange={(c) => set({ color: c })} />
                <label>Stärke</label>
                <input
                  type="range"
                  min={el.highlight ? 6 : 1}
                  max={el.highlight ? 48 : 12}
                  step={el.highlight ? 1 : 0.5}
                  value={el.strokeWidth}
                  onChange={(e) => set({ strokeWidth: Number(e.target.value) }, false)}
                  onMouseUp={commit}
                />
              </Row>
            </Group>
          )}

          <Group title="Drehung">
            <Row>
              <RotateCw size={15} />
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={Math.round(el.rotation ?? 0)}
                onChange={(e) => set({ rotation: Number(e.target.value) }, false)}
                onMouseUp={commit}
                onTouchEnd={commit}
              />
              <span className="insp-val">{Math.round(el.rotation ?? 0)}°</span>
            </Row>
            <Row>
              <input
                className="field field-sm"
                type="number"
                min={-180}
                max={180}
                value={Math.round(el.rotation ?? 0)}
                onChange={(e) => set({ rotation: Number(e.target.value) })}
              />
              <button className="btn ghost" onClick={() => set({ rotation: 0 })}>
                Zurücksetzen
              </button>
            </Row>
          </Group>

          <Group title="Aktionen">
            <div className="insp-actions">
              <button className="btn ghost" onClick={() => set({ locked: !el.locked })}>
                {el.locked ? <Unlock size={15} /> : <Lock size={15} />} {el.locked ? 'Entsperren' : 'Sperren'}
              </button>
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
            <FontPicker value={tool.textFamily} onChange={(textFamily) => setToolDefaults({ textFamily })} />
          </Row>
          <Row>
            <label>Grösse</label>
            <input className="field field-sm" type="number" min={4} max={400} value={tool.textSize} onChange={(e) => setToolDefaults({ textSize: Number(e.target.value) })} />
            <label>Farbe</label>
            <ColorPicker title="Schriftfarbe" value={tool.textColor} onChange={(c) => setToolDefaults({ textColor: c })} />
          </Row>
          <p className="insp-hint">Standard: <strong>Grösse 9</strong>, Schwarz. Auf die Seite klicken, um Text einzufügen.</p>
        </Group>
      );
    }
    if (activeTool === 'highlight') {
      return (
        <Group title="Markieren">
          <Row>
            <label>Form</label>
            <div className="seg insp-seg">
              <button className={`seg-btn ${tool.highlightMode === 'rect' ? 'active' : ''}`} onClick={() => setToolDefaults({ highlightMode: 'rect' })}>
                Rechteck
              </button>
              <button className={`seg-btn ${tool.highlightMode === 'brush' ? 'active' : ''}`} onClick={() => setToolDefaults({ highlightMode: 'brush' })}>
                Stift
              </button>
            </div>
          </Row>
          <Row>
            <label>Farbe</label>
            <ColorPicker title="Markierungsfarbe" value={tool.highlightColor} onChange={(c) => setToolDefaults({ highlightColor: c })} />
          </Row>
          {tool.highlightMode === 'brush' && (
            <Row>
              <label>Stärke</label>
              <input type="range" min={6} max={48} step={1} value={tool.highlightWidth} onChange={(e) => setToolDefaults({ highlightWidth: Number(e.target.value) })} />
              <span className="insp-val">{Math.round(tool.highlightWidth)}</span>
            </Row>
          )}
          <p className="insp-hint">
            {tool.highlightMode === 'brush'
              ? 'Wie ein Textmarker frei über den Text zeichnen – die ovale Spitze hinterlässt eine durchscheinende Spur.'
              : 'Über Text ziehen, um ihn rechteckig zu markieren.'}
          </p>
        </Group>
      );
    }
    if (activeTool === 'draw') {
      return (
        <Group title="Zeichnen">
          <Row>
            <label>Farbe</label>
            <ColorPicker title="Linienfarbe" value={tool.drawColor} onChange={(c) => setToolDefaults({ drawColor: c })} />
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
            <ColorPicker title="Füllfarbe" value={tool.shapeFill} onChange={(c) => setToolDefaults({ shapeFill: c })} />
            <label>Rand</label>
            <ColorPicker title="Randfarbe" value={tool.shapeStroke} onChange={(c) => setToolDefaults({ shapeStroke: c })} />
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
    if (activeTool === 'cut') {
      return (
        <Group title="Bereich duplizieren">
          <p className="insp-hint">
            Ziehe ein Rechteck auf: der Bereich wird in <strong>voller Originalqualität
            (1:1)</strong> dupliziert und als frei verschiebbares Stück eingefügt (direkt
            angewählt). Das <strong>Original bleibt vollständig erhalten</strong> – nichts
            wird herausgeschnitten oder überdeckt. Das Stück lässt sich verschieben,
            <strong> duplizieren</strong> (⌘/Strg + D) und <strong>kopieren</strong>
            (⌘/Strg + C · V).
          </p>
        </Group>
      );
    }
    if (activeTool === 'brush') {
      return (
        <Group title="Hintergrund-Pinsel">
          <Row>
            <label>Form</label>
            <div className="seg insp-seg">
              <button className={`seg-btn ${tool.brushMode === 'brush' ? 'active' : ''}`} onClick={() => setToolDefaults({ brushMode: 'brush' })}>
                Pinsel
              </button>
              <button className={`seg-btn ${tool.brushMode === 'rect' ? 'active' : ''}`} onClick={() => setToolDefaults({ brushMode: 'rect' })}>
                Rechteck
              </button>
            </div>
          </Row>
          {tool.brushMode === 'brush' && (
            <Row>
              <label>Stärke</label>
              <input
                type="range"
                min={4}
                max={64}
                step={1}
                value={tool.brushWidth}
                onChange={(e) => setToolDefaults({ brushWidth: Number(e.target.value) })}
              />
              <span className="insp-val">{Math.round(tool.brushWidth)}</span>
            </Row>
          )}
          <Row>
            <label>Aufgenommen</label>
            <span className="swatch-preview" style={{ background: tool.brushColor }} />
            <span className="insp-hint" style={{ margin: 0 }}>{tool.brushColor}</span>
          </Row>
          <button
            className="btn ghost insp-wide"
            onClick={() => {
              setToolDefaults({ textColor: tool.brushColor });
              addRecentColor(tool.brushColor);
              showToast('Pinsel-Farbe für neuen Text übernommen', 'success');
            }}
            title="Die zuletzt aufgenommene Farbe als Schriftfarbe verwenden"
          >
            <Type size={15} /> Farbe für Text übernehmen
          </button>
          <p className="insp-hint">
            {tool.brushMode === 'rect'
              ? 'Ziehe ein Rechteck auf – es wird randlos mit der Hintergrundfarbe direkt unter dem Startpunkt gefüllt und deckt den Bereich unsichtbar ab.'
              : 'Male über eine Stelle — der Pinsel nimmt automatisch die exakte Hintergrundfarbe direkt darunter auf und überdeckt den Inhalt unsichtbar.'}{' '}
            Die aufgenommene Farbe landet auch in der Farbauswahl unter „Zuletzt verwendet“.
          </p>
        </Group>
      );
    }
    if (activeTool === 'edit-text') {
      return (
        <Group title="Text scannen">
          <p className="insp-hint">
            Erkannte Textzeilen werden markiert. Klicke auf eine Zeile, um ihre echte
            Schrift zu sehen — Name, Grösse, Stil, Farbe und ob die Originalschrift
            eingebettet ist. Mit <strong>„In dieser Schrift schreiben“</strong> wird ein
            leeres Textfeld in <strong>exakt dieser Schrift</strong> (Grösse, Fett/Kursiv,
            Farbe) eingefügt — ohne Hintergrund-Abdeckung, direkt zum Tippen.
          </p>
          <p className="insp-hint">
            Tipp: Mit den Pfeiltasten verschiebst du ein Feld Pixel für Pixel. Liegt die
            Grundlinie der Buchstaben exakt auf einer Nachbarzeile, erscheint kurz eine
            Hilfslinie als Sichthilfe – ohne Magnet-Effekt.
          </p>
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
  // Picking a font or toggling weight/style is an explicit override, so drop the
  // captured original-font binding and let the chosen family/style take effect.
  return (
    <Group title="Text">
      <Row>
        <FontPicker value={el.family} onChange={(family) => set({ family, embeddedFontId: undefined })} />
      </Row>
      {el.embeddedFontId && <p className="insp-hint" style={{ margin: '0 0 2px' }}>✓ Originalschrift des Dokuments (1:1)</p>}
      <Row>
        <input className="field field-sm" type="number" min={4} max={400} value={el.size} onChange={(e) => set({ size: Number(e.target.value) })} />
        <ColorPicker title="Schriftfarbe" value={el.color} onChange={(c) => set({ color: c })} />
        <button className={`btn icon ${el.bold ? 'primary' : 'ghost'}`} onClick={() => set({ bold: !el.bold, embeddedFontId: undefined })} title="Fett">
          <Bold size={15} />
        </button>
        <button className={`btn icon ${el.italic ? 'primary' : 'ghost'}`} onClick={() => set({ italic: !el.italic, embeddedFontId: undefined })} title="Kursiv">
          <Italic size={15} />
        </button>
      </Row>
      <Row>
        <button className={`btn icon ${el.align === 'left' ? 'primary' : 'ghost'}`} onClick={() => set({ align: 'left' })} title="Linksbündig">
          <AlignLeft size={15} />
        </button>
        <button className={`btn icon ${el.align === 'center' ? 'primary' : 'ghost'}`} onClick={() => set({ align: 'center' })} title="Zentriert">
          <AlignCenter size={15} />
        </button>
        <button className={`btn icon ${el.align === 'right' ? 'primary' : 'ghost'}`} onClick={() => set({ align: 'right' })} title="Rechtsbündig">
          <AlignRight size={15} />
        </button>
      </Row>
      {el.coverColor && (
        <Row>
          <label>Hintergrund</label>
          <ColorPicker title="Hintergrund-Abdeckung" value={el.coverColor} onChange={(c) => set({ coverColor: c })} />
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
        <ColorPicker title="Füllfarbe" value={el.fill ?? '#ffffff'} onChange={(c) => set({ fill: c })} />
        <button className="btn ghost" onClick={() => set({ fill: null })}>
          ohne
        </button>
      </Row>
      <Row>
        <label>Rand</label>
        <ColorPicker title="Randfarbe" value={el.stroke ?? '#111111'} onChange={(c) => set({ stroke: c })} />
        <input className="field field-sm" type="number" min={0} max={20} value={el.strokeWidth} onChange={(e) => set({ strokeWidth: Number(e.target.value) })} />
      </Row>
      {radius && el.type === 'rect' && (
        <Row>
          <label>Radius</label>
          <input className="field field-sm" type="number" min={0} max={60} value={el.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
        </Row>
      )}
    </Group>
  );
}
