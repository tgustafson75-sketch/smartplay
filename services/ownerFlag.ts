import { create } from 'zustand';

/**
 * Whether THIS session's backup identity was verified as the owner by the server (api/owner-verify).
 * In memory only — never persisted — so owner status is re-proven every launch and a copied file
 * cannot grant it. No imports on purpose: store/playerProfileStore reads it without an import cycle.
 */
export const useOwnerFlag = create<{ owner: boolean; set: (owner: boolean) => void }>()((set) => ({
  owner: false,
  set: (owner) => set({ owner }),
}));
