import { getApiBaseUrl } from './apiBase';
import { mergeSwingDetections } from './swing/swingSegmentation';
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
  // 2026-06-14 (Tim) — 1-2 genuinely-observed strengths for THIS swing,
  // named by the model alongside the fault (setup fundamentals from the
  // address frame + balance from the finish). Empty when nothing observable;
  // absent until the /api/swing-analysis `strengths` field is deployed.
  strengths?: string[];
  // 2026-07-07 (Tim — chunk-shot honesty) — an honest strike read, filled by the
  // model ONLY from visible contact evidence (divot before the ball, club digging
  // behind the ball, ball squirting low). 'unknown' by default — the motion read
  // usually can't see contact. SmartMotion's verdict uses this (alongside the
  // camera ball-departure check + the player's feel note) so a chunk is never shown
  // as a good swing. Absent on legacy server deploys → treated as 'unknown'.
  contact_read?: 'clean' | 'fat' | 'thin' | 'topped' | 'unknown';
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
      /**
       * 2026-08-25 (Tim's device log, Aug 24 21:49/21:50 — swing_locate_fallback, cause dead_host).
       *
       * WHEN WE COULD NOT FIND THE SWING, SAY SO. If the locate pass is abandoned the frames are
       * sampled across the WHOLE clip instead of the swing, so every read downstream is built on a
       * smear — and the player was shown that result looking exactly like a good one. The house rule
       * is degrade AND FLAG, never degrade silently.
       *
       * null = the swing window was found (or was already known from the acoustic strike, the normal
       * case) and the read is a normal one.
       */
      locate_degraded?: 'dead_host' | 'ceiling' | 'unknown' | null;
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
// 2026-06-09 — bumped 55s → 63s. The old value was BELOW the server's own
// 60s maxDuration, so on any slow analysis the CLIENT aborted ~5s before the
// server would have returned — and that abort was then mislabeled as a
// network loss ("Lost connection — check your network") even on perfect
// Wi-Fi. The client must wait at least as long as the server can legitimately
// run (60s) plus response round-trip, so a slow run resolves to a real result
// or an honest server error instead of a phantom client-side network failure.
// (With the swing localizer the real analysis now runs on a tight window and
// rarely approaches this ceiling anyway — this is the failure-mode safety net.)
const REQUEST_TIMEOUT_MS = 63_000;
// 2026-05-26 — Fix CO: tentative bumped 15s → 30s. Tim's swing
// library upload was timing out the FALLBACK path too (primary 55s
// + tentative 15s = 70s total; server vision chain under load can
// chew 50s on the primary then the tentative aborts before its
// reduced-frame retry completes). 30s gives the tentative real
// breathing room while staying inside the user's patience budget.
// 2026-06-07 audit r4: bumped 30s → 55s. Tentative now uses
// tier='full' (audit r3 H3 fix) so the server can climb the full
// Haiku → OpenAI → Sonnet escalation chain (30-40s under load).
// 30s client cap was aborting that chain mid-escalation, defeating
// the safety net. 55s fits inside Vercel's 60s function maxDuration
// while giving the server room to complete the deep dive.
const TENTATIVE_TIMEOUT_MS = 55_000;

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
import * as VT from '../utils/videoThumbnail'; // serialized wrapper (native retriever crash fix)
import * as ImageManipulator from 'expo-image-manipulator';
import { Audio } from 'expo-av';
// 2026-06-07 (audit) — share the circuit breaker + reactive connectivity
// signal with the voice paths so weak-signal range sessions short-circuit
// instead of paying full timeout+retry per swing.
import { recordSuccess, recordFailure } from './voiceCircuitBreaker';
import { reportOnline, reportNetworkFailure } from '../store/connectivityStore';

// Phase V.6 diagnostic — single grep target. Filter via:
//   adb logcat | grep V6-DIAG
const V6 = (msg: string, data?: Record<string, unknown>): void => {
  if (data) console.log('[V6-DIAG] ' + msg + ' ' + JSON.stringify(data));
  else console.log('[V6-DIAG] ' + msg);
};

/**
 * 2026-08-31 (Tim: "hard to show a wow factor when you have to wait probably more than a minute") —
 * WHERE THE MINUTE GOES, ON A REAL DEVICE.
 *
 * Every stage of this pipeline was already timed, into `console.log`, which is invisible on a phone
 * on a golf course. So the honest answer to "why did that take a minute" was nobody's to give —
 * not Tim's, and not mine. Reasoning about it from constants is exactly the kind of guessing that
 * has been wrong repeatedly. [[missing-log-entry-is-the-evidence]] [[my-measurement-is-the-least-reliable-part]]
 *
 * One breadcrumb per analysis, as `diag` so it reads as information rather than a fault, carrying
 * the elapsed milliseconds of each stage and which path was taken. The next on-course run names its
 * own long pole.
 */
export type AnalysisTiming = {
  probe_ms?: number;
  locate_ms?: number;
  extract_ms?: number;
  request_ms?: number;
  total_ms: number;
  /** Whether the caller already knew the swing window — the branch that skips probe AND locate. */
  bounded: boolean;
  frames: number;
  tier: string;
};

function logAnalysisTiming(t: AnalysisTiming): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../store/issueLogStore') as typeof import('../store/issueLogStore')).useIssueLogStore
      .getState().addAppEvent('swing_analysis_timing', t as unknown as Record<string, unknown>, 'diag');
  } catch { /* telemetry is never allowed to break an analysis */ }
}

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

// 2026-06-14 (audit #3 — honesty) — `fraction` is the REAL position this frame was
// sampled at within the swing window (0 = window start, 1 = window end). Carried so
// the fault-frame fraction reported to the user reflects the actual sampling array
// used (quick 3-frame / full 5-frame / long-clip even spread) instead of blindly
// indexing the full-tier FRAME_TIME_FRACTIONS array.
export type Frame = { b64: string; media_type: string; time_sec: number; fraction?: number };

// 2026-05-28 — Fix FO: exported so poseAnalysisApi.ts can reuse the
// same duration-probe path (Audio.Sound primary, VT.getThumbnailAsync
// upper-bound fallback) instead of relying on caller-provided
// durationMs which often arrives null / wrong on uploaded clips.
/**
 * 2026-08-31 (Tim: "make it as rapid as reasonable — hard to show a wow factor when you have to wait
 * more than a minute") — A CLIP'S DURATION CANNOT CHANGE, SO PROBE IT ONCE.
 *
 * The same clip was probed repeatedly in a single analysis: the locate pass probes it, extractKeyFrames
 * probes it again when the caller has no duration to hand, and the pose warm added on 2026-08-31 probes
 * it a third time. Each probe has an 8-SECOND ceiling and every one of them goes through
 * `serializeMediaRead` — the global media chain — so they do not merely repeat, they QUEUE, behind
 * each other and behind every frame decode in flight.
 *
 * The in-flight promise is shared as well as the result. Without that, two callers starting at the
 * same moment (the warm and the extract, which is exactly the pair this session created) both probe
 * and the second still waits for the first through the chain.
 *
 * Only a POSITIVE result is remembered: a failed probe returns 0, and caching 0 would make one bad
 * read permanent for that clip.
 */
const durationCache = new Map<string, number>();
const durationInflight = new Map<string, Promise<number>>();
/** Bounded so a long library session cannot grow this without limit. */
const DURATION_CACHE_MAX = 64;

/**
 * No invalidation helper is exported on purpose. A recording writes a NEW uri every time, so a stale
 * duration for a reused path is not a real scenario — and an export nothing calls is the orphan class
 * this repo keeps finding as live bugs. The bounded LRU is the only eviction there is.
 * [[orphans-are-live-bugs-not-dead-code]]
 */

export async function probeDurationMs(clipUri: string): Promise<number> {
  const cached = durationCache.get(clipUri);
  if (cached != null && cached > 0) return cached;
  const pending = durationInflight.get(clipUri);
  if (pending) return pending;
  const run = probeDurationUncached(clipUri)
    .then((ms) => {
      if (ms > 0) {
        if (durationCache.size >= DURATION_CACHE_MAX) {
          const oldest = durationCache.keys().next().value;
          if (oldest != null) durationCache.delete(oldest);
        }
        durationCache.set(clipUri, ms);
      }
      return ms;
    })
    .finally(() => { durationInflight.delete(clipUri); });
  durationInflight.set(clipUri, run);
  return run;
}

async function probeDurationUncached(clipUri: string): Promise<number> {
  // 2026-06-10 — Overall timeout so a problem clip (slow audio-track load or a
  // stalling MediaMetadataRetriever on Android) can NEVER hang re-analysis on an
  // infinite spinner. If probing doesn't finish in time, fall back to the
  // default duration and let the localizer / wide-spread sampling proceed.
  const PROBE_TIMEOUT_MS = 8_000;
  const probe = async (): Promise<number> => {
  // Phase V.6 — try Audio.Sound first (works when video has an audio
  // track), then probe via VT.getThumbnailAsync at large timestamps as a
  // fallback (if a frame extracts at t=Xms, the video is at least that
  // long). Many uploaded videos have no audio track, defeating the
  // Audio.Sound path silently — the VT probe rescues those.
  try {
    // 2026-08-09 (shared-copy verification) — the Audio.Sound load is a NATIVE DECODER read; under
    // the shared-copy pool other consumers' retrievers may hold the SAME file, so this must run
    // through the global media-read chain (decoder + retriever on one file = the SIGSEGV class).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { serializeMediaRead } = require('../utils/videoThumbnail') as typeof import('../utils/videoThumbnail');
    const probed = await serializeMediaRead(async () => {
      const { sound, status } = await Audio.Sound.createAsync({ uri: clipUri }, { shouldPlay: false });
      const ms = status.isLoaded && status.durationMillis && status.durationMillis > 0 ? status.durationMillis : null;
      await sound.unloadAsync().catch(() => {});
      return { ms, isLoaded: status.isLoaded };
    });
    if (probed.ms != null) {
      V6('STAGE 1 — duration probed via Audio.Sound', { duration_ms: probed.ms });
      return probed.ms;
    }
    V6('STAGE 1 — Audio.Sound loaded but no duration', { isLoaded: probed.isLoaded });
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
    // 8s succeeded — clip is at least 8s. Walk upward; the LAST ms that
    // succeeds is the tightest lower bound. (audit — prior code returned
    // inside the first iteration, so 30s was never tried and a >15s clip
    // was always estimated at 15s.)
    let lower = 8_000;
    for (const ms of [15_000, 30_000]) {
      try {
        await VT.getThumbnailAsync(clipUri, { time: ms, quality: 0.3 });
        lower = ms; // this time existed → clip is at least ms
      } catch {
        break; // failed → clip is shorter than ms; `lower` is the bound
      }
    }
    V6('STAGE 1 — duration via VT lower bound', { at_least_ms: lower });
    return lower;
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
  };
  return Promise.race([
    probe(),
    new Promise<number>((res) => setTimeout(() => res(FALLBACK_DURATION_MS), PROBE_TIMEOUT_MS)),
  ]);
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
// 512px resize for the speed-path callers (SmartMotion, Cage Mode
// shot review, library Quick uploads). Gemini / OpenAI vision
// latency scales with image count and payload; 5 → 3 frames saves
// ~30-45% of model time and ~40% of per-frame upload payload.
// Used via the optional `quickTier` arg below.
const QUICK_TIER_FRAME_TIME_FRACTIONS = [0.10, 0.55, 0.85];
// 2026-06-14 (Tim — analysis speed, "without losing accuracy") — 640 → 512px.
// The quick-tier read is gross body-fault detection (over-the-top, reverse pivot,
// early extension) where the golfer fills the frame; that's fully legible at 512px.
// (Face-angle is the only thing that degrades sub-640, and it's parked — needs
// 240fps. See face-smash-fps-future.) This cuts the per-frame base64 ~36% on top
// of the 3-frame sample, so the UPLOAD leg — the real bottleneck on the weak
// cellular Tim plays in — lands faster. Conservative step within the validated
// 800→640 accuracy-neutral range; revert to 640 if a clean-session A/B shows drift.
const QUICK_TIER_RESIZE_WIDTH = 512;
const QUICK_TIER_COMPRESS = 0.55;
const FULL_TIER_RESIZE_WIDTH = 800;
const FULL_TIER_COMPRESS = 0.65;

export async function extractKeyFrames(
  clipUri: string,
  boundaries?: { startSec: number; endSec: number },
  quickTier: boolean = false,
  // 2026-06-11 (audit) — when the caller already probed the duration (analyzeSwing
  // does before locating), pass it here so the unbounded branch below doesn't
  // re-run the expensive probeDurationMs (loads an Audio.Sound + several
  // thumbnail extractions, up to 8s) a second time on the same clip.
  knownDurationMs?: number,
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
      const durationMs = knownDurationMs != null && knownDurationMs > 0
        ? knownDurationMs
        : await probeDurationMs(clipUri);
      if (durationMs > LONG_CLIP_THRESHOLD_MS) {
        windowStartMs = 0;
        windowDurationMs = durationMs;
        // 2026-06-09 — Acoustics-free upload fix. An untrimmed phone
        // UPLOAD (practice swings + setup + the real swing somewhere in
        // the middle/end, no acoustic window to narrow on) needs the AI
        // to FIND the swing itself. It can only do that if the swing is
        // actually in the frames we send — a fixed 3-5 frame sample is
        // so sparse across 30-60s that a ~2s swing falls BETWEEN frames
        // and the read comes back empty ("won't analyze"). So scale the
        // frame count with clip length (~1 per 5s, 6-12 frames) spread
        // evenly across the whole clip; the TEMPORAL ANALYSIS block in
        // api/swing-analysis.ts then picks out the swing frames and
        // ignores the setup/walk-up ones. Endpoint cap was raised 5→12
        // to match. (Bounded live SmartMotion clips are unaffected: they
        // take the `boundaries` branch above and keep the fast 3-frame
        // sample inside the known strike window.)
        const durSec = durationMs / 1000;
        const n = Math.max(6, Math.min(12, Math.round(durSec / 5)));
        const lo = 0.06;
        const hi = 0.96;
        frameFractions = Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
        V6('STAGE 2 — extractKeyFrames long-clip duration-scaled spread', {
          duration_ms: durationMs,
          quick_tier: quickTier,
          frame_count: n,
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
          // 2026-06-10 — Robustness: phone camera clips are often VARIABLE frame
          // rate, and Android's MediaMetadataRetriever (behind expo-video-
          // thumbnails) can return null at an arbitrary time even though the
          // clip plays fine. Retry at a few nearby times so we land on a
          // decodable frame instead of failing the whole extraction.
          let r: { uri: string } | null = null;
          let lastErr: unknown = null;
          for (const ct of [timeMs, timeMs + 250, Math.max(0, timeMs - 250), 0]) {
            try { r = await VT.getThumbnailAsync(clipUri, { time: ct, quality: 0.8 }); break; }
            catch (e) { lastErr = e; }
          }
          if (!r) {
            perFrameOutcomes.push({ idx: i, t_ms: timeMs, ok: false, error: 'thumbnail_failed_all_retries: ' + (lastErr instanceof Error ? lastErr.message : String(lastErr)) });
            return null;
          }
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
          return { b64: m.base64, media_type: 'image/jpeg', time_sec: timeMs / 1000, fraction: t } as Frame;
        } catch (err) {
          perFrameOutcomes.push({ idx: i, t_ms: timeMs, ok: false, error: err instanceof Error ? err.message : String(err) });
          return null;
        }
      }),
    );
    const valid = frames.filter((f): f is Frame => f !== null);
    // 2026-06-10 — When extraction comes back EMPTY (the "plays manually but
    // won't re-analyze" case), log the exact cause to the owner issue log:
    // clip uri scheme + the first thumbnail errors reveal an Android codec/VFR
    // or content://-uri problem without an ADB cable.
    if (valid.length === 0) {
      try {
        const firstErrs = perFrameOutcomes.filter(o => !o.ok).slice(0, 3).map(o => o.error);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../store/issueLogStore').useIssueLogStore.getState().addAppEvent('frame_extraction_empty', {
          uri_scheme: clipUri.split(':')[0],
          uri_tail: clipUri.slice(-44),
          attempted: frameFractions.length,
          errors: firstErrs,
          bounded: boundaries != null,
        });
      } catch { /* logging is best-effort */ }
    }
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

// ─── Swing localizer (acoustics-free) ───────────────────────────────────────
// 2026-06-09 — Uploaded phone clips have no acoustics to find the swing inside
// a 30-60s video. We do it in two cheap passes: (1) send COARSE timestamped
// frames and ask the model WHEN the swing happens; (2) re-extract DENSE frames
// in a tight window around it and run the normal analysis on just that. So the
// AI both finds AND reads the swing, with no manual marking and no acoustics.
// 2026-07-20 (BETA — Tim: swing analysis must never fail to find the swing) — bumped the
// locate frames from 320px/0.5 to 512px/0.65. At 320px a golfer at range/DTL distance is a
// handful of pixels — the model literally couldn't SEE the swing to place it. Bigger, clearer
// frames give the locator real signal to be intelligent with (still small on the wire: a 512px
// JPEG q0.65 is ~20-30KB, so even 18 frames stay well under any body limit).
const LOCATE_FRAME_WIDTH = 512;
const LOCATE_FRAME_COMPRESS = 0.65;
// 2026-06-29 (Tim) — lowered 12s→6s so SmartMotion/range clips around 8-10s (a real
// swing buried in a short clip) still get the swing LOCALIZED before pose extraction,
// instead of being skipped and smearing frames across the whole clip = empty biomech.
const LOCATE_MIN_CLIP_MS = 6_000;
// 2026-06-11 — bumped 15s → 25s. Telemetry (swing_locate_fallback "Aborted",
// Jun 10–11) showed the coarse-frame locate pass aborting client-side before a
// cold /api/swing-analysis Lambda returned. The locate pass is cheap (small
// frames) but cold-start + inference can exceed 15s; 25s clears it while still
// failing fast enough to fall back to wide-spread sampling if the server is dead.
// 2026-07-29 (Tim — consistent "swing_locate — Aborted"). The SERVER never hard-fails locate: on any
// Gemini error/timeout it still returns a 200 best-guess window (see api/swing-analysis.ts). But its
// Gemini call has a 20s server-side timeout, and on a cold Lambda 20s + cold-start + response can
// exceed the OLD 25s client abort — so the client was killing a response that was still on its way,
// every time. 35s clears the server's worst case so the guaranteed 200 always lands; with the frame
// count now halved the common case is far faster, so this ceiling is only ever hit on a cold miss.
const LOCATE_TIMEOUT_MS = 35_000;

/**
 * 2026-08-25 (release hardening) — THE OUTER GUARD MUST BE BIGGER THAN WHAT IT WRAPS.
 *
 * `smartmotion.tsx` raced `analyzeSwing` against a hardcoded 130s "hang guard" — a magic number in
 * one file wrapping budgets defined in this one. It had drifted SMALLER than their sum, so the
 * worst legitimate run (cold locate, then a first attempt that 502s just under the retry cap, then
 * a full-length retry) was killed at 130s and shown as "Analysis timed out" while the server's
 * answer was still on its way. The guard was manufacturing the failure it existed to catch.
 *
 * Derived here from the named parts instead, so the two can never disagree again. This is a
 * LAST-RESORT hang guard, not a latency budget: its only job is to be larger than the slowest run
 * that could still succeed. Typical runs are a small fraction of it, a dead network aborts in 3-9s
 * via the dead-host guard, and a wedged decode is bounded in utils/videoThumbnail.
 */
const DURATION_PROBE_CEILING_MS = 8_000;   // probeDurationMs' own PROBE_TIMEOUT_MS
const FRAME_EXTRACTION_CEILING_MS = 30_000; // serialized bounded decodes, generous allowance

/**
 * 2026-08-25 — tightened 30s → 12s to match its OWN stated intent. The comment at the retry site
 * reads "Fast-fail (~5s) is the intended trigger; anything slow has already failed meaningfully and
 * the retry won't help" — but the cap let a 29s first attempt earn a full second attempt, adding up
 * to 64s of wall clock to a request that had already failed slowly. 12s still covers a genuine
 * fast-fail with margin and takes 18s off the worst case.
 */
export const RETRY_ELIGIBILITY_CAP_MS = 12_000;
const RETRY_BACKOFF_MS = 1_200;

/** The slowest run that could still legitimately succeed. Consumed by the screen's hang guard. */
export const ANALYSIS_WORST_CASE_MS =
  DURATION_PROBE_CEILING_MS +
  LOCATE_TIMEOUT_MS +
  FRAME_EXTRACTION_CEILING_MS +
  RETRY_ELIGIBILITY_CAP_MS +
  RETRY_BACKOFF_MS +
  REQUEST_TIMEOUT_MS;

// 2026-08-08 (Tim's log: swing_locate_fallback "Aborted" ×6 in 10 min — each one a FULL 35s hang on a
// flaky home network before the fallback smeared the analysis; "reads should be faster"). Concurrent
// dead-host guard, same design as the transcribe path: probe /api/health (3s) while the locate fetch
// runs; both a fast refusal AND a black-hole (probe times out, one 6s retry also silent) abort the
// doomed locate in ~3-9s so analysis degrades fast instead of burning 35s per swing. A slow-but-ALIVE
// host answers the tiny GET and the locate is never aborted (cold-Lambda patience preserved).
/**
 * 2026-08-24 (Tim's device log: swing_locate_fallback "Aborted" ×3 at 7:30/7:32/7:34 PM, live_cage).
 *
 * THE LOG COULD NOT SAY WHO ABORTED. Both the 35s ceiling and this guard called
 * `controller.abort()` with no reason, and the catch reported the generic `error: "Aborted"`. So a
 * network that was genuinely down and a server that was merely slow produced the SAME line — which
 * is exactly why this entry has sat open since 08-08, with the 08-24 handoff noting the contention
 * diagnosis "was never confirmed... equally consistent with the network being down at that moment."
 *
 * Sixteen days of ambiguity is a telemetry defect, not a swing defect. The guard now REPORTS: which
 * probe answered, how long it took, and therefore whether the abort was this guard doing its job on
 * a dead host, or the ceiling firing on a live-but-slow one. Same discipline as the `cdnOk` field
 * that settled the 35-second voice silence.
 */
function armDeadHostGuard(
  apiUrl: string,
  controller: AbortController,
  onFired: (probes: { probe1Ok: boolean; probe2Ok: boolean; probe3Ok: boolean; firedAfterMs: number }) => void,
): { cancel: () => void } {
  let cancelled = false;
  const armedAt = Date.now();
  const probe = async (timeoutMs: number): Promise<boolean> => {
    try {
      const pc = new AbortController();
      const pt = setTimeout(() => pc.abort(), timeoutMs);
      // 2026-08-08 (verification wave) — ?lite=1: the bare /api/health runs 3 BILLABLE provider probes
      // with ~3s internal timeouts + cold start, so a 3s client budget timed out spuriously on a healthy
      // host (false-abort risk) and every armed guard burned paid provider calls. lite answers instantly
      // and free — it's a REACHABILITY probe, provider health is irrelevant here.
      const r = await fetch(`${apiUrl}/api/health?lite=1`, { method: 'GET', signal: pc.signal }).finally(() => clearTimeout(pt));
      return r.ok;
    } catch { return false; }
  };
  void (async () => {
    const probe1Ok = await probe(3000);
    if (probe1Ok) return;
    if (cancelled) return;
    const probe2Ok = await probe(6000);
    if (probe2Ok) return;
    if (cancelled) return;
    /**
     * 2026-09-01 (Tim's log, Sep 1 16:17 and 17:29 — swing_locate_fallback, cause dead_host,
     * probe1Ok:false probe2Ok:false, fired at 9s, TWICE) — A THIRD, PATIENT PROBE.
     *
     * The host was not dead. /api/health?lite=1 answers in ~230ms and the analysis endpoint was up
     * both times. What this guard cannot see is that it competes with the very request it is
     * guarding: eight coarse frames are POSTing to the SAME ORIGIN while these probes try to GET it,
     * so on a phone uplink the small request queues behind the large body and times out. The guard
     * then reads its own starvation as a dead host and kills a request the 35s ceiling would have
     * let finish — 26 seconds of headroom thrown away, twice in one afternoon.
     *
     * A dead host stays silent no matter how long you wait; a starved probe eventually gets through.
     * So the third probe is deliberately generous. Total budget ~21s still leaves 14s under the
     * ceiling, which is the only thing this guard exists to save.
     * [[the-client-must-be-the-last-to-give-up]]
     */
    const probe3Ok = await probe(12_000);
    if (probe3Ok) return;
    if (cancelled) return;
    // All three silent. Record the verdict BEFORE aborting, so the catch can name the cause
    // rather than reporting a bare "Aborted" that proves nothing.
    try { onFired({ probe1Ok, probe2Ok, probe3Ok, firedAfterMs: Date.now() - armedAt }); } catch { /* no-op */ }
    try { controller.abort(); } catch { /* no-op */ }
  })();
  return { cancel: () => { cancelled = true; } };
}

// Small, many, evenly-spread frames tagged with timestamps. Cheap to extract
// and tiny on the wire — used only to ASK "where's the swing", not to read it.
async function extractCoarseFrames(clipUri: string, durationMs: number, count: number): Promise<Frame[]> {
  const lo = 0.04;
  const hi = 0.97;
  const fracs = Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
  // 2026-07-29 (Tim — "60s to analyze, then a failure"). This used to fire ALL `count` (10-16)
  // getThumbnailAsync calls CONCURRENTLY via Promise.all. On a 4K phone clip that spins up 16 native
  // MediaMetadataRetriever instances decoding the SAME file at once — the documented slow/OOM/SIGSEGV
  // vector (see services/swing/clubPath.ts) — which is exactly why locate crawled for ~a minute and
  // then aborted/failed on real uploads. Extract SEQUENTIALLY: one retriever at a time is dramatically
  // faster on a 4K source (no thrash) and can't crash. The frames are tiny + this is background, so the
  // sequential cost is invisible next to the concurrent thrash it replaces.
  const out: Frame[] = [];
  for (const frac of fracs) {
    const timeMs = Math.round(durationMs * frac);
    try {
      const r = await VT.getThumbnailAsync(clipUri, { time: timeMs, quality: 0.5 });
      const m = await ImageManipulator.manipulateAsync(
        r.uri,
        [{ resize: { width: LOCATE_FRAME_WIDTH } }],
        { compress: LOCATE_FRAME_COMPRESS, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (m.base64) out.push({ b64: m.base64, media_type: 'image/jpeg', time_sec: timeMs / 1000 } as Frame);
    } catch {
      /* skip this frame; locate tolerates gaps */
    }
  }
  return out;
}

// 2026-06-10 — Field telemetry for the auto swing-finder. Logged to /owner-logs
// (ANALYSIS tab) so a setup/address read is diagnosable: did the localizer find
// the swing, miss it, or fail to extract coarse frames? This is the thing that,
// when it silently fell back (e.g. during the API-base spine outage), caused the
// analyzer to spread frames across setup/walk-up and read the address.
/**
 * 2026-08-19 — locator breadcrumbs, classified.
 *
 * These lines were all landing as 'analysis_error' (addAppEvent's default kind) and therefore being
 * MAILED to the owner as problems. A tester's report of "analysis_error: swing_located" was a swing
 * the locator had found correctly — the success line itself, forwarded as a failure. Normal operation
 * is not an issue: a release inbox is only useful if every line in it is worth reading.
 *
 * SUCCESS ('*_located') and BY-DESIGN skips (a clip too short to be worth a locate pass — the
 * deliberate speed path) are 'diag': kept on the device for owner-log review, never exported.
 * Genuine degradation — a server error, a missing timestamp, an exception, frames that failed to
 * extract, a missing API URL — stays reportable, because those are the ones worth waking up to.
 */
function logLocate(stage: string, details: Record<string, unknown>): void {
  try {
    const reason = typeof details.reason === 'string' ? details.reason : '';
    const expected = stage.endsWith('_located')
      || reason === 'clip_under_12s' || reason === 'clip_too_short';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../store/issueLogStore').useIssueLogStore.getState()
      .addAppEvent(stage, details, expected ? 'diag' : 'analysis_error');
  } catch { /* best-effort */ }
}

/**
 * Find WHEN the swing happens in a long, unbounded clip and return a tight
 * window around it. Returns null when it can't locate (caller falls back to
 * wide-spread sampling). Best-effort: its own 15s timeout, never throws,
 * never trips the analysis breaker.
 */
export async function locateSwingWindow(
  clipUri: string,
  durationMs: number,
  /**
   * 2026-08-25 — optional so the existing caller in swinglab/swing/[swing_id] is untouched.
   * Reports WHY the locate was abandoned, which the analysis path needs in order to flag the read
   * as rough rather than presenting a whole-clip smear as a clean measurement.
   */
  opts?: { onAbort?: (cause: 'dead_host' | 'ceiling' | 'unknown') => void },
): Promise<{ startSec: number; endSec: number; swingTimeSec: number } | null> {
  const apiUrl = getApiBaseUrl();
  if (!apiUrl || durationMs < LOCATE_MIN_CLIP_MS) {
    logLocate('swing_locate_skip', { reason: durationMs < LOCATE_MIN_CLIP_MS ? 'clip_under_12s' : 'no_api_url', dur_ms: durationMs });
    return null;
  }
  // 2026-07-29 (Tim — "60s to analyze then a failure"). Root cause: locate sent up to 16 frames to a
  // Gemini vision call; 16 images is a HEAVY multimodal inference that regularly ran past the 25s
  // client timeout (server budget is 60s, so the client abandoned a call that was still running →
  // consistent "swing_locate — Aborted"). A COARSE "which ~5s window has the swing" question doesn't
  // need 16 images — 8-10 is plenty and the inference is far faster, so it lands well inside the window.
  const count = Math.max(8, Math.min(10, Math.round(durationMs / 1000 / 5)));
  const frames = await extractCoarseFrames(clipUri, durationMs, count);
  if (frames.length < 3) {
    logLocate('swing_locate_fallback', { reason: 'coarse_frames_failed', extracted: frames.length, wanted: count });
    return null;
  }
  /**
   * 2026-08-24 — WHO ABORTED. Two things can abort the locate fetch and they mean OPPOSITE things:
   * the dead-host guard (the network is gone — degrading fast is CORRECT behaviour) and the 35s
   * ceiling (the host answered our probe and then took too long — a real server problem). Until
   * today both produced the same bare "Aborted", which is why this entry sat open for sixteen days.
   * Declared outside the try so the catch can name the cause.
   */
  const startedAt = Date.now();
  let abortCause: 'dead_host' | 'ceiling' | null = null;
  let probeVerdict: { probe1Ok: boolean; probe2Ok: boolean; probe3Ok: boolean; firedAfterMs: number } | null = null;
  try {
    // 2026-08-08 — dead-host guard (see armDeadHostGuard): a provably-dead network aborts in ~3-9s
    // instead of hanging the full 35s ceiling per swing.
    const locateCtl = new AbortController();
    const locateTimer = setTimeout(() => {
      abortCause = abortCause ?? 'ceiling';
      try { locateCtl.abort(); } catch { /* no-op */ }
    }, LOCATE_TIMEOUT_MS);
    const guard = armDeadHostGuard(apiUrl, locateCtl, (probes) => {
      abortCause = abortCause ?? 'dead_host';
      probeVerdict = probes;
    });
    let res: Response;
    try {
      res = await fetch(`${apiUrl}/api/swing-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'locate_swing',
          frames: frames.map((f) => ({ b64: f.b64, media_type: f.media_type, time_sec: f.time_sec })),
        }),
        signal: locateCtl.signal,
      });
    } finally {
      clearTimeout(locateTimer);
      guard.cancel();
    }
    if (!res.ok) {
      logLocate('swing_locate_fallback', { reason: 'server_' + res.status, coarse_frames: frames.length });
      return null;
    }
    const data = (await res.json()) as { found?: boolean; swing_time_sec?: number; confidence?: string };
    // 2026-07-20 (BETA) — the locator now ALWAYS returns a best-estimate swing_time_sec (server
    // no longer emits "no swing"), so trust any finite timestamp regardless of the found flag.
    // This branch now only guards a genuinely malformed response.
    if (typeof data.swing_time_sec !== 'number' || !Number.isFinite(data.swing_time_sec)) {
      V6('LOCATE — no usable timestamp in response (fallback to wide spread)', { coarse_frames: frames.length });
      logLocate('swing_locate_fallback', { reason: 'no_timestamp', coarse_frames: frames.length });
      return null;
    }
    const durSec = durationMs / 1000;
    const t = Math.max(0, Math.min(durSec, data.swing_time_sec));
    // A bit before (top of backswing) through a bit after (follow-through).
    const startSec = Math.max(0, t - 2.5);
    const endSec = Math.min(durSec, t + 3);
    if (endSec - startSec < 1) return null;
    V6('LOCATE — swing window', {
      swing_time_sec: t, startSec, endSec,
      confidence: data.confidence ?? null, coarse_frames: frames.length,
    });
    logLocate('swing_located', { swing_time_sec: Math.round(t * 10) / 10, start_sec: Math.round(startSec * 10) / 10, end_sec: Math.round(endSec * 10) / 10, confidence: data.confidence ?? null });
    // 2026-08-09 (verification wave C1) — return the IMPACT ESTIMATE itself, not just the window.
    // Callers used to convert this to a window and throw the anchor away, then sample "impact" at a
    // fixed 65% window fraction — which lands ~1.1s AFTER the ball (impact truly sits at 2.5/5.5 =
    // 45.5% of this window). Threading swingTimeSec lets the strike-anchored sampling branch (the
    // correct one) run for uploads too.
    return { startSec, endSec, swingTimeSec: t };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const name = e instanceof Error ? e.name : '';
    const aborted = name === 'AbortError' || /abort/i.test(msg);
    /**
     * 2026-08-24 — an abort is now reported as an ABORT with its cause and the evidence, not as a
     * nameless exception. `dead_host` with both probes false means the network was gone and this
     * degraded fast, which is the guard working; `ceiling` means the host answered our probe and
     * then took longer than 35s, which is a server problem worth chasing. Those are different bugs
     * and for sixteen days they produced the same log line.
     */
    if (aborted) {
      const detail = {
        reason: 'aborted',
        cause: abortCause ?? 'unknown',
        elapsed_ms: Date.now() - startedAt,
        coarse_frames: frames.length,
        ...(probeVerdict ?? {}),
      };
      V6('LOCATE — aborted (fallback to wide spread)', detail);
      logLocate('swing_locate_fallback', detail);
      try { opts?.onAbort?.(abortCause ?? 'unknown'); } catch { /* reporting never breaks the read */ }
      return null;
    }
    V6('LOCATE — failed (fallback to wide spread)', { error: msg });
    logLocate('swing_locate_fallback', { reason: 'exception', error: msg, elapsed_ms: Date.now() - startedAt });
    return null;
  }
}

// 2026-06-11 — bumped 20s → 30s alongside LOCATE_TIMEOUT_MS. Range mode locates
// across 2-min clips, so its coarse pass is larger and slower than the single-
// swing locate; give it proportionally more headroom over a cold Lambda.
const LOCATE_SWINGS_TIMEOUT_MS = 30_000;

/**
 * RANGE MODE (acoustics off) — find ALL swings in a multi-swing clip. Plural
 * sibling of locateSwingWindow: sends DENSER coarse timestamped frames and asks
 * the model for every distinct swing-impact time. Returns an array (possibly
 * empty — caller then falls back to single-swing localization). Best-effort:
 * own timeout, never throws, never trips the analysis breaker.
 */
export async function locateSwings(
  clipUri: string,
  durationMs: number,
): Promise<Array<{ timeSec: number; confidence: 'high' | 'low' }>> {
  const apiUrl = getApiBaseUrl();
  if (!apiUrl || durationMs < LOCATE_MIN_CLIP_MS) {
    logLocate('range_locate_skip', { reason: durationMs < LOCATE_MIN_CLIP_MS ? 'clip_too_short' : 'no_api_url', dur_ms: durationMs });
    return [];
  }
  // Denser than single-swing localize so we don't miss swings: ~1 frame / 5s,
  // clamped 12-24 (a 2-min range session needs broad-but-bounded coverage).
  // 2026-06-11 — ~2.5s frame spacing (was 5s). Validated on Tim's real 60s
  // range clip: at 5s spacing the model OVER-detected (9 for 6 real swings)
  // because sparse snapshots each read as a swing; at 2.5s (24 frames) it nailed
  // 6. Capped at 24 — going denser (30) made the model return [] (input too busy).
  const count = Math.max(12, Math.min(24, Math.round(durationMs / 1000 / 2.5)));
  const frames = await extractCoarseFrames(clipUri, durationMs, count);
  if (frames.length < 3) {
    logLocate('range_locate_fallback', { reason: 'coarse_frames_failed', extracted: frames.length, wanted: count });
    return [];
  }
  // 2026-08-24 — same cause-naming as the single locate. This is the live_cage path, which is where
  // Tim's 7:30-7:34 PM aborts came from, so the ambiguity mattered here too.
  const rangeStartedAt = Date.now();
  let rangeAbortCause: 'dead_host' | 'ceiling' | null = null;
  let rangeProbeVerdict: { probe1Ok: boolean; probe2Ok: boolean; probe3Ok: boolean; firedAfterMs: number } | null = null;
  try {
    // 2026-08-08 — same dead-host guard as the single locate: flaky network degrades in ~3-9s, not 30s+.
    const rangeCtl = new AbortController();
    const rangeTimer = setTimeout(() => {
      rangeAbortCause = rangeAbortCause ?? 'ceiling';
      try { rangeCtl.abort(); } catch { /* no-op */ }
    }, LOCATE_SWINGS_TIMEOUT_MS);
    const rangeGuard = armDeadHostGuard(apiUrl, rangeCtl, (probes) => {
      rangeAbortCause = rangeAbortCause ?? 'dead_host';
      rangeProbeVerdict = probes;
    });
    let res: Response;
    try {
      res = await fetch(`${apiUrl}/api/swing-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'locate_swings',
          frames: frames.map((f) => ({ b64: f.b64, media_type: f.media_type, time_sec: f.time_sec })),
        }),
        signal: rangeCtl.signal,
      });
    } finally {
      clearTimeout(rangeTimer);
      rangeGuard.cancel();
    }
    if (!res.ok) {
      logLocate('range_locate_fallback', { reason: 'server_' + res.status, coarse_frames: frames.length });
      return [];
    }
    const data = (await res.json()) as { swings?: Array<{ time_sec?: number; confidence?: string }> };
    const durSec = durationMs / 1000;
    const raw = (data.swings ?? [])
      .filter((s) => typeof s.time_sec === 'number' && Number.isFinite(s.time_sec))
      .map((s) => ({
        timeSec: Math.max(0, Math.min(durSec, s.time_sec as number)),
        confidence: (s.confidence === 'high' ? 'high' : 'low') as 'high' | 'low',
      }));
    // 2026-06-11 — Collapse the model's over-detections (one swing's phases
    // labeled as multiple swings on ~1-1.5s-spaced coarse frames). Verified on
    // real clips: a 1-swing DTL clip came back as 3, a face-on as 6. See
    // mergeSwingDetections.
    // 2026-07-08 (segmentation audit #4) — the 2.5s merge floor was validated at
    // 2.5s FRAME SPACING (60s clip / 24 frames). A 120s range clip still caps at 24
    // frames → 5s spacing, exactly the geometry the 2026-06-11 note says over-
    // detected (adjacent-frame phantoms sit ~5s apart and survived a 2.5s merge).
    // Scale the separation to the ACTUAL frame interval so the merge keeps up.
    // 2026-07-30 (detection root-cause #4 — long-clip UNDER-count). The coarse frames cap at 24, so a
    // 120s clip yields frameIntervalSec≈5s → a 5s merge floor that collapsed two REAL swings hit ~4s apart
    // (normal range cadence) into one. Cap the adaptive separation at a plausible two-swing gap so a long
    // clip can't merge distinct swings; the floor still scales up from 2.5s for genuinely sparse frames.
    const frameIntervalSec = durationMs / 1000 / Math.max(1, frames.length);
    const out = mergeSwingDetections(raw, Math.min(3.5, Math.max(2.5, frameIntervalSec)));
    logLocate('range_located', { count: out.length, raw_count: raw.length, coarse_frames: frames.length });
    return out;
  } catch (e) {
    // 2026-08-24 — name the cause, same as the single locate. `dead_host` with both probes false is
    // the guard working on a gone network; `ceiling` is a live host that took too long, which is a
    // different bug entirely. They used to be indistinguishable.
    {
      const msg = e instanceof Error ? e.message : String(e);
      const name = e instanceof Error ? e.name : '';
      if (name === 'AbortError' || /abort/i.test(msg)) {
        logLocate('range_locate_fallback', {
          reason: 'aborted',
          cause: rangeAbortCause ?? 'unknown',
          elapsed_ms: Date.now() - rangeStartedAt,
          coarse_frames: frames.length,
          ...(rangeProbeVerdict ?? {}),
        });
        return [];
      }
      logLocate('range_locate_fallback', { reason: 'exception', error: msg, elapsed_ms: Date.now() - rangeStartedAt });
    }
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
    // 2026-06-10 — swinger handedness. Direction-dependent faults (over-the-top,
    // hip slide, lead side) mirror for lefties; the analyzer prompt uses this to
    // read direction correctly instead of assuming right-handed.
    handedness?: 'left' | 'right' | null;
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
    // Server runs Gemini 2.5 Flash only (no OpenAI escalation). A
    // 13s server-side timeout caps a cold Lambda + complex scene so
    // the server returns 502 fast → poseDetection.ts tier=quick retry
    // fires on the now-warm Lambda (3-8s). 'full' (or omitted) is
    // the existing library / Cage upload behavior — Gemini → OpenAI
    // escalation chain.
    tier?: 'quick' | 'full';
    /**
     * 2026-08-31 — FIRED THE INSTANT THIS FUNCTION IS DONE DECODING.
     *
     * The pose warm added this morning was started by the caller as soon as the request was built,
     * which is BEFORE analyzeSwing has probed, located and extracted. Every frame decode in this app
     * goes through one serialized media chain, so the warm's 5-8 decodes did not fill idle time —
     * they QUEUED IN FRONT OF the extraction the analysis was waiting on, and made the wait longer.
     * A latency fix that added latency.
     *
     * Only this function knows when its own decoding ends and the network wait starts. That is the
     * moment the decoder is genuinely idle, so that is when the caller is told.
     */
    onFramesReady?: () => void;
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
    // 2026-06-08 — typed coach NOTE (setSessionCoachNote on the swing-detail
    // screen). Like coach_audio but written, not spoken: the instructor's
    // note on this swing ("hips stalled at impact"). Threaded into the
    // analyst prompt as expert context (not ground truth) so library/coach
    // analysis incorporates the coach's read.
    coach_note?: string | null;
    // 2026-06-29 (Tim — drill-aware analysis) — when the swing was captured INSIDE a
    // drill, the drill's focus/premise so the analyst grades the swing against the
    // drill's intent (e.g. "the pump drill trains an in-to-out path — did they?")
    // rather than giving a generic full-swing fault read.
    drill_focus?: string | null;
    drill_name?: string | null;
    // 2026-06-30 (audit C11) — the player's OWN felt sense of the swing (setSessionFeel:
    // "felt thin", "pured it", "came over the top"). Self-reported context the analyst can
    // weigh against what it sees ("you said X, I see Y") — like coach_audio, but from the
    // golfer. Was persisted + displayed but never reached any brain/analysis prompt.
    feel_note?: string | null;
    // 2026-07-07 (Tim — "tie the tracing into the analysis") — the app's OWN measured
    // signals for THIS swing (pose tempo/biomech, camera launch tracking, acoustic
    // strike). Instrument readings the vision model corroborates against — it was
    // judging frames blind to our measurements. All optional; pass what's real.
    measured?: {
      tempo_ratio?: number | null;
      backswing_ms?: number | null;
      downswing_ms?: number | null;
      shoulder_tilt_deg?: number | null;
      spine_delta_deg?: number | null;
      weight_shift_pct?: number | null;
      launch_divergence_deg?: number | null;
      launch_side?: string | null;
      strike_peak_db?: number | null;
    } | null;
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
  // Acoustics-free localization: for an UNBOUNDED long clip (an untrimmed
  // phone upload), find the swing FIRST so the dense frames land ON the swing
  // instead of being spread across a minute of practice/setup/walk-up. Bounded
  // clips (live SmartMotion windowed on the strike, or a user trim) and short
  // clips skip this — they're already targeted. Failure falls back silently to
  // the duration-scaled wide spread inside extractKeyFrames.
  // 2026-08-25 — set only when the locate pass was abandoned; rides out on the result so the review
  // screen can mark the read as rough instead of presenting a smear as a clean measurement.
  let locateDegraded: 'dead_host' | 'ceiling' | 'unknown' | null = null;
  let effectiveBoundaries = boundaries;
  let probedDurMs = 0; // 2026-06-11 (audit) — reused by extractKeyFrames below
  // 2026-08-31 — stage clocks. See logAnalysisTiming: the whole pipeline was timed into console.log,
  // which is unreadable on a phone, so nobody could say which stage cost the minute.
  const tStart = Date.now();
  let probeMs = 0, locateMs = 0, extractMs = 0, requestMs = 0;
  if (!effectiveBoundaries) {
    const tProbe = Date.now();
    probedDurMs = await probeDurationMs(clipUri).catch(() => 0);
    probeMs = Date.now() - tProbe;
    if (probedDurMs >= LOCATE_MIN_CLIP_MS) {
      const tLocate = Date.now();
      const located = await locateSwingWindow(clipUri, probedDurMs, {
        onAbort: (cause) => { locateDegraded = cause; },
      });
      locateMs = Date.now() - tLocate;
      if (located) {
        effectiveBoundaries = located;
        V6('STAGE 2 — using located swing window as boundaries', located);
      } else {
        // The locate pass gave up. Frames now come from the whole clip rather than the swing, so
        // the read that follows is rough — carry the reason out so the player can be told.
        locateDegraded = locateDegraded ?? 'unknown';
        V6('STAGE 2 — locate failed; read will be flagged as rough', { cause: locateDegraded });
      }
    }
  }
  // Pass the already-probed duration so extractKeyFrames' unbounded branch
  // doesn't probe the same clip a second time (no-op when boundaries are set).
  const tExtract = Date.now();
  /**
   * 2026-08-31 — `probedDurMs` is 0 whenever the caller supplied boundaries, so this passed
   * `undefined` on the FAST path and extractKeyFrames probed the clip all over again. The probe is
   * memoized now, so asking for it here is free when anything already asked — and it removes a
   * duration probe from the one path that was supposed to be the quick one.
   */
  const durForExtract = probedDurMs || (await probeDurationMs(clipUri).catch(() => 0)) || undefined;
  const frames = await extractKeyFrames(clipUri, effectiveBoundaries, quickTier, durForExtract);
  extractMs = Date.now() - tExtract;
  // Decoding is finished; everything from here is network. Safe for the caller to use the decoder.
  try { context.onFramesReady?.(); } catch { /* a warm must never affect the analysis */ }
  /**
   * 2026-08-25 (Tim — "I've actually never waited for the analysis") — report what the frame cache
   * saved on this analysis. Decodes are serialized app-wide, so a decode avoided is wall-clock the
   * player did not wait through. This turns the next "it takes a while" into a number instead of a
   * guess.
   */
  try {
    const { thumbnailCacheStats, wedgedDecodeCount } = await import('../utils/videoThumbnail');
    const st = thumbnailCacheStats();
    if (st.hits + st.misses > 0) {
      V6('FRAME CACHE', { decodes: st.misses, reused: st.hits, saved_pct: Math.round((st.hits / (st.hits + st.misses)) * 100) });
    }
    // 2026-08-25 — a non-zero count means a native decode had to be abandoned so the app-wide chain
    // could keep moving. Zero in a healthy session; if this ever climbs, the clip is the suspect.
    const abandoned = wedgedDecodeCount();
    if (abandoned > 0) V6('MEDIA CHAIN — abandoned wedged decodes', { count: abandoned });
  } catch { /* telemetry never blocks an analysis */ }
  if (frames.length === 0) {
    V6('STAGE 3 SKIP — no_frames (no usable frames extracted)');
    return { kind: 'no_frames' };
  }

  // No-walls policy: the swing-analysis circuit breaker is telemetry-only. We
  // still record success/failure below (for diagnostics + the connectivity
  // signal), but we never short-circuit on a degraded breaker — the caddie/
  // analysis path always attempts and degrades gracefully rather than walling
  // off the user on prior failures.

  const apiUrl = getApiBaseUrl();
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
    let res = await tryFetch(1);
    let elapsedMs = Date.now() - t0;
    requestMs = elapsedMs;
    V6('STAGE 4 — /api/swing-analysis response', {
      status: res.status,
      elapsed_ms: elapsedMs,
    });
    // 2026-06-07 — Auto-retry-once for tier=quick 502. After Win #6
    // shipped fast-fail on Haiku null (server returns 502 in ~5s
    // instead of escalating 30-40s), the client was leaving the
    // user with an error message + "tap Record to try another
    // swing" — losing the speed win to a manual re-record. Retry
    // once with a 1.2s delay so the warm Haiku + warm prompt cache
    // can produce a successful read on the second attempt. Net UX:
    // ~7-8s for a normally-recoverable Haiku hiccup instead of
    // 30-40s escalation OR a forced re-record. Only fires for
    // tier=quick — tier=full already has the escalation safety net.
    // 2026-06-07 self-audit H1: skip retry when the first attempt
    // already burned >30s (slow Lambda or genuine server timeout).
    // Without the cap, first-attempt 55s + 1.2s wait + retry 55s =
    // ~111s wall clock — longer than Vercel's 60s function maxDuration
    // means the retry hits a dead server anyway. Fast-fail (~5s) is
    // the intended trigger; anything slow has already failed
    // meaningfully and the retry won't help.
    // RETRY_ELIGIBILITY_CAP_MS is module-scope now (see ANALYSIS_WORST_CASE_MS) and is 12s.
    // Also retry 503 (Service Unavailable) — Vercel emits this on brief cold
    // restarts just as it emits 502 on Lambda timeouts; both resolve on the
    // second attempt once the instance is warm.
    if (!res.ok && (res.status === 502 || res.status === 503) && context.tier === 'quick' && elapsedMs < RETRY_ELIGIBILITY_CAP_MS) {
      V6('STAGE 4 — tier=quick 502 (fast-fail), auto-retry once after 1200ms', {
        first_attempt_elapsed_ms: elapsedMs,
      });
      await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
      const retryT0 = Date.now();
      try {
        res = await tryFetch(1);
        elapsedMs = Date.now() - t0;
        V6('STAGE 4 — auto-retry response', {
          status: res.status,
          retry_elapsed_ms: Date.now() - retryT0,
          total_elapsed_ms: elapsedMs,
        });
      } catch (e) {
        V6('STAGE 4 — auto-retry threw, surfacing original error', {
          error_head: (e instanceof Error ? e.message : String(e)).slice(0, 120),
        });
      }
    } else if (!res.ok && res.status === 502 && context.tier === 'quick') {
      V6('STAGE 4 — tier=quick 502 but first attempt slow, skipping retry', {
        first_attempt_elapsed_ms: elapsedMs,
        cap_ms: RETRY_ELIGIBILITY_CAP_MS,
      });
    }
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
      // 5xx = server problem, 4xx = request problem; neither is a network loss.
      recordFailure('swing-analysis', 'server');
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
            // 2026-06-14 (audit #3 — honesty) — use the REAL fraction this frame
            // was sampled at (carried on the Frame), not FRAME_TIME_FRACTIONS[idx].
            // The old code always indexed the full-tier 5-frame array, so a
            // quick-tier (3-frame) or long-clip (even-spread) read reported a
            // fault-position that didn't match where the frame actually came from.
            faultFrameFraction = frames[idx].fraction ?? null;
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

    // Success — clear the breaker window + mark online.
    recordSuccess('swing-analysis');
    reportOnline();
    // 2026-08-31 — one breadcrumb naming the long pole. Emitted on the SUCCESS path because a
    // timing for a run that failed says more about the failure than about the speed.
    logAnalysisTiming({
      probe_ms: probeMs || undefined,
      locate_ms: locateMs || undefined,
      extract_ms: extractMs || undefined,
      request_ms: requestMs || undefined,
      total_ms: Date.now() - tStart,
      bounded: boundaries != null,
      frames: frames.length,
      tier: context.tier ?? 'full',
    });
    return {
      kind: 'ok',
      analysis: data,
      locate_degraded: locateDegraded,
      frame_timestamps_sec: frames.map(f => f.time_sec),
      fault_frame_uri: faultFrameUri,
      fault_frame_display_uri: faultFrameDisplayUri,
      fault_frame_fraction: faultFrameFraction,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : '';
    V6('STAGE 4 — fetch threw', { error: msg, name });
    // CRITICAL distinction (the false "lost connection on Wi-Fi" bug): an
    // AbortSignal.timeout fires a TimeoutError when the SERVER took too long.
    // That is NOT a network loss — the connection was fine, the analysis just
    // ran past our deadline. Classifying it as no_network told the user to
    // "check your network" on perfect Wi-Fi AND tripped the breaker into
    // Local Mode. Treat timeout as its own honest case; reserve no_network
    // for genuine connectivity errors.
    const isTimeout = name === 'TimeoutError' || name === 'AbortError' ||
      (/abort|timeout|timed out/i.test(msg) && !/network request failed|connection|unreachable|dns|offline/i.test(msg));
    if (isTimeout) {
      recordFailure('swing-analysis', 'timeout');
      return { kind: 'error', message: 'That took too long to analyze. Tap Re-analyze to try again.' };
    }
    if (/network|connection|fetch|unreachable|dns|offline/i.test(msg)) {
      recordFailure('swing-analysis', 'network');
      reportNetworkFailure();
      return { kind: 'no_network' };
    }
    recordFailure('swing-analysis', 'server');
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

  const apiUrl = getApiBaseUrl();
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
        // 2026-06-07 self-audit H3: switched tier='quick' → tier='full'
        // here. With Win #6 (fast-fail tier=quick on Haiku null) +
        // auto-retry-once, the PRIMARY analyzeSwing already gets two
        // Haiku attempts. Tentative running ALSO at tier='quick'
        // would just add 2 more Haiku attempts — if Haiku is broken
        // on this clip, all 4 fail and the user gets nothing.
        // Tentative is the LAST resort after primary failed; switching
        // it to tier='full' brings in the OpenAI → Sonnet escalation
        // safety net (30-40s, but a much higher chance of producing
        // SOMETHING usable from the single tentative frame).
        context: { ...context, tier: 'full' as const },
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
    // 2026-06-23 (smoke-test) — mirror the primary classifier: an abort/timeout =
    // slow server (cold Lambda), NOT signal loss. Only genuine connectivity errors
    // are no_network; a timeout must read as "took too long", not "no network".
    const name = err instanceof Error ? err.name : '';
    const isTimeout = name === 'TimeoutError' || name === 'AbortError' ||
      (/abort|timeout|timed out/i.test(msg) && !/network request failed|connection|unreachable|dns|offline/i.test(msg));
    if (isTimeout) return { kind: 'error', message: 'That took too long to analyze. Tap Re-analyze to try again.' };
    if (/network|connection|fetch|unreachable|dns|offline/i.test(msg)) return { kind: 'no_network' };
    return { kind: 'error', message: msg };
  }
}
