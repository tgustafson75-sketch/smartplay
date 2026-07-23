/**
 * 2026-07-23 (Tim — SmartFinder auto-detect) — client for api/measure-scan.
 *
 * The Measure mode ranges off a known-height object by the angular height it fills — normally
 * the user taps the object's TOP + BASE. This calls our vision brain to do that tap
 * automatically: send the camera frame, get back the best known-size reference (flagstick or
 * person) with its top + base in NORMALIZED image coords, feed straight into
 * services/rangefinder.computeHeightRangedDistance. HONEST: found=false when the model can't
 * clearly see both the top and the ground-contact base → the caller keeps the manual two-tap.
 */
import { getApiBaseUrl } from './apiBase';

export type MeasureScanResult = {
  found: boolean;
  kind: 'flagstick' | 'person' | 'none';
  real_height_m: number;
  top: { x: number; y: number } | null;
  base: { x: number; y: number } | null;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
};

const NOT_FOUND: MeasureScanResult = { found: false, kind: 'none', real_height_m: 0, top: null, base: null, confidence: 'low' };

/**
 * Detect a known-size reference in a camera frame. Best-effort — returns a found=false result
 * (never throws) on any network/parse failure so the UI cleanly falls back to manual tapping.
 */
export async function detectMeasureReference(imageBase64: string, mediaType: 'image/jpeg' | 'image/png' = 'image/jpeg'): Promise<MeasureScanResult> {
  const b64 = (imageBase64 || '').trim();
  if (!b64) return NOT_FOUND;
  const base = getApiBaseUrl();
  if (!base) return NOT_FOUND;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/measure-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_b64: b64, image_media_type: mediaType }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return NOT_FOUND;
    const data = (await res.json()) as Partial<MeasureScanResult>;
    const top = validPoint(data.top);
    const base2 = validPoint(data.base);
    const kind = data.kind === 'flagstick' || data.kind === 'person' ? data.kind : 'none';
    const heightM = Number(data.real_height_m);
    const found = data.found === true && kind !== 'none' && !!top && !!base2 && Number.isFinite(heightM) && heightM > 0;
    if (!found) return { ...NOT_FOUND, notes: typeof data.notes === 'string' ? data.notes : undefined };
    return {
      found: true,
      kind,
      real_height_m: heightM,
      top,
      base: base2,
      confidence: data.confidence === 'high' || data.confidence === 'medium' ? data.confidence : 'low',
      notes: typeof data.notes === 'string' ? data.notes : undefined,
    };
  } catch {
    return NOT_FOUND;
  }
}

function validPoint(v: unknown): { x: number; y: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { x?: unknown; y?: unknown };
  const x = Number(o.x), y = Number(o.y);
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
