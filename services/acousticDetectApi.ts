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

export interface BallSpeedResult {
  speed_mph: number;
  impact_ms: number;
  echo_ms: number;
  delta_ms: number;
  confidence: number;
  source: 'mock_scaffold' | 'acoustic_real';
}

const apiUrl = (): string => process.env.EXPO_PUBLIC_API_URL ?? '';

export async function detectBallSpeed(args: {
  audioUri: string;
  distance_yards: number;
  impact_ms: number | null;
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
        distance_yards: args.distance_yards,
        impact_ms: args.impact_ms ?? null,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<BallSpeedResult>;
    if (typeof data.speed_mph !== 'number') return null;
    return data as BallSpeedResult;
  } catch (e) {
    console.log('[acoustic-detect] failed:', e);
    return null;
  }
}
