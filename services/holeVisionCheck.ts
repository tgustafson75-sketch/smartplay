/**
 * 2026-10-13 (Tim — "we have computer vision to find a tee's green and its tee box… we can correlate our
 * own information pretty cheaply") — THE VISION CROSS-CHECK OF A HOLE THE COURSE ENGINE PAIRED.
 *
 * The engine pairs each hole's tee and green from the course database and OpenStreetMap. Where the
 * database has no tee, the green is chosen by walking the routing from the previous green — so hole 1
 * can start at the green nearest the clubhouse and every hole after it follows the wrong one. Nothing
 * checked the result against the picture. Our own vision read (api/hole-scan) already outlines a hole's
 * green and tee from the satellite tile; this frames each paired hole and asks it independently.
 *
 * Pure: the frame to request and the verdict from the read. The server route (api/course-verify) does
 * the fetching and storing; the client (services/courseVerification) applies verdicts.
 */
import { unprojectTilePixel } from './smartVisionOverlay';
import { haversineYards } from '../utils/geoDistance';
import { MAPBOX_Z0_METERS_PER_PX as Z0_M_PER_PX } from '../utils/mapboxScale';

export type LatLng = { lat: number; lng: number };
export const CHECK_TILE_PX = 1024;
/** A green this close to where vision sees one is the same green (green radius ~15 yd + read error). */
export const GREEN_MATCH_YD = 25;
/** Vision sees the hole's green this far from ours, confidently: ours is the wrong green. */
export const GREEN_MISMATCH_YD = 40;


/**
 * North-up tile centred on the hole, zoomed so the tee, the green and a margin around both fit. The
 * hole is the CENTRE of the frame, which is what hole-scan is told to read when a wide frame holds
 * several holes.
 */
export function frameForHole(tee: LatLng | null, green: LatLng): { center: LatLng; zoom: number; spanYards: number } {
  const center = tee ? { lat: (tee.lat + green.lat) / 2, lng: (tee.lng + green.lng) / 2 } : green;
  const holeYd = tee ? haversineYards(tee, green) : 0;
  // the hole plus 60 yd beyond each end, never tighter than a 220-yd frame (a green alone)
  const spanM = Math.max(220, holeYd * 1.25 + 120) * 0.9144;
  const mpp = spanM / CHECK_TILE_PX;
  const raw = Math.log2((Z0_M_PER_PX * Math.cos((center.lat * Math.PI) / 180)) / mpp);
  const zoom = Math.max(15, Math.min(19, Math.floor(raw)));
  const actualMpp = (Z0_M_PER_PX * Math.cos((center.lat * Math.PI) / 180)) / 2 ** zoom;
  return { center, zoom, spanYards: (actualMpp * CHECK_TILE_PX) / 0.9144 };
}

export function pointFromTile(p: { x: number; y: number }, frame: { center: LatLng; zoom: number }): LatLng {
  return unprojectTilePixel(p.x * CHECK_TILE_PX, p.y * CHECK_TILE_PX, frame.center, frame.zoom, 0, CHECK_TILE_PX, CHECK_TILE_PX);
}

export type HoleCheck = {
  verdict: 'verified' | 'unconfirmed' | 'suspect';
  /** Yards from our green to the green vision found; null when it found none. */
  greenOffYd: number | null;
  /** Yards from our tee to the tee vision found (informational — a hole has several tee boxes). */
  teeOffYd: number | null;
  /** Where vision put this hole's green, when it found one. */
  visionGreen: LatLng | null;
};

/**
 * The verdict. Decided by the GREEN — the thing every yardage is measured to:
 *   verified    — vision found a green within GREEN_MATCH_YD of ours;
 *   suspect     — vision CONFIDENTLY (medium/high) found this hole's green more than GREEN_MISMATCH_YD away;
 *   unconfirmed — it found none, was unsure, or landed in between. Not a guess either way.
 */
export function judgeHole(
  ours: { tee: LatLng | null; green: LatLng },
  read: { found_green: boolean; green_center: LatLng | null; tee: LatLng | null; confidence: 'high' | 'medium' | 'low' },
): HoleCheck {
  const visionGreen = read.found_green && read.green_center ? read.green_center : null;
  const greenOffYd = visionGreen ? Math.round(haversineYards(visionGreen, ours.green)) : null;
  const teeOffYd = read.tee && ours.tee ? Math.round(haversineYards(read.tee, ours.tee)) : null;
  let verdict: HoleCheck['verdict'] = 'unconfirmed';
  if (greenOffYd != null && greenOffYd <= GREEN_MATCH_YD) verdict = 'verified';
  else if (greenOffYd != null && greenOffYd > GREEN_MISMATCH_YD && read.confidence !== 'low') verdict = 'suspect';
  return { verdict, greenOffYd, teeOffYd, visionGreen };
}
