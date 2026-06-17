import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'pdfworld:theme';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
  /** thumbnail magnification in the page overview (1 = compact … 3 = read the text) */
  thumbZoom: number;
  theme: Theme;
  openSignature: () => void;
  closeSignature: () => void;
  toggleSidebar: () => void;
  toggleOrganizer: () => void;
  setOrganizer: (open: boolean) => void;
  toggleElementsPanel: () => void;
  setElementsPanel: (open: boolean) => void;
  openSaveDialog: () => void;
  closeSaveDialog: () => void;
  setThumbZoom: (z: number) => void;
  toggleTheme: () => void;
}

export const useUI = create<UIState>((set) => ({
  signatureOpen: false,
  sidebarOpen: true,
  organizerOpen: false,
  elementsPanelOpen: false,
  saveDialogOpen: false,
  thumbZoom: 1,
  theme: readTheme(),
  openSignature: () => set({ signatureOpen: true }),
  closeSignature: () => set({ signatureOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleOrganizer: () => set((s) => ({ organizerOpen: !s.organizerOpen })),
  setOrganizer: (open) => set({ organizerOpen: open }),
  toggleElementsPanel: () => set((s) => ({ elementsPanelOpen: !s.elementsPanelOpen })),
  setElementsPanel: (open) => set({ elementsPanelOpen: open }),
  openSaveDialog: () => set({ saveDialogOpen: true }),
  closeSaveDialog: () => set({ saveDialogOpen: false }),
  setThumbZoom: (z) => set({ thumbZoom: Math.max(1, Math.min(3, Number(z.toFixed(2)))) }),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === 'light' ? 'dark' : 'light';
      applyTheme(theme);
      if (typeof window !== 'undefined') window.localStorage.setItem(THEME_KEY, theme);
      return { theme };
    }),
}));
