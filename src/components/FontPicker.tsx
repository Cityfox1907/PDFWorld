import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FONT_CATALOG, cssStackFor, fontDef, type FontFamilyKey, type FontDef } from '../lib/pdf';
import { ChevronDown, Check, Search } from 'lucide-react';

/**
 * Font picker that previews every option in its OWN typeface. A native <select>
 * can't do this reliably — most browsers draw the option list with the system UI
 * font regardless of `font-family` — so this is a custom popover where each row
 * (and the trigger) is styled with the font it represents. Includes a search box
 * because the catalogue is long.
 */

const GROUP_LABEL: Record<FontDef['group'], string> = {
  system: 'System',
  standard: 'Standard',
  web: 'Web-Schriften',
};
const GROUP_ORDER: FontDef['group'][] = ['system', 'standard', 'web'];

interface PopPos {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export function FontPicker({ value, onChange }: { value: FontFamilyKey; onChange: (key: FontFamilyKey) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<PopPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = fontDef(value);

  // The popover is position:fixed (computed from the trigger) so the inspector's
  // own scroll/overflow can never clip it, and it can flip above when low on space.
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(380, Math.max(160, openUp ? spaceAbove : spaceBelow));
    setPos({
      left: r.left,
      top: openUp ? r.top - gap - maxHeight : r.bottom + gap,
      width: r.width,
      maxHeight,
    });
  }, []);

  // Place before paint so the popover never flashes at a stale position.
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

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUP_ORDER.map((g) => ({
      group: g,
      fonts: FONT_CATALOG.filter((f) => f.group === g && (!q || f.label.toLowerCase().includes(q))),
    })).filter((g) => g.fonts.length > 0);
  }, [query]);

  const select = (key: FontFamilyKey) => {
    onChange(key);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="font-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="field font-picker-btn"
        style={{ fontFamily: cssStackFor(value) }}
        onClick={() => setOpen((o) => !o)}
        title={current.label}
      >
        <span className="font-picker-name">{current.label}</span>
        <ChevronDown size={15} className="font-picker-chevron" />
      </button>

      {open && pos && (
        <div
          className="font-picker-pop"
          style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
        >
          <div className="font-picker-search">
            <Search size={14} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Schrift suchen…"
            />
          </div>
          <div className="font-picker-list">
            {groups.map(({ group, fonts }) => (
              <div key={group}>
                <div className="font-picker-group">{GROUP_LABEL[group]}</div>
                {fonts.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={`font-picker-item ${f.key === value ? 'active' : ''}`}
                    style={{ fontFamily: cssStackFor(f.key) }}
                    onClick={() => select(f.key)}
                  >
                    <span className="font-picker-item-name">{f.label}</span>
                    {f.key === value && <Check size={14} />}
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && <div className="font-picker-empty">Keine Treffer</div>}
          </div>
        </div>
      )}
    </div>
  );
}
