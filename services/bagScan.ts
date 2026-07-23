/**
 * 2026-07-23 (Tim — Bag Vision) — scan a bag from a short VIDEO, client side.
 *
 * The user records a few seconds panning across their clubs; we pull a handful of frames and
 * post them to /api/bag-scan, which returns the distinct clubs with product specifics. Far
 * less annoying than photographing 14 clubs one at a time. The returned set populates the bag
 * (clubBagStore) and — turned around — sharpens live auto club detection (services/clubRecognition
 * can constrain its reads to the set the player actually owns).
 *
 * Best-effort + honest: extraction/network failures return an empty list, never throw.
 */
import * as VT from '../utils/videoThumbnail';
import * as ImageManipulator from 'expo-image-manipulator';
import { getApiBaseUrl } from './apiBase';

export type ScannedClub = {
  club_id: string;
  club_type: string;
  brand: string;
  model: string;
  loft: string;
  confidence: 'high' | 'medium' | 'low';
};

// Sample timestamps (ms) across a short pan. We tolerate failures (a clip shorter than the last
// timestamp just yields fewer frames) so recording length isn't rigid.
const SAMPLE_TIMES_MS = [300, 1100, 1900, 2700, 3500, 4300];
const FRAME_MAX_W = 1024;

/** Pull evenly-spaced base64 JPEG frames from a video clip. Returns [] if none extract. */
export async function extractBagFrames(clipUri: string): Promise<string[]> {
  const frames: string[] = [];
  for (const time of SAMPLE_TIMES_MS) {
    try {
      const { uri } = await VT.getThumbnailAsync(clipUri, { time, quality: 0.7 });
      const m = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: FRAME_MAX_W } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (m.base64) frames.push(m.base64);
    } catch {
      // Frame beyond clip end / decode hiccup — skip and keep going.
    }
  }
  return frames;
}

/**
 * Scan a bag video → detected clubs. `apiUrl` optional (defaults to getApiBaseUrl()). Never throws.
 */
export async function scanBagFromVideo(clipUri: string, apiUrl?: string): Promise<ScannedClub[]> {
  if (!clipUri) return [];
  const frames = await extractBagFrames(clipUri);
  if (frames.length === 0) return [];
  return scanBagFromFrames(frames, apiUrl);
}

/** Post already-extracted base64 frames to /api/bag-scan. Exposed for reuse/testing. */
export async function scanBagFromFrames(framesBase64: string[], apiUrl?: string): Promise<ScannedClub[]> {
  const base = apiUrl || getApiBaseUrl();
  if (!base || framesBase64.length === 0) return [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/bag-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: framesBase64.map((b64) => ({ b64, media_type: 'image/jpeg' })) }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as { clubs?: unknown };
    if (!Array.isArray(data.clubs)) return [];
    return data.clubs
      .map((c): ScannedClub | null => {
        const o = (c ?? {}) as Record<string, unknown>;
        const club_id = String(o.club_id ?? '');
        if (!club_id) return null;
        const conf = o.confidence;
        return {
          club_id,
          club_type: typeof o.club_type === 'string' ? o.club_type : 'unknown',
          brand: typeof o.brand === 'string' ? o.brand : '',
          model: typeof o.model === 'string' ? o.model : '',
          loft: typeof o.loft === 'string' ? o.loft : '',
          confidence: conf === 'high' || conf === 'medium' ? conf : 'low',
        };
      })
      .filter((c): c is ScannedClub => c != null);
  } catch {
    return [];
  }
}
