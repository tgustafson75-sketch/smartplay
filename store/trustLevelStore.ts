import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

/**
 * Phase E — Trust Spectrum.
 *
 * How present the caddie is. TWO levels, not three — see the 2026-07-24 note below.
 *
 *   L1 Quiet  — SmartVision leads. The caddie is small and SILENT: tap or type to talk, and it
 *               never volunteers anything.
 *   L3 Active — DEFAULT. The caddie leads and speaks along the way.
 *
 * L2 exists only as a type-valid alias of Active so nothing indexing TRUST_LEVEL_META[level] can
 * crash. It is unreachable at runtime: setLevel coerces 2 to 3 and migrate maps anything but 1 to 3.
 *
 * 2026-08-30 — THIS HEADER DESCRIBED AN APP THAT NO LONGER EXISTS, and that is not cosmetic. It
 * still promised "L1 Quiet — Cockpit layout + Harry persona", "L2 Companion — default", and a
 * "Caddie home layout switcher (L1 cockpit / L2 companion / L3 active)". By then Harry was out of
 * ACTIVE_PERSONAS, cockpitMode had been hardcoded false and its branch deleted (08-26), and the
 * default had been L3 for over a month.
 *
 * That stale paragraph cost real behaviour twice in one day. proactiveKevin kept a slower
 * "L2 Companion" debounce for a level that has called itself Active since July — and had no branch
 * at all for L1, so the QUIET level was interrupted every two minutes, exactly as often as Active.
 * A file's description of itself is not its runtime behaviour, and a contract nobody prunes becomes
 * a source someone trusts. [[zero-setup-needs-a-native-build]]
 *
 * The level is consumed by:
 *   - app/(tabs)/caddie.tsx — which view leads (SmartVision vs the caddie)
 *   - services/trustLevelService.ts — getTrustLevel() and proactiveDebounceMs(), the one owner of
 *     whether and how often the caddie may speak unprompted
 *   - services/voiceOnboardingService.ts — per-level hint copy
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
