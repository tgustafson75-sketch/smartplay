/**
 * 2026-10-03 (Tim: "Is all of this being managed by an orchestrator?" — it was not).
 *
 * Swing analysis stages were started from five places — the swing screen's open effect, its own pose
 * backfill, the upload service, SmartMotion, the Analyze button — and nothing owned the ORDER. That is
 * how one 6-second upload collided with itself: a second 37MB clip copy, a pose pass competing with the
 * read's frames on the same reader, the locate run twice, two reads of one clip.
 *
 * This module owns it:
 *
 *   1. WHERE IS THE SWING  — findUploadSwingWindow: the web SmartMotion motion pass (Android, hidden
 *      browser), the whole clip when the clip is short, the on-device locate, the network locate, the
 *      middle of the clip. One answer, one place, in that order.
 *   2. THE READ            — runPhaseKOnSession (key frames → /api/swing-analysis → classify → store):
 *      what the player waits for.
 *   3. THE SECOND PASS     — pose / body mechanics / trace, started by the read when it finishes
 *      (videoUpload's post-Phase-K pose pass). Never on the critical path.
 *
 * One run per swing — joining instead of starting a second — is the engine's job
 * (services/swing/orchestrator/engine + uploadRun).
 *
 * services/swing/analysisPipeline still records what ran (observation); this decides what runs.
 */

import { ON_DEVICE_LOCATE_MIN_CLIP_MS } from './analysisFrames';

export type UploadSwingWindow = {
  startSec: number;
  endSec: number;
  /** A measured impact, when the method that found the window measured one (pose locate). */
  impactSec: number | null;
  via: 'motion' | 'whole_clip' | 'on_device' | 'network' | 'middle';
  /**
   * The locator's own window, before the ±0.5s address/finish padding (pose locate only). The read's
   * nine frames want the tight span — denser around impact — and analyzeSwing samples it.
   */
  core?: { startSec: number; endSec: number };
};

/** A clip this short IS the swing; locating it costs more than it saves. */
const SHORT_CLIP_NO_LOCATE_SEC = 8;

type PoseReader = (clipUri: string, tMs: number) => Promise<{ handsHigh: boolean } | null>;
const PICK_BUDGET_MS = 4_000;

/**
 * Hands above the shoulders in one frame — the top of a backswing or a finish. Walking, setting up and
 * turning to watch the ball never put them there, which is what tells a swing apart from the other
 * bursts of motion in a busy clip.
 */
const readHandsHigh: PoseReader = async (clipUri, tMs) => {
  const VT = require('../../utils/videoThumbnail') as typeof import('../../utils/videoThumbnail');
  const mp = require('../mediaPipePoseService') as typeof import('../mediaPipePoseService');
  const FS = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  try {
    const thumb = await VT.getThumbnailAsync(clipUri, { time: Math.max(0, Math.round(tMs)), quality: 0.6 });
    const f = await mp.detectPoseFromUri(thumb.uri, undefined, tMs);
    void FS.deleteAsync(thumb.uri, { idempotent: true }).catch(() => undefined);
    if (!f) return null;
    const kp = (n: string) => f.keypoints.find((k) => k.name === n && k.score > 0.3) ?? null;
    const wrists = [kp('left_wrist'), kp('right_wrist')].filter((k): k is NonNullable<typeof k> => k != null);
    const shoulders = [kp('left_shoulder'), kp('right_shoulder')].filter((k): k is NonNullable<typeof k> => k != null);
    if (wrists.length === 0 || shoulders.length === 0) return { handsHigh: false };
    const highestWrist = Math.min(...wrists.map((w) => w.y));      // y grows downward
    const shoulderLine = Math.min(...shoulders.map((k) => k.y));
    return { handsHigh: highestWrist < shoulderLine - 0.02 };
  } catch { return null; }
};

/**
 * 2026-10-03 (Tim's 14.5s clip: wind in the trees, the setup, the swing at ~7s, turning to watch at
 * ~10.5s — which out-scores the swing). Motion alone cannot tell those apart; the web SmartMotion's
 * "last burst" rule would pick the turn. So motion PROPOSES and pose CONFIRMS: a few reads around each
 * burst's peak, strongest bursts first, and the swing is the burst where the hands go above the
 * shoulders. Exported for the test.
 */
export async function pickSwingBurst(
  clipUri: string,
  bursts: { startMs: number; endMs: number; peakMs: number; peak: number }[],
  read: PoseReader = readHandsHigh,
  budgetMs = PICK_BUDGET_MS,
  clock: () => number = Date.now,
): Promise<{ startMs: number; endMs: number; peakMs: number } | null> {
  const ranked = [...bursts].sort((a, b) => b.peak - a.peak).slice(0, 4);
  // A budget, not a hope: where pose is slow (no native engine, the browser fallback warming up) this
  // gives up and the caller uses the motion window instead of waiting.
  const deadline = clock() + budgetMs;
  for (const b of ranked) {
    let high = 0;
    for (const t of [b.peakMs - 350, b.peakMs, b.peakMs + 350]) {
      if (clock() > deadline) return null;
      const left = Math.max(1, deadline - clock());
      const r = await Promise.race([read(clipUri, t), new Promise<null>((res) => setTimeout(() => res(null), left))]);
      if (r?.handsHigh) high++;
      if (high >= 1) return b;
    }
  }
  return null;
}

/**
 * 2026-10-04 (sweep) — every answer inside the clip and the right way round. A duration that
 * under-reports (an upload's metadata) could put a motion window's start past its clamped end.
 */
function clampWindow(w: UploadSwingWindow, dur: number): UploadSwingWindow {
  const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
  const startSec = clamp(w.startSec, 0, dur);
  const endSec = clamp(w.endSec, startSec, dur);
  if (endSec - startSec < 0.2) return { startSec: 0, endSec: dur, impactSec: null, via: w.via === 'middle' ? 'middle' : 'whole_clip' };
  const impactSec = w.impactSec != null && w.impactSec >= startSec && w.impactSec <= endSec ? w.impactSec : null;
  const core = w.core
    ? { startSec: clamp(w.core.startSec, startSec, endSec), endSec: clamp(w.core.endSec, startSec, endSec) }
    : undefined;
  return { ...w, startSec, endSec, impactSec, ...(core && core.endSec > core.startSec ? { core } : { core: undefined }) };
}

export async function findUploadSwingWindow(
  clipUri: string,
  durationSec: number,
  opts: Parameters<typeof findUploadSwingWindowRaw>[2] = {},
): Promise<UploadSwingWindow> {
  // Clamp to the LONGER of the stated duration and the one the motion pass measured: an upload's
  // metadata can under-report, and clamping to it threw away a correct window past the stated end.
  const measured = { durSec: 0 };
  const w = await findUploadSwingWindowRaw(clipUri, durationSec, opts, measured);
  return clampWindow(w, Math.max(0.5, durationSec, measured.durSec));
}

async function findUploadSwingWindowRaw(
  clipUri: string,
  durationSec: number,
  /**
   * allowNetwork:false — the live capture path right after Stop: a fast on-device answer (or the whole
   * clip) beats a 35s network locate while the player stands there waiting for the read.
   */
  opts: {
    allowNetwork?: boolean;
    /** Why the network locate gave up — analyzeSwing reports it as `locate_degraded`. */
    onNetworkAbort?: (cause: 'dead_host' | 'ceiling' | 'unknown') => void;
  } = {},
  measured: { durSec: number } = { durSec: 0 },
): Promise<UploadSwingWindow> {
  const dur = Math.max(0.5, durationSec);
  let motionRan = false;
  // 1. The web SmartMotion way: localised motion between tiny frames (seconds, no pose), then a few
  //    pose reads to tell the swing burst from the other motion in the clip.
  try {
    const { Platform } = require('react-native') as typeof import('react-native');
    if (Platform.OS === 'android') {
      const fe = require('../frameEngine') as typeof import('../frameEngine');
      // 2026-10-04 (sweep) — the motion pass reads the pooled PRIVATE COPY too, never the file the
      // review player is looping (decoder contention; the never-read-what-the-player-holds rule). The
      // copy is the one the burst pick and the read's frame readers use next, so it is not extra work.
      const { acquireClipCopy } = require('./sharedClipCopy') as typeof import('./sharedClipCopy');
      const shared = (await fe.ensureFrameEngine(5_000)) ? await acquireClipCopy(clipUri).catch(() => null) : null;
      if (shared) try {
        motionRan = true;
        const m = await fe.findMotionWindow(shared.uri);
        measured.durSec = (m.durationMs ?? 0) / 1000;
        const mdur = Math.max(dur, measured.durSec);
        const bursts = m.bursts ?? [];
        console.log('[window] motion pass', JSON.stringify({ window: m.window, bursts: bursts.length }));
        // Short clips: the motion window is enough — no pose on the critical path at all.
        if (dur <= SHORT_CLIP_NO_LOCATE_SEC) {
          if (m.window && m.window.endMs > m.window.startMs) {
            return { startSec: m.window.startMs / 1000, endSec: Math.min(mdur, m.window.endMs / 1000), impactSec: null, via: 'motion' };
          }
          return { startSec: 0, endSec: mdur, impactSec: null, via: 'whole_clip' };
        }
        let swing: { startMs: number; endMs: number; peakMs: number } | null = null;
        if (bursts.length > 1) swing = await pickSwingBurst(shared.uri, bursts);
        if (swing) {
          // Address (~1.8s before the fastest moment) through the finish (~1.5s after).
          return {
            startSec: Math.max(0, (swing.peakMs - 1800) / 1000),
            endSec: Math.min(mdur, (swing.peakMs + 1500) / 1000),
            impactSec: null,
            via: 'motion',
          };
        }
        if (m.window && m.window.endMs > m.window.startMs) {
          return { startSec: m.window.startMs / 1000, endSec: Math.min(mdur, m.window.endMs / 1000), impactSec: null, via: 'motion' };
        }
      } finally { shared.release(); }
    }
  } catch (e) { console.log('[window] motion pass failed', e instanceof Error ? e.message : String(e)); }

  // 2. Short clip: the clip is the swing — once the motion pass has had its look. Where there IS no
  //    motion pass (iOS) a clip long enough to hold a walk-up still gets the on-device locate: exact
  //    native frames make it a few seconds there, and it is what analyzeSwing did before it came here.
  if (dur <= SHORT_CLIP_NO_LOCATE_SEC && (motionRan || dur * 1000 < ON_DEVICE_LOCATE_MIN_CLIP_MS)) {
    return { startSec: 0, endSec: dur, impactSec: null, via: 'whole_clip' };
  }

  // 3/4. Pose locate on the device, then the network.
  try {
    const { locateSwingWindowOnDevice } = require('./onDeviceLocate') as typeof import('./onDeviceLocate');
    const onDev = await locateSwingWindowOnDevice(clipUri, dur * 1000).catch(() => null);
    if (onDev && onDev.endSec > onDev.startSec) {
      return { startSec: Math.max(0, onDev.startSec - 0.5), endSec: Math.min(dur, onDev.endSec + 0.5), impactSec: onDev.swingTimeSec, via: 'on_device', core: { startSec: onDev.startSec, endSec: onDev.endSec } };
    }
    if (dur <= SHORT_CLIP_NO_LOCATE_SEC) return { startSec: 0, endSec: dur, impactSec: null, via: 'whole_clip' };
    if (opts.allowNetwork === false) throw new Error('network locate not allowed here');
    const { locateSwingWindow } = require('../poseDetection') as typeof import('../poseDetection');
    const net = await locateSwingWindow(clipUri, dur * 1000, { onAbort: opts.onNetworkAbort });
    if (net && net.endSec > net.startSec) {
      return { startSec: Math.max(0, net.startSec - 0.5), endSec: Math.min(dur, net.endSec + 0.5), impactSec: net.swingTimeSec, via: 'network', core: { startSec: net.startSec, endSec: net.endSec } };
    }
  } catch { /* fall through to the middle */ }

  // 5. Nothing found anything: the middle of the clip.
  const c = dur / 2;
  return { startSec: Math.max(0, c - 2.5), endSec: Math.min(dur, c + 3), impactSec: null, via: 'middle' };
}
