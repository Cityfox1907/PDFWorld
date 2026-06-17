import { useState } from 'react';
import { useStore, type ToolId, type ToolDefaults } from '../state/store';
import type { AnyElement, ElementPatch, TextElement, InkElement } from '../lib/pdf';
import { inkDashArray } from '../lib/utils/ink';
import { FontPicker } from './FontPicker';
import { ColorPicker } from './ColorPicker';
import {
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Copy,
  BringToFront,
  SendToBack,
  Trash2,
  Type,
  RotateCw,
  Lock,
  Unlock,
  Info,
  MousePointer2,
  ScanText,
  Scissors,
  Paintbrush,
  Highlighter,
  Pencil,
  Square,
  Circle,
  Eraser,
  Image as ImageIcon,
  PenTool,
  type LucideIcon,
} from 'lucide-react';

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="insp-group">
      {title && <div className="insp-title">{title}</div>}
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="insp-row">{children}</div>;
}

/** A live preview of the current pen/marker stroke. */
function StrokePreview({ color, width, opacity, dash, marker }: { color: string; width: number; opacity: number; dash: ToolDefaults['drawDash']; marker: boolean }) {
  const w = Math.min(Math.max(width, 1), 14);
  return (
    <div className="stroke-preview">
      <svg width="100%" height="30" viewBox="0 0 180 30" preserveAspectRatio="none" style={{ mixBlendMode: marker ? 'multiply' : undefined }}>
        <path
          d="M10 22 C 50 4, 95 30, 170 9"
          fill="none"
          stroke={color}
          strokeWidth={w}
          strokeOpacity={opacity}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={inkDashArray(marker ? 'solid' : dash, w)}
        />
      </svg>
    </div>
  );
}

/** Header showing the active context with an optional, tucked-away hint. */
function Header({ icon: Icon, title, tip }: { icon: LucideIcon; title: string; tip?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="insp-head">
      <div className="insp-head-row">
        <span className="insp-head-title">
          <Icon size={16} />
          {title}
        </span>
        {tip && (
          <button
            className={`insp-info ${open ? 'on' : ''}`}
            onClick={() => setOpen((v) => !v)}
            title="Hinweis ein-/ausblenden"
          >
            <Info size={15} />
          </button>
        )}
      </div>
      {tip && open && <p className="insp-tip">{tip}</p>}
    </div>
  );
}

const TOOL_META: Record<ToolId, { icon: LucideIcon; title: string; tip?: string }> = {
  select: { icon: MousePointer2, title: 'Auswählen', tip: 'Element anklicken, um es zu bearbeiten. Mit den Pfeiltasten verschiebst du es pixelgenau (Shift = 10 px).' },
  'edit-text': { icon: ScanText, title: 'Text scannen', tip: 'Auf eine erkannte Zeile klicken, ihre Schrift übernehmen und anschliessend an die gewünschte Stelle klicken, um in genau dieser Schrift zu schreiben.' },
  text: { icon: Type, title: 'Text einfügen', tip: 'Auf die Seite klicken, um ein Textfeld einzufügen. Es wächst beim Tippen mit.' },
  cut: { icon: Scissors, title: 'Bereich duplizieren', tip: 'Rechteck aufziehen — der Bereich wird in voller Qualität (1:1) dupliziert und frei verschiebbar eingefügt. Das Original bleibt erhalten.' },
  brush: { icon: Paintbrush, title: 'Hintergrund-Pinsel' },
  highlight: { icon: Highlighter, title: 'Markieren' },
  draw: { icon: Pencil, title: 'Zeichnen' },
  rect: { icon: Square, title: 'Rechteck', tip: 'Aufziehen, um ein Rechteck zu zeichnen.' },
  ellipse: { icon: Circle, title: 'Ellipse', tip: 'Aufziehen, um eine Ellipse zu zeichnen.' },
  redact: { icon: Eraser, title: 'Schwärzen', tip: 'Bereich aufziehen, um ihn mit einem schwarzen Balken abzudecken.' },
  image: { icon: ImageIcon, title: 'Bild' },
  signature: { icon: PenTool, title: 'Unterschrift' },
};

const ELEMENT_META: Record<AnyElement['type'], { icon: LucideIcon; title: string }> = {
  text: { icon: Type, title: 'Text' },
  rect: { icon: Square, title: 'Rechteck' },
  ellipse: { icon: Circle, title: 'Ellipse' },
  highlight: { icon: Highlighter, title: 'Markierung' },
  ink: { icon: Pencil, title: 'Zeichnung' },
  image: { icon: ImageIcon, title: 'Bild' },
  signature: { icon: PenTool, title: 'Unterschrift' },
};

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

  const page = pages.find((p) => p.id === currentPageId);
  const el = page?.elements.find((e) => e.id === selectedId) ?? null;

  const set = (patch: ElementPatch, doCommit = true) => {
    if (!page || !el) return;
    updateElement(page.id, el.id, patch);
    if (doCommit) commit();
  };

  if (el) {
    const meta = ELEMENT_META[el.type];
    const title = el.type === 'ink' && (el as InkElement).highlight ? 'Marker' : meta.title;
    return (
      <aside className="inspector">
        <Header icon={meta.icon} title={title} />
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
        {el.type === 'ink' && <InkProps el={el} set={set} commit={commit} />}

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
      </aside>
    );
  }

  const meta = TOOL_META[activeTool];
  return (
    <aside className="inspector">
      <Header icon={meta.icon} title={meta.title} tip={meta.tip} />
      <ToolSettings tool={tool} activeTool={activeTool} setToolDefaults={setToolDefaults} />
    </aside>
  );
}

function ToolSettings({
  tool,
  activeTool,
  setToolDefaults,
}: {
  tool: ToolDefaults;
  activeTool: ToolId;
  setToolDefaults: (patch: Partial<ToolDefaults>) => void;
}) {
  const addRecentColor = useStore((s) => s.addRecentColor);
  const showToast = useStore((s) => s.showToast);
  const pendingTextStyle = useStore((s) => s.pendingTextStyle);

  if (activeTool === 'text') {
    // A typeface armed from the scan panel takes over the next placement, so make that
    // unmistakable instead of showing the (now irrelevant) default font controls.
    if (pendingTextStyle) {
      return (
        <Group>
          <p className="insp-note">✓ Schrift übernommen{pendingTextStyle.embeddedFontId ? ' (Original 1:1)' : ''}</p>
          <p className="insp-tip" style={{ marginTop: 0 }}>
            Klicke auf die Stelle, an der das Textfeld in dieser Schrift eingefügt werden soll.
          </p>
        </Group>
      );
    }
    return (
      <Group>
        <Row>
          <FontPicker value={tool.textFamily} onChange={(textFamily) => setToolDefaults({ textFamily })} />
        </Row>
        <Row>
          <label>Grösse</label>
          <input className="field field-sm" type="number" min={4} max={400} value={tool.textSize} onChange={(e) => setToolDefaults({ textSize: Number(e.target.value) })} />
          <label>Farbe</label>
          <ColorPicker title="Schriftfarbe" value={tool.textColor} onChange={(c) => setToolDefaults({ textColor: c })} />
        </Row>
      </Group>
    );
  }

  if (activeTool === 'highlight') {
    return (
      <Group>
        <Row>
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
      </Group>
    );
  }

  if (activeTool === 'draw') {
    const marker = tool.drawStyle === 'marker';
    return (
      <Group>
        <Row>
          <div className="seg insp-seg">
            <button
              className={`seg-btn ${!marker ? 'active' : ''}`}
              onClick={() => setToolDefaults({ drawStyle: 'pen', drawOpacity: 1 })}
            >
              Stift
            </button>
            <button
              className={`seg-btn ${marker ? 'active' : ''}`}
              onClick={() => setToolDefaults({ drawStyle: 'marker', drawOpacity: 0.4 })}
            >
              Marker
            </button>
          </div>
        </Row>
        <Row>
          <label>Farbe</label>
          <ColorPicker title="Linienfarbe" value={tool.drawColor} onChange={(c) => setToolDefaults({ drawColor: c })} />
        </Row>
        <Row>
          <label>Stärke</label>
          <input type="range" min={1} max={24} step={0.5} value={tool.drawWidth} onChange={(e) => setToolDefaults({ drawWidth: Number(e.target.value) })} />
          <span className="insp-val">{tool.drawWidth.toFixed(1)}</span>
        </Row>
        <Row>
          <label>Deckkraft</label>
          <input type="range" min={0.1} max={1} step={0.05} value={tool.drawOpacity} onChange={(e) => setToolDefaults({ drawOpacity: Number(e.target.value) })} />
          <span className="insp-val">{Math.round(tool.drawOpacity * 100)}%</span>
        </Row>
        {!marker && (
          <Row>
            <label>Stil</label>
            <div className="seg insp-seg">
              {(['solid', 'dashed', 'dotted'] as const).map((d) => (
                <button key={d} className={`seg-btn ${tool.drawDash === d ? 'active' : ''}`} onClick={() => setToolDefaults({ drawDash: d })}>
                  {d === 'solid' ? 'Voll' : d === 'dashed' ? 'Strich' : 'Punkt'}
                </button>
              ))}
            </div>
          </Row>
        )}
        <StrokePreview color={tool.drawColor} width={tool.drawWidth} opacity={tool.drawOpacity} dash={tool.drawDash} marker={marker} />
      </Group>
    );
  }

  if (activeTool === 'rect' || activeTool === 'ellipse') {
    return (
      <Group>
        <Row>
          <label>Füllung</label>
          <ColorPicker title="Füllfarbe" value={tool.shapeFill} onChange={(c) => setToolDefaults({ shapeFill: c })} />
          <label>Rand</label>
          <ColorPicker title="Randfarbe" value={tool.shapeStroke} onChange={(c) => setToolDefaults({ shapeStroke: c })} />
        </Row>
      </Group>
    );
  }

  if (activeTool === 'brush') {
    return (
      <Group>
        <Row>
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
            <input type="range" min={4} max={64} step={1} value={tool.brushWidth} onChange={(e) => setToolDefaults({ brushWidth: Number(e.target.value) })} />
            <span className="insp-val">{Math.round(tool.brushWidth)}</span>
          </Row>
        )}
        <Row>
          <label>Aufgenommen</label>
          <span className="swatch-preview" style={{ background: tool.brushColor }} />
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
      </Group>
    );
  }

  // select / edit-text / cut / redact: no controls — the header (with its info toggle)
  // already says everything that used to be a wall of text.
  return null;
}

function TextProps({ el, set }: { el: TextElement; set: (p: ElementPatch) => void }) {
  // Picking a font or toggling weight/style is an explicit override, so drop the
  // captured original-font binding and let the chosen family/style take effect.
  return (
    <Group title="Schrift">
      <Row>
        <FontPicker value={el.family} onChange={(family) => set({ family, embeddedFontId: undefined })} />
      </Row>
      {el.embeddedFontId && <p className="insp-note">✓ Originalschrift des Dokuments (1:1)</p>}
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
        <div className="seg insp-seg">
          <button className={`seg-btn ${el.align === 'left' ? 'active' : ''}`} onClick={() => set({ align: 'left' })} title="Linksbündig">
            <AlignLeft size={15} />
          </button>
          <button className={`seg-btn ${el.align === 'center' ? 'active' : ''}`} onClick={() => set({ align: 'center' })} title="Zentriert">
            <AlignCenter size={15} />
          </button>
          <button className={`seg-btn ${el.align === 'right' ? 'active' : ''}`} onClick={() => set({ align: 'right' })} title="Rechtsbündig">
            <AlignRight size={15} />
          </button>
        </div>
      </Row>
      {el.coverColor && (
        <Row>
          <label>Hintergrund</label>
          <ColorPicker title="Hintergrund-Abdeckung" value={el.coverColor} onChange={(c) => set({ coverColor: c })} />
        </Row>
      )}
    </Group>
  );
}

function InkProps({ el, set, commit }: { el: InkElement; set: (p: ElementPatch, doCommit?: boolean) => void; commit: () => void }) {
  const marker = !!el.highlight;
  return (
    <Group title={marker ? 'Marker' : 'Zeichnung'}>
      <Row>
        <div className="seg insp-seg">
          <button className={`seg-btn ${!marker ? 'active' : ''}`} onClick={() => set({ highlight: false })}>
            Stift
          </button>
          <button className={`seg-btn ${marker ? 'active' : ''}`} onClick={() => set({ highlight: true })}>
            Marker
          </button>
        </div>
      </Row>
      <Row>
        <label>Farbe</label>
        <ColorPicker title={marker ? 'Markerfarbe' : 'Linienfarbe'} value={el.color} onChange={(c) => set({ color: c })} />
      </Row>
      <Row>
        <label>Stärke</label>
        <input
          type="range"
          min={marker ? 6 : 1}
          max={marker ? 48 : 24}
          step={0.5}
          value={el.strokeWidth}
          onChange={(e) => set({ strokeWidth: Number(e.target.value) }, false)}
          onMouseUp={commit}
        />
        <span className="insp-val">{el.strokeWidth.toFixed(1)}</span>
      </Row>
      <Row>
        <label>Deckkraft</label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={el.opacity}
          onChange={(e) => set({ opacity: Number(e.target.value) }, false)}
          onMouseUp={commit}
        />
        <span className="insp-val">{Math.round(el.opacity * 100)}%</span>
      </Row>
      {!marker && (
        <Row>
          <label>Stil</label>
          <div className="seg insp-seg">
            {(['solid', 'dashed', 'dotted'] as const).map((d) => (
              <button key={d} className={`seg-btn ${(el.dash ?? 'solid') === d ? 'active' : ''}`} onClick={() => set({ dash: d })}>
                {d === 'solid' ? 'Voll' : d === 'dashed' ? 'Strich' : 'Punkt'}
              </button>
            ))}
          </div>
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
