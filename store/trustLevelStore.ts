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

export const TRUST_LEVEL_META: Record<TrustLevel, TrustLevelMeta> = {
  1: { level: 1, id: 'quiet',     label: 'Quiet',     one_liner: "Harry's cockpit. Tap to talk." },
  2: { level: 2, id: 'companion', label: 'Companion', one_liner: "Kevin's there when I need him." },
  3: { level: 3, id: 'active',    label: 'Active',    one_liner: 'Kevin engages along the way.' },
};

/** Display order for the slider — numerical order matches intensity. */
export const TRUST_LEVEL_SLIDER_ORDER: readonly TrustLevel[] = [1, 2, 3];

interface TrustLevelState {
  level: TrustLevel;
  /** 2026-06-04 — Persona we should restore when leaving L1 Cockpit. Was
   *  formerly named preCockpitPersona and tied to L5; the Cockpit binding
   *  moved to L1 in the 2026-06-04 trust-spectrum collapse. Captured at
   *  the moment of entering L1 so the user's preferred Kevin/Tank/Serena
   *  is restored on exit. Null when not in Cockpit. */
  preCockpitPersona: string | null;
  setLevel: (level: TrustLevel) => void;
}

export const useTrustLevelStore = create<TrustLevelState>()(
  persist(
    (set, get) => ({
      level: 2,
      preCockpitPersona: null,
      setLevel: (level) => {
        const prev = get().level;
        const wasCockpit = prev === 1;
        const willBeCockpit = level === 1;

        // L1 IS Harry's cockpit. Entering L1 → save current persona, swap
        // to Harry. Leaving L1 → restore the saved persona so the user
        // gets back Kevin/Tank/Serena. Dynamic require avoids the
        // circular import between settingsStore and trustLevelStore.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const settingsMod = require('./settingsStore') as typeof import('./settingsStore');
          const currentPersona = settingsMod.useSettingsStore.getState().caddiePersonality;
          if (willBeCockpit && !wasCockpit) {
            set({ level, preCockpitPersona: currentPersona ?? null });
            if (currentPersona !== 'harry') {
              settingsMod.useSettingsStore.getState().setCaddiePersonality?.('harry');
            }
            // 2026-06-04 — Route to the Caddie tab on L1 entry so the
            // user lands on the Cockpit render immediately. The Caddie
            // screen already early-returns into the Cockpit layout when
            // trustLevel === 1 (see app/(tabs)/caddie.tsx — `cockpitMode`),
            // so this hop is the only thing needed to make L1 selection
            // from Settings or any other tab "go to Cockpit." Wrapped in
            // its own try because the router import can throw before the
            // navigation tree is mounted.
            void (async () => {
              try {
                const { router } = await import('expo-router');
                router.replace('/(tabs)/caddie' as never);
              } catch (e) {
                console.log('[trustLevel] L1 router nav skipped:', e);
              }
            })();
            return;
          }
          if (wasCockpit && !willBeCockpit) {
            const restore = get().preCockpitPersona;
            set({ level, preCockpitPersona: null });
            if (restore && restore !== currentPersona) {
              settingsMod.useSettingsStore.getState().setCaddiePersonality?.(restore as 'kevin' | 'tank' | 'serena' | 'harry');
            }
            return;
          }
        } catch (e) {
          console.log('[trustLevel] cockpit persona binding skipped:', e);
        }
        set({ level });
      },
    }),
    {
      name: 'trust-level-store-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      // 2026-06-04 — version bumped from 1 → 2 for the {1,2,3} collapse.
      // Migrate coerces any out-of-range persisted level to L2 default.
      version: 2,
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<TrustLevelState>;
        const lvl = s.level;
        if (lvl !== 1 && lvl !== 2 && lvl !== 3) {
          // Users on legacy L4/L5 land on L2 Companion (the safe default).
          return { ...s, level: 2, preCockpitPersona: null } as TrustLevelState;
        }
        return s as TrustLevelState;
      },
    },
  ),
);
