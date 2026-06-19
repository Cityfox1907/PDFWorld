import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  cssStackFor,
  textFaceCss,
  shapeOutline,
  calloutOutline,
  calloutTailHeight,
  pointsToSvgPath,
  isStrokeOnlyShape,
  CALLOUT_PAD,
  firstBaselineOffset,
  type AnyElement,
  type ElementPatch,
  type TextElement,
  type ShapeElement,
  type CalloutElement,
  type InkElement,
} from '../lib/pdf';
import { nearestBaseline } from '../lib/utils/align';
import { inkDashArray } from '../lib/utils/ink';
import { Lock, Unlock } from 'lucide-react';

// Screen-pixel catch radius for the alignment magnet while *dragging* text. Generous
// enough that exact alignment is effortless, small enough never to fight a free move.
const SNAP_TOL = 6;

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
  /** left edges (view-points) a dragged text box may snap to (list/paragraph starts) */
  alignXs?: number[];
  /** report the active horizontal (baseline) guide while dragging (null clears it) */
  onAlignGuide?: (y: number | null) => void;
  /** report the active vertical (left-edge) guide while dragging (null clears it) */
  onAlignGuideX?: (x: number | null) => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  updateElement: (pageId: string, id: string, patch: ElementPatch) => void;
  commit: () => void;
}

export function ElementView({ el, pageId, scale, editing, interactive, editTextMode, alignBaselines, alignXs, onAlignGuide, onAlignGuideX, onStartEdit, onEndEdit, updateElement, commit }: Props) {
  const isInSelection = useStore((s) => s.selectedElementIds.includes(el.id));
  const selectionCount = useStore((s) => s.selectedElementIds.length);
  const selectElement = useStore((s) => s.selectElement);
  const selected = isInSelection && interactive;
  // Resize handles + the lock badge only make sense for a lone selection; a group shows
  // just the outlines so it stays readable while several elements are picked.
  const soloSelected = selected && selectionCount === 1;
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
    const store = useStore.getState();
    const selIds = store.selectedElementIds;
    const alreadySelected = selIds.includes(el.id);
    // Shift-click toggles this element in/out of the selection without moving anything.
    if (e.shiftKey) {
      store.toggleElementSelection(el.id);
      return;
    }
    // A plain click on an element outside the current selection selects just it; clicking
    // one that's already part of a multi-selection keeps the group so it can be dragged.
    if (!alreadySelected) selectElement(el.id);
    flashLock();
    // A locked element is selectable (so it can be unlocked) but never moves.
    if (locked) return;

    // The set that actually moves: the whole (unlocked) selection when dragging a group,
    // otherwise just this element.
    const groupIds = alreadySelected && selIds.length > 1 ? selIds : [el.id];
    const page = store.pages.find((p) => p.id === pageId);
    const members = (page?.elements ?? [])
      .filter((m) => groupIds.includes(m.id) && !m.locked)
      .map((m) => ({ id: m.id, x: m.x, y: m.y, points: m.type === 'ink' ? (m as InkElement).points.map((p) => ({ ...p })) : null }));
    if (!members.length) return;
    const single = members.length === 1;

    // Capture the pointer to THIS element so every following move/up is delivered here
    // even if the finger slides off the element — without this, touch drags on iOS get
    // "stuck" the moment the touch is reinterpreted as a scroll and the element stops
    // following the finger. The matching `releasePointerCapture` runs in `up`.
    const node = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    node.setPointerCapture?.(pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      let dx = (ev.clientX - startX) / scale;
      let dy = (ev.clientY - startY) / scale;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true;
      // Baseline / left-edge snapping is an alignment aid for a SINGLE text box; a group
      // drag moves everything rigidly so their relative layout is preserved.
      let guideY: number | null = null;
      let guideX: number | null = null;
      if (single && el.type === 'text' && !el.rotation) {
        const t = el as TextElement;
        const off = firstBaselineOffset(t.size, t.lineHeight);
        const tol = SNAP_TOL / scale;
        const ny = el.y + dy;
        const nx = el.x + dx;
        if (alignBaselines && alignBaselines.length) {
          const snapY = nearestBaseline(ny + off, alignBaselines, tol);
          if (snapY != null) {
            dy = snapY - off - el.y;
            guideY = snapY;
          }
        }
        if (alignXs && alignXs.length) {
          const snapX = nearestBaseline(nx, alignXs, tol);
          if (snapX != null) {
            dx = snapX - el.x;
            guideX = snapX;
          }
        }
      }
      onAlignGuide?.(guideY);
      onAlignGuideX?.(guideX);
      for (const m of members) {
        const patch: ElementPatch = { x: m.x + dx, y: m.y + dy };
        if (m.points) patch.points = m.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        updateElement(pageId, m.id, patch);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      node.releasePointerCapture?.(pointerId);
      onAlignGuide?.(null);
      onAlignGuideX?.(null);
      if (moved) commit();
      // A click (no drag) on a member of a multi-selection narrows it down to just that
      // element — so a group can be broken back into a single pick without a detour.
      else if (alreadySelected && groupIds.length > 1) selectElement(el.id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    // A cancelled touch (browser stole the gesture, multi-touch, …) must tear the drag
    // down too, otherwise the listeners leak and the next tap behaves erratically.
    window.addEventListener('pointercancel', up);
  };

  const startResize = (e: React.PointerEvent, h: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    if (locked) return;
    selectElement(el.id);
    const node = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    node.setPointerCapture?.(pointerId);
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
      window.removeEventListener('pointercancel', up);
      node.releasePointerCapture?.(pointerId);
      commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
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
      onDoubleClick={() => (el.type === 'text' || el.type === 'callout') && interactive && !locked && onStartEdit()}
    >
      <ElementBody el={el} scale={scale} editing={editing} onEndEdit={onEndEdit} updateElement={updateElement} pageId={pageId} />
      {soloSelected && !editing && !locked && (
        <>
          {HANDLES.map((h) => (
            <span key={h} className={`handle ${h}`} onPointerDown={(e) => startResize(e, h)} />
          ))}
        </>
      )}
      {soloSelected && !editing && lockVisible && (
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
      // Only plain text fields auto-grow; a callout keeps its drawn bubble size.
      if (el.type === 'text') fitToContent(taRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  switch (el.type) {
    case 'text': {
      const t = el as TextElement;
      const textStyle: React.CSSProperties = {
        // One face rule for field, editor and markers: the captured original typeface
        // verbatim (no faux bold/italic over an already-styled program), else the chosen
        // family with the requested weight/style. See textFaceCss.
        ...textFaceCss(t.family, t.embeddedFontId, t.bold, t.italic),
        fontSize: t.size * scale,
        color: t.color,
        textAlign: t.align,
        lineHeight: t.lineHeight,
        // When this text replaces existing PDF text, paint the sampled background
        // behind it so the original glyphs are hidden live in the editor too.
        background: t.coverColor ?? undefined,
      };
      // List markers hang in the margin to the LEFT of the box (so the box width — and
      // the left-edge alignment guide — stays on the text itself, matching the export).
      const listOn = t.list && t.list !== 'none';
      const markerCol = listOn ? (
        <div
          className="list-markers"
          style={{
            position: 'absolute',
            right: '100%',
            top: 0,
            marginRight: t.size * 0.35 * scale,
            fontFamily: textStyle.fontFamily,
            fontSize: t.size * scale,
            fontWeight: textStyle.fontWeight,
            fontStyle: textStyle.fontStyle,
            lineHeight: t.lineHeight,
            color: t.color,
            textAlign: 'right',
            whiteSpace: 'pre',
            pointerEvents: 'none',
          }}
        >
          {(t.text.length ? t.text.split('\n') : ['']).map((_, i) => (
            <div key={i}>{t.list === 'bullet' ? '•' : `${i + 1}.`}</div>
          ))}
        </div>
      ) : null;
      if (editing) {
        return (
          <>
            {markerCol}
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
                // Enter starts a new line / paragraph (multi-line text); Escape — or
                // clicking anywhere else — finishes the field.
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
          </>
        );
      }
      return (
        <>
          {markerCol}
          <div className="text-body" style={textStyle}>
            {t.text || <span className="text-placeholder">Text…</span>}
          </div>
        </>
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
    case 'shape': {
      const s = el as ShapeElement;
      const { points, closed } = shapeOutline(s.shape, 0, 0, s.width * scale, s.height * scale, s.flip ?? false);
      return (
        <svg className="shape-body" width={s.width * scale} height={s.height * scale} style={{ overflow: 'visible', pointerEvents: 'none' }}>
          <path
            d={pointsToSvgPath(points, closed)}
            fill={isStrokeOnlyShape(s.shape) ? 'none' : s.fill ?? 'none'}
            stroke={s.stroke ?? 'none'}
            strokeWidth={(s.stroke ? s.strokeWidth : 0) * scale}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={s.stroke ? inkDashArray(s.dash, s.strokeWidth * scale) : undefined}
          />
        </svg>
      );
    }
    case 'callout': {
      const c = el as CalloutElement;
      const { points, closed } = calloutOutline(0, 0, c.width * scale, c.height * scale);
      const tailH = calloutTailHeight(c.height);
      const textStyle: React.CSSProperties = {
        fontFamily: cssStackFor(c.family),
        fontSize: c.size * scale,
        fontWeight: c.bold ? 700 : 400,
        fontStyle: c.italic ? 'italic' : 'normal',
        color: c.color,
        textAlign: c.align,
        lineHeight: c.lineHeight,
      };
      const inner: React.CSSProperties = {
        position: 'absolute',
        left: CALLOUT_PAD * scale,
        top: CALLOUT_PAD * scale,
        width: Math.max(0, c.width - 2 * CALLOUT_PAD) * scale,
        height: Math.max(0, c.height - tailH - 2 * CALLOUT_PAD) * scale,
        overflow: 'hidden',
        pointerEvents: editing ? 'auto' : 'none',
      };
      return (
        <div className="callout-body" style={{ width: c.width * scale, height: c.height * scale }}>
          <svg className="callout-shape" width={c.width * scale} height={c.height * scale} style={{ overflow: 'visible', pointerEvents: 'none' }}>
            <path d={pointsToSvgPath(points, closed)} fill={c.fill} stroke={c.stroke ?? 'none'} strokeWidth={(c.stroke ? c.strokeWidth : 0) * scale} strokeLinejoin="round" />
          </svg>
          <div style={inner}>
            {editing ? (
              <textarea
                ref={taRef}
                className="text-edit"
                style={{ ...textStyle, width: '100%', height: '100%' }}
                wrap="off"
                defaultValue={c.text}
                onChange={(e) => updateElement(pageId, el.id, { text: e.currentTarget.value })}
                onBlur={onEndEdit}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  // Enter adds a line (notes are multi-line); Escape finishes.
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <div className="text-body" style={textStyle}>
                {c.text || <span className="text-placeholder">Notiz…</span>}
              </div>
            )}
          </div>
        </div>
      );
    }
    case 'highlight': {
      return <div className="fill-body" style={{ background: el.color, mixBlendMode: 'multiply' }} />;
    }
    case 'image':
    case 'signature': {
      const bw = el.borderWidth ?? 0;
      const border = el.borderColor && bw > 0 ? `${bw * scale}px ${el.borderStyle ?? 'solid'} ${el.borderColor}` : undefined;
      return <img className="img-body" style={{ border, boxSizing: 'border-box' }} src={el.src} alt="" draggable={false} />;
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
