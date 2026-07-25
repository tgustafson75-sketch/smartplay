import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

/**
 * Phase E — Trust Spectrum.
 *
 * Single global level (1–3) controlling how present the caddie is across all
 * surfaces. Default L2 Companion for new users per spec. Persisted in
 * AsyncStorage so the choice survives restarts.
 *
 *   L1 Quiet     — Cockpit layout + Harry persona, tap-to-talk only. Caddie
 *                  never volunteers; user drives every interaction.
 *   L2 Companion — default. Caddie reactive; speaks when asked or in reply.
 *   L3 Active    — Caddie volunteers unprompted (briefings, hole intros,
 *                  shot reactions).
 *
 * 2026-06-04 — Collapsed from the prior 1–5 schema. L4 'Full' was removed
 * (gates moved to L3 + L2). L5 'Cockpit' was removed and its Cockpit layout
 * + Harry persona binding moved to L1. Migration coerces any persisted
 * level outside {1,2,3} back to L2 Companion (safe default).
 *
 * The level is consumed by:
 *   - Caddie home layout switcher (L1 cockpit / L2 companion / L3 active)
 *   - services/voiceOnboardingService.ts — picks per-level hint copy
 *   - services/trustLevelService.ts — exposes getTrustLevel() etc.
 */

export type TrustLevel = 1 | 2 | 3;

export type TrustLevelMeta = {
  level: TrustLevel;
  id: 'quiet' | 'companion' | 'active';
  label: string;        // user-facing slider label
  one_liner: string;    // one-line description
};

// 2026-07-24 (Tim — "remove harry, remove cockpit, TWO levels = Quiet + Active, one caddie interface
// that toggles SmartVision <-> caddie"). Collapsed to TWO user-facing levels. Harry persona binding +
// the branded Cockpit are GONE. Level now ONLY controls proactivity + which view leads:
//   - Level 1 QUIET  = SmartVision leads (map primary); caddie is small + silent (tap/type to talk).
//   - Level 3 ACTIVE = the caddie leads (avatar primary); volunteers along the way. DEFAULT.
// The middle 'companion' (2) is retired — kept as a type-valid alias of Active so no consumer that
// indexes TRUST_LEVEL_META[level] can crash; migration coerces any persisted 2 to 3.
export const TRUST_LEVEL_META: Record<TrustLevel, TrustLevelMeta> = {
  1: { level: 1, id: 'quiet',     label: 'Quiet',     one_liner: 'SmartVision leads · tap or type to talk.' },
  2: { level: 2, id: 'active',    label: 'Active',    one_liner: 'Your caddie leads the way.' },
  3: { level: 3, id: 'active',    label: 'Active',    one_liner: 'Your caddie leads the way.' },
};

/** Display order for the toggle — just the two live levels now (Quiet, Active). */
export const TRUST_LEVEL_SLIDER_ORDER: readonly TrustLevel[] = [1, 3];

interface TrustLevelState {
  level: TrustLevel;
  setLevel: (level: TrustLevel) => void;
}

export const useTrustLevelStore = create<TrustLevelState>()(
  persist(
    (set) => ({
      level: 3,
      // No persona swap, no router hop — the level is pure proactivity/view state now.
      setLevel: (level) => set({ level: level === 2 ? 3 : level }),
    }),
    {
      name: 'trust-level-store-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      // 2026-07-24 — version 3 for the two-level {Quiet=1, Active=3} collapse. Any persisted
      // Companion (2) or out-of-range level maps to Active (3), the new default.
      version: 3,
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<TrustLevelState>;
        const lvl = s.level;
        return { ...s, level: lvl === 1 ? 1 : 3 } as TrustLevelState;
      },
    },
  ),
);
