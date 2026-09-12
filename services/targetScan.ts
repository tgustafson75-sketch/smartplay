/**
 * 2026-09-12 (Tim) — "Only ask to tap the bullseye if vision did not catch it verifiably."
 *
 * The client half of api/target-scan. Its job is the word VERIFIABLY.
 *
 * A confidence label is the model's opinion of itself, and thresholding it is a guess about a guess.
 * A bullseye needs neither, because its geometry is knowable — so a detection can be PROVED:
 *
 *   - the centre must lie BETWEEN the two reported edges, not off to one side of them;
 *   - the two radii (centre→left, centre→right) must AGREE; a real circle seen through mild
 *     perspective stays near-symmetric about its own centre, and a fit that is wildly lopsided has
 *     found two unrelated things;
 *   - the ring must be a believable SIZE in frame — a target filling 2% of the width is either far
 *     outside the rig this is for, or it is a logo;
 *   - and the edges must sit on roughly the same horizontal, because they were asked for on the
 *     horizontal through the centre.
 *
 * Pass all four and we have not "probably" found the target: we have found it, and the recovered
 * pixels-per-inch and centre come with it. Fail any and the caller asks for a tap — ONCE.
 *
 * This is the honesty rule applied to an INPUT rather than an output: the factor the player can
 * change is "put the target where I can see all of it", and we say so instead of degrading quietly.
 */
import { getApiBaseUrl } from './apiBase';

export interface TargetScanResult {
  found: boolean;
  center: { x: number; y: number } | null;
  edge_left: { x: number; y: number } | null;
  edge_right: { x: number; y: number } | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
}

export interface TargetVerification {
  ok: boolean;
  /** Centre in normalized image coords, only when verified. */
  center: { x: number; y: number } | null;
  /** Outer-ring radius as a fraction of image width, only when verified. */
  radiusFrac: number | null;
  /** Why it failed, for the line we show the player. Null when it passed. */
  reason: 'not_found' | 'asymmetric' | 'too_small' | 'too_large' | 'edges_not_level' | null;
}

/** Radii may differ by this much and still be one circle under mild perspective. */
const MAX_RADIUS_ASYMMETRY = 0.35;
/** Below this the "target" is a logo or something across the room. */
const MIN_RADIUS_FRAC = 0.04;
/** Above this it is not a target in a cage, it is a wall. */
const MAX_RADIUS_FRAC = 0.45;
/** The two edges were asked for on one horizontal; this much drift is lens, more is a bad fit. */
const MAX_EDGE_TILT = 0.06;

/**
 * Prove it, or say why not.
 *
 * Pure and synchronous so every rule above can be asserted against real numbers in a test rather
 * than only on a phone in a garage.
 */
export function verifyTarget(scan: TargetScanResult | null): TargetVerification {
  const fail = (reason: TargetVerification['reason']): TargetVerification =>
    ({ ok: false, center: null, radiusFrac: null, reason });

  if (!scan || !scan.found || !scan.center || !scan.edge_left || !scan.edge_right) return fail('not_found');

  const { center, edge_left, edge_right } = scan;

  // The centre must actually be between the edges — a "centre" outside its own ring is two objects.
  if (!(edge_left.x < center.x && center.x < edge_right.x)) return fail('asymmetric');

  const rl = center.x - edge_left.x;
  const rr = edge_right.x - center.x;
  const rMax = Math.max(rl, rr);
  if (rMax <= 0) return fail('too_small');
  if (Math.abs(rl - rr) / rMax > MAX_RADIUS_ASYMMETRY) return fail('asymmetric');

  // Both edges were requested on the horizontal through the centre.
  if (Math.abs(edge_left.y - edge_right.y) > MAX_EDGE_TILT) return fail('edges_not_level');

  const radiusFrac = (rl + rr) / 2;
  if (radiusFrac < MIN_RADIUS_FRAC) return fail('too_small');
  if (radiusFrac > MAX_RADIUS_FRAC) return fail('too_large');

  return { ok: true, center: { x: center.x, y: center.y }, radiusFrac, reason: null };
}

/** What to tell the player when it could not be verified. Names the factor THEY can change. */
export function targetFailureLine(reason: TargetVerification['reason']): string {
  switch (reason) {
    case 'too_small': return "I can't pick your target out from here — move the camera closer, or tap it.";
    case 'too_large': return "I'm too close to see the whole target — back the camera off, or tap it.";
    case 'asymmetric':
    case 'edges_not_level': return "I can't see all of your target clearly — square it up to the camera, or tap it.";
    default: return "I couldn't find your target — tap the middle of it and I'll take it from there.";
  }
}

/**
 * Ask the server to find the target. Never throws: a failed scan means "ask for a tap", which is a
 * perfectly good outcome and must never take the capture screen down with it.
 */
export async function scanForTarget(imageB64: string): Promise<TargetScanResult | null> {
  try {
    const base = getApiBaseUrl();
    if (!base || !imageB64) return null;
    const res = await fetch(base + '/api/target-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_b64: imageB64, image_media_type: 'image/jpeg' }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as TargetScanResult;
  } catch (e) {
    console.log('[target-scan] failed (non-fatal):', e);
    return null;
  }
}
