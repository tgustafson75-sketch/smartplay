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

/**
 * 2026-09-14 (Tim — "I am going to include a couple of balls in the photo").
 * A ball read out of the same frames. Model is always present — the route drops a brand-only read,
 * because `services/ballPerformance` compares models and a bare brand cannot be compared to anything.
 */
export type ScannedBall = {
  brand: string;
  model: string;
  confidence: 'high' | 'medium' | 'low';
};

/** What one scan saw. Clubs and balls come from the same images in one call. */
export type BagScanResult = {
  clubs: ScannedClub[];
  balls: ScannedBall[];
};

const EMPTY_SCAN: BagScanResult = { clubs: [], balls: [] };

// Sample timestamps (ms) across a short pan. We tolerate failures (a clip shorter than the last
// timestamp just yields fewer frames) so recording length isn't rigid.
const SAMPLE_TIMES_MS = [300, 1100, 1900, 2700, 3500, 4300];
const FRAME_MAX_W = 1024;
/** The route accepts 8; asking for more just gets them dropped server-side. */
const MAX_IMAGES = 8;

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
 * Scan a bag video → what was in it. `apiUrl` optional (defaults to getApiBaseUrl()). Never throws.
 */
export async function scanBagFromVideo(clipUri: string, apiUrl?: string): Promise<BagScanResult> {
  if (!clipUri) return EMPTY_SCAN;
  const frames = await extractBagFrames(clipUri);
  if (frames.length === 0) return EMPTY_SCAN;
  return scanBagFromFrames(frames, apiUrl);
}

/**
 * 2026-09-14 (Tim — "Add ability to add photos for review too. If it persists the first time, then
 * anything it missed I can take a picture of.")
 *
 * THE SECOND PASS IS THE POINT. A video pan reads most of a bag and misses a few — a head turned
 * away, a wedge in shadow. Photographing the stragglers is a far better repair than re-recording the
 * whole bag and hoping for a better take, and it is only useful because the first pass now persists.
 *
 * Photos go down the SAME route as frames: the API has never cared whether an image came from a
 * video, and giving photos their own endpoint would have been a second prompt to keep in step with
 * the catalog. Resized and compressed to the same ceiling so a 12 MP still cannot blow the payload
 * limit that six video frames sit comfortably inside.
 */
export async function scanBagFromPhotos(photoUris: string[], apiUrl?: string): Promise<BagScanResult> {
  const uris = (photoUris ?? []).filter((u) => typeof u === 'string' && u.length > 0).slice(0, MAX_IMAGES);
  if (uris.length === 0) return EMPTY_SCAN;
  const frames: string[] = [];
  for (const uri of uris) {
    try {
      const m = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: FRAME_MAX_W } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (m.base64) frames.push(m.base64);
    } catch {
      // One unreadable photo does not fail the batch — the others still describe real clubs.
    }
  }
  if (frames.length === 0) return EMPTY_SCAN;
  return scanBagFromFrames(frames, apiUrl);
}

/** Post already-extracted base64 images to /api/bag-scan. Exposed for reuse/testing. */
export async function scanBagFromFrames(framesBase64: string[], apiUrl?: string): Promise<BagScanResult> {
  const base = apiUrl || getApiBaseUrl();
  if (!base || framesBase64.length === 0) return EMPTY_SCAN;
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
    if (!res.ok) return EMPTY_SCAN;
    const data = (await res.json()) as { clubs?: unknown; balls?: unknown };
    const balls: ScannedBall[] = (Array.isArray(data.balls) ? data.balls : [])
      .map((b): ScannedBall | null => {
        const o = (b ?? {}) as Record<string, unknown>;
        const model = typeof o.model === 'string' ? o.model.trim() : '';
        if (!model) return null;
        const conf = o.confidence;
        return {
          brand: typeof o.brand === 'string' ? o.brand.trim() : '',
          model,
          confidence: conf === 'high' || conf === 'medium' ? conf : 'low',
        };
      })
      .filter((b): b is ScannedBall => b != null);
    if (!Array.isArray(data.clubs)) return { clubs: [], balls };
    const clubs = data.clubs
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
    return { clubs, balls };
  } catch {
    return EMPTY_SCAN;
  }
}
