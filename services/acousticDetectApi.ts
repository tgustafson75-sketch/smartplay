/**
 * Client for /api/acoustic-detect (server-side ball-speed detection).
 *
 * Reads the WAV/M4A from the parallel impact-detector recording, base64-
 * encodes it, and POSTs to the endpoint along with the user's calibrated
 * cage distance. Returns a BallSpeedResult or null on any failure.
 *
 * Fire-and-forget at the call site: the on-device impact card already
 * shows a strike time + dB; the server speed is an enrichment that
 * lands when it lands. We don't block the result UI on this round-trip.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { getApiBaseUrl } from './apiBase';

export interface BallSpeedResult {
  /** Server-confirmed impact timestamp (independent of client metering). */
  impact_ms: number;
  /** Cage-wall echo timestamp. */
  echo_ms: number;
  /** Echo delay = echo_ms - impact_ms. */
  delta_ms: number;
  /** Cage distance derived from echo delay — real measurement. */
  cage_distance_yards: number;
  /** Ball-speed estimate (heuristic: club-typical × peak-amplitude factor). True
   *  ball speed needs 2 mics / radar / doppler. NULL when no club was provided —
   *  the honest split: cage distance + timing are still real. (audit #4) */
  ball_speed_mph: number | null;
  /** Detection confidence 0-1. */
  confidence: number;
  /** Peak loudness at impact, dBFS. */
  peak_db: number;
  source: 'acoustic_real';
}

const apiUrl = (): string => getApiBaseUrl();

export async function detectBallSpeed(args: {
  audioUri: string;
  impact_ms: number | null;
  /** Optional — server uses this for the ball-speed heuristic
   *  (club-typical × peak-amplitude factor). Defaults to 'unknown' so an
   *  untagged swing returns a null ball speed instead of being silently
   *  scaled to a 7-iron (honesty: don't imply a club we weren't told). */
  club?: string;
}): Promise<BallSpeedResult | null> {
  try {
    const base = apiUrl();
    if (!base) return null;

    const audioBase64 = await FileSystem.readAsStringAsync(args.audioUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!audioBase64 || audioBase64.length < 100) return null;

    const res = await fetch(base + '/api/acoustic-detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64,
        impact_ms: args.impact_ms ?? null,
        club: args.club ?? 'unknown',
      }),
      // 2026-07-06 (audit) — bound the wait (~1.5× the route's 30s maxDuration)
      // so a stalled connection returns null instead of hanging forever.
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<BallSpeedResult> & { configured?: boolean };
    // 2026-07-08 (cage audit #4) — the server intentionally returns a valid payload
    // (real impact/echo/cage-distance) with ball_speed_mph:null for an unknown club.
    // Dropping the WHOLE payload on a null speed threw away the real cage-distance
    // measurement and defeated the server's honesty contract. Keep the object when the
    // detection itself is real (a real impact_ms); let ball_speed_mph be independently null.
    if (data.configured === false || typeof data.impact_ms !== 'number') return null;
    return data as BallSpeedResult;
  } catch (e) {
    console.log('[acoustic-detect] failed:', e);
    return null;
  }
}
