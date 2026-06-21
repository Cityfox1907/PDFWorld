import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * A floating page indicator with prev/next steppers. On touch there is no wheel gesture to
 * turn pages at the document edge, so this is the primary way to move between pages. The
 * counter itself is a button: on a long document, stepping one page at a time is tedious,
 * so tapping it opens the page organiser — a thumbnail grid where one tap jumps to any page.
 */
export function MobilePageNav() {
  const pages = useStore((s) => s.pages);
  const currentPageId = useStore((s) => s.currentPageId);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const setOrganizer = useUI((s) => s.setOrganizer);

  if (pages.length <= 1) return null;
  const idx = pages.findIndex((p) => p.id === currentPageId);
  const go = (delta: number) => {
    const next = idx + delta;
    if (next >= 0 && next < pages.length) setCurrentPage(pages[next].id);
  };

  return (
    <div className="m-pagenav">
      <button className="m-pagenav-btn" onClick={() => go(-1)} disabled={idx <= 0} aria-label="Vorherige Seite">
        <ChevronLeft size={18} />
      </button>
      <button
        className="m-pagenav-label"
        onClick={() => setOrganizer(true)}
        aria-label="Seitenübersicht öffnen"
      >
        {idx + 1} / {pages.length}
      </button>
      <button className="m-pagenav-btn" onClick={() => go(1)} disabled={idx >= pages.length - 1} aria-label="Nächste Seite">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
