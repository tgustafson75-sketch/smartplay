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
  // Phase 403b — 0-based index of the most diagnostic frame, or -1 when
  // no specific frame stood out. Surfaces the moment of the fault in
  // the review UI.
  fault_frame_index?: number;
  // Phase 418 — unified swing validation gate. False when frames contain
  // no analyzable swing (no person, floor footage, etc.). Downstream
  // SmartMotion UI gates pose overlay, metrics, and insight on this
  // flag. Legacy responses default to true; isValidSwing() in
  // services/swingValidity.ts adds a heuristic fallback on observation
  // text for backward compat.
  valid_swing?: boolean;
  validity_reason?: string | null;
};

export type SwingAnalysisResult =
  | {
      kind: 'ok';
      analysis: SwingAnalysis;
      frame_timestamps_sec: number[];
      // Phase 403b — local file URI for the persisted fault-frame JPEG.
      // Null when fault_frame_index was -1 or when persistence failed
      // (consumers tolerate missing image — text diagnostic still
      // renders).
      fault_frame_uri?: string | null;
    }
  | { kind: 'no_frames' }
  | { kind: 'no_network' }
  | { kind: 'error'; message: string };

// Phase U1 — lowered from 30s to 15s. The heuristic-fallback path
// (analyzeSwingTentative) fires when the primary call returns no_network /
// no_frames / error, so users no longer wait the full timeout before
// seeing some output. 15s is still generous for a 5-frame Anthropic
// vision call (typical: 4-9s on stable network).
const REQUEST_TIMEOUT_MS = 15_000;
const TENTATIVE_TIMEOUT_MS = 15_000;

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

// Phase AF — re-targeted toward impact zone. Prior fractions
// [0.05, 0.30, 0.55, 0.80, 0.95] sampled too sparsely around impact (the
// most diagnostic moment for face/path/attack-angle reads) and the 0.80
// frame frequently landed past impact on faster swings, leaving the
// classifier no impact frame to read. New layout: address, mid-backswing,
// transition, impact, follow-through — three frames clustered around the
// 60-78% downswing-to-impact window where face angle and contact point
// are visible.
const FRAME_TIME_FRACTIONS = [0.08, 0.40, 0.60, 0.75, 0.88];
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

/**
 * Phase BW — accept optional clip boundaries to sample frames from a
 * sub-window of a multi-swing master video. When boundaries are
 * provided, fractions apply WITHIN [startSec, endSec] instead of the
 * whole video. Without boundaries, behavior is unchanged: probe full
 * duration and sample at fixed fractions of the clip.
 */
export async function extractKeyFrames(
  clipUri: string,
  boundaries?: { startSec: number; endSec: number },
): Promise<Frame[]> {
  if (!clipUri) {
    V6('STAGE 2 — empty clipUri, no frames');
    return [];
  }
  try {
    // When boundaries provided, the swing window is known — skip the
    // whole-clip duration probe and sample within [startSec, endSec].
    let windowStartMs: number;
    let windowDurationMs: number;
    if (boundaries) {
      windowStartMs = Math.round(boundaries.startSec * 1000);
      windowDurationMs = Math.round((boundaries.endSec - boundaries.startSec) * 1000);
      V6('STAGE 2 — extractKeyFrames bounded window', {
        start_sec: boundaries.startSec,
        end_sec: boundaries.endSec,
        window_ms: windowDurationMs,
        target_fractions: FRAME_TIME_FRACTIONS,
      });
    } else {
      const durationMs = await probeDurationMs(clipUri);
      windowStartMs = 0;
      windowDurationMs = durationMs;
      V6('STAGE 2 — extractKeyFrames whole-clip', {
        duration_ms: durationMs,
        target_fractions: FRAME_TIME_FRACTIONS,
      });
    }
    const perFrameOutcomes: Array<{ idx: number; t_ms: number; ok: boolean; raw_uri_tail?: string; raw_size?: number; b64_kb?: number; error?: string }> = [];
    const frames = await Promise.all(
      FRAME_TIME_FRACTIONS.map(async (t, i) => {
        const timeMs = windowStartMs + Math.round(windowDurationMs * t);
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
      bounded: boundaries != null,
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
  // Phase 403b — caddie_name optional; when present, the analyst writes
  // the observation in that caddie's cadence (Tank/Kevin/Serena/Harry).
  // Phase 502 — player_context (handicap, dominant_miss, height) and
  // swing_tag (putt/chip route through a short-game-specific analysis
  // branch) let the analyst tailor the read per player and per shot type
  // instead of giving every golfer the same canned full-swing fault.
  context: {
    club: string;
    swing_number: number;
    prior_issues?: string[];
    caddie_name?: string;
    player_context?: {
      handicap?: number | null;
      dominant_miss?: string | null;
      experience?: string | null;
      first_name?: string | null;
    };
    swing_tag?: string | null;
  },
  boundaries?: { startSec: number; endSec: number },
  // Phase 403b — when provided, the persisted fault-frame JPEG will be
  // saved under this filename (e.g. `${shotId}_fault.jpg`) inside the
  // app's document directory. Callers in videoUpload.ts pass the shot id
  // so the resulting URI can be persisted onto perShotAnalysis.
  persistOpts?: { faultFrameBaseName: string },
): Promise<SwingAnalysisResult> {
  V6('STAGE 2 — analyzeSwing enter', {
    club: context.club,
    swing_number: context.swing_number,
    prior_issues_count: context.prior_issues?.length ?? 0,
    bounded: boundaries != null,
    boundary_start_sec: boundaries?.startSec ?? null,
    boundary_end_sec: boundaries?.endSec ?? null,
  });
  const frames = await extractKeyFrames(clipUri, boundaries);
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
      // context now includes player_context + swing_tag for personalized
      // + short-game-aware analysis per Phase 502.
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
      // Phase AF — capture full body (clipped at 800) + status text so the
      // V6-DIAG trace surfaces upstream error messages (e.g. invalid model
      // id, key issues, prompt validation failures) instead of just status
      // codes. Try to extract a JSON error message for cleaner user-facing
      // copy; fall back to status code.
      V6('STAGE 4 — non-ok response body', {
        status: res.status,
        statusText: res.statusText,
        body_head: body.slice(0, 800),
      });
      let userMsg = 'Server returned ' + res.status;
      try {
        const parsed = JSON.parse(body) as { error?: string };
        if (parsed?.error) userMsg = parsed.error.slice(0, 160);
      } catch { /* body wasn't JSON */ }
      return { kind: 'error', message: userMsg };
    }
    const data = (await res.json()) as SwingAnalysis;
    V6('STAGE 4 — analysis parsed', {
      detected_issue: data.detected_issue,
      severity: data.severity,
      confidence: data.confidence,
      observation_head: (data.observation ?? '').slice(0, 200),
      follow_up_question: data.follow_up_question ?? null,
      fault_frame_index: data.fault_frame_index ?? null,
    });

    // Phase 403b — persist the fault frame as a JPEG so the review UI
    // can show the user the moment of the fault. We already have the
    // base64 in `frames[index].b64`; write it once to the document
    // directory under a stable shot-id-keyed name. Failures are
    // non-fatal — the text diagnostic still renders.
    let faultFrameUri: string | null = null;
    const idx = typeof data.fault_frame_index === 'number' ? data.fault_frame_index : -1;
    if (idx >= 0 && idx < frames.length && persistOpts?.faultFrameBaseName) {
      try {
        const FS = await import('expo-file-system/legacy');
        const dir = FS.documentDirectory ?? FS.cacheDirectory;
        if (dir) {
          const safeName = persistOpts.faultFrameBaseName.replace(/[^a-zA-Z0-9_-]/g, '_');
          const uri = `${dir}smartmotion/${safeName}.jpg`;
          await FS.makeDirectoryAsync(`${dir}smartmotion`, { intermediates: true }).catch(() => {});
          await FS.writeAsStringAsync(uri, frames[idx].b64, { encoding: FS.EncodingType.Base64 });
          faultFrameUri = uri;
          V6('STAGE 4 — fault frame persisted', {
            uri_tail: uri.slice(-40),
            frame_index: idx,
          });
        }
      } catch (e) {
        V6('STAGE 4 — fault frame persist failed (non-fatal)', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      kind: 'ok',
      analysis: data,
      frame_timestamps_sec: frames.map(f => f.time_sec),
      fault_frame_uri: faultFrameUri,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    V6('STAGE 4 — fetch threw', { error: msg });
    if (/network|abort|timeout|fetch/i.test(msg)) return { kind: 'no_network' };
    return { kind: 'error', message: msg };
  }
}

/**
 * Phase U1 — Heuristic-fallback path.
 *
 * Used by `runPhaseKOnSession` when the primary 5-frame full-analysis call
 * returns no usable result (every swing kind is no_frames / no_network /
 * error / detected_issue 'none'). Re-extracts a single frame from a
 * different time fraction (mid-clip, where pose is most likely visible
 * even on partial captures) and POSTs to /api/swing-analysis with
 * `mode: 'tentative'`. The server returns a tentative observation with
 * confidence 'low' and detected_issue 'none' — the consumer renders it
 * as a "Tentative read" PrimaryIssue rather than a full failure.
 *
 * This path returns the SAME tagged-union shape as analyzeSwing so the
 * caller can branch uniformly. A successful tentative result has
 * `kind: 'ok'` with `analysis.confidence === 'low'` and
 * `analysis.detected_issue === 'none'`.
 */
export async function analyzeSwingTentative(
  clipUri: string,
  context: { club: string; swing_number: number },
): Promise<SwingAnalysisResult> {
  V6('TENTATIVE STAGE 0 — analyzeSwingTentative enter', {
    club: context.club,
    swing_number: context.swing_number,
  });

  // Try a different time fraction than the primary path used. Primary
  // sampled at [0.08, 0.40, 0.60, 0.75, 0.88]. Mid-clip (0.50) is offset
  // from those and most likely to have a visible figure even on partial
  // captures. Fall back to 0.30 if 0.50 fails.
  const FALLBACK_FRACTIONS = [0.5, 0.3, 0.7];
  let frame: Frame | null = null;
  let durationMs = FALLBACK_DURATION_MS;
  try {
    durationMs = await probeDurationMs(clipUri);
  } catch {
    /* duration probe is best-effort; fall through to default */
  }

  for (const t of FALLBACK_FRACTIONS) {
    const timeMs = Math.round(durationMs * t);
    try {
      const r = await VT.getThumbnailAsync(clipUri, { time: timeMs, quality: 0.8 });
      const m = await ImageManipulator.manipulateAsync(
        r.uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (m.base64) {
        frame = { b64: m.base64, media_type: 'image/jpeg', time_sec: timeMs / 1000 };
        V6('TENTATIVE STAGE 2 — single-frame extracted', {
          fraction: t,
          time_ms: timeMs,
          b64_kb: Math.round(m.base64.length / 1024),
        });
        break;
      }
    } catch (err) {
      V6('TENTATIVE STAGE 2 — fraction failed', {
        fraction: t,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!frame) {
    V6('TENTATIVE STAGE 2 — no_frames after all fallback fractions');
    return { kind: 'no_frames' };
  }

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  try {
    V6('TENTATIVE STAGE 3 — POST /api/swing-analysis (tentative mode)', {
      total_payload_kb: Math.round(frame.b64.length / 1024),
    });
    const t0 = Date.now();
    const res = await fetch(`${apiUrl}/api/swing-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frames: [{ b64: frame.b64, media_type: frame.media_type }],
        context,
        mode: 'tentative',
      }),
      signal: AbortSignal.timeout(TENTATIVE_TIMEOUT_MS),
    });
    const elapsedMs = Date.now() - t0;
    V6('TENTATIVE STAGE 4 — response', { status: res.status, elapsed_ms: elapsedMs });
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      let userMsg = 'Server returned ' + res.status;
      try {
        const parsed = JSON.parse(body) as { error?: string };
        if (parsed?.error) userMsg = parsed.error.slice(0, 160);
      } catch { /* not JSON */ }
      return { kind: 'error', message: userMsg };
    }
    const data = (await res.json()) as SwingAnalysis;
    V6('TENTATIVE STAGE 4 — parsed', {
      detected_issue: data.detected_issue,
      confidence: data.confidence,
      observation_head: (data.observation ?? '').slice(0, 200),
    });
    return { kind: 'ok', analysis: data, frame_timestamps_sec: [frame.time_sec] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    V6('TENTATIVE STAGE 4 — fetch threw', { error: msg });
    if (/network|abort|timeout|fetch/i.test(msg)) return { kind: 'no_network' };
    return { kind: 'error', message: msg };
  }
}
