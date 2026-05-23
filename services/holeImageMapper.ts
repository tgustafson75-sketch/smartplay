/**
 * 2026-05-22 — Hole Image Mapper.
 *
 * Single resolver in front of every per-hole image source so SmartVision
 * (and any future caller) all consult the same priority chain:
 *
 *   1. Bundled screenshot via local: courseId        — local_by_id (90)
 *   2. Bundled screenshot via course-name substring  — local_by_name (70)
 *   3. Palms alias                                    — palms_alias (50)
 *   4. Mapbox per-hole satellite tile                 — mapbox (80)
 *      (only when we have tee + green coords AND token is configured)
 *   5. Google Static Maps satellite                   — google (75)
 *      (only when we have green coords AND key is configured)
 *   6. null                                            — none (0)
 *
 * Bundled wins because the user already paid the asset-bundle cost to
 * ship those courses and they're highest fidelity. Mapbox/Google only
 * fire for courses the user looked up via golfcourseapi — i.e. courses
 * we don't have bundled.
 *
 * Returns a metadata envelope so the consumer can pick a render style
 * (full vs thumbnail, image vs URL) and surface confidence.
 */

import type { ImageSourcePropType } from 'react-native';
import {
  getLocalHoleImageById,
  getLocalHoleImage,
} from '../data/localCourseImages';
import PALMS_IMAGES from '../data/palmsImages';
import { getHoleImageryUrl, isMapboxConfigured } from './mapboxImagery';
import { devLog } from './devLog';

export type HoleImageSource =
  | 'local_by_id'
  | 'local_by_name'
  | 'palms_alias'
  | 'mapbox'
  | 'google'
  | 'none';

export interface LatLng { lat: number; lng: number }

export interface HoleImageResolveInput {
  courseId: string | null;
  courseName: string | null;
  holeNumber: number;
  par?: number;
  yardage?: number;
  tee?: LatLng | null;
  green?: LatLng | null;
  /** Render container dimensions — passed to mapbox URL builder so the
   *  fit-view zoom matches the surface it'll render in. */
  width?: number;
  height?: number;
}

export interface HoleImageResolution {
  /** A ready-to-use Image source. `{ uri }` for remote, require() module
   *  for bundled. null when nothing available. */
  source: ImageSourcePropType | null;
  /** Raw URL when remote (Mapbox / Google); null for bundled. Exposed so
   *  callers can prefetch / cache outside React Native's Image. */
  url: string | null;
  source_type: HoleImageSource;
  /** 0..100. Higher is better. */
  confidence: number;
}

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

export function resolveHoleImage(input: HoleImageResolveInput): HoleImageResolution {
  const { courseId, courseName, holeNumber } = input;
  if (holeNumber < 1) return empty();

  // 1. Bundled by canonical local: id (highest fidelity for shipped courses).
  const byId = getLocalHoleImageById(courseId, holeNumber);
  if (byId) {
    devLog(`[holeImageMapper] local_by_id course=${courseId} hole=${holeNumber}`);
    return { source: byId, url: null, source_type: 'local_by_id', confidence: 90 };
  }

  // 2. Bundled by course-name substring match.
  const byName = getLocalHoleImage(courseName, holeNumber);
  if (byName) {
    devLog(`[holeImageMapper] local_by_name "${courseName}" hole=${holeNumber}`);
    return { source: byName, url: null, source_type: 'local_by_name', confidence: 70 };
  }

  // 3. Palms alias (legacy: only when name explicitly mentions palms).
  if (courseName && courseName.toLowerCase().includes('palms')) {
    const alias = PALMS_IMAGES[holeNumber] ?? null;
    if (alias) {
      devLog(`[holeImageMapper] palms_alias hole=${holeNumber}`);
      return { source: alias, url: null, source_type: 'palms_alias', confidence: 50 };
    }
  }

  // 4. Mapbox per-hole satellite tile. Needs tee + green + configured token.
  if (isMapboxConfigured() && input.green) {
    const mapboxUrl = getHoleImageryUrl(
      {
        courseId,
        holeNumber,
        par: input.par ?? 4,
        yardage: input.yardage ?? 380,
        tee: input.tee ?? null,
        green: input.green,
      },
      { width: input.width, height: input.height },
    );
    if (mapboxUrl) {
      devLog(`[holeImageMapper] mapbox hole=${holeNumber} course=${courseId ?? 'api'}`);
      return {
        source: { uri: mapboxUrl },
        url: mapboxUrl,
        source_type: 'mapbox',
        confidence: 80,
      };
    }
  }

  // 5. Google Static Maps satellite — straight aerial centered on green.
  //    No tile rotation; simpler than Mapbox's hole-axis fit. Still useful
  //    when Mapbox isn't configured or returned null.
  if (GOOGLE_MAPS_KEY && input.green) {
    const zoom = pickGoogleZoom(input.par ?? 4, input.yardage ?? 380);
    const w = Math.min(input.width ?? 600, 640);
    const h = Math.min(input.height ?? 500, 640);
    const heading =
      input.tee && input.green
        ? Math.round(bearingDeg(input.tee, input.green))
        : 0;
    const url =
      'https://maps.googleapis.com/maps/api/staticmap?' +
      `center=${input.green.lat.toFixed(6)},${input.green.lng.toFixed(6)}` +
      `&zoom=${zoom}` +
      `&size=${w}x${h}` +
      `&maptype=satellite` +
      (heading > 0 ? `&heading=${heading}` : '') +
      `&key=${GOOGLE_MAPS_KEY}`;
    devLog(`[holeImageMapper] google hole=${holeNumber} course=${courseId ?? 'api'}`);
    return {
      source: { uri: url },
      url,
      source_type: 'google',
      confidence: 75,
    };
  }

  devLog(`[holeImageMapper] none — no source for course=${courseId} / "${courseName}" hole=${holeNumber}`);
  return empty();
}

function empty(): HoleImageResolution {
  return { source: null, url: null, source_type: 'none', confidence: 0 };
}

function pickGoogleZoom(par: number, yardage: number): number {
  if (par === 3 || yardage < 180) return 18;
  if (yardage < 400) return 17;
  return 16;
}

function bearingDeg(a: LatLng, b: LatLng): number {
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const φ1 = a.lat * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
