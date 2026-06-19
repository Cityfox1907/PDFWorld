import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * A couple of shape glyphs lucide-react doesn't ship (parallelogram, trapezoid),
 * drawn in the exact same stroke style (24-grid, currentColor, round joins) so they
 * sit seamlessly next to the lucide icons in the Elemente menu and inspector.
 * Cast to `LucideIcon` so they drop into the existing `{ size }` call sites unchanged.
 */
function strokeIcon(children: ReactNode): LucideIcon {
  const Icon = ({ size = 24 }: { size?: number | string }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
  return Icon as unknown as LucideIcon;
}

export const ParallelogramIcon = strokeIcon(<path d="M7 5 H21 L17 19 H3 Z" />);
export const TrapezoidIcon = strokeIcon(<path d="M7 5 H17 L21 19 H3 Z" />);
