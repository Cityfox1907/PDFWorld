import { useEffect, useState } from 'react';

/**
 * Decides whether to mount the touch-first mobile UI instead of the desktop workspace.
 * A device counts as "mobile" when it has a coarse (touch) pointer on a phone/tablet-sized
 * viewport, OR when the window is simply narrow — so the desktop experience is left
 * completely untouched on real desktops, while phones and narrow windows get the app UI.
 */
function evaluate(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const w = window.innerWidth;
  return (coarse && w <= 1024) || w <= 820;
}

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(evaluate);

  useEffect(() => {
    const onChange = () => setMobile(evaluate());
    const mqlPointer = window.matchMedia('(pointer: coarse)');
    const mqlWidth = window.matchMedia('(max-width: 1024px)');
    mqlPointer.addEventListener?.('change', onChange);
    mqlWidth.addEventListener?.('change', onChange);
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);
    return () => {
      mqlPointer.removeEventListener?.('change', onChange);
      mqlWidth.removeEventListener?.('change', onChange);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
    };
  }, []);

  return mobile;
}
