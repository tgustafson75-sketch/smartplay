/**
 * Phase 404 — Reference swing comparison registry.
 *
 * Maps each canonical swing fault (from api/swing-analysis.ts) to an
 * optional reference illustration showing correct execution of the
 * affected swing position. When a reference is registered, the
 * "See the moment" modal in app/swinglab/swing/[swing_id].tsx renders
 * the user's fault frame side-by-side with the reference; when no
 * reference is registered, the modal falls back to the single-frame
 * view from Phase 403b (no regression).
 *
 * # Why this file
 *
 * Per the Phase 404 brief, AI-generated reference visuals are excluded
 * (accuracy risks — bad references hurt more than help). Phase 404
 * ships the WIRING + the registration site. The actual illustrations
 * are deferred to a licensed asset drop or a custom production pass.
 *
 * # How to add an illustration
 *
 * 1. Drop the PNG at `assets/swing-references/<category>/illustration.png`
 *    (see assets/swing-references/README.md for the catalog).
 * 2. Replace the `image: null` entry below with
 *    `image: require('../assets/swing-references/<category>/illustration.png')`.
 * 3. Optionally tune the `callout` line — it's the caddie's
 *    visible-difference cue shown beneath the reference image.
 *
 * No other code needs to change. The modal autodetects.
 *
 * # Honesty bar
 *
 * - Don't ship a reference asset for a fault if the illustration is
 *   inaccurate or condescending — leave the slot null and the system
 *   gracefully omits side-by-side for that category.
 * - The callout is a pre-written per-category line, NOT a dynamic
 *   per-swing generation. Phase 404 doesn't claim per-swing reference
 *   commentary — that'd require an LLM call per view, and the brief
 *   wants visual evidence, not more text.
 */

import type { ImageSourcePropType } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { getAuthoredReference } from '../store/referenceAuthoringStore';

/**
 * 2026-07-06 (elite audit) — read-time re-anchor for authored capture uris.
 * The authoring screen persists ABSOLUTE paths under documentDirectory/
 * reference-authoring/, and iOS regenerates the app-container UUID on every
 * native build/reinstall — so a stored path from a prior install silently
 * points at the DEAD container even though the file survived (same reshuffle
 * resolveClipUri in videoUpload.ts heals for swing clips). getSwingReference
 * is SYNCHRONOUS (called straight from render), so re-anchor by prefix check
 * instead of an async existence probe: a file:// uri whose prefix isn't the
 * LIVE documentDirectory is guaranteed stale — rebuild it from the basename.
 */
function reanchorAuthoredUri(stored: string): string {
  if (!stored.startsWith('file://')) return stored;
  try {
    const dir = FileSystem.documentDirectory;
    if (!dir || stored.startsWith(dir)) return stored;
    const base = stored.split('/').pop();
    return base ? `${dir}reference-authoring/${base}` : stored;
  } catch {
    return stored; // FS unavailable — don't regress, hand back the original
  }
}

// Mirror of api/swing-analysis.ts CanonicalIssue. Local copy so the
// registry doesn't pull a server file (the API file is bundle-poison —
// it imports @vercel/node). 'none' is included for completeness but
// never gets a reference (no fault = no comparison).
export type CanonicalIssue =
  | 'club_face_open'
  | 'club_face_closed'
  | 'swing_path_outside_in'
  | 'swing_path_inside_out'
  | 'attack_angle_steep'
  | 'attack_angle_shallow'
  | 'early_extension'
  | 'over_the_top'
  | 'chicken_wing'
  | 'reverse_pivot'
  | 'none';

export type SwingReference = {
  /** Bundled illustration. null = no asset registered yet; modal omits
   *  side-by-side for this category and falls back to single-frame. */
  image: ImageSourcePropType | null;
  /** Caddie's visible-difference cue rendered under the reference. Kept
   *  short — one sentence the user can read at a glance while looking
   *  at the side-by-side. */
  callout: string;
  /** Optional friendly name for the swing position the reference shows
   *  ("Impact", "Top of backswing"). Used as the reference column's
   *  sub-label so the user knows what they're comparing AGAINST. */
  position: string;
};

const REGISTRY: Record<CanonicalIssue, SwingReference> = {
  club_face_open: {
    image: null,
    position: 'Impact',
    callout: 'Reference shows the clubface square to the target at impact. Yours is open — leading edge tilted right of the line.',
  },
  club_face_closed: {
    image: null,
    position: 'Impact',
    callout: 'Reference shows the clubface square at impact. Yours is closed — leading edge tilted left of the line.',
  },
  swing_path_outside_in: {
    image: null,
    position: 'Downswing',
    callout: 'Reference shows the club approaching from inside the target line. Yours is coming from outside — the classic slice path.',
  },
  swing_path_inside_out: {
    image: null,
    position: 'Downswing',
    callout: 'Reference shows the club on plane through impact. Yours is dropping too far inside — hook risk.',
  },
  attack_angle_steep: {
    image: null,
    position: 'Impact',
    callout: 'Reference shows a shallow, level approach into the ball. Yours is chopping down — too steep.',
  },
  attack_angle_shallow: {
    image: null,
    position: 'Impact',
    callout: 'Reference shows a slight descending blow into the ball. Yours is sweeping — losing compression.',
  },
  early_extension: {
    image: null,
    position: 'Impact',
    callout: 'Reference keeps the hips back through impact. Yours are sliding toward the ball — posture lost.',
  },
  over_the_top: {
    image: null,
    position: 'Transition',
    callout: 'Reference drops the club into the slot on transition. Yours is throwing the club over the top — the slice trigger.',
  },
  chicken_wing: {
    image: null,
    position: 'Follow-through',
    callout: 'Reference extends the lead arm fully through impact. Yours is bending — loss of width and clubface control.',
  },
  reverse_pivot: {
    image: null,
    position: 'Top of backswing',
    callout: 'Reference loads weight onto the trail side at the top. Yours is hanging on the lead side — reverse pivot.',
  },
  none: {
    image: null,
    position: '',
    callout: '',
  },
};

/**
 * Look up the reference asset for a fault category. Returns null when
 * the category has no registered reference OR when the category is
 * 'none' (no fault → nothing to compare). The caller renders
 * side-by-side only when this returns a non-null result.
 *
 * Phase 405b — runtime overlay. The authoring store
 * (store/referenceAuthoringStore.ts) is consulted FIRST so Tank can
 * capture references in-app and see them appear immediately in the
 * side-by-side modal. When no authored capture exists for the
 * category, the function falls through to the bundled REGISTRY's
 * require() path — the standard production path for every user other
 * than Tank's device.
 */
export function getSwingReference(issue: string | null | undefined): SwingReference | null {
  if (!issue || issue === 'none') return null;
  const baseline = REGISTRY[issue as CanonicalIssue];
  if (!baseline) return null;

  // Runtime overlay: prefer an authored capture on this device.
  const authored = getAuthoredReference(issue);
  if (authored && authored.imageUri) {
    return {
      image: { uri: reanchorAuthoredUri(authored.imageUri) } as ImageSourcePropType,
      position: baseline.position,
      callout: authored.callout && authored.callout.trim().length > 0
        ? authored.callout
        : baseline.callout,
    };
  }

  if (!baseline.image) return null;
  return baseline;
}

/**
 * Test/debug helper — returns the list of categories that currently
 * have a registered illustration. Useful for an admin / asset-coverage
 * surface later. NOT called from production paths.
 */
export function listRegisteredReferences(): CanonicalIssue[] {
  return (Object.keys(REGISTRY) as CanonicalIssue[]).filter(k => REGISTRY[k].image != null);
}
