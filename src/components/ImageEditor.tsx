import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { ElementPatch, ImageElement } from '../lib/pdf';
import { X, Check, Crop } from 'lucide-react';

/** Stage the image is fitted into inside the modal. */
const STAGE_W = 560;
const STAGE_H = 460;

export function ImageEditorModal() {
  const editor = useStore((s) => s.imageEditor);
  const close = useStore((s) => s.closeImageEditor);
  const pages = useStore((s) => s.pages);
  const updateElement = useStore((s) => s.updateElement);
  const commit = useStore((s) => s.commit);

  let found: { pageId: string; el: ImageElement } | null = null;
  if (editor) {
    for (const p of pages) {
      const el = p.elements.find((e) => e.id === editor.id);
      if (el && (el.type === 'image' || el.type === 'signature')) {
        found = { pageId: p.id, el: el as ImageElement };
        break;
      }
    }
  }

  if (!editor || !found) return null;
  const apply = (patch: ElementPatch) => {
    commit();
    updateElement(found.pageId, found.el.id, patch);
    close();
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal imgedit-modal" onClick={(e) => e.stopPropagation()}>
        <CropEditor el={found.el} onApply={apply} onClose={close} />
      </div>
    </div>
  );
}

/** Fit a w×h image into the stage, returning the display size. */
function fitStage(w: number, h: number): { w: number; h: number } {
  const s = Math.min(STAGE_W / w, STAGE_H / h, 1);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

// ── CROP ──────────────────────────────────────────────────────────────────────
type Rect = { x: number; y: number; w: number; h: number };
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

function CropEditor({ el, onApply, onClose }: { el: ImageElement; onApply: (p: ElementPatch) => void; onClose: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [disp, setDisp] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [box, setBox] = useState<Rect | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const im = new Image();
    im.onload = () => {
      const d = fitStage(im.naturalWidth, im.naturalHeight);
      setImg(im);
      setDisp(d);
      // Start with a small inset so the crop handles are obvious and grabbable.
      const inset = Math.round(Math.min(d.w, d.h) * 0.08);
      setBox({ x: inset, y: inset, w: d.w - inset * 2, h: d.h - inset * 2 });
    };
    im.src = el.src;
  }, [el.src]);

  const clampBox = useCallback(
    (b: Rect): Rect => {
      const minSize = 16;
      let { x, y, w, h } = b;
      w = Math.max(minSize, w);
      h = Math.max(minSize, h);
      x = Math.max(0, Math.min(x, disp.w - w));
      y = Math.max(0, Math.min(y, disp.h - h));
      return { x, y, w, h };
    },
    [disp],
  );

  const startMove = (e: React.PointerEvent) => {
    if (!box) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const o = { ...box };
    const move = (ev: PointerEvent) => setBox(clampBox({ ...o, x: o.x + (ev.clientX - sx), y: o.y + (ev.clientY - sy) }));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (e: React.PointerEvent, h: Handle) => {
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const o = { ...box };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      let { x, y, w, h: hh } = o;
      if (h.includes('e')) w = o.w + dx;
      if (h.includes('s')) hh = o.h + dy;
      if (h.includes('w')) {
        w = o.w - dx;
        x = o.x + dx;
      }
      if (h.includes('n')) {
        hh = o.h - dy;
        y = o.y + dy;
      }
      // keep top-left from crossing the opposite edge
      if (w < 16) {
        if (h.includes('w')) x = o.x + o.w - 16;
        w = 16;
      }
      if (hh < 16) {
        if (h.includes('n')) y = o.y + o.h - 16;
        hh = 16;
      }
      setBox(clampBox({ x, y, w, h: hh }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const apply = () => {
    if (!img || !box) return;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const ratio = natW / disp.w; // natural px per display px (aspect preserved)
    const cx = box.x * ratio;
    const cy = box.y * ratio;
    const cw = Math.max(1, Math.round(box.w * ratio));
    const ch = Math.max(1, Math.round(box.h * ratio));
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, cx, cy, box.w * ratio, box.h * ratio, 0, 0, cw, ch);
    const src = c.toDataURL('image/png');
    // Keep the cropped portion exactly where it sat on the page (the box is laid out
    // with object-fit:contain, so account for any letterboxing offset + scale).
    const s = Math.min(el.width / natW, el.height / natH);
    const offX = (el.width - natW * s) / 2;
    const offY = (el.height - natH * s) / 2;
    onApply({
      src,
      aspect: cw / ch,
      x: el.x + offX + cx * s,
      y: el.y + offY + cy * s,
      width: box.w * ratio * s,
      height: box.h * ratio * s,
    });
  };

  return (
    <>
      <div className="modal-head">
        <h3>
          <Crop size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} /> Bild zuschneiden
        </h3>
        <button className="btn ghost icon" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p className="insp-hint" style={{ margin: '0 0 12px' }}>Ziehe den Rahmen an den Griffen, um die Ränder anzupassen.</p>
      <div className="imgedit-stage" ref={stageRef} style={{ width: disp.w, height: disp.h }}>
        {img && <img className="imgedit-img" src={el.src} alt="" draggable={false} style={{ width: disp.w, height: disp.h }} />}
        {box && (
          <div className="crop-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} onPointerDown={startMove}>
            {HANDLES.map((h) => (
              <span key={h} className={`crop-handle ${h}`} onPointerDown={(e) => startResize(e, h)} />
            ))}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Abbrechen
        </button>
        <button className="btn primary" onClick={apply}>
          <Check size={16} /> Zuschneiden
        </button>
      </div>
    </>
  );
}
