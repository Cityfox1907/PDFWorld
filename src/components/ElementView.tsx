import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { cssStackFor, embeddedFontFamily, BASELINE_RATIO, type AnyElement, type ElementPatch, type TextElement, type InkElement } from '../lib/pdf';
import { nearestBaseline } from '../lib/utils/align';
import { inkDashArray } from '../lib/utils/ink';
import { Lock, Unlock } from 'lucide-react';

// Screen-pixel tolerance for the visual baseline guide while dragging text — tight,
// because the line is a confirmation of exact alignment, never a magnet.
const ALIGN_TOL = 1.5;

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

interface Props {
  el: AnyElement;
  pageId: string;
  scale: number;
  editing: boolean;
  /** whether the element responds to pointer input (move/resize/select/edit) */
  interactive: boolean;
  /** in the scan tool a single click on text re-opens its in-place editor */
  editTextMode?: boolean;
  /** baselines (view-points) a dragged text box may snap to for alignment */
  alignBaselines?: number[];
  /** report the active alignment guide while dragging (null clears it) */
  onAlignGuide?: (y: number | null) => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  updateElement: (pageId: string, id: string, patch: ElementPatch) => void;
  commit: () => void;
}

export function ElementView({ el, pageId, scale, editing, interactive, editTextMode, alignBaselines, onAlignGuide, onStartEdit, onEndEdit, updateElement, commit }: Props) {
  const selectedId = useStore((s) => s.selectedElementId);
  const selectElement = useStore((s) => s.selectElement);
  const selected = selectedId === el.id && interactive;
  const locked = !!el.locked;

  // The lock badge flashes for 3 s whenever the element becomes (or is re-)selected,
  // then fades — a discreet handle to lock/unlock without permanent clutter.
  const [lockVisible, setLockVisible] = useState(false);
  const lockTimer = useRef<number | null>(null);
  const flashLock = () => {
    setLockVisible(true);
    if (lockTimer.current) window.clearTimeout(lockTimer.current);
    lockTimer.current = window.setTimeout(() => setLockVisible(false), 3000);
  };
  useEffect(() => {
    if (selected) flashLock();
    else setLockVisible(false);
  }, [selected]);
  useEffect(() => () => { if (lockTimer.current) window.clearTimeout(lockTimer.current); }, []);

  const toggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateElement(pageId, el.id, { locked: !locked });
    commit();
    flashLock();
  };

  const startMove = (e: React.PointerEvent) => {
    if (!interactive || editing) return;
    // In the scan tool, clicking text re-opens its editor instead of moving it,
    // so an already-edited line can be corrected again.
    if (editTextMode && el.type === 'text' && !locked) {
      e.stopPropagation();
      e.preventDefault(); // keep focus so the editor we open doesn't blur instantly
      selectElement(el.id);
      onStartEdit();
      return;
    }
    e.stopPropagation();
    selectElement(el.id);
    flashLock();
    // A locked element is selectable (so it can be unlocked) but never moves.
    if (locked) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { x: el.x, y: el.y };
    const inkPoints = el.type === 'ink' ? (el as InkElement).points.map((p) => ({ ...p })) : null;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true;
      const y = origin.y + dy; // free movement, no magnet
      // Visual-only guide: light up the shared line when this text's baseline lands
      // exactly on a neighbour's, then let it vanish as soon as you move on.
      let guide: number | null = null;
      if (el.type === 'text' && !el.rotation && alignBaselines && alignBaselines.length) {
        const size = (el as TextElement).size;
        guide = nearestBaseline(y + size * BASELINE_RATIO, alignBaselines, ALIGN_TOL / scale);
      }
      onAlignGuide?.(guide);
      const patch: ElementPatch = { x: origin.x + dx, y };
      if (inkPoints) patch.points = inkPoints.map((p) => ({ x: p.x + dx, y: p.y + (y - origin.y) }));
      updateElement(pageId, el.id, patch);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onAlignGuide?.(null);
      if (moved) commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (e: React.PointerEvent, h: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    if (locked) return;
    selectElement(el.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const o = { x: el.x, y: el.y, w: el.width, h: el.height };
    const aspect = el.type === 'image' || el.type === 'signature' ? o.w / o.h : 0;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      let { x, y, w, h: hh } = o;
      if (h.includes('e')) w = Math.max(8, o.w + dx);
      if (h.includes('s')) hh = Math.max(8, o.h + dy);
      if (h.includes('w')) {
        w = Math.max(8, o.w - dx);
        x = o.x + (o.w - w);
      }
      if (h.includes('n')) {
        hh = Math.max(8, o.h - dy);
        y = o.y + (o.h - hh);
      }
      if (aspect && (h === 'nw' || h === 'ne' || h === 'se' || h === 'sw')) {
        hh = w / aspect;
        if (h.includes('n')) y = o.y + (o.h - hh);
      }
      updateElement(pageId, el.id, { x, y, width: w, height: hh });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Hidden elements (toggled off in the Elements panel) leave the canvas entirely and
  // are skipped on export; they remain listed in the panel so they can be shown again.
  if (el.hidden) return null;

  const base: React.CSSProperties = {
    left: el.x * scale,
    top: el.y * scale,
    width: el.width * scale,
    height: el.height * scale,
    opacity: el.opacity,
    pointerEvents: interactive ? 'auto' : 'none',
    // Free rotation pivots around the centre, matching the bake layer.
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  };

  return (
    <div
      className={`el ${selected ? 'selected' : ''} ${locked ? 'locked' : ''}`}
      style={base}
      onPointerDown={startMove}
      onDoubleClick={() => el.type === 'text' && interactive && !locked && onStartEdit()}
    >
      <ElementBody el={el} scale={scale} editing={editing} onEndEdit={onEndEdit} updateElement={updateElement} pageId={pageId} />
      {selected && !editing && !locked && (
        <>
          {HANDLES.map((h) => (
            <span key={h} className={`handle ${h}`} onPointerDown={(e) => startResize(e, h)} />
          ))}
        </>
      )}
      {selected && !editing && lockVisible && (
        <button
          className={`el-lock ${locked ? 'on' : ''}`}
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          onClick={toggleLock}
          title={locked ? 'Entsperren' : 'Sperren (vor versehentlichem Verschieben schützen)'}
        >
          {locked ? <Lock size={11} /> : <Unlock size={11} />}
        </button>
      )}
    </div>
  );
}

function ElementBody({
  el,
  scale,
  editing,
  onEndEdit,
  updateElement,
  pageId,
}: {
  el: AnyElement;
  scale: number;
  editing: boolean;
  onEndEdit: () => void;
  updateElement: (pageId: string, id: string, patch: ElementPatch) => void;
  pageId: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Grow the box to hug its content (text never wraps, so the on-screen line matches
  // the export, which also doesn't wrap). A new field therefore starts compact and
  // lengthens only as far as the typed line — never the old over-wide, over-tall box.
  const fitToContent = (ta: HTMLTextAreaElement) => {
    const w = (ta.scrollWidth + 2) / scale; // +2px: a little room for the end caret
    const h = ta.scrollHeight / scale;
    const width = Math.max(el.width, Math.round(w * 100) / 100);
    const height = Math.max(el.height, Math.round(h * 100) / 100);
    if (width !== el.width || height !== el.height) updateElement(pageId, el.id, { width, height });
  };

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      // Pre-select the content so existing text turns blue and a single keystroke
      // replaces it — the caret is instantly ready for new fields too.
      taRef.current.select();
      fitToContent(taRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  switch (el.type) {
    case 'text': {
      const t = el as TextElement;
      const textStyle: React.CSSProperties = {
        // Prefer the captured original typeface so an in-place edit looks identical.
        fontFamily: embeddedFontFamily(t.embeddedFontId) ?? cssStackFor(t.family),
        fontSize: t.size * scale,
        fontWeight: t.bold ? 700 : 400,
        fontStyle: t.italic ? 'italic' : 'normal',
        color: t.color,
        textAlign: t.align,
        lineHeight: t.lineHeight,
        // When this text replaces existing PDF text, paint the sampled background
        // behind it so the original glyphs are hidden live in the editor too.
        background: t.coverColor ?? undefined,
      };
      if (editing) {
        return (
          <textarea
            ref={taRef}
            className="text-edit"
            style={textStyle}
            // wrap=off so the textarea never soft-wraps: each line keeps its true width,
            // which is what the auto-fit below measures (and what the export draws).
            wrap="off"
            defaultValue={t.text}
            onChange={(e) => {
              const ta = e.currentTarget;
              const width = Math.max(el.width, (ta.scrollWidth + 2) / scale);
              const height = Math.max(el.height, ta.scrollHeight / scale);
              updateElement(pageId, el.id, { text: ta.value, width, height });
            }}
            onBlur={onEndEdit}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              // Enter finishes the field (Shift+Enter adds a line); Escape also exits.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        );
      }
      return (
        <div className="text-body" style={textStyle}>
          {t.text || <span className="text-placeholder">Text…</span>}
        </div>
      );
    }
    case 'rect': {
      return (
        <div
          className="fill-body"
          style={{
            background: el.fill ?? 'transparent',
            border: el.stroke && el.strokeWidth ? `${el.strokeWidth * scale}px solid ${el.stroke}` : 'none',
            borderRadius: el.radius * scale,
          }}
        />
      );
    }
    case 'ellipse': {
      return (
        <div
          className="fill-body"
          style={{
            background: el.fill ?? 'transparent',
            border: el.stroke && el.strokeWidth ? `${el.strokeWidth * scale}px solid ${el.stroke}` : 'none',
            borderRadius: '50%',
          }}
        />
      );
    }
    case 'highlight': {
      return <div className="fill-body" style={{ background: el.color, mixBlendMode: 'multiply' }} />;
    }
    case 'image':
    case 'signature': {
      return <img className="img-body" src={el.src} alt="" draggable={false} />;
    }
    case 'ink': {
      const d = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x - el.x) * scale} ${(p.y - el.y) * scale}`).join(' ');
      return (
        <svg
          className="ink-body"
          width={el.width * scale}
          height={el.height * scale}
          // Highlighter / marker strokes blend like a real marker so text stays legible.
          style={el.highlight ? { mixBlendMode: 'multiply' } : undefined}
        >
          <path
            d={d}
            fill="none"
            stroke={el.color}
            strokeWidth={el.strokeWidth * scale}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={inkDashArray(el.dash, el.strokeWidth * scale)}
          />
        </svg>
      );
    }
    default:
      return null;
  }
}
