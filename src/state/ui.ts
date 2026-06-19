import { create } from 'zustand';

export type Theme = 'light' | 'dark';

/**
 * How scrolling moves between pages in the editor:
 *  - 'paged'      jump one whole page at a time (default) — reaching a page edge and
 *                 scrolling on snaps to the next/previous page.
 *  - 'continuous' flowing scroll — the leftover scroll carries straight into the next
 *                 page so neighbouring pages blend seamlessly.
 */
export type ScrollMode = 'paged' | 'continuous';

const THEME_KEY = 'pdfworld:theme';
const SCROLL_KEY = 'pdfworld:scrollMode';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readScrollMode(): ScrollMode {
  if (typeof window === 'undefined') return 'paged';
  const saved = window.localStorage.getItem(SCROLL_KEY);
  // The default is deliberately page-by-page, never the continuous flow.
  return saved === 'continuous' ? 'continuous' : 'paged';
}

/** Reflect the active theme onto <html> so the CSS variable set switches. */
export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
}

interface UIState {
  signatureOpen: boolean;
  sidebarOpen: boolean;
  /** full-window page organiser for arranging many pages at once */
  organizerOpen: boolean;
  /** the layers/elements overview panel on the left (overview of every edit) */
  elementsPanelOpen: boolean;
  /** save dialog (rename + choose destination) before exporting */
  saveDialogOpen: boolean;
  /** thumbnail magnification in the page overview (kept at 1; the slider was removed) */
  thumbZoom: number;
  theme: Theme;
  /** whether scrolling jumps page-by-page (default) or flows continuously */
  scrollMode: ScrollMode;
  openSignature: () => void;
  closeSignature: () => void;
  toggleSidebar: () => void;
  toggleOrganizer: () => void;
  setOrganizer: (open: boolean) => void;
  toggleElementsPanel: () => void;
  setElementsPanel: (open: boolean) => void;
  openSaveDialog: () => void;
  closeSaveDialog: () => void;
  toggleTheme: () => void;
  toggleScrollMode: () => void;
}

export const useUI = create<UIState>((set) => ({
  signatureOpen: false,
  sidebarOpen: true,
  organizerOpen: false,
  elementsPanelOpen: false,
  saveDialogOpen: false,
  thumbZoom: 1,
  theme: readTheme(),
  scrollMode: readScrollMode(),
  openSignature: () => set({ signatureOpen: true }),
  closeSignature: () => set({ signatureOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleOrganizer: () => set((s) => ({ organizerOpen: !s.organizerOpen })),
  setOrganizer: (open) => set({ organizerOpen: open }),
  toggleElementsPanel: () => set((s) => ({ elementsPanelOpen: !s.elementsPanelOpen })),
  setElementsPanel: (open) => set({ elementsPanelOpen: open }),
  openSaveDialog: () => set({ saveDialogOpen: true }),
  closeSaveDialog: () => set({ saveDialogOpen: false }),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === 'light' ? 'dark' : 'light';
      applyTheme(theme);
      if (typeof window !== 'undefined') window.localStorage.setItem(THEME_KEY, theme);
      return { theme };
    }),
  toggleScrollMode: () =>
    set((s) => {
      const scrollMode: ScrollMode = s.scrollMode === 'paged' ? 'continuous' : 'paged';
      if (typeof window !== 'undefined') window.localStorage.setItem(SCROLL_KEY, scrollMode);
      return { scrollMode };
    }),
}));
