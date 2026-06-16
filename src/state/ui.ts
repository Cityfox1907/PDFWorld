import { create } from 'zustand';

interface UIState {
  signatureOpen: boolean;
  sidebarOpen: boolean;
  openSignature: () => void;
  closeSignature: () => void;
  toggleSidebar: () => void;
}

export const useUI = create<UIState>((set) => ({
  signatureOpen: false,
  sidebarOpen: true,
  openSignature: () => set({ signatureOpen: true }),
  closeSignature: () => set({ signatureOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
