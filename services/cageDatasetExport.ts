/**
 * 2026-09-12 (Tim) — THE CAGE DATASET HAD NO EXIT.
 *
 * `app/practice-session/target-calibration.tsx` has been collecting labelled acoustic samples since
 * it was built — listen for the strike, tap where it hit, save the WAV alongside the hit position,
 * peak dB and cage geometry. Its own header says the result *"can be batch-sent to
 * /api/acoustic-detect for server-side spectral analysis to find canvas-center vs canvas-edge vs net
 * discriminating features"*.
 *
 * "Can be". Nothing did. `targetSamples` was written by that screen and read only by that same
 * screen, for its own scatter plot and counts — so every sample Tim patiently labelled stayed on one
 * device and taught nothing. [[sweep-the-missing-half-not-the-unused-export]]
 *
 * WHAT THIS EXPORTS, and why not the audio. Posting 200 WAVs out of the app would be slow, large and
 * mostly redundant: the interesting part is not the waveform, it is the FEATURES the detector reads
 * from it against the label the player gave. So each sample is run through the existing
 * /api/acoustic-detect client, and the result is a compact table of
 * {label, hit position, peak, impact/echo timing, derived cage distance, confidence} — small enough
 * to share as JSON, and exactly the shape a discriminator would be fitted on.
 *
 * The WAVs stay on device (durably, since 2026-09-12) so a richer pass can always go back to them.
 *
 * HONEST ABOUT FAILURES: a sample whose audio has gone, or whose detection fails, is reported as a
 * skip WITH ITS REASON rather than quietly dropped. A dataset that silently shrinks is worse than a
 * small one, because nobody knows which half is missing.
 */
import { detectBallSpeed } from './acousticDetectApi';
import { useAcousticCalibrationStore, type CageTargetSample } from '../store/acousticCalibrationStore';

export interface CageDatasetRow {
  id: string;
  capturedAt: number;
  /** The LABEL — what the player said happened. */
  hitType: CageTargetSample['hitType'];
  hitX: number | null;
  hitY: number | null;
  /** What the microphone recorded. */
  peakDb: number;
  /** What the detector derived, or null when it could not run. */
  impactMs: number | null;
  echoMs: number | null;
  deltaMs: number | null;
  cageDistanceYards: number | null;
  confidence: number | null;
}

export interface CageDatasetExport {
  exportedAt: number;
  totalSamples: number;
  rows: CageDatasetRow[];
  /** Samples that could not be processed, each with the reason. Never silently dropped. */
  skipped: { id: string; reason: 'no_audio' | 'detect_failed' }[];
}

/**
 * Build the feature table from every stored sample.
 *
 * Sequential on purpose: this is a server round-trip per sample against a route with a 30s ceiling,
 * and firing 200 at once is exactly the self-inflicted traffic that starved the foreground once
 * before. [[our-own-traffic-starves-the-foreground]] `onProgress` exists so the screen can show it
 * working rather than appearing hung.
 */
export async function buildCageDataset(
  onProgress?: (done: number, total: number) => void,
): Promise<CageDatasetExport> {
  const samples = useAcousticCalibrationStore.getState().targetSamples;
  const rows: CageDatasetRow[] = [];
  const skipped: CageDatasetExport['skipped'] = [];

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    onProgress?.(i, samples.length);

    if (!s.wavUri) { skipped.push({ id: s.id, reason: 'no_audio' }); continue; }

    // club is deliberately omitted: the server's ball-speed heuristic would scale a club-typical
    // number, and this dataset is about the ACOUSTIC signature, not a speed guess.
    const r = await detectBallSpeed({ audioUri: s.wavUri, impact_ms: null });
    if (!r) { skipped.push({ id: s.id, reason: 'detect_failed' }); continue; }

    rows.push({
      id: s.id,
      capturedAt: s.capturedAt,
      hitType: s.hitType,
      hitX: s.hitX ?? null,
      hitY: s.hitY ?? null,
      peakDb: s.peakDb,
      impactMs: r.impact_ms ?? null,
      echoMs: r.echo_ms ?? null,
      deltaMs: r.delta_ms ?? null,
      cageDistanceYards: r.cage_distance_yards ?? null,
      confidence: r.confidence ?? null,
    });
  }

  onProgress?.(samples.length, samples.length);
  return { exportedAt: Date.now(), totalSamples: samples.length, rows, skipped };
}

/** One-line summary for the screen, stating the skips out loud. */
export function describeCageDataset(d: CageDatasetExport): string {
  const labelled = d.rows.filter((r) => r.hitType !== 'net').length;
  const bits = [`${d.rows.length} of ${d.totalSamples} samples`, `${labelled} on canvas`];
  if (d.skipped.length > 0) {
    const noAudio = d.skipped.filter((s) => s.reason === 'no_audio').length;
    const failed = d.skipped.length - noAudio;
    if (noAudio > 0) bits.push(`${noAudio} lost their audio`);
    if (failed > 0) bits.push(`${failed} failed detection`);
  }
  return bits.join(' · ');
}
