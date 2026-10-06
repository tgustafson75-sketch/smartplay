/**
 * 2026-10-05 (Tim: "We should have one clean, fast, and correct analysis path that the orchestrator
 * makes sure is correct") — THE BODY READ AND THE SWING ARC OF ONE SHOT, as one engine run.
 *
 * Before this, three places computed a shot's pose and arc, each its own way:
 *   - the upload run's pose tail (videoUpload.runUploadPosePass): shot 1 only, full-window arc;
 *   - the swing screen: its own arc effect (narrowed window, heard-strike anchor) and its own per-shot
 *     pose backfill for swings 2+;
 *   - SmartMotion: its own pose extraction per selected swing and its own arc effect (segment window,
 *     acoustic tolerance), writing the session's arc for swing 1.
 * The same swing could get three different arcs depending on which screen asked first, and two decodes
 * of one clip could run at once. Now every screen asks for `runShotDetail(sessionId, shotId)` and draws
 * what lands in the store; the recipe below is the only one.
 *
 *   pose  the shot's window and impact → analyzeSwingFromVideo → shot biomechanics (and the session's,
 *         for the first shot). Waits for the swing's READ to finish decoding first.
 *   arc   from the pose frames → detectClubPath (on-device tracker, vision fallback) → shot arc (and the
 *         session's, for the first shot).
 *
 * A shot that already has its biomechanics / a tracked arc is not recomputed unless `force` (a new
 * analysis of the swing, which may have moved the window).
 */
import { getOrStartRun, liveRun, whenStageSettled, type AnalysisRun, type StageDef } from './engine';
import { liveSessionStore } from './liveSessionStore';
import { useSwingSessionStore, type SwingSession, type SwingShot } from '../../../store/swingSessionStore';
import type { PoseFrame, SwingBiomechanics } from '../../poseAnalysisApi';

type In = { sessionId: string; shotId: string; force: boolean; arc: boolean };

/** Whether the live shot run for a key was asked for the arc (a trace-off request skips it). */
const liveWantsArc = new Map<string, boolean>();

export const swingRunKey = (sessionId: string) => `swing:${sessionId}`;
export const shotRunKey = (sessionId: string, shotId: string) => `shot:${sessionId}:${shotId}`;

function lookup(sessionId: string, shotId: string): { s: SwingSession; shot: SwingShot; first: boolean } | null {
  const s = useSwingSessionStore.getState().sessionHistory.find((x) => x.id === sessionId);
  const shot = s?.shots.find((x) => x.id === shotId);
  if (!s || !shot?.clipUri) return null;
  return { s, shot, first: s.shots.find((x) => x.clipUri)?.id === shotId };
}

/** The biomechanics already stored for this shot (`undefined` = never computed, `null` = computed, none). */
export function storedShotBiomech(s: SwingSession, shot: SwingShot, first: boolean): SwingBiomechanics | null | undefined {
  if (shot.biomechanics !== undefined) return shot.biomechanics;
  return first ? s.biomechanics : undefined;
}

/** True when this platform can only produce a vision arc — a stored one is then as good as it gets. */
function trackerUnavailable(): boolean {
  try { return (require('react-native') as typeof import('react-native')).Platform.OS !== 'android'; } catch { return true; }
}

/**
 * Windows already ANSWERED this app session (an arc, or an honest "no arc"), keyed by everything that
 * changes the answer. A null result (no copy, no network, cancelled) is not an answer and is not kept —
 * that one is asked again. Without this, turning the trace off and on re-asked a paid vision call about
 * frames it had already answered "no" for (09-06: "analyzing every time I open").
 */
const answered = new Set<string>();
const answerKey = (s: SwingSession, shot: SwingShot) =>
  `${s.id}|${shot.id}|${shot.clipUri}|${shot.clipStartSeconds ?? ''}|${shot.clipEndSeconds ?? ''}`;

function hasFinalArc(s: SwingSession, shot: SwingShot, first: boolean): boolean {
  if (answered.has(answerKey(s, shot))) return true;
  const src = shot.club_arc_source ?? (first ? s.club_arc_source : undefined);
  if (src === 'tracker') return true;   // tracked, found or honestly empty — re-tracking gives the same answer
  // A stored VISION answer (an arc, or an honest "no arc") is final where the tracker cannot run: asking
  // the paid model again about the same frames cannot change it — across app launches too.
  return src === 'vision' && trackerUnavailable();
}

/** The shot's swing window (ms) and impact, from what the capture / the locate stored on it. */
function windowAndImpact(shot: SwingShot): { window: { startMs: number; endMs: number } | null; impactMs: number | null } {
  const window = typeof shot.clipStartSeconds === 'number' && typeof shot.clipEndSeconds === 'number'
    && shot.clipEndSeconds > shot.clipStartSeconds
    ? { startMs: shot.clipStartSeconds * 1000, endMs: shot.clipEndSeconds * 1000 }
    : null;
  let impactMs: number | null = typeof shot.locatedImpactSec === 'number' && shot.locatedImpactSec > 0 ? shot.locatedImpactSec * 1000 : null;
  if (impactMs == null && shot.detectionMethod === 'audio_transient' && typeof shot.detectionOffsetSeconds === 'number') {
    impactMs = shot.detectionOffsetSeconds * 1000;   // a heard strike
  }
  if (impactMs != null && window && (impactMs < window.startMs || impactMs > window.endMs)) impactMs = null;
  return { window, impactMs };
}

async function poseStage(input: In, signal: AbortSignal): Promise<SwingBiomechanics | null> {
  // One decoder: the swing's read pulls its key frames first.
  await whenStageSettled(swingRunKey(input.sessionId), 'read', signal);
  if (signal.aborted) return null;
  const hit = lookup(input.sessionId, input.shotId);
  if (!hit) return null;
  const { s, shot, first } = hit;
  const { traceStep } = require('../../analysisTrace') as typeof import('../../analysisTrace');
  const vu = require('../../videoUpload') as typeof import('../../videoUpload');
  const pd = require('../../poseDetection') as typeof import('../../poseDetection');
  const uri = (await vu.resolveClipUri(shot.clipUri).catch(() => null)) || shot.clipUri!;
  const probed = await pd.probeDurationMs(uri).catch(() => 0);
  const durMs = probed > 0 ? probed : Math.max((s.upload?.duration_sec ?? 0) * 1000, (shot.clipEndSeconds ?? 3) * 1000 + 500);
  let { window, impactMs } = windowAndImpact(shot);
  // No window at all (an old upload): find the swing on the device, then on the network.
  if (!window && first && durMs > 0) {
    try {
      let loc: { startSec: number; endSec: number; swingTimeSec: number } | null = null;
      try {
        const { locateSwingWindowOnDevice } = await import('../onDeviceLocate');
        loc = await locateSwingWindowOnDevice(uri, durMs);
      } catch { /* the network locate below */ }
      if (!loc && !signal.aborted) loc = await pd.locateSwingWindow(uri, durMs);
      if (loc && loc.endSec > loc.startSec) {
        window = { startMs: loc.startSec * 1000, endMs: loc.endSec * 1000 };
        impactMs = loc.swingTimeSec * 1000;
      }
    } catch { /* whole clip */ }
  }
  if (signal.aborted) return null;
  const { swingerForSession } = require('../sessionSwinger') as typeof import('../sessionSwinger');
  const poseMod = await import('../../poseAnalysisApi');
  const biomech = await poseMod.analyzeSwingFromVideo(
    uri, durMs, s.upload?.angleOverride ?? null, probed > 0, window, impactMs, swingerForSession(s).handedness,
    0, () => signal.aborted,   // a superseded / cancelled body read stops decoding, not just writing
  );
  const store = liveSessionStore(signal);
  store.setShotBiomechanics(input.sessionId, input.shotId, biomech);
  if (first) store.setSessionBiomechanics(input.sessionId, biomech);
  traceStep('body read', { shot: input.shotId.slice(-6), frames: biomech?.frames.length ?? 0, windowed: !!window, impact: impactMs != null });
  return biomech;
}

async function arcStage(input: In, signal: AbortSignal, thisRunPose: SwingBiomechanics | undefined): Promise<{ points: number } | null> {
  const hit = lookup(input.sessionId, input.shotId);
  if (!hit) return null;
  const { s, shot, first } = hit;
  // A forced run (a new analysis, maybe a new window) aims only with ITS OWN body read.
  const bio = input.force ? (thisRunPose ?? null) : storedShotBiomech(s, shot, first);
  const frames: PoseFrame[] | null = bio?.frames?.length ? bio.frames : null;
  const vu = require('../../videoUpload') as typeof import('../../videoUpload');
  const pd = require('../../poseDetection') as typeof import('../../poseDetection');
  const uri = (await vu.resolveClipUri(shot.clipUri).catch(() => null)) || shot.clipUri!;
  const { window } = windowAndImpact(shot);
  let rawStartMs = window?.startMs ?? null;
  let rawEndMs = window?.endMs ?? null;
  if (rawStartMs == null || rawEndMs == null) {
    // No stored window: the body read's own frames bound the swing.
    if (!frames || frames.length < 2) return null;
    rawStartMs = Math.max(0, frames[0].timestampMs - 200);
    rawEndMs = frames[frames.length - 1].timestampMs + 200;
    const dur = await pd.probeDurationMs(uri).catch(() => 0);
    if (dur > 0) rawEndMs = Math.min(rawEndMs, dur);
  }
  const { clubArcAnchor, narrowClubPathWindow } = require('../clubPathWindow') as typeof import('../clubPathWindow');
  const { anchorMs, toleranceMs } = clubArcAnchor({
    detectionMethod: shot.detectionMethod,
    detectionOffsetSeconds: shot.detectionOffsetSeconds,
    frames,
    rawStartMs,
    rawEndMs,
  });
  const { startMs, endMs } = narrowClubPathWindow(rawStartMs, rawEndMs, anchorMs);
  (require('../../analysisTrace') as typeof import('../../analysisTrace')).traceStep('arc anchor', {
    shot: input.shotId.slice(-6), anchorMs: anchorMs != null ? Math.round(anchorMs) : null, toleranceMs,
    heard: shot.detectionMethod === 'audio_transient', windowMs: Math.round(endMs - startMs), pose: frames?.length ?? 0,
  });
  if (!(endMs > startMs) || signal.aborted) return null;
  const { detectClubPath } = await import('../clubPath');
  const { bodyBoundsFromPose } = await import('../bodyBounds');
  const { sessionCapturedFps } = await import('../../capture/clipFps');
  const arc = await detectClubPath({
    videoUri: uri, startMs, endMs, impactMs: anchorMs, toleranceMs,
    shouldAbort: () => signal.aborted,
    bodyBounds: bodyBoundsFromPose(frames),
    poseFrames: frames,
    sourceFps: sessionCapturedFps(s),
    // A vision answer is already stored (Android, tracker could not run last time): try the free tracker
    // again, never the paid model again.
    trackerOnly: !input.force && (shot.club_arc_source ?? (first ? s.club_arc_source : undefined)) === 'vision',
  });
  if (signal.aborted) return null;
  try {
    (require('../../../store/issueLogStore') as typeof import('../../../store/issueLogStore')).useIssueLogStore.getState().addAppEvent('club_arc', {
      points: arc?.points.length ?? 0, source: arc?.source ?? null, rejected: arc?.rejected?.reason ?? null,
      detected: arc?.rejected?.detected ?? null, gate: arc?.rejected?.gate ?? null, framesSampled: arc?.framesSampled ?? null,
      windowMs: Math.round(endMs - startMs), pose: frames?.length ?? 0,
      // Whether the ROI zoom engaged — "detected: 2" means nothing without it.
      zoomed: bodyBoundsFromPose(frames) != null,
    }, 'diag');
  } catch { /* a diagnostic never breaks the run */ }
  if (!arc) return null;   // no answer at all (no copy / no network) — asked again next time
  answered.add(answerKey(s, shot));
  if (arc.points.length < 3 && arc.rejected?.reason === 'too_few') sayClubheadUnreadableOnce();
  const pts = arc.points.length >= 3 ? arc.points.map((p) => ({ x: p.x, y: p.y, tMs: p.tMs + startMs })) : [];
  const frame = pts.length ? { w: arc.frameW ?? null, h: arc.frameH ?? null } : null;
  const store = liveSessionStore(signal);
  store.setShotClubArc(input.sessionId, input.shotId, pts, frame, arc.source);
  if (first) store.setSessionClubArc(input.sessionId, pts, frame, arc.source);
  return { points: pts.length };
}

/**
 * The once-ever spoken note when the clubhead could not be seen (SmartMotion's, since 07-22): what the
 * camera can read, what it could not, and the fix. Moved here with the arc so every screen gets it.
 */
function sayClubheadUnreadableOnce(): void {
  try {
    const ce = (require('../../../store/captureEngineStore') as typeof import('../../../store/captureEngineStore')).useCaptureEngineStore;
    if (ce.getState().clubheadNoticeShown) return;
    ce.getState().markClubheadNoticeShown();
    const { clubheadUnreadableNote } = require('../../captureQuality') as typeof import('../../captureQuality');
    const note = clubheadUnreadableNote();
    const line = `${note.can}, but ${note.missing}. ${note.fix![0].toUpperCase()}${note.fix!.slice(1)}.`;
    const st = (require('../../../store/settingsStore') as typeof import('../../../store/settingsStore')).useSettingsStore.getState();
    if (st.voiceEnabled ?? true) {
      const { speak } = require('../../voiceService') as typeof import('../../voiceService');
      const { getApiBaseUrl } = require('../../apiBase') as typeof import('../../apiBase');
      void speak(line, st.voiceGender, st.language, getApiBaseUrl(), { userInitiated: false }).catch(() => undefined);
    }
  } catch { /* a note that could not be spoken never breaks the run */ }
}

function stages(): StageDef<In>[] {
  return [
    {
      id: 'pose',
      critical: true,
      // Decode ~20 frames + MediaPipe; on a slow phone with a cold model ~40s, plus the locate when the
      // upload predates windows.
      budgetMs: 120_000,
      when: ({ input }) => {
        if (input.force) return true;
        const hit = lookup(input.sessionId, input.shotId);
        return !!hit && storedShotBiomech(hit.s, hit.shot, hit.first) === undefined;
      },
      run: ({ input, signal }) => poseStage(input, signal),
    },
    {
      id: 'arc',
      after: ['pose'],
      // The tracker's own timeout scales with the frame count (30s + 0.8s/frame, ≤150 frames) — then the
      // vision fallback's 32s request.
      budgetMs: 200_000,
      when: ({ input, outputs }) => {
        const hit = lookup(input.sessionId, input.shotId);
        if (!hit || !input.arc) return false;
        if (!input.force && hasFinalArc(hit.s, hit.shot, hit.first)) return false;
        const bio = input.force ? (outputs.pose as SwingBiomechanics | undefined) : storedShotBiomech(hit.s, hit.shot, hit.first);
        return !!bio?.frames?.length;   // the arc is found FROM the body read; without one there is nothing to aim at
      },
      run: ({ input, signal, outputs }) => arcStage(input, signal, outputs.pose as SwingBiomechanics | undefined),
    },
  ];
}

/**
 * Start (or join) the body + arc run for one shot. `force` (a new analysis of the swing) restarts a live
 * run and recomputes what is stored.
 */
export function runShotDetail(sessionId: string, shotId: string, opts: { force?: boolean; arc?: boolean } = {}): AnalysisRun<In> {
  const force = !!opts.force;
  const arc = opts.arc !== false;
  const key = shotRunKey(sessionId, shotId);
  // A live run that was asked WITHOUT the arc does not answer a request that wants it: run again after it.
  const live = liveRun(key);
  if (live && arc && !force && liveWantsArc.get(key) === false) {
    void live.done.then(() => { runShotDetail(sessionId, shotId, opts); });
    return live as AnalysisRun<In>;
  }
  liveWantsArc.set(key, arc);
  return getOrStartRun<In>(key, () => ({
    stages: stages(),
    input: { sessionId, shotId, force, arc },
    hooks: {
      onStageFailed: (key, stage, error) => {
        try {
          (require('../../../store/issueLogStore') as typeof import('../../../store/issueLogStore')).useIssueLogStore.getState()
            .addAppEvent('orchestrator_stage_failed', { run: key, stage, error: error.slice(0, 120) }, 'diag');
        } catch { /* never breaks the run */ }
      },
      onStageDone: (_k, stage, st) => {
        try {
          (require('../../analysisTrace') as typeof import('../../analysisTrace'))
            .traceStep(`shot ${stage}: ${st.status}`, { ms: st.ms ?? null, error: st.error ?? null });
        } catch { /* observation */ }
      },
    },
  }), () => force);
}

/**
 * What a SCREEN calls when it shows a shot: the shot's body + arc, computed once and drawn from the store.
 * The first swing belongs to the swing's analysis run while that run is live (it starts the shot run with
 * `force` after the read) — asking for it here too would decode the same window twice. Returns a cleanup.
 */
export function requestShotDetail(sessionId: string, shotId: string, opts: { arc?: boolean } = {}): () => void {
  const hit = lookup(sessionId, shotId);
  if (!hit) return () => {};
  const live = liveRun(swingRunKey(sessionId));
  if (hit.first && live) {
    let off = false;
    void live.done.then(() => { if (!off) runShotDetail(sessionId, shotId, opts); });
    return () => { off = true; };
  }
  let off = false;
  // While the swing's read is still going, ask only once it has settled: the shot run's budget would
  // otherwise be spent waiting (a 6-swing read outlasts it) and the body read fail without decoding.
  const readSt = live?.snapshot().stages.read?.status;
  if (live && (readSt === 'pending' || readSt === 'running')) {
    void whenStageSettled(swingRunKey(sessionId), 'read').then(() => { if (!off) requestShotDetail(sessionId, shotId, opts); });
    return () => { off = true; };
  }
  const run = runShotDetail(sessionId, shotId, opts);
  // Cancelled by a NEW analysis of the swing (its window may have moved): the screen still shows this
  // shot, so ask again once that analysis lets it (requestShotDetail waits for its read).
  void run.done.then((snap) => {
    if (!off && Object.values(snap.stages).some((st) => st.status === 'cancelled')) requestShotDetail(sessionId, shotId, opts);
  });
  return () => { off = true; };
}
