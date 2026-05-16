/**
 * Acoustic ball-speed detection — server-side endpoint.
 *
 * Phase J.2 — Option C hybrid DSP. Client already detects the impact
 * timestamp on-device via expo-av metering (see services/acousticImpact
 * Detector.ts). This endpoint takes the parallel audio recording (small
 * WAV/M4A, ~150-300 KB for a 12s clip) and runs two-peak time-of-arrival
 * detection to compute ball speed.
 *
 * Math: speed_mph = (2 × distance_yards × 0.5556) / Δt_seconds
 *   - distance_yards = cage front-to-back distance the user calibrated
 *   - Δt = time between impact peak and rear-wall echo peak
 *   - 0.5556 = yards-to-meters factor for sanity, then mph conversion
 *
 * Status (this commit — session 1 of multi-session DSP work):
 *   - Endpoint scaffolding live.
 *   - Audio decode + real FFT peak-pair detection NOT YET IMPLEMENTED.
 *   - Returns mock data with source: 'mock_scaffold' so the client can
 *     wire the round-trip end-to-end and surface the UI today.
 *
 * Next session: replace the mock with `node-wav` decode + scipy-style
 * envelope peak detection. Iteration after: handle compressed M4A
 * formats too (expo-av on iOS returns M4A by default).
 *
 * Request:
 *   POST /api/acoustic-detect
 *   body: { audioBase64: string, distance_yards: number, impact_ms?: number }
 *
 * Response (success):
 *   { speed_mph: number, impact_ms: number, echo_ms: number,
 *     delta_ms: number, confidence: number, source: 'mock_scaffold' | 'acoustic_real' }
 *
 * Response (failure):
 *   { error: string }  with HTTP 400 / 500
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

interface SuccessBody {
  speed_mph: number;
  impact_ms: number;
  echo_ms: number;
  delta_ms: number;
  confidence: number;
  source: 'mock_scaffold' | 'acoustic_real';
}

interface ErrorBody { error: string; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' } as ErrorBody);
  }

  const body = (req.body ?? {}) as {
    audioBase64?: string;
    distance_yards?: number;
    impact_ms?: number;
  };

  const audio = body.audioBase64 ?? '';
  const distance = Number(body.distance_yards);
  const clientImpactMs = Number(body.impact_ms);

  if (!audio || audio.length < 100) {
    return res.status(400).json({ error: 'audioBase64 missing or too small' } as ErrorBody);
  }
  if (!Number.isFinite(distance) || distance < 2 || distance > 50) {
    return res.status(400).json({
      error: 'distance_yards must be 2-50 (your cage front-to-back distance)',
    } as ErrorBody);
  }

  // ──────────────────────────────────────────────────────────────────
  // Mock detection — placeholder while real DSP is being built.
  // Returns a speed in a club-typical range so the client UI can render
  // a real value during dev. The `source: 'mock_scaffold'` field lets
  // the client distinguish mock from real once the FFT detector ships.
  // ──────────────────────────────────────────────────────────────────
  const impactMs = Number.isFinite(clientImpactMs) ? clientImpactMs : 1800;

  // Speed of sound ≈ 343 m/s. distance_yards × 0.9144 = meters. Round
  // trip = 2 × that. So Δt = (2 × meters) / 343.
  const meters = distance * 0.9144;
  const expectedDeltaSec = (2 * meters) / 343;
  const deltaMs = expectedDeltaSec * 1000;
  const echoMs = impactMs + deltaMs;

  // Mock a realistic ball speed for a 7-iron-ish strike.
  const mockSpeed = 110 + Math.random() * 30; // 110-140 mph range

  const reply: SuccessBody = {
    speed_mph: Math.round(mockSpeed * 10) / 10,
    impact_ms: Math.round(impactMs),
    echo_ms: Math.round(echoMs),
    delta_ms: Math.round(deltaMs),
    confidence: 0.50,
    source: 'mock_scaffold',
  };

  return res.status(200).json(reply);
}
