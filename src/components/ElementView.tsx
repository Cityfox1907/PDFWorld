import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { cssStackFor, type AnyElement, type ElementPatch, type TextElement, type InkElement } from '../lib/pdf';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

interface Props {
  el: AnyElement;
  pageId: string;
  scale: number;
  editing: boolean;
  /** whether the element responds to pointer input (move/resize/select/edit) */
  interactive: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  updateElement: (pageId: string, id: string, patch: ElementPatch) => void;
  commit: () => void;
}

export function ElementView({ el, pageId, scale, editing, interactive, onStartEdit, onEndEdit, updateElement, commit }: Props) {
  const selectedId = useStore((s) => s.selectedElementId);
  const selectElement = useStore((s) => s.selectElement);
  const selected = selectedId === el.id && interactive;

  const startMove = (e: React.PointerEvent) => {
    if (!interactive || editing) return;
    e.stopPropagation();
    selectElement(el.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { x: el.x, y: el.y };
    const inkPoints = el.type === 'ink' ? (el as InkElement).points.map((p) => ({ ...p })) : null;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true;
      const patch: ElementPatch = { x: origin.x + dx, y: origin.y + dy };
      if (inkPoints) patch.points = inkPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      updateElement(pageId, el.id, patch);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (e: React.PointerEvent, h: Handle) => {
    e.stopPropagation();
    e.preventDefault();
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

  const base: React.CSSProperties = {
    left: el.x * scale,
    top: el.y * scale,
    width: el.width * scale,
    height: el.height * scale,
    opacity: el.opacity,
    pointerEvents: interactive ? 'auto' : 'none',
  };

  return (
    <div
      className={`el ${selected ? 'selected' : ''}`}
      style={base}
      onPointerDown={startMove}
      onDoubleClick={() => el.type === 'text' && interactive && onStartEdit()}
    >
      <ElementBody el={el} scale={scale} editing={editing} onEndEdit={onEndEdit} updateElement={updateElement} pageId={pageId} />
      {selected && !editing && (
        <>
          {HANDLES.map((h) => (
            <span key={h} className={`handle ${h}`} onPointerDown={(e) => startResize(e, h)} />
          ))}
        </>
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
  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      // Pre-select the content so existing text turns blue and a single keystroke
      // replaces it — the caret is instantly ready for new fields too.
      taRef.current.select();
    }
  }, [editing]);

  switch (el.type) {
    case 'text': {
      const t = el as TextElement;
      const textStyle: React.CSSProperties = {
        fontFamily: cssStackFor(t.family),
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
            defaultValue={t.text}
            onChange={(e) => {
              const grown = Math.max(el.height, e.currentTarget.scrollHeight / scale);
              updateElement(pageId, el.id, { text: e.target.value, height: grown });
            }}
            onBlur={onEndEdit}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
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
        <svg className="ink-body" width={el.width * scale} height={el.height * scale}>
          <path d={d} fill="none" stroke={el.color} strokeWidth={el.strokeWidth * scale} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    default:
      return null;
  }
}
