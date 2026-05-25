/**
 * Acoustic detection — server-side endpoint.
 *
 * Phase J.2 — Option C hybrid DSP, session 2 (real body).
 *
 * What this does:
 *   1. Decodes the base64 WAV (forced WAV on both iOS + Android in
 *      acousticImpactDetector; 22050 Hz mono int16 PCM).
 *   2. Builds an envelope from the absolute sample values.
 *   3. Finds the primary peak (impact) AND the secondary peak (cage-
 *      wall echo) in a 5-80 ms window after the primary.
 *   4. Derives cage_distance_yards from the echo delay using speed of
 *      sound (343 m/s at 20°C). Δt = 2 × distance / 343 → distance =
 *      Δt × 343 / 2.
 *   5. Estimates ball_speed using club-typical × peak-amplitude factor.
 *      Tagged source: 'acoustic_real' to distinguish from the previous
 *      'mock_scaffold' or 'club_typical_stub' tags.
 *
 * Physics honesty:
 *   - The two-peak math measures CAGE DISTANCE, not ball speed (with
 *     one mic, speed of sound is fixed; echo delay only encodes
 *     geometry).
 *   - Ball speed is a HEURISTIC: club-typical baseline scaled by impact
 *     peak amplitude as a rough proxy for strike quality. True ball
 *     speed needs 2 mics, doppler, or radar — out of scope.
 *   - The confidence field reflects DETECTION confidence (did we find
 *     a clean peak pair?), not measurement accuracy.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

interface SuccessBody {
  /** Detected impact-frame timestamp in ms, server-confirmed from the
   *  WAV waveform (independent of the client's metering estimate). */
  impact_ms: number;
  /** Detected cage-wall echo timestamp. */
  echo_ms: number;
  /** Echo delay in ms. */
  delta_ms: number;
  /** Cage distance derived from echo delay. Math is real and reliable. */
  cage_distance_yards: number;
  /** Ball-speed HEURISTIC (club-typical × peak factor). Real ball-speed
   *  measurement needs hardware we don't have. null when the client
   *  posted no club / 'unknown' — we won't fake a 7I calibration just
   *  because we don't know the club. Honest read: detection is real,
   *  speed estimate is unavailable for this swing. Client falls back
   *  to pose-derivation when null. */
  ball_speed_mph: number | null;
  /** Confidence 0-1 in the peak-pair detection. */
  confidence: number;
  /** Peak loudness at impact in dBFS (for diagnostics). */
  peak_db: number;
  source: 'acoustic_real';
}

interface ErrorBody { error: string; }

const SOUND_SPEED_MPS = 343; // m/s at 20°C, ~sea level

// Club-typical ball speeds (mph). Same numbers as
// services/acousticBallSpeed.ts CLUB_TYPICAL_BALL_SPEED_MPH so the
// stub-era estimates remain consistent.
const CLUB_TYPICAL: Record<string, number> = {
  D: 155, '3W': 145, '5W': 138, H: 132,
  '3I': 128, '4I': 124, '5I': 120, '6I': 115,
  '7I': 108, '8I': 102, '9I': 95,
  PW: 88, GW: 80, SW: 72, LW: 62,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' } as ErrorBody);
  }

  const body = (req.body ?? {}) as {
    audioBase64?: string;
    impact_ms?: number;
    club?: string;
  };

  const audio = body.audioBase64 ?? '';
  if (!audio || audio.length < 200) {
    return res.status(400).json({ error: 'audioBase64 missing or too small' } as ErrorBody);
  }

  let pcm: { samples: Int16Array; sampleRate: number };
  try {
    pcm = decodeWav(Buffer.from(audio, 'base64'));
  } catch (e) {
    return res.status(400).json({
      error: `WAV decode failed: ${e instanceof Error ? e.message : String(e)}`,
    } as ErrorBody);
  }

  const detection = detectPeakPair(pcm.samples, pcm.sampleRate);
  if (!detection) {
    return res.status(200).json({
      error: 'no clean peak pair detected',
    } as ErrorBody);
  }

  // Cage distance from echo delay. Δt = 2 × distance / sound_speed.
  // → distance_m = Δt_s × sound_speed / 2
  const deltaSec = detection.deltaMs / 1000;
  const distanceMeters = (deltaSec * SOUND_SPEED_MPS) / 2;
  const distanceYards = Math.round(distanceMeters * 1.0936 * 10) / 10;

  // Ball speed heuristic.
  // Peak factor: -10 dBFS = 1.0× (clean center hit), -25 dBFS = 0.75×
  // (heel/toe/thin). Linearly interpolated between -10 and -40.
  const peakFactor = Math.max(0.5, Math.min(1.05, 1 + (detection.peakDb + 10) / 30));
  // 2026-05-24 P1.1 — Removed silent '7I' fallback. When the client
  // posts no club (or 'unknown' / empty), we DO NOT fake-calibrate
  // against 7-iron. The audio detection IS real (impact time, cage
  // distance, peak dB) — but ball-speed needs a known club factor
  // and we don't have one. Return null; client falls through to
  // pose-derived ball speed instead of presenting a wrong number.
  // SmartMotion + Quick Record's post-v1.2.2 "honest untagged" path
  // is the canonical caller for this branch.
  const rawClub = typeof body.club === 'string' ? body.club.trim() : '';
  const hasKnownClub = rawClub.length > 0 && rawClub.toLowerCase() !== 'unknown' && CLUB_TYPICAL[rawClub] !== undefined;
  const ballSpeed: number | null = hasKnownClub
    ? Math.round(CLUB_TYPICAL[rawClub] * peakFactor * 10) / 10
    : null;

  const reply: SuccessBody = {
    impact_ms: detection.impactMs,
    echo_ms: detection.echoMs,
    delta_ms: detection.deltaMs,
    cage_distance_yards: distanceYards,
    ball_speed_mph: ballSpeed,
    confidence: detection.confidence,
    peak_db: detection.peakDb,
    source: 'acoustic_real',
  };
  return res.status(200).json(reply);
}

// ─── WAV decode ─────────────────────────────────────────────────────

/**
 * Parses a standard 44-byte WAV header, returns Int16 PCM samples.
 * Supports 16-bit mono linear PCM at any sample rate. Throws on
 * anything else (compressed formats, multi-channel, float PCM).
 */
function decodeWav(buf: Buffer): { samples: Int16Array; sampleRate: number } {
  if (buf.length < 44) throw new Error('file too small');
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a WAV');
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAV header invalid');

  // Walk through chunks looking for 'fmt ' and 'data'.
  let p = 12;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let channels = 0;
  let dataStart = -1;
  let dataLen = 0;

  while (p + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', p, p + 4);
    const chunkSize = buf.readUInt32LE(p + 4);
    if (chunkId === 'fmt ') {
      const audioFormat = buf.readUInt16LE(p + 8);
      if (audioFormat !== 1) throw new Error(`unsupported audio format ${audioFormat}`);
      channels = buf.readUInt16LE(p + 10);
      sampleRate = buf.readUInt32LE(p + 12);
      bitsPerSample = buf.readUInt16LE(p + 22);
    } else if (chunkId === 'data') {
      dataStart = p + 8;
      dataLen = chunkSize;
      break;
    }
    p += 8 + chunkSize;
  }

  if (dataStart < 0) throw new Error('no data chunk');
  if (channels !== 1) throw new Error(`expected mono, got ${channels} channels`);
  if (bitsPerSample !== 16) throw new Error(`expected 16-bit PCM, got ${bitsPerSample}-bit`);
  if (!sampleRate) throw new Error('sampleRate is 0');

  const sampleCount = dataLen / 2;
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buf.readInt16LE(dataStart + i * 2);
  }
  return { samples, sampleRate };
}

// ─── Peak detection ─────────────────────────────────────────────────

interface PeakPair {
  impactMs: number;
  echoMs: number;
  deltaMs: number;
  peakDb: number;
  confidence: number;
}

/**
 * Find impact + echo peaks.
 *
 * Algorithm:
 *   1. Build an envelope by taking abs(sample) → downsample to 1ms
 *      bins (rough max within each bin).
 *   2. Find the global max → that's the impact bin.
 *   3. Search the [+5ms, +80ms] window after impact for the next local
 *      max. Echo arrival at typical cage distances (2-12 yards) falls
 *      in 11-65 ms range; the window covers both ends with margin.
 *   4. Confidence = (echo_amplitude / impact_amplitude) capped at 0.95.
 *      Low echo amplitude relative to impact = noisy detection.
 *
 * Returns null when no clear secondary peak is found.
 */
function detectPeakPair(samples: Int16Array, sampleRate: number): PeakPair | null {
  const samplesPerMs = sampleRate / 1000;
  const ms = Math.floor(samples.length / samplesPerMs);
  if (ms < 100) return null;

  // 1ms bin maxes.
  const env = new Float32Array(ms);
  for (let i = 0; i < ms; i++) {
    const start = Math.floor(i * samplesPerMs);
    const end = Math.floor((i + 1) * samplesPerMs);
    let m = 0;
    for (let j = start; j < end; j++) {
      const a = Math.abs(samples[j]);
      if (a > m) m = a;
    }
    env[i] = m;
  }

  // Global max → impact.
  let impactBin = 0;
  let impactVal = 0;
  for (let i = 0; i < ms; i++) {
    if (env[i] > impactVal) {
      impactVal = env[i];
      impactBin = i;
    }
  }
  if (impactVal < 1500) return null; // ~ -27 dBFS — too quiet to be a strike

  // Echo window: 5-80 ms after impact.
  const windowStart = impactBin + 5;
  const windowEnd = Math.min(impactBin + 80, ms);
  let echoBin = -1;
  let echoVal = 0;
  for (let i = windowStart; i < windowEnd; i++) {
    if (env[i] > echoVal) {
      echoVal = env[i];
      echoBin = i;
    }
  }
  if (echoBin < 0 || echoVal < impactVal * 0.10) return null;

  // dBFS for impact peak. int16 range = 32768. dB = 20·log10(v/32768).
  const peakDb = 20 * Math.log10(impactVal / 32768);
  const ratio = echoVal / impactVal;
  const confidence = Math.min(0.95, ratio * 1.2);

  return {
    impactMs: impactBin,
    echoMs: echoBin,
    deltaMs: echoBin - impactBin,
    peakDb: Math.round(peakDb * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
  };
}
