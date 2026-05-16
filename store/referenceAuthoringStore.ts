/**
 * Phase 405b — Reference-asset authoring store.
 *
 * Per-device store for swing-reference captures produced via the in-app
 * authoring tool at /author/reference-assets. Tank (the real instructor
 * behind the persona) opens that screen and captures one still image
 * and/or one short video per fault category from
 * services/swingReferences.ts. Captures are stored as local file URIs
 * inside the device's documentDirectory and persisted to AsyncStorage
 * so they survive app restarts.
 *
 * Runtime overlay: getSwingReference() in services/swingReferences.ts
 * consults THIS store first. When a category has an authored capture,
 * the side-by-side "See the moment" modal renders it as the REFERENCE
 * pane. Other users (no authored captures on their device) fall
 * through to the bundled require() registry — currently null for all
 * categories, so they see the Phase 403b single-frame view until Tim
 * drops in vetted assets via EAS Update.
 *
 * Distribution: when Tank is happy with a capture, the authoring
 * screen offers a per-file Share action (expo-sharing) that hands the
 * file off to Tim's preferred channel (AirDrop, Drive, email).
 * Receivers of the file drop it into
 * assets/swing-references/<category>/illustration.png and replace
 * `image: null` with `require(...)` in services/swingReferences.ts.
 * One EAS Update later, everyone sees the new reference.
 *
 * Why per-device and not server-backed:
 * - v1.1 ships without backend asset hosting. EAS Update is the
 *   distribution channel for everyone except Tank.
 * - Tank's authoring is iterative — he tries a capture, opens swing
 *   analysis to see it in context, recaptures if it's not clean. The
 *   round-trip needs to be instant; a server hop would make it sluggish.
 * - When v1.2+ adds backend asset hosting, this store becomes the
 *   client-side mirror of the server catalog and the sync layer slots
 *   in here.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mirror of services/swingReferences.ts CanonicalIssue. Kept as plain
// string in the store so a schema bump on the canonical list doesn't
// break persisted entries (entries for retired categories just become
// orphan keys; nothing crashes).
export type AuthoringCategory = string;

export type AuthoredReference = {
  /** Local file URI for a still image (JPEG/PNG). Null when only video
   *  was captured for this category. */
  imageUri: string | null;
  /** Local file URI for a short explanatory video. Null when only an
   *  image was captured. Renderer support for video in the side-by-
   *  side modal is a follow-up; storing it now means Tank can capture
   *  in one pass and the video light up when the modal upgrades. */
  videoUri: string | null;
  /** Author's override of the per-category callout. When non-empty,
   *  shown beneath the reference image instead of the catalog default
   *  in services/swingReferences.ts. Lets Tank rephrase the cue in his
   *  voice ("Trust your prep. Send it. Square clubface, square shot.") */
  callout: string | null;
  /** ms-epoch of last capture for this slot. UI sorts by recency in
   *  the author screen's status row. */
  updated_at: number;
};

interface ReferenceAuthoringState {
  /** Per-category authored captures keyed by canonical-issue id (e.g.
   *  'club_face_open', 'early_extension'). */
  byCategory: Record<AuthoringCategory, AuthoredReference>;

  setImage: (category: AuthoringCategory, imageUri: string) => void;
  setVideo: (category: AuthoringCategory, videoUri: string) => void;
  setCallout: (category: AuthoringCategory, callout: string) => void;
  clear: (category: AuthoringCategory) => void;
  clearAll: () => void;
}

function emptyEntry(): AuthoredReference {
  return { imageUri: null, videoUri: null, callout: null, updated_at: Date.now() };
}

export const useReferenceAuthoringStore = create<ReferenceAuthoringState>()(
  persist(
    (set) => ({
      byCategory: {},

      setImage: (category, imageUri) =>
        set(s => ({
          byCategory: {
            ...s.byCategory,
            [category]: {
              ...(s.byCategory[category] ?? emptyEntry()),
              imageUri,
              updated_at: Date.now(),
            },
          },
        })),

      setVideo: (category, videoUri) =>
        set(s => ({
          byCategory: {
            ...s.byCategory,
            [category]: {
              ...(s.byCategory[category] ?? emptyEntry()),
              videoUri,
              updated_at: Date.now(),
            },
          },
        })),

      setCallout: (category, callout) =>
        set(s => ({
          byCategory: {
            ...s.byCategory,
            [category]: {
              ...(s.byCategory[category] ?? emptyEntry()),
              callout: callout.trim().length > 0 ? callout.trim() : null,
              updated_at: Date.now(),
            },
          },
        })),

      clear: (category) =>
        set(s => {
          const next = { ...s.byCategory };
          delete next[category];
          return { byCategory: next };
        }),

      clearAll: () => set({ byCategory: {} }),
    }),
    {
      name: '@smartplay/reference_authoring',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);

/**
 * Pure lookup helper used by services/swingReferences.ts to overlay
 * authored captures on top of the bundled registry. Returns null when
 * no authored capture exists for the category — caller falls through
 * to the bundled require() path.
 *
 * Read-only — does NOT subscribe; safe to call from synchronous
 * renderer code that just needs a value once.
 */
export function getAuthoredReference(category: string): AuthoredReference | null {
  const entry = useReferenceAuthoringStore.getState().byCategory[category];
  if (!entry) return null;
  if (!entry.imageUri && !entry.videoUri) return null;
  return entry;
}
