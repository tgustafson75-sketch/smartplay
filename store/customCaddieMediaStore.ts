/**
 * 2026-06-11 (audit 4c) — Custom-caddie image blobs, split out of
 * playerProfileStore.
 *
 * The two base64 images (selfie + AI portrait) used to live on
 * playerProfileStore, which re-serializes its ENTIRE persisted blob to
 * AsyncStorage on every change — including a handicap differential push on each
 * imported round. Carrying ~hundreds of KB of base64 through every one of those
 * writes was pure write-amplification. These images change rarely, so they get
 * their own lightweight persisted store; the profile store no longer pays to
 * re-write them on unrelated updates.
 *
 * Migration is safe + idempotent: migrateFromProfile() copies the legacy values
 * over only when this store is empty, then nulls them on the profile store so
 * the bloat stops. Read sites fall back to the profile fields until migration
 * completes, so the custom-caddie avatar never flickers or disappears.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

interface CustomCaddieMediaState {
  /** Original selfie capture (raw base64, no data: prefix). */
  selfieB64: string | null;
  /** AI-edited caddie portrait (raw base64). */
  customCaddiePortraitB64: string | null;
  /** 2026-06-16 (Tim) — the DASHBOARD profile icon (raw base64). Independent of the
   *  active caddie: you can apply a custom-caddie portrait (or selfie) as just your
   *  profile picture WITHOUT it becoming your caddie's voice/persona. */
  profilePortraitB64: string | null;
  /** Set once the one-time move off playerProfileStore has run. */
  _migratedFromProfile: boolean;
  setSelfieB64: (b: string | null) => void;
  setCustomCaddiePortraitB64: (b: string | null) => void;
  setProfilePortraitB64: (b: string | null) => void;
  /** One-time move of the two blobs out of playerProfileStore. Idempotent:
   *  copies only fields this store doesn't already have, then nulls the legacy
   *  profile fields. Call only once BOTH stores have hydrated (see _layout). */
  migrateFromProfile: () => void;
}

export const useCustomCaddieMediaStore = create<CustomCaddieMediaState>()(
  persist(
    (set, get) => ({
      selfieB64: null,
      customCaddiePortraitB64: null,
      profilePortraitB64: null,
      _migratedFromProfile: false,
      setSelfieB64: (b) => set({ selfieB64: b }),
      setCustomCaddiePortraitB64: (b) => set({ customCaddiePortraitB64: b }),
      setProfilePortraitB64: (b) => set({ profilePortraitB64: b }),
      migrateFromProfile: () => {
        if (get()._migratedFromProfile) return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const profileMod = require('./playerProfileStore') as typeof import('./playerProfileStore');
          const profile = profileMod.usePlayerProfileStore.getState() as unknown as {
            selfieB64?: string | null;
            customCaddiePortraitB64?: string | null;
          };
          const legacySelfie = profile.selfieB64 ?? null;
          const legacyPortrait = profile.customCaddiePortraitB64 ?? null;

          const patch: Partial<CustomCaddieMediaState> = {};
          if (legacySelfie && !get().selfieB64) patch.selfieB64 = legacySelfie;
          if (legacyPortrait && !get().customCaddiePortraitB64) patch.customCaddiePortraitB64 = legacyPortrait;
          if (Object.keys(patch).length > 0) set(patch);

          // Null the legacy blobs so the profile store stops re-serializing them.
          if (legacySelfie || legacyPortrait) {
            profileMod.usePlayerProfileStore.setState({
              selfieB64: null,
              customCaddiePortraitB64: null,
            } as never);
          }
          set({ _migratedFromProfile: true });
        } catch {
          // Non-fatal — read-site fallbacks keep the avatar visible; we just
          // retry on the next hydration tick rather than marking migrated.
        }
      },
    }),
    {
      name: 'custom-caddie-media-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      partialize: (s) => ({
        selfieB64: s.selfieB64,
        customCaddiePortraitB64: s.customCaddiePortraitB64,
        profilePortraitB64: s.profilePortraitB64,
        _migratedFromProfile: s._migratedFromProfile,
      }),
      // 2026-06-25 (audit) — version+migrate hook so a future shape change can't
      // silently wipe the persisted base64 portraits on a version bump. Passthrough today.
      version: 1,
      migrate: (state) => state as CustomCaddieMediaState,
    },
  ),
);
