/**
 * Phase BR — Tutorial analysis client.
 *
 * Calls /api/tutorial-analysis to extract structured teaching content
 * from a tutorial entry's title + notes + (optional) representative
 * frame. Returns a tagged-union outcome so the upload UI can render
 * the right state without crashing on network/parse failures.
 *
 * Audio transcription is intentionally NOT here yet (BR2 scope — see
 * docs/tutorial-analysis-architecture.md "What's deferred"). When BR2
 * ships, this service will gain a `transcribeAndAnalyze` function that
 * extracts audio from the video file, calls Whisper, and feeds the
 * transcript into the same /api/tutorial-analysis endpoint.
 */

// 2026-05-25 — SDK 54 moved readAsStringAsync to the legacy module.
// Same fix pattern as services/glassesVisionInput.ts:262 and
// app/profile/custom-caddie.tsx. Without /legacy this throws "undefined
// is not a function" at runtime as soon as a tutorial video read fires.
import * as FileSystem from 'expo-file-system/legacy';
import { track } from './analytics';
import type { ClubId } from './clubRecognition';

export interface TutorialAnalysisResult {
  kind: 'ok';
  teaching_focus: string;
  key_cues: string[];
  target_clubs: ClubId[];
  target_situations: string[];
  instructor: string | null;
  confidence: 'high' | 'medium' | 'low';
  latency_ms: number;
}

export type TutorialAnalysisOutcome =
  | TutorialAnalysisResult
  | { kind: 'no_network'; latency_ms: number }
  | { kind: 'error'; message: string; latency_ms: number };

const REQUEST_TIMEOUT_MS = 20_000;

export interface TutorialAnalysisInput {
  title: string;
  notes?: string | null;
  /** Optional: a single representative frame extracted client-side from
   *  a video. Adds visual context to the Sonnet extraction. */
  frame_uri?: string | null;
}

async function uriToBase64(uri: string): Promise<string> {
  return await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
}

export async function analyzeTutorial(
  input: TutorialAnalysisInput,
  apiUrl: string,
): Promise<TutorialAnalysisOutcome> {
  const startedAt = Date.now();

  if (!input.title?.trim()) {
    return { kind: 'error', message: 'title required', latency_ms: 0 };
  }
  if (!apiUrl) {
    return { kind: 'error', message: 'apiUrl missing', latency_ms: 0 };
  }

  let frame: { b64: string; media_type: string } | undefined;
  if (input.frame_uri) {
    try {
      const b64 = await uriToBase64(input.frame_uri);
      frame = { b64, media_type: 'image/jpeg' };
    } catch (e) {
      // Frame is optional — skip on extract failure rather than fail
      // the whole analysis. The Sonnet prompt handles text-only input.
      track('tutorial_frame_extract_failed', {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${apiUrl}/api/tutorial-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title.trim(),
        notes: input.notes?.trim() ?? '',
        ...(frame ? { frame } : {}),
        voiceGender: require('../store/settingsStore').useSettingsStore.getState().voiceGender ?? 'male',
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const latency_ms = Date.now() - startedAt;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      track('tutorial_analysis_failed', {
        status: res.status,
        latency_ms,
        body_preview: text.slice(0, 200),
      });
      // 2026-07-15 (audit) — the raw body (HTML proxy page / provider JSON) must not reach the
      // user; keep the preview in telemetry only, show friendly copy.
      return { kind: 'error', message: 'Couldn’t analyze that tutorial right now — try again in a moment.', latency_ms };
    }

    const data = await res.json() as Partial<TutorialAnalysisResult>;
    const result: TutorialAnalysisResult = {
      kind: 'ok',
      teaching_focus: data.teaching_focus ?? input.title.trim(),
      key_cues: Array.isArray(data.key_cues) ? data.key_cues : [],
      target_clubs: Array.isArray(data.target_clubs) ? data.target_clubs as ClubId[] : [],
      target_situations: Array.isArray(data.target_situations) ? data.target_situations : [],
      instructor: data.instructor ?? null,
      confidence: data.confidence ?? 'low',
      latency_ms,
    };

    track('tutorial_analysis_ok', {
      confidence: result.confidence,
      latency_ms,
      key_cues_count: result.key_cues.length,
      target_clubs_count: result.target_clubs.length,
    });

    return result;
  } catch (e) {
    clearTimeout(timer);
    const latency_ms = Date.now() - startedAt;
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (/network|abort|timeout|fetch/i.test(message)) {
      track('tutorial_analysis_no_network', { latency_ms });
      return { kind: 'no_network', latency_ms };
    }
    track('tutorial_analysis_error', { message, latency_ms });
    return { kind: 'error', message, latency_ms };
  }
}
