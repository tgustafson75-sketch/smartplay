/**
 * 2026-07-24 (Tim — "do we need the app name at the top everywhere / the whole time? Logo in left
 * probably does the trick, maybe fade out the SMARTPLAY CADDIE name after a first load").
 *
 * Session-scoped brand reveal: the full SMARTPLAY CADDIE wordmark shows on first app load, then fades
 * out ~2.6s later, leaving just the circular logo badge on every header for the rest of the session.
 * NOT persisted — a fresh cold start shows the wordmark again (that's the "first load" moment), then it
 * settles back to logo-only. One shared flag so the fade happens once, app-wide, not per-screen.
 */
import { create } from 'zustand';

interface BrandRevealState {
  /** True until the first-load reveal window elapses; then false for the rest of the session. */
  nameVisible: boolean;
  hide: () => void;
}

export const useBrandRevealStore = create<BrandRevealState>((set) => ({
  nameVisible: true,
  hide: () => set({ nameVisible: false }),
}));
