/**
 * Phase K — Pose detection client.
 *
 * Today: cloud-based via Anthropic vision (option a per spec). Frames
 * sampled from a swing clip are POSTed to /api/swing-analysis and the
 * structured swing-fault classification comes back.
 *
 * Future swap to local TFJS / MoveNet pose detection: replace the body of
 * `analyzeSwing()` (and optionally `extractKeyFrames()`) with a local
 * inference path. Consumer signature stays stable — `swingIssueClassifier`
 * and the rest of the pipeline don't change.
 *
 * Phase R update — `extractKeyFrames` now probes real clip duration via
 * expo-av before sampling, so uploaded videos (typically much longer than
 * a 2s cage capture) get frames spread across their actual swing window
 * rather than the first 2 seconds. Each returned frame carries its own
 * `time_sec` so consumers can wire detected-issue timestamp anchors.
 */

export type CanonicalIssue =
  | 'club_face_open'
  | 'club_face_closed'
  | 'swing_path_outside_in'
  | 'swing_path_inside_out'
  | 'attack_angle_steep'
  | 'attack_angle_shallow'
  | 'early_extension'
  | 'over_the_top'
  | 'chicken_wing'
  | 'reverse_pivot'
  | 'none';

export type SwingAnalysis = {
  detected_issue: CanonicalIssue;
  severity: 'minor' | 'moderate' | 'significant' | 'none';
  confidence: 'high' | 'medium' | 'low';
  observation: string;
  follow_up_question?: string | null;
};

export type SwingAnalysisResult =
  | { kind: 'ok'; analysis: SwingAnalysis; frame_timestamps_sec: number[] }
  | { kind: 'no_frames' }
  | { kind: 'no_network' }
  | { kind: 'error'; message: string };

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Sample 5 key frames from a swing clip via expo-video-thumbnails. Each
 * frame is extracted at a normalized time fraction (5%, 30%, 55%, 80%, 95%
 * of the clip — covers address through follow-through), resized + JPEG-
 * compressed via expo-image-manipulator, and returned as base64 ready for
 * the vision endpoint. Each frame carries its own `time_sec` so consumers
 * can anchor detected-issue timestamps for Phase R temporal alignment.
 *
 * Duration is probed via expo-av before sampling. If the probe fails or
 * returns nothing usable, falls back to a 2-second window (typical cage
 * capture length). Returns empty array on any failure — consumer treats
 * as `no_frames`.
 */
import * as VT from 'expo-video-thumbnails';
import * as ImageManipulator from 'expo-image-manipulator';
import { Audio } from 'expo-av';

// Phase V.6 diagnostic — single grep target. Filter via:
//   adb logcat | grep V6-DIAG
const V6 = (msg: string, data?: Record<string, unknown>): void => {
  if (data) console.log('[V6-DIAG] ' + msg + ' ' + JSON.stringify(data));
  else console.log('[V6-DIAG] ' + msg);
};

const FRAME_TIME_FRACTIONS = [0.05, 0.30, 0.55, 0.80, 0.95];
const FALLBACK_DURATION_MS = 2000;

export type Frame = { b64: string; media_type: string; time_sec: number };

async function probeDurationMs(clipUri: string): Promise<number> {
  // Phase V.6 — try Audio.Sound first (works when video has an audio
  // track), then probe via VT.getThumbnailAsync at large timestamps as a
  // fallback (if a frame extracts at t=Xms, the video is at least that
  // long). Many uploaded videos have no audio track, defeating the
  // Audio.Sound path silently — the VT probe rescues those.
  try {
    const { sound, status } = await Audio.Sound.createAsync({ uri: clipUri }, { shouldPlay: false });
    if (status.isLoaded && status.durationMillis && status.durationMillis > 0) {
      const ms = status.durationMillis;
      await sound.unloadAsync().catch(() => {});
      V6('STAGE 1 — duration probed via Audio.Sound', { duration_ms: ms });
      return ms;
    }
    await sound.unloadAsync().catch(() => {});
    V6('STAGE 1 — Audio.Sound loaded but no duration', { isLoaded: status.isLoaded });
  } catch (e) {
    V6('STAGE 1 — Audio.Sound failed', { error: e instanceof Error ? e.message : String(e) });
  }

  for (const ms of [30_000, 15_000, 8_000, 4_000, 2_000]) {
    try {
      await VT.getThumbnailAsync(clipUri, { time: ms, quality: 0.3 });
      V6('STAGE 1 — duration via VT lower bound', { at_least_ms: ms });
      return ms;
    } catch {
      // Frame extract at that timestamp failed → video is shorter.
    }
  }
  V6('STAGE 1 — duration unknown, fallback', { fallback_ms: FALLBACK_DURATION_MS });
  return FALLBACK_DURATION_MS;
}

export async function extractKeyFrames(clipUri: string): Promise<Frame[]> {
  if (!clipUri) {
    V6('STAGE 2 — empty clipUri, no frames');
    return [];
  }
  try {
    const durationMs = await probeDurationMs(clipUri);
    V6('STAGE 2 — extractKeyFrames start', {
      duration_ms: durationMs,
      target_fractions: FRAME_TIME_FRACTIONS,
    });
    const perFrameOutcomes: Array<{ idx: number; t_ms: number; ok: boolean; raw_uri_tail?: string; raw_size?: number; b64_kb?: number; error?: string }> = [];
    const frames = await Promise.all(
      FRAME_TIME_FRACTIONS.map(async (t, i) => {
        const timeMs = Math.round(durationMs * t);
        try {
          const r = await VT.getThumbnailAsync(clipUri, { time: timeMs, quality: 0.8 });
          let rawSize: number | undefined;
          try {
            const info = await import('expo-file-system/legacy').then(m => m.getInfoAsync(r.uri));
            if (info.exists) rawSize = (info as { size?: number }).size ?? undefined;
          } catch { /* size probe is informational */ }
          const m = await ImageManipulator.manipulateAsync(
            r.uri,
            [{ resize: { width: 1024 } }],
            { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true },
          );
          if (!m.base64) {
            perFrameOutcomes.push({ idx: i, t_ms: timeMs, ok: false, raw_uri_tail: r.uri.slice(-30), raw_size: rawSize, error: 'manipulator returned no base64' });
            return null;
          }
          perFrameOutcomes.push({
            idx: i, t_ms: timeMs, ok: true,
            raw_uri_tail: r.uri.slice(-30), raw_size: rawSize,
            b64_kb: Math.round(m.base64.length / 1024),
          });
          return { b64: m.base64, media_type: 'image/jpeg', time_sec: timeMs / 1000 };
        } catch (err) {
          perFrameOutcomes.push({ idx: i, t_ms: timeMs, ok: false, error: err instanceof Error ? err.message : String(err) });
          return null;
        }
      }),
    );
    const valid = frames.filter((f): f is Frame => f !== null);
    V6('STAGE 2 — extractKeyFrames done', {
      successful: valid.length,
      attempted: FRAME_TIME_FRACTIONS.length,
      per_frame: perFrameOutcomes,
    });
    return valid;
  } catch (e) {
    V6('STAGE 2 — extractKeyFrames threw', { error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/**
 * Analyze a single swing. Extracts frames, sends to vision endpoint, returns
 * structured swing fault + the list of timestamps (in seconds) those frames
 * were sampled from. Returns no_frames result when frame extraction is
 * unavailable so the consumer renders honest empty-state instead of fake
 * data.
 */
export async function analyzeSwing(
  clipUri: string,
  context: { club: string; swing_number: number; prior_issues?: string[] },
): Promise<SwingAnalysisResult> {
  V6('STAGE 2 — analyzeSwing enter', {
    club: context.club,
    swing_number: context.swing_number,
    prior_issues_count: context.prior_issues?.length ?? 0,
  });
  const frames = await extractKeyFrames(clipUri);
  if (frames.length === 0) {
    V6('STAGE 3 SKIP — no_frames (no usable frames extracted)');
    return { kind: 'no_frames' };
  }

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  try {
    const wireFrames = frames.map(({ b64, media_type }) => ({ b64, media_type }));
    const totalKB = Math.round(wireFrames.reduce((acc, f) => acc + f.b64.length, 0) / 1024);
    V6('STAGE 3 — POST /api/swing-analysis', {
      frames_count: wireFrames.length,
      total_payload_kb: totalKB,
      api_base: apiUrl,
    });
    const t0 = Date.now();
    const res = await fetch(`${apiUrl}/api/swing-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: wireFrames, context }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const elapsedMs = Date.now() - t0;
    V6('STAGE 4 — /api/swing-analysis response', {
      status: res.status,
      elapsed_ms: elapsedMs,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      V6('STAGE 4 — non-ok response body', { body_head: body.slice(0, 300) });
      return { kind: 'error', message: 'Server returned ' + res.status };
    }
    const data = (await res.json()) as SwingAnalysis;
    V6('STAGE 4 — analysis parsed', {
      detected_issue: data.detected_issue,
      severity: data.severity,
      confidence: data.confidence,
      observation_head: (data.observation ?? '').slice(0, 200),
      follow_up_question: data.follow_up_question ?? null,
    });
    return { kind: 'ok', analysis: data, frame_timestamps_sec: frames.map(f => f.time_sec) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    V6('STAGE 4 — fetch threw', { error: msg });
    if (/network|abort|timeout|fetch/i.test(msg)) return { kind: 'no_network' };
    return { kind: 'error', message: msg };
  }
}
