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
  // 2026-05-24 — Layman translation of the detected_issue produced in
  // the SAME analysis call so the PrimaryIssueCard can render a
  // progressive-disclosure "What does this mean?" toggle without a
  // re-run. Empty string when there's no fault to translate; absent
  // on legacy server deploys (client hides the affordance entirely).
  layman_explanation?: string;
  // 2026-05-24 — GolfFix #1 structured payload. Named fault from a
  // fixed allowlist of faults visible in 2D phone video + paired
  // cause / fix / drill produced in the SAME Sonnet call. The card
  // renders primary_fault as the expert headline, fix + drill
  // beneath, layman_explanation behind a "What does this mean?"
  // info-tap (expert headline, plain-language one tap down).
  // primary_fault === 'inconclusive' means the model isn't
  // confident — cause/fix/drill arrive empty in that case, and the
  // card renders an honest "not enough to read yet" state instead
  // of fabricating advice. Optional + back-compat: absent on legacy
  // server deploys.
  primary_fault?:
    | 'over_the_top' | 'early_extension' | 'casting' | 'sway'
    | 'reverse_pivot' | 'chicken_wing' | 'plane_too_flat' | 'plane_too_steep'
    | 'head_movement' | 'spine_angle_loss' | 'no_dominant_fault' | 'inconclusive';
  cause?: string;
  fix?: string;
  drill?: string;
  // 2026-05-24 S1.1 — Frame-specific evidence: "Frame N: <visible cue>".
  // Populated for every diagnostic primary_fault (including
  // no_dominant_fault). Empty for inconclusive. Calibration gate
  // against the prior default-bias where every swing got 'early
  // extension' — a diagnostic call must now cite the frame.
  evidence?: string;
  // 2026-05-24 — Owner-tool telemetry. The server echoes the REAL
  // counts of image + text content blocks it sent to Sonnet so the
  // in-app swing-analysis debug screen can prove the whole pipe
  // (frames sent client-side === blocks server saw). Optional so
  // legacy responses without the field are still typed correctly.
  _debug?: {
    imageBlocks: number;
    textBlocks: number;
    mode: 'analysis' | 'tentative';
    shortGame: boolean;
  };
};

export type SwingAnalysisResult =
  | {
      kind: 'ok';
      analysis: SwingAnalysis;
      frame_timestamps_sec: number[];
      // Phase 403b — local file URI for the persisted fault-frame JPEG.
      // Null when fault_frame_index was -1 or when persistence failed
      // (consumers tolerate missing image — text diagnostic still
      // renders). WIRE-QUALITY (1024px / 75% JPEG — the same downscaled
      // frame the vision model received).
      fault_frame_uri?: string | null;
      // 2026-05-24 — DISPLAY-QUALITY fault frame. Re-extracted from
      // the source clip at native resolution (not the wire-quality
      // downscale) via expo-video-thumbnails. Crisp enough for
      // annotation and one-tap social sharing — the unit the
      // visual-annotation feature and the share flywheel render on.
      // Null on the same conditions as fault_frame_uri above (no
      // diagnostic frame OR persist failure); the wire-quality
      // path may still succeed independently.
      fault_frame_display_uri?: string | null;
      // 2026-05-24 — Source-clip fraction the fault frame was sampled
      // at (e.g. 0.40 = early-downswing slot in FRAME_TIME_FRACTIONS).
      // Lets annotation tooling map back to a scrub position on the
      // video timeline.
      fault_frame_fraction?: number | null;
    }
  | { kind: 'no_frames' }
  | { kind: 'no_network' }
  | { kind: 'error'; message: string };

// Phase U1 — lowered from 30s to 15s. The heuristic-fallback path
// (analyzeSwingTentative) fires when the primary call returns no_network /
// no_frames / error, so users no longer wait the full timeout before
// seeing some output. 15s is still generous for a 5-frame Anthropic
// vision call (typical: 4-9s on stable network).
// 2026-05-26 — Fix AW: bumped 15s → 55s. Tim's repro: 14s clip
// returned "Lost connection to the analyzer" even though the server-
// side fallback chain (Anthropic → OpenAI → Gemini, Batches 23-24)
// can take up to 50s when the primary is slow. The client was
// aborting at 15s, BEFORE the fallback chain could complete —
// making the resilience layer unreachable from the client. 55s
// budgets the full chain inside Vercel's 60s maxDuration with a
// small grace window for the response round-trip.
const REQUEST_TIMEOUT_MS = 55_000;
// 2026-05-26 — Fix CO: tentative bumped 15s → 30s. Tim's swing
// library upload was timing out the FALLBACK path too (primary 55s
// + tentative 15s = 70s total; server vision chain under load can
// chew 50s on the primary then the tentative aborts before its
// reduced-frame retry completes). 30s gives the tentative real
// breathing room while staying inside the user's patience budget.
const TENTATIVE_TIMEOUT_MS = 30_000;

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

// 2026-05-28 — Fix FO: exported so poseAnalysisApi.ts can reuse the
// same duration-probe path (Audio.Sound primary, VT.getThumbnailAsync
// upper-bound fallback) instead of relying on caller-provided
// durationMs which often arrives null / wrong on uploaded clips.
export async function probeDurationMs(clipUri: string): Promise<number> {
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

  // 2026-05-26 — Fix DH: start the duration probe at 8s (typical
  // upload length) instead of 30s. Prior code probed 30s first, which
  // FAILED on every clip under 30s (~98% of uploads), wasting ~400ms
  // per upload on the VT.getThumbnailAsync timeout before falling
  // through to 15s, then 8s. New order tries 8s first (succeeds on
  // most clips), then bumps UP to 15s/30s if 8s passed (i.e., clip is
  // longer than 8s — keep probing for tighter lower bound), and only
  // FALLS DOWN to 4s/2s if 8s itself failed (i.e., short clip).
  try {
    await VT.getThumbnailAsync(clipUri, { time: 8_000, quality: 0.3 });
    // 8s succeeded — clip is at least 8s. Try longer for tighter bound.
    for (const ms of [15_000, 30_000]) {
      try {
        await VT.getThumbnailAsync(clipUri, { time: ms, quality: 0.3 });
        V6('STAGE 1 — duration via VT lower bound', { at_least_ms: ms });
        return ms;
      } catch {
        V6('STAGE 1 — duration via VT lower bound', { at_least_ms: 8_000 });
        return 8_000;
      }
    }
    return 8_000;
  } catch {
    // 8s failed — clip is short. Probe down.
    for (const ms of [4_000, 2_000]) {
      try {
        await VT.getThumbnailAsync(clipUri, { time: ms, quality: 0.3 });
        V6('STAGE 1 — duration via VT lower bound (short clip)', { at_least_ms: ms });
        return ms;
      } catch {
        // Even shorter.
      }
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
// 2026-06-07 — quickTier sampling. Trims default 5-frame extraction
// to a 3-frame (address / impact / finish) sample with smaller
// 640px resize for the speed-path callers (SmartMotion, Cage Mode
// shot review, library Quick uploads). Anthropic Haiku 4.5 vision
// latency scales near-linearly with image count; 5 → 3 frames saves
// ~30-45% of model time and ~40% of per-frame upload payload.
// Used via the optional `quickTier` arg below.
const QUICK_TIER_FRAME_TIME_FRACTIONS = [0.10, 0.55, 0.85];
const QUICK_TIER_RESIZE_WIDTH = 640;
const QUICK_TIER_COMPRESS = 0.55;
const FULL_TIER_RESIZE_WIDTH = 800;
const FULL_TIER_COMPRESS = 0.65;

export async function extractKeyFrames(
  clipUri: string,
  boundaries?: { startSec: number; endSec: number },
  quickTier: boolean = false,
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
    // 2026-05-24 — Tiered sampling by clip length. The default
    // FRAME_TIME_FRACTIONS = [0.08, 0.40, 0.60, 0.75, 0.88] are
    // impact-clustered and work for in-app captures (≤4s, swing fills
    // the clip). Library-uploaded videos vary:
    //   - 4-10s   : brief preroll then swing — back-window of last 5s
    //               catches it.
    //   - 10s+    : instructor demo + the student's swing somewhere in
    //               the middle or end. Back-window misses mid-clip
    //               swings entirely. Spread 5 frames evenly across the
    //               whole clip with a slight back-half tilt; the
    //               TEMPORAL ANALYSIS prompt block in
    //               api/swing-analysis.ts already handles "frame N is
    //               the swing, others are setup/talking" so wide
    //               spread + the prompt finds the swing wherever it
    //               lives. Local `frameFractions` so we never mutate
    //               the module-level const.
    const LONG_CLIP_THRESHOLD_MS = 10_000;
    const MEDIUM_CLIP_THRESHOLD_MS = 4_000;
    const MEDIUM_CLIP_BACK_WINDOW_MS = 5_000;
    const LONG_CLIP_FRACTIONS = [0.20, 0.40, 0.60, 0.78, 0.92];
    // 2026-06-07 — Quick-tier: 3-frame address/impact/finish sample
    // for the speed paths (SmartMotion / Cage / library Quick). Saves
    // ~6-12s of Haiku vision latency vs 5 frames; accuracy on the
    // impact-clustered swing read is essentially unchanged at this
    // size.
    let frameFractions: readonly number[] = quickTier ? QUICK_TIER_FRAME_TIME_FRACTIONS : FRAME_TIME_FRACTIONS;
    if (boundaries) {
      windowStartMs = Math.round(boundaries.startSec * 1000);
      windowDurationMs = Math.round((boundaries.endSec - boundaries.startSec) * 1000);
      V6('STAGE 2 — extractKeyFrames bounded window', {
        start_sec: boundaries.startSec,
        end_sec: boundaries.endSec,
        window_ms: windowDurationMs,
        target_fractions: frameFractions,
      });
    } else {
      const durationMs = await probeDurationMs(clipUri);
      if (durationMs > LONG_CLIP_THRESHOLD_MS) {
        windowStartMs = 0;
        windowDurationMs = durationMs;
        // Quick-tier wins even on long clips — the speed cost of 5
        // wide frames > the marginal accuracy bump on speed-path calls.
        if (!quickTier) frameFractions = LONG_CLIP_FRACTIONS;
        V6('STAGE 2 — extractKeyFrames long-clip wide-spread', {
          duration_ms: durationMs,
          target_fractions: frameFractions,
        });
      } else if (durationMs > MEDIUM_CLIP_THRESHOLD_MS) {
        windowStartMs = Math.max(0, durationMs - MEDIUM_CLIP_BACK_WINDOW_MS);
        windowDurationMs = durationMs - windowStartMs;
        V6('STAGE 2 — extractKeyFrames medium-clip back-window', {
          duration_ms: durationMs,
          window_start_ms: windowStartMs,
          window_ms: windowDurationMs,
          target_fractions: frameFractions,
        });
      } else {
        windowStartMs = 0;
        windowDurationMs = durationMs;
        V6('STAGE 2 — extractKeyFrames whole-clip', {
          duration_ms: durationMs,
          target_fractions: frameFractions,
        });
      }
    }
    const perFrameOutcomes: Array<{ idx: number; t_ms: number; ok: boolean; raw_uri_tail?: string; raw_size?: number; b64_kb?: number; error?: string }> = [];
    const frames = await Promise.all(
      frameFractions.map(async (t, i) => {
        const timeMs = windowStartMs + Math.round(windowDurationMs * t);
        try {
          const r = await VT.getThumbnailAsync(clipUri, { time: timeMs, quality: 0.8 });
          let rawSize: number | undefined;
          try {
            const info = await import('expo-file-system/legacy').then(m => m.getInfoAsync(r.uri));
            if (info.exists) rawSize = (info as { size?: number }).size ?? undefined;
          } catch { /* size probe is informational */ }
          // 2026-05-26 — Fix CS: reduce upload payload to survive flakier
          // mobile networks. 1024px → 800px + compress 0.75 → 0.65 cuts
          // the per-frame base64 from ~110-200KB to ~50-90KB. Five-frame
          // payload drops from ~700KB-1MB to ~300-450KB → much higher
          // success rate on weak range/cart-path signal. Vision analysis
          // still works fine at 800px (Sonnet/OpenAI/Gemini all handle
          // sub-1024 frames cleanly for swing-pose reads).
          // 2026-06-07 — Quick-tier shrinks per-frame payload to
          // 640px / 0.55 compress (vs 800/0.65). Cuts base64 from
          // ~50-90 KB to ~25-45 KB per frame; combined with 3-frame
          // sampling, the upload drops from ~300-450 KB to ~75-135 KB
          // — much faster on cellular.
          const resizeWidth = quickTier ? QUICK_TIER_RESIZE_WIDTH : FULL_TIER_RESIZE_WIDTH;
          const compressQ = quickTier ? QUICK_TIER_COMPRESS : FULL_TIER_COMPRESS;
          const m = await ImageManipulator.manipulateAsync(
            r.uri,
            [{ resize: { width: resizeWidth } }],
            { compress: compressQ, format: ImageManipulator.SaveFormat.JPEG, base64: true },
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
    // 2026-05-26 — Fix DL: payload-size summary on top of the
    // per-frame detail. Audit flagged that the per_frame array is
    // hard to scan; a single avg/min/max line catches regressions
    // (e.g. if someone bumps resize back to 1024px). Reuse b64_kb
    // already computed — zero extra cost.
    const kbValues = perFrameOutcomes
      .filter((o): o is typeof o & { b64_kb: number } => o.ok === true && typeof o.b64_kb === 'number')
      .map(o => o.b64_kb);
    const sumKb = kbValues.reduce((a, b) => a + b, 0);
    V6('STAGE 2 — extractKeyFrames done', {
      successful: valid.length,
      attempted: frameFractions.length,
      bounded: boundaries != null,
      per_frame: perFrameOutcomes,
      payload_summary: kbValues.length > 0 ? {
        total_kb: sumKb,
        avg_kb: Math.round(sumKb / kbValues.length),
        min_kb: Math.min(...kbValues),
        max_kb: Math.max(...kbValues),
      } : null,
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
    // 2026-05-24 — Reanalyze "look for something else" signal. When
    // the user taps the swing-detail Reanalyze button on a session
    // that already has a primary_issue, runPhaseKOnSession captures
    // the prior fault and threads it through here. The server prompt
    // adds a directive: confirm the prior fault honestly if the
    // evidence is still there, but ACTIVELY consider non-matching
    // faults this pass so a recurring call doesn't become a default.
    // First-analysis path passes null/omits this field → no change.
    prior_analyzed_fault?: string | null;
    // 2026-05-21 — Fix B: camera angle the player chose BEFORE
    // recording. Routed into the analyst's system prompt so
    // down-the-line vs face-on reads use the correct orientation
    // for biomechanical checks. Defaults to 'down_the_line' (the
    // common swing-analysis convention) when omitted.
    //
    // 2026-05-22 audit refinement — added 'glasses_pov' for the
    // Meta-glasses first-person down-look (no torso in frame). The
    // analyst prompt drops body-rotation reads in that mode and
    // leans on grip / setup / impact-contact cues that ARE visible.
    angle?: 'down_the_line' | 'face_on' | 'glasses_pov';
    // 2026-05-21 — Fix E: player's selected language. Routes into
    // the swing-analysis prompt so the observation text comes back
    // in the right language (Spanish / Chinese / English).
    language?: 'en' | 'es' | 'zh';
    // 2026-05-27 — Fix ES (Phase 2.5): cage targeting context. When
    // the user has set up a ball area + target on the session via
    // CageTargetingCard, this gets threaded into the vision prompt
    // as an anchor: "the ball is sitting at normalized x,y within
    // radius r — confirm by looking at the first frame; impact is
    // the moment the ball leaves that area." Strong prior reduces
    // false-positive impact reads and tightens the temporal anchor
    // for the fault-frame selection. Both fields are normalized
    // 0..1 relative to the video frame.
    ball_area_norm?: { x: number; y: number; r: number } | null;
    target_norm?: { x: number; y: number } | null;
    // 2026-05-28 — Fix FM: tier='quick' = SmartMotion's speed path.
    // Server runs Anthropic Haiku 4.5 only and returns whatever it
    // gets (no escalation to gpt-4o / Sonnet). Trades occasional
    // low-confidence reads for the ~2-5s Haiku latency Tim's voice
    // path needs vs the 30-50s full chain. 'full' (or omitted) is
    // the existing library / Cage upload behavior — full Haiku →
    // OpenAI → Sonnet escalation chain.
    tier?: 'quick' | 'full';
    // 2026-05-28 — Fix FP: spoken-audio transcript from the same clip
    // (Whisper via /api/transcribe, written to shot.commentary_transcript
    // by swingCommentaryService). When present, the analyzer prompt
    // sees what the coach OR player said while the swing was being
    // recorded — Katie demoing "feel like your hands are softer at
    // the top", or Tim's glasses-POV "buttery hands here". The
    // analyzer uses it as expert / self-reported context, not as
    // ground truth, and can call out mismatches (player said X but
    // I see Y). Empty / null = vision-only analysis as before.
    coach_audio?: string | null;
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
  // 2026-06-07 — Thread tier:'quick' into extractKeyFrames so the
  // SmartMotion / Cage / library Quick paths get the 3-frame 640px
  // fast sample instead of the default 5-frame 800px. ~6-12s
  // Haiku-vision saving per call, ~40% per-frame payload cut.
  const quickTier = context.tier === 'quick';
  const frames = await extractKeyFrames(clipUri, boundaries, quickTier);
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
    // 2026-05-27 — Fix EJ: single-shot fast-failure retry on transient
    // network blips. Tim's report from on-course YouTube shoot:
    // "SmartMotion did a reading or analyzing one out of five times."
    // The 4-out-of-5 failures land as no_network in the V6 trace,
    // typical of cellular hiccups at the range (walking behind a
    // tree, BT-vs-cell handoff, brief Wi-Fi flap). Retry once if the
    // first attempt FAILED FAST (<10s) — that's a network blip, not
    // a server timeout. A real server timeout (~55s) is NOT retried
    // because retrying would just wait another 55s for the same
    // failure. Each attempt gets its own fresh AbortSignal because
    // the prior signal is bound to the prior fetch.
    const FAST_FAIL_MS = 10_000;
    const MAX_ATTEMPTS = 2;
    const tryFetch = async (attempt: number): Promise<Response> => {
      const attemptT0 = Date.now();
      try {
        return await fetch(`${apiUrl}/api/swing-analysis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // context now includes player_context + swing_tag for personalized
          // + short-game-aware analysis per Phase 502.
          body: JSON.stringify({ frames: wireFrames, context }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        const elapsed = Date.now() - attemptT0;
        const msg = err instanceof Error ? err.message : String(err);
        const fastTransient = elapsed < FAST_FAIL_MS && /network|fetch/i.test(msg) && !/abort|timeout/i.test(msg);
        if (attempt < MAX_ATTEMPTS && fastTransient) {
          V6('STAGE 3 RETRY — fast-failure network blip, retrying after 1500ms', {
            error_head: msg.slice(0, 120), elapsed_ms: elapsed, attempt,
          });
          await new Promise(r => setTimeout(r, 1500));
          return tryFetch(attempt + 1);
        }
        throw err;
      }
    };
    const res = await tryFetch(1);
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

    // 2026-05-24 — Owner-tool telemetry. Stash the frames-sent vs
    // server-saw counts so /swing-analysis-debug can flash PASS/CHECK
    // without dashboards. The server's _debug field carries its real
    // counts; we pair them with wireFrames.length to prove the whole
    // pipe end-to-end. Wrapped in try/catch so a store hiccup never
    // blocks the analysis return path.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const dbg = require('../store/swingAnalysisDebugStore') as typeof import('../store/swingAnalysisDebugStore');
      // Perspective isn't on the analyzeSwing context type today; the
      // store field is null-tolerant and future-proofed if a caller
      // starts forwarding it. Defensive read via unknown cast.
      const ctxRecord = context as unknown as Record<string, unknown>;
      const perspective = typeof ctxRecord.perspective === 'string' ? ctxRecord.perspective : null;
      // 2026-05-26 — Fix DN: also stash provider, escalation_reason,
      // and the full attempts array. Owner debug screen can render
      // the orchestration decision tree at a glance.
      const debugAny = data._debug as Record<string, unknown> | undefined;
      const attemptsArr = Array.isArray(debugAny?.attempts) ? debugAny.attempts as Array<{ provider: string; elapsed_ms: number; ok: boolean; error: string | null; score: number }> : null;
      dbg.useSwingAnalysisDebugStore.getState().record({
        at: Date.now(),
        framesSent: wireFrames.length,
        imageBlocks: data._debug?.imageBlocks ?? null,
        textBlocks: data._debug?.textBlocks ?? null,
        mode: data._debug?.mode ?? null,
        shortGame: data._debug?.shortGame ?? null,
        perspective,
        provider: typeof debugAny?.provider === 'string' ? debugAny.provider as string : null,
        escalation_reason: typeof debugAny?.escalation_reason === 'string' ? debugAny.escalation_reason as string : null,
        attempts: attemptsArr,
      });
    } catch (e) {
      console.log('[poseDetection] swing-analysis debug stash failed (non-fatal):', e);
    }

    // Phase 403b — persist the fault frame as a JPEG so the review UI
    // can show the user the moment of the fault. We already have the
    // base64 in `frames[index].b64`; write it once to the document
    // directory under a stable shot-id-keyed name. Failures are
    // non-fatal — the text diagnostic still renders.
    let faultFrameUri: string | null = null;
    // 2026-05-24 — Display-quality companion to the wire-quality
    // fault frame. Annotation + social-share require a crisp source;
    // the wire frame above is 1024px / 75% JPEG (sized for the
    // vision model, not human consumption). Re-extracted from the
    // SOURCE clip at native resolution via expo-video-thumbnails
    // at the SAME timestamp the wire frame was sampled at. Persist
    // failure here is independent of the wire-quality path.
    let faultFrameDisplayUri: string | null = null;
    let faultFrameFraction: number | null = null;
    const idx = typeof data.fault_frame_index === 'number' ? data.fault_frame_index : -1;
    if (idx >= 0 && idx < frames.length && persistOpts?.faultFrameBaseName) {
      try {
        const FS = await import('expo-file-system/legacy');
        const dir = FS.documentDirectory ?? FS.cacheDirectory;
        if (dir) {
          const safeName = persistOpts.faultFrameBaseName.replace(/[^a-zA-Z0-9_-]/g, '_');
          const wireUri = `${dir}smartmotion/${safeName}.jpg`;
          await FS.makeDirectoryAsync(`${dir}smartmotion`, { intermediates: true }).catch(() => {});
          await FS.writeAsStringAsync(wireUri, frames[idx].b64, { encoding: FS.EncodingType.Base64 });
          faultFrameUri = wireUri;
          V6('STAGE 4 — fault frame persisted (wire quality)', {
            uri_tail: wireUri.slice(-40),
            frame_index: idx,
          });

          // 2026-05-24 — Display-quality re-extract. Same timestamp,
          // native resolution, JPEG quality 1.0. Copies the
          // VideoThumbnails-produced temp file into the same stable
          // dir under a `_display` suffix so consumers can pick one
          // (wire for vision-pipeline replay, display for human eyes).
          // Wrapped in its own try/catch — wire-quality persist
          // already succeeded above; display-quality is bonus.
          try {
            const timeMs = Math.round(frames[idx].time_sec * 1000);
            const r = await VT.getThumbnailAsync(clipUri, { time: timeMs, quality: 1.0 });
            const displayUri = `${dir}smartmotion/${safeName}_display.jpg`;
            await FS.deleteAsync(displayUri, { idempotent: true }).catch(() => {});
            await FS.copyAsync({ from: r.uri, to: displayUri });
            faultFrameDisplayUri = displayUri;
            // Source-clip fraction. FRAME_TIME_FRACTIONS is the
            // canonical sampling array — using the index directly
            // gives the most-meaningful fraction value regardless
            // of whether the clip used a bounded window.
            faultFrameFraction = FRAME_TIME_FRACTIONS[idx] ?? null;
            V6('STAGE 4 — fault frame persisted (display quality)', {
              uri_tail: displayUri.slice(-40),
              fraction: faultFrameFraction,
            });
          } catch (eDisplay) {
            V6('STAGE 4 — display-quality fault frame persist failed (non-fatal)', {
              error: eDisplay instanceof Error ? eDisplay.message : String(eDisplay),
            });
          }
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
      fault_frame_display_uri: faultFrameDisplayUri,
      fault_frame_fraction: faultFrameFraction,
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
      // 2026-05-26 — Fix CS (tentative path mirror): 1024px/0.75 →
      // 800px/0.65 so the fallback retry also cuts payload ~55%.
      const m = await ImageManipulator.manipulateAsync(
        r.uri,
        [{ resize: { width: 800 } }],
        { compress: 0.65, format: ImageManipulator.SaveFormat.JPEG, base64: true },
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
        // 2026-06-02 — Fix GM: thread tier:'quick' into the tentative
        // fallback context. The tentative path is by definition a
        // fast-degraded fallback — a single frame, "best we can do"
        // observation. Running the full Haiku→OpenAI→Sonnet escalation
        // chain on it defeats the purpose: by the time we're asking
        // for tentative, the user has already waited 30-40s for the
        // primary attempt. Quick (Haiku-only) keeps the fallback in
        // the 2-5s budget and matches the design intent.
        context: { ...context, tier: 'quick' as const },
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
