import { useEffect, useState } from 'react';
import { useMobileUi } from './mobileUi';

/**
 * An app-native confirmation dialog — the touch-friendly replacement for window.confirm,
 * which is blocking, unstyled and, in some in-app browsers, silently suppressed (so a
 * destructive action would run with no prompt at all). A centred card with a backdrop,
 * a short fade/scale-in, and two clearly sized buttons. Driven entirely by useMobileUi.
 */
export function MobileConfirm() {
  const req = useMobileUi((s) => s.confirm);
  const resolve = useMobileUi((s) => s.resolveConfirm);
  const [render, setRender] = useState(!!req);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (req) {
      setRender(true);
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = window.setTimeout(() => setRender(false), 200);
    return () => window.clearTimeout(t);
  }, [req]);

  // Keep the last request visible through the exit animation after it clears.
  const [last, setLast] = useState(req);
  useEffect(() => {
    if (req) setLast(req);
  }, [req]);

  if (!render || !last) return null;

  return (
    <div className={`m-confirm-root ${shown ? 'open' : ''}`} role="dialog" aria-modal="true">
      <div className="m-confirm-backdrop" onClick={() => resolve(false)} />
      <div className="m-confirm">
        <div className="m-confirm-title">{last.title}</div>
        {last.message && <div className="m-confirm-msg">{last.message}</div>}
        <div className="m-confirm-actions">
          <button className="m-confirm-btn" onClick={() => resolve(false)}>
            {last.cancelLabel ?? 'Abbrechen'}
          </button>
          <button
            className={`m-confirm-btn primary ${last.danger ? 'danger' : ''}`}
            onClick={() => resolve(true)}
            autoFocus
          >
            {last.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
