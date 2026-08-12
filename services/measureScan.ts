/**
 * 2026-08-12 — client for /api/measure-scan, the missing half of the hands-free rangefinder.
 *
 * Tim asked for this on 2026-07-22 ("SmartFinder auto-detect / wrap SmartVision around it"). The
 * endpoint was built that day and the maths (services/rangefinder.computeHeightRangedDistance) was
 * built and unit-tested — and the two were never connected to each other or to a screen. An
 * adversarial sweep on 08-12 found the endpoint had zero client callers and the maths was referenced
 * only by its own test file. A whole feature living in a test.
 *
 * WHY IT MATTERS beyond being unfinished: SmartFinder's live read is the camera-TILT rangefinder,
 * which is unreliable near the horizon — where golf targets actually are. Tim, 2026-06-23: "moving
 * the target never gets accurate, defaults to 250 or 10." Tiny pitch errors explode the projected
 * point. Ranging off a KNOWN-HEIGHT object's angular size has no such failure mode: it doesn't use
 * pitch, GPS or heading at all, only how tall the flagstick looks. It is the honest fix for the
 * complaint the tilt gate could only paper over.
 *
 * HONESTY: the server returns found=false unless it can clearly see BOTH the top and the
 * ground-contact base of a real known-size reference. No guess → we keep whatever read we had.
 */
import { getApiBaseUrl, appKeyHeaders } from './apiBase';

export type MeasureScanKind = 'flagstick' | 'person';

export interface MeasureScanResult {
  found: boolean;
  kind: MeasureScanKind | null;
  /** The reference's real-world height in metres — feeds computeHeightRangedDistance. */
  real_height_m: number | null;
  /** Normalized frame coords (0..1) of the reference's top and ground-contact base. */
  top: { x: number; y: number } | null;
  base: { x: number; y: number } | null;
  confidence: 'high' | 'medium' | 'low' | null;
  notes?: string | null;
}

const NOT_FOUND: MeasureScanResult = {
  found: false, kind: null, real_height_m: null, top: null, base: null, confidence: null,
};

/**
 * Ask the vision brain to find a known-height reference in this frame.
 *
 * Never throws and never returns a partial result: any failure — offline, timeout, malformed
 * response, a reference the model isn't sure about — comes back as found=false so the caller simply
 * keeps its existing read. The two-tap manual path stays available regardless.
 *
 * 12s: this is one vision call on a single still, taken while the user holds the phone up. Longer
 * than that and they've moved, so the answer would describe a frame that no longer exists.
 */
export async function scanForMeasureReference(imageBase64: string, mediaType = 'image/jpeg'): Promise<MeasureScanResult> {
  if (!imageBase64) return NOT_FOUND;
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/measure-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...appKeyHeaders() },
      body: JSON.stringify({ image_b64: imageBase64, image_media_type: mediaType }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return NOT_FOUND;
    const j = (await res.json()) as Partial<MeasureScanResult>;
    const okPt = (p: unknown): p is { x: number; y: number } =>
      !!p && typeof p === 'object'
      && Number.isFinite((p as { x: number }).x) && Number.isFinite((p as { y: number }).y);
    // A "found" result missing either endpoint or a height is not usable — treat it as not found
    // rather than half-trusting it, which is how a fabricated distance would get on screen.
    if (!j.found || !okPt(j.top) || !okPt(j.base) || !(Number(j.real_height_m) > 0)) return NOT_FOUND;
    return {
      found: true,
      kind: (j.kind as MeasureScanKind) ?? null,
      real_height_m: Number(j.real_height_m),
      top: j.top,
      base: j.base,
      confidence: (j.confidence as MeasureScanResult['confidence']) ?? 'medium',
      notes: j.notes ?? null,
    };
  } catch {
    return NOT_FOUND;
  }
}
