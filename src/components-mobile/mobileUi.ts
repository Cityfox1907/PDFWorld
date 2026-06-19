import { create } from 'zustand';

/**
 * Which bottom-sheet (if any) is currently open in the mobile UI. The page-organiser,
 * the layers overview, the signature/save/image-editor modals all keep their own open
 * state in the shared stores (useUI / useStore); this only governs the sheets that are
 * unique to the mobile shell.
 */
export type MobileSheet = 'none' | 'props' | 'shapes' | 'menu' | 'layers';

interface MobileUiState {
  sheet: MobileSheet;
  open: (sheet: MobileSheet) => void;
  close: () => void;
  toggle: (sheet: MobileSheet) => void;
}

export const useMobileUi = create<MobileUiState>((set, get) => ({
  sheet: 'none',
  open: (sheet) => set({ sheet }),
  close: () => set({ sheet: 'none' }),
  toggle: (sheet) => set({ sheet: get().sheet === sheet ? 'none' : sheet }),
}));
