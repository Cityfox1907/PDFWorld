import { create } from 'zustand';

/**
 * Which bottom-sheet (if any) is currently open in the mobile UI. The page-organiser,
 * the layers overview, the signature/save/image-editor modals all keep their own open
 * state in the shared stores (useUI / useStore); this only governs the sheets that are
 * unique to the mobile shell.
 */
export type MobileSheet = 'none' | 'props' | 'shapes' | 'menu' | 'layers';

/** A pending confirmation prompt — the app-native replacement for the browser's blocking,
 *  unstyled (and in some in-app browsers silently suppressed) window.confirm(). */
export interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Tint the confirm button as destructive (red). */
  danger?: boolean;
  onConfirm: () => void;
}

interface MobileUiState {
  sheet: MobileSheet;
  open: (sheet: MobileSheet) => void;
  close: () => void;
  toggle: (sheet: MobileSheet) => void;
  confirm: ConfirmRequest | null;
  /** Show a confirmation prompt; onConfirm runs only if the user accepts. */
  askConfirm: (req: ConfirmRequest) => void;
  /** Resolve the open prompt — runs onConfirm when accepted, then clears it. */
  resolveConfirm: (accepted: boolean) => void;
}

export const useMobileUi = create<MobileUiState>((set, get) => ({
  sheet: 'none',
  open: (sheet) => set({ sheet }),
  close: () => set({ sheet: 'none' }),
  toggle: (sheet) => set({ sheet: get().sheet === sheet ? 'none' : sheet }),
  confirm: null,
  askConfirm: (req) => {
    // Never silently replace an unresolved prompt — the first question must be
    // answered (or dismissed) before the next destructive action can ask.
    if (get().confirm) return;
    set({ confirm: req });
  },
  resolveConfirm: (accepted) => {
    const req = get().confirm;
    set({ confirm: null });
    if (accepted) req?.onConfirm();
  },
}));
