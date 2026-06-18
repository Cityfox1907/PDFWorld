import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { ElementPatch, ImageElement } from '../lib/pdf';
import { X, Check, RotateCcw, Wand2, Eraser, Brush, Crop } from 'lucide-react';

/** Largest working dimension for the interactive background editor (keeps brush +
 *  flood-fill snappy); the final mask is upscaled to the image's full resolution
 *  on apply so nothing is downscaled in the saved document. */
const WORK_MAX = 1400;
/** Stage the image is fitted into inside the modal. */
const STAGE_W = 560;
const STAGE_H = 460;

export function ImageEditorModal() {
  const editor = useStore((s) => s.imageEditor);
  const close = useStore((s) => s.closeImageEditor);
  const pages = useStore((s) => s.pages);
  const updateElement = useStore((s) => s.updateElement);
  const commit = useStore((s) => s.commit);
  const showToast = useStore((s) => s.showToast);

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
        {editor.mode === 'crop' ? (
          <CropEditor el={found.el} onApply={apply} onClose={close} />
        ) : (
          <BgEditor el={found.el} onApply={apply} onClose={close} onError={(m) => showToast(m, 'error')} />
        )}
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

// ── BACKGROUND REMOVAL ──────────────────────────────────────────────────────────
type BrushMode = 'remove' | 'keep';

function BgEditor({ el, onApply, onClose, onError }: { el: ImageElement; onApply: (p: ElementPatch) => void; onClose: () => void; onError: (m: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgElRef = useRef<HTMLImageElement | null>(null);
  const baseData = useRef<ImageData | null>(null); // source pixels at work resolution
  const mask = useRef<Uint8Array | null>(null); // 255 keep, 0 removed
  const history = useRef<Uint8Array[]>([]);
  const work = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const [disp, setDisp] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const [tolerance, setTolerance] = useState(32);
  const [brush, setBrush] = useState<BrushMode>('remove');
  const [brushSize, setBrushSize] = useState(28);
  const [busy, setBusy] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  // Composite the work-resolution image with the current mask onto the canvas.
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const base = baseData.current;
    const m = mask.current;
    if (!canvas || !base || !m) return;
    const { w, h } = work.current;
    const out = new ImageData(w, h);
    const src = base.data;
    const dst = out.data;
    for (let i = 0; i < m.length; i++) {
      const j = i * 4;
      dst[j] = src[j];
      dst[j + 1] = src[j + 1];
      dst[j + 2] = src[j + 2];
      dst[j + 3] = m[i] ? src[j + 3] : 0;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.putImageData(out, 0, 0);
  }, []);

  useEffect(() => {
    const im = new Image();
    im.onload = () => {
      const natW = im.naturalWidth;
      const natH = im.naturalHeight;
      const ws = Math.min(1, WORK_MAX / Math.max(natW, natH));
      const w = Math.max(1, Math.round(natW * ws));
      const h = Math.max(1, Math.round(natH * ws));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(im, 0, 0, w, h);
      imgElRef.current = im;
      baseData.current = ctx.getImageData(0, 0, w, h);
      mask.current = new Uint8Array(w * h).fill(255);
      work.current = { w, h };
      setDisp(fitStage(w, h));
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = w;
        canvas.height = h;
      }
      setReady(true);
      requestAnimationFrame(render);
    };
    im.src = el.src;
  }, [el.src, render]);

  const pushHistory = () => {
    if (!mask.current) return;
    history.current.push(mask.current.slice());
    if (history.current.length > 24) history.current.shift();
    setCanUndo(true);
  };

  const undo = () => {
    const prev = history.current.pop();
    if (prev) {
      mask.current = prev;
      render();
    }
    setCanUndo(history.current.length > 0);
  };

  const reset = () => {
    if (!mask.current) return;
    pushHistory();
    mask.current.fill(255);
    render();
  };

  // Magic-wand: remove the connected region, reachable from the image edges, whose
  // colour stays within tolerance of the (averaged) border colour.
  const auto = () => {
    const base = baseData.current;
    const m = mask.current;
    if (!base || !m) return;
    setBusy(true);
    pushHistory();
    const { w, h } = work.current;
    const d = base.data;
    // averaged border colour as the background reference
    let br = 0;
    let bg = 0;
    let bb = 0;
    let n = 0;
    const sample = (x: number, y: number) => {
      const j = (y * w + x) * 4;
      br += d[j];
      bg += d[j + 1];
      bb += d[j + 2];
      n++;
    };
    for (let x = 0; x < w; x++) {
      sample(x, 0);
      sample(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      sample(0, y);
      sample(w - 1, y);
    }
    br /= n;
    bg /= n;
    bb /= n;
    const tol = (tolerance / 100) * 320; // sum-of-abs distance threshold
    const visited = new Uint8Array(w * h);
    const q = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    const seed = (i: number) => {
      if (!visited[i]) {
        const j = i * 4;
        if (Math.abs(d[j] - br) + Math.abs(d[j + 1] - bg) + Math.abs(d[j + 2] - bb) <= tol) {
          visited[i] = 1;
          q[tail++] = i;
        }
      }
    };
    for (let x = 0; x < w; x++) {
      seed(x);
      seed((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      seed(y * w);
      seed(y * w + w - 1);
    }
    while (head < tail) {
      const i = q[head++];
      m[i] = 0;
      const x = i % w;
      const y = (i / w) | 0;
      const tryN = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const ni = ny * w + nx;
        if (visited[ni]) return;
        const j = ni * 4;
        if (Math.abs(d[j] - br) + Math.abs(d[j + 1] - bg) + Math.abs(d[j + 2] - bb) <= tol) {
          visited[ni] = 1;
          q[tail++] = ni;
        }
      };
      tryN(x + 1, y);
      tryN(x - 1, y);
      tryN(x, y + 1);
      tryN(x, y - 1);
    }
    render();
    setBusy(false);
  };

  // Paint the mask with a disk under the pointer (remove or restore).
  const paintAt = (cx: number, cy: number) => {
    const m = mask.current;
    if (!m) return;
    const { w, h } = work.current;
    const rad = (brushSize / 2) * (w / disp.w);
    const value = brush === 'remove' ? 0 : 255;
    const r2 = rad * rad;
    const x0 = Math.max(0, Math.floor(cx - rad));
    const x1 = Math.min(w - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad));
    const y1 = Math.min(h - 1, Math.ceil(cy + rad));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dxx = x - cx;
        const dyy = y - cy;
        if (dxx * dxx + dyy * dyy <= r2) m[y * w + x] = value;
      }
    }
  };

  const startPaint = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    pushHistory();
    const { w, h } = work.current;
    const toLocal = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((clientX - r.left) / r.width) * w, y: ((clientY - r.top) / r.height) * h };
    };
    let last = toLocal(e.clientX, e.clientY);
    paintAt(last.x, last.y);
    render();
    const move = (ev: PointerEvent) => {
      const p = toLocal(ev.clientX, ev.clientY);
      // interpolate so fast strokes stay continuous
      const steps = Math.max(1, Math.round(Math.hypot(p.x - last.x, p.y - last.y) / 2));
      for (let i = 1; i <= steps; i++) paintAt(last.x + ((p.x - last.x) * i) / steps, last.y + ((p.y - last.y) * i) / steps);
      last = p;
      render();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const apply = () => {
    const im = imgElRef.current;
    const m = mask.current;
    if (!im || !m) return;
    const natW = im.naturalWidth;
    const natH = im.naturalHeight;
    const { w, h } = work.current;
    const out = document.createElement('canvas');
    out.width = natW;
    out.height = natH;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(im, 0, 0, natW, natH);
    const data = ctx.getImageData(0, 0, natW, natH);
    const px = data.data;
    // Apply the work-resolution mask to the full-resolution image (nearest sample),
    // so the saved cut-out keeps the image's original detail.
    for (let y = 0; y < natH; y++) {
      const my = Math.min(h - 1, (y * h / natH) | 0) * w;
      for (let x = 0; x < natW; x++) {
        const mx = Math.min(w - 1, (x * w / natW) | 0);
        if (!m[my + mx]) px[(y * natW + x) * 4 + 3] = 0;
      }
    }
    ctx.putImageData(data, 0, 0);
    let src: string;
    try {
      src = out.toDataURL('image/png');
    } catch {
      onError('Bild konnte nicht verarbeitet werden.');
      return;
    }
    onApply({ src });
  };

  return (
    <>
      <div className="modal-head">
        <h3>
          <Wand2 size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} /> Hintergrund entfernen
        </h3>
        <button className="btn ghost icon" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="imgedit-bg">
        <div className="imgedit-stage checker" style={{ width: disp.w, height: disp.h }}>
          <canvas
            ref={canvasRef}
            className="imgedit-canvas"
            style={{ width: disp.w, height: disp.h, cursor: 'crosshair' }}
            onPointerDown={startPaint}
          />
          {!ready && <div className="imgedit-loading">Lädt…</div>}
        </div>
        <div className="imgedit-tools">
          <button className="btn primary insp-wide" onClick={auto} disabled={busy || !ready}>
            <Wand2 size={15} /> Automatisch entfernen
          </button>
          <div className="imgedit-field">
            <label>Toleranz</label>
            <input type="range" min={2} max={90} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
            <span className="insp-val">{tolerance}</span>
          </div>
          <div className="divider" />
          <div className="seg insp-seg">
            <button className={`seg-btn ${brush === 'remove' ? 'active' : ''}`} onClick={() => setBrush('remove')} title="Wegradieren">
              <Eraser size={14} /> Entfernen
            </button>
            <button className={`seg-btn ${brush === 'keep' ? 'active' : ''}`} onClick={() => setBrush('keep')} title="Wiederherstellen">
              <Brush size={14} /> Behalten
            </button>
          </div>
          <div className="imgedit-field">
            <label>Pinsel</label>
            <input type="range" min={6} max={90} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
            <span className="insp-val">{brushSize}</span>
          </div>
          <p className="insp-hint" style={{ margin: '2px 0 0' }}>
            Mit gedrückter Maus über das Bild malen, um Bereiche zu entfernen oder wieder einzublenden.
          </p>
          <div className="divider" />
          <div className="imgedit-tool-row">
            <button className="btn ghost" onClick={undo} disabled={!canUndo}>
              <RotateCcw size={15} /> Rückgängig
            </button>
            <button className="btn ghost" onClick={reset}>
              Zurücksetzen
            </button>
          </div>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Abbrechen
        </button>
        <button className="btn primary" onClick={apply} disabled={!ready}>
          <Check size={16} /> Übernehmen
        </button>
      </div>
    </>
  );
}
