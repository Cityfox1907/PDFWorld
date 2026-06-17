import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { toHex } from '../lib/utils/color';
import { Check, Pipette } from 'lucide-react';

/**
 * A compact, friendly colour picker shared by every tool and element.
 *
 * It replaces the bare `<input type="color">` with a popover that offers a curated
 * document palette, the colours you used most recently (including any tone sampled
 * with the background brush or the eyedropper), a hex field, the OS colour dialog
 * for anything custom, and — where the browser supports it — an eyedropper that
 * lifts a colour straight off the rendered PDF. Picked colours flow into the shared
 * recent list so they're one click away in the next field.
 */

// A calm, document-friendly palette: a neutral ramp plus the system accent hues.
const PRESETS = [
  '#000000', '#3a3a3c', '#636366', '#8e8e93', '#aeaeb2', '#c7c7cc', '#e5e5ea', '#f2f2f7', '#ffffff',
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#5856d6', '#af52de', '#a2845e',
];

const POP_W = 220;
const POP_H = 252;

function eyeDropperSupported(): boolean {
  return typeof window !== 'undefined' && !!window.EyeDropper;
}

export function ColorPicker({
  value,
  onChange,
  title,
}: {
  value: string;
  onChange: (hex: string) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const recent = useStore((s) => s.recentColors);
  const addRecentColor = useStore((s) => s.addRecentColor);

  const hex = toHex(value);
  const [hexDraft, setHexDraft] = useState(hex);
  useEffect(() => setHexDraft(hex), [hex]);

  // Fixed-position popover computed from the trigger, so the inspector's own scroll
  // never clips it; flips above when there isn't room below.
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8));
    const below = r.bottom + 8;
    const flip = below + POP_H > window.innerHeight - 8 && r.top - POP_H - 8 > 8;
    setPos({ left, top: flip ? r.top - POP_H - 8 : below });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const reposition = () => place();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, place]);

  // Live update (no history of intermediate tones); records to the recent list only
  // on a deliberate pick so dragging the OS dial doesn't flood it.
  const preview = (c: string) => onChange(toHex(c));
  const commit = (c: string, close = true) => {
    const h = toHex(c);
    onChange(h);
    addRecentColor(h);
    if (close) setOpen(false);
  };

  const pickFromScreen = async () => {
    if (!window.EyeDropper) return;
    try {
      const res = await new window.EyeDropper().open();
      commit(res.sRGBHex);
    } catch {
      /* the user dismissed the eyedropper */
    }
  };

  const swatch = (c: string, key: string) => (
    <button
      key={key}
      type="button"
      className={`color-cell ${toHex(c) === hex ? 'active' : ''}`}
      style={{ background: c }}
      onClick={() => commit(c)}
      title={toHex(c)}
    >
      {toHex(c) === hex && <Check size={12} strokeWidth={3} />}
    </button>
  );

  return (
    <div className="color-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="color-swatch-btn"
        onClick={() => setOpen((o) => !o)}
        title={title ? `${title} · ${hex}` : hex}
      >
        <span className="color-swatch-chip" style={{ background: hex }} />
      </button>

      {open && pos && (
        <div className="color-pop" style={{ left: pos.left, top: pos.top, width: POP_W }}>
          <div className="color-pop-grid">{PRESETS.map((c) => swatch(c, c))}</div>

          {recent.length > 0 && (
            <>
              <div className="color-pop-label">Zuletzt verwendet</div>
              <div className="color-pop-grid">{recent.map((c, i) => swatch(c, `r${i}`))}</div>
            </>
          )}

          <div className="color-pop-foot">
            <label className="color-native" title="Eigene Farbe wählen">
              <input
                type="color"
                value={hex}
                onChange={(e) => preview(e.target.value)}
                onBlur={(e) => commit(e.target.value, false)}
              />
              <span className="color-native-ring" />
            </label>
            <input
              className="color-hex"
              value={hexDraft}
              spellCheck={false}
              onChange={(e) => {
                const v = e.target.value;
                setHexDraft(v);
                if (/^#?[0-9a-fA-F]{6}$/.test(v)) preview(v.startsWith('#') ? v : `#${v}`);
              }}
              onBlur={() => {
                if (/^#?[0-9a-fA-F]{6}$/.test(hexDraft)) commit(hexDraft, false);
                else setHexDraft(hex);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            {eyeDropperSupported() && (
              <button
                type="button"
                className="color-eyedrop"
                onClick={pickFromScreen}
                title="Farbe aus dem Dokument aufnehmen"
              >
                <Pipette size={15} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
