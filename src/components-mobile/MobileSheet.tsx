import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  /** 'tall' uses most of the screen (forms/inspector); 'auto' hugs its content. */
  height?: 'auto' | 'tall';
}

/**
 * An iOS-style bottom sheet: a backdrop, a rounded card that slides up from below, a
 * drag-grip that flicks it away, and a scrollable body. It mounts only while open (plus
 * a short exit animation) so several sheets can coexist cheaply.
 */
export function MobileSheet({ open, onClose, title, children, height = 'auto' }: Props) {
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; dy: number } | null>(null);

  useEffect(() => {
    if (open) {
      setRender(true);
      // Two frames so the element exists at translateY(100%) before transitioning in.
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = window.setTimeout(() => setRender(false), 300);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!render) return null;

  const onGripDown = (e: React.PointerEvent) => {
    const el = sheetRef.current;
    if (!el) return;
    dragRef.current = { startY: e.clientY, dy: 0 };
    el.style.transition = 'none';
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const dy = Math.max(0, ev.clientY - dragRef.current.startY);
      dragRef.current.dy = dy;
      el.style.transform = `translateY(${dy}px)`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.style.transition = '';
      el.style.transform = '';
      const dy = dragRef.current?.dy ?? 0;
      dragRef.current = null;
      if (dy > 110) onClose();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={`m-sheet-root ${shown ? 'open' : ''}`}>
      <div className="m-sheet-backdrop" onClick={onClose} />
      <div ref={sheetRef} className={`m-sheet ${height === 'tall' ? 'tall' : ''}`} role="dialog" aria-modal="true">
        <div className="m-sheet-grip" onPointerDown={onGripDown}>
          <span className="m-grip-bar" />
          <button className="m-sheet-x" onClick={onClose} aria-label="Schließen">
            <X size={18} />
          </button>
        </div>
        {title && <div className="m-sheet-title">{title}</div>}
        <div className="m-sheet-body">{children}</div>
      </div>
    </div>
  );
}
