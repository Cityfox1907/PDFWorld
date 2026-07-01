import { useEffect, useRef, useState } from 'react';
import { useUI } from '../state/ui';
import { useStore, visibleSize } from '../state/store';
import type { ImageElement } from '../lib/pdf';
import { uid } from '../lib/utils/id';
import { X, Eraser, Upload, Check } from 'lucide-react';

export function SignatureModal() {
  const open = useUI((s) => s.signatureOpen);
  const close = useUI((s) => s.closeSignature);
  const pages = useStore((s) => s.pages);
  const currentPageId = useStore((s) => s.currentPageId);
  const addElement = useStore((s) => s.addElement);
  const setTool = useStore((s) => s.setTool);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = 2;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0b1f3a';
    setHasInk(false);

    let drawing = false;
    const pos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      drawing = true;
      // Capture the pointer so the stroke continues even when the hand drifts
      // outside the canvas mid-signature — without this the line just stops.
      canvas.setPointerCapture?.(e.pointerId);
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      setHasInk(true);
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    };
    const up = () => {
      drawing = false;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [open]);

  if (!open) return null;

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  const placeFromDataUrl = (src: string) => {
    const page = pages.find((p) => p.id === currentPageId);
    if (!page) return;
    const img = new Image();
    img.onload = () => {
      const { width: vw, height: vh } = visibleSize(page);
      const aspect = img.width / img.height || 3;
      let w = Math.min(vw * 0.4, 240);
      let h = w / aspect;
      if (h > vh * 0.3) {
        h = vh * 0.3;
        w = h * aspect;
      }
      const el: ImageElement = {
        id: uid('el'),
        type: 'signature',
        x: vw * 0.5 - w / 2,
        y: vh * 0.7,
        width: w,
        height: h,
        opacity: 1,
        z: page.elements.reduce((m, e) => Math.max(m, e.z), 0) + 1,
        src,
        aspect,
      };
      addElement(page.id, el);
      setTool('select');
      close();
    };
    img.src = src;
  };

  const confirmDraw = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    const trimmed = trimCanvas(canvas);
    placeFromDataUrl(trimmed);
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Unterschrift</h3>
          <button className="btn ghost icon" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <p className="insp-hint" style={{ margin: '0 0 10px' }}>Zeichne deine Unterschrift oder lade ein Bild hoch.</p>
        <canvas ref={canvasRef} className="sig-canvas" />
        <div className="modal-actions">
          <button className="btn ghost" onClick={clear}>
            <Eraser size={16} /> Löschen
          </button>
          <button className="btn ghost" onClick={() => uploadRef.current?.click()}>
            <Upload size={16} /> Hochladen
          </button>
          <button className="btn primary" onClick={confirmDraw} disabled={!hasInk}>
            <Check size={16} /> Einfügen
          </button>
        </div>
        <input
          ref={uploadRef}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => placeFromDataUrl(reader.result as string);
            reader.readAsDataURL(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

/** Crop transparent margins so the placed signature sits tight in its box. */
function trimCanvas(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/png');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        found = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (!found) return canvas.toDataURL('image/png');
  const pad = 8;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width, maxX + pad);
  maxY = Math.min(height, maxY + pad);
  const w = maxX - minX;
  const h = maxY - minY;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')?.drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}
