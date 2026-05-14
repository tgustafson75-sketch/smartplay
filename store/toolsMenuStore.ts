/**
 * Global Tools menu open/close state.
 *
 * Lifted from the Caddie tab's local `showMoreMenu` state so the same
 * Tools menu can be opened from the ••• pill in every tab's
 * BrandHeaderRow. The actual menu UI lives in
 * components/tools/GlobalToolsMenu.tsx which mounts once at the app root.
 *
 * Why a zustand store and not React context: the ••• pill is in
 * BrandHeaderRow, but the menu modal renders at app/_layout.tsx — two
 * separate parts of the tree. A store gives both sides a stable
 * subscription without prop-drilling through every tab.
 */

import { create } from 'zustand';

interface ToolsMenuState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useToolsMenuStore = create<ToolsMenuState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
