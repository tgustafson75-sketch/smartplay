import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

/**
 * Phase E — Trust Spectrum.
 *
 * Single global level (1–4) controlling how present Kevin is across all surfaces.
 * Default L2 Companion for new users per spec. Persisted in AsyncStorage so the
 * choice survives restarts.
 *
 * The level is consumed by:
 *   - Caddie home layout switcher (L1 quiet / L2 companion / L3 active / L4 full)
 *   - services/modeSelector.ts — shapes Caddie/Coach/Psychologist mode-selection
 *   - services/voiceOnboardingService.ts — picks per-level hint copy
 *   - services/trustLevelService.ts — exposes getTrustLevel(), wake-word default,
 *     and any other consumer-facing convenience.
 */

export type TrustLevel = 1 | 2 | 3 | 4;

export type TrustLevelMeta = {
  level: TrustLevel;
  id: 'quiet' | 'companion' | 'active' | 'full';
  label: string;        // user-facing slider label
  one_liner: string;    // one-line Mike-readable description
};

export const TRUST_LEVEL_META: Record<TrustLevel, TrustLevelMeta> = {
  1: { level: 1, id: 'quiet',     label: 'Quiet',     one_liner: 'Just the basics.' },
  2: { level: 2, id: 'companion', label: 'Companion', one_liner: "Kevin's there when I need him." },
  3: { level: 3, id: 'active',    label: 'Active',    one_liner: 'Kevin engages along the way.' },
  4: { level: 4, id: 'full',      label: 'Full',      one_liner: "Kevin's right there with me." },
};

interface TrustLevelState {
  level: TrustLevel;
  setLevel: (level: TrustLevel) => void;
}

export const useTrustLevelStore = create<TrustLevelState>()(
  persist(
    (set) => ({
      level: 2,
      setLevel: (level) => set({ level }),
    }),
    {
      name: 'trust-level-store-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      // Audit follow-up — explicit version + migrate added defensively.
      version: 1,
      migrate: (persisted) => persisted as TrustLevelState,
    },
  ),
);
