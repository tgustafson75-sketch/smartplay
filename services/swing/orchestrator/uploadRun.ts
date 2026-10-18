/**
 * 2026-10-04 — Phase 1 of the SmartMotion orchestrator (docs/SMARTMOTION-ORCHESTRATOR.md): the
 * upload / library path as ONE run.
 *
 *   window (critical)  where the swing is — services/swing/analysisOrchestrator.findUploadSwingWindow.
 *                      Only for a single-swing upload with no window yet: clips of 15s or more go
 *                      straight to the read, which splits a range session into its swings.
 *   read   (critical)  key frames → /api/swing-analysis → classify → store (videoUpload's read).
 *   pose               pose frames, body mechanics, on-device verdict, club arc — after the read.
 *
 * Every caller of videoUpload.runPhaseKOnSession (the swing screen, Analyze-at-position, trim, the
 * practice overlay, ingest) comes through here, so they all get the same order and one run per swing.
 */
import { cancelRunsWithPrefix, getOrStartRun, liveRun, liveRunKeys, whenStageSettled, type StageDef } from './engine';
import { useSwingSessionStore } from '../../../store/swingSessionStore';
import { retireSessionShotRuns, retirementOf, runShotDetail, shotImpactMs, shotRunKey, swingRunKey } from './shotDetail';
import type { ReadExtras } from '../../videoUpload';

/**
 * 2026-10-05 (Tim: "We should have one clean, fast, and correct analysis path that the orchestrator
 * makes sure is correct") — this is now THE run for every saved swing, not just uploads. SmartMotion's
 * live captures used to read their swings with their own analyzeSwing calls, commit their own on-device
 * verdict and draw their own arc; they now ingest the session and come through here like everything
 * else. `extras` carries what only a live capture knows (its measured tempo and strike, a drill's focus,
 * the per-swing callback that lets the pager show each swing as it lands).
 */
/** `retired`: the session's retirement count when this run began (a newer capture retires its body read). */
type In = { sessionId: string; extras?: ReadExtras; retired: number };
type ReadResult = Awaited<ReturnType<typeof import('../../videoUpload')._runPhaseKRead>>;

/** A single-swing upload this long or longer is a range session — the read carves its swings. */
const MULTI_SWING_UPLOAD_SEC = 15;

const session = (id: string) => useSwingSessionStore.getState().sessionHistory.find((s) => s.id === id) ?? null;

/**
 * 2026-10-04 (sweep) — a putt is read by puttingAnalysisService, not by the swing stages. The old pose
 * tail sat AFTER the read's putting return and never ran for putts; as an engine stage it did, and a
 * full-swing fault could land as a putt's headline before the putting synthesis replaced it.
 */
function isPutt(id: string): boolean {
  const s = session(id);
  if (!s) return false;
  try {
    const { getAnalyzerKind } = require('../../swingLibrary') as typeof import('../../swingLibrary');
    return getAnalyzerKind(s) === 'putting';
  } catch { return false; }
}

/**
 * 2026-10-17 (Tim's range session: a 60s SmartMotion capture whose strike was never heard went to the
 * read as `window=0.0-59.8s`, nine frames over a minute, and the body read sampled the same minute) —
 * a stored window longer than one swing is not a window. A live capture's finder gives up after 15s
 * and stores the whole clip; the run finds the swing in it before anything reads it.
 */
export const NO_SWING_FOUND = "I couldn't find a swing in this clip — scrub to your swing and tap Analyze the swing at that moment.";

function storedWindowTooLong(shot: { clipStartSeconds?: number | null; clipEndSeconds?: number | null }): boolean {
  const { MAX_SWING_WINDOW_SEC } = require('../poseMotion') as typeof import('../poseMotion');
  return typeof shot.clipStartSeconds === 'number' && typeof shot.clipEndSeconds === 'number'
    && shot.clipEndSeconds - shot.clipStartSeconds > MAX_SWING_WINDOW_SEC;
}

const noSwing = (outputs: Record<string, unknown>) => (outputs.window as { noSwing?: boolean } | undefined)?.noSwing === true;

function needsWindow(id: string): boolean {
  if (isPutt(id)) return false;
  const s = session(id);
  const shot = s?.shots?.[0];
  if (!s || !shot?.clipUri) return false;
  // Only a window the PLAYER chose is kept; the finder's own answer is re-found on every analysis
  // (an automatic window that was wrong used to be re-read forever — Tim's 3870 clip, 10-04).
  if (shot.clipWindowSource === 'user' && shot.clipStartSeconds != null && shot.clipEndSeconds != null
    && shot.clipEndSeconds > shot.clipStartSeconds) return false;
  // A live capture already windowed its swing — unless that "window" is longer than one swing.
  // (or it stored none and the clip is longer than one: the practice overlay's no-detections fallback).
  if (s.source !== 'uploaded_video') {
    if (s.shots.filter((x) => x.clipUri).length !== 1) return false;
    const { MAX_SWING_WINDOW_SEC } = require('../poseMotion') as typeof import('../poseMotion');
    return storedWindowTooLong(shot) || (shot.clipStartSeconds == null && (s.upload?.duration_sec ?? 0) > MAX_SWING_WINDOW_SEC);
  }
  const dur = s.upload?.duration_sec ?? 0;
  return dur > 0 && dur < MULTI_SWING_UPLOAD_SEC;
}

function stages(): StageDef<In>[] {
  return [
    {
      id: 'window',
      critical: true,
      // Motion (≤20s) → burst check (4s) → on-device locate (≤20s cap) → network locate (35s): enough
      // for the chain to ANSWER, so the read never has to locate a second time.
      // 2026-10-04 (sweep) — above the chain's real Android worst case (engine 5 + motion 20 + copy +
      // pick 4 + on-device 20 + network ≈ 79s+); an overrun abandons the window, never half-writes it.
      budgetMs: 90_000,
      when: ({ input }) => needsWindow(input.sessionId),
      run: async ({ input, signal }) => {
        const s = session(input.sessionId);
        const shot = s?.shots?.[0];
        if (!s || !shot?.clipUri) return null;
        const { findUploadSwingWindow } = require('../analysisOrchestrator') as typeof import('../analysisOrchestrator');
        // A live capture carries no probed duration; its stored (whole-clip) window ends at the clip's end.
        const durSec = Math.max(s.upload?.duration_sec ?? 0, shot.clipEndSeconds ?? 0);
        const w = await findUploadSwingWindow(shot.clipUri, durSec);
        // Overran its budget or the run was replaced: the read has moved on without this window.
        if (signal.aborted) return null;
        /**
         * 2026-10-17 — nothing found in a clip long enough to hold a session: the middle of a minute is
         * not a swing either. Said honestly (the settle stage), and nothing reads the clip — never 0–60s.
         */
        if (w.via === 'middle' && durSec >= MULTI_SWING_UPLOAD_SEC) {
          const { traceStep } = require('../../analysisTrace') as typeof import('../../analysisTrace');
          traceStep('no swing found in the clip — nothing is read', { clip_s: Math.round(durSec * 10) / 10 }, { sessionId: input.sessionId });
          // The body read's answer too (computed, none): a screen showing this swing must not locate the
          // same minute again, nor body-read it whole.
          const { liveSessionStore } = require('./liveSessionStore') as typeof import('./liveSessionStore');
          liveSessionStore(signal).setShotBiomechanics(input.sessionId, shot.id, null);
          liveSessionStore(signal).setSessionBiomechanics(input.sessionId, null);
          return { ...w, noSwing: true };
        }
        useSwingSessionStore.getState().setShotClipBoundaries(input.sessionId, shot.id, w.startSec, w.endSec, w.impactSec, 'auto');
        runWindow.set(input.sessionId, windowKey(input.sessionId));   // the run's OWN window move is not a new request
        try {
          (require('../../../store/toastStore') as typeof import('../../../store/toastStore')).useToastStore.getState()
            .show(w.via === 'middle' ? 'Analyzing your swing… scrub + re-analyze to fine-tune.' : 'Found your swing — analyzing…');
        } catch { /* a toast is a courtesy */ }
        return w;
      },
    },
    {
      id: 'read',
      critical: true,
      after: ['window'],
      /**
       * 2026-10-05 — DERIVED from what this read has to do. One swing's worst case is poseDetection's
       * ANALYSIS_WORST_CASE_MS; a range session needs one of those per swing it may read serially (a fixed 160s
       * cut off a 6-swing SmartMotion session mid-read), plus the transcript wait, the
       * range split's locate and the tentative fallback. A backstop — every call inside has its own timeout.
       */
      budgetMs: ({ input }) => {
        const one = (require('../../poseDetection') as typeof import('../../poseDetection')).ANALYSIS_WORST_CASE_MS;
        const s = session(input.sessionId);
        const dur = s?.upload?.duration_sec ?? 0;
        const swings = s?.source === 'uploaded_video' && dur >= MULTI_SWING_UPLOAD_SEC
          ? Math.ceil(dur / 6)                                   // split by the read: ~one swing per 6s at most
          : Math.max(1, s?.shots.filter((x) => x.clipUri).length ?? 1);
        const perSwing = Number.isFinite(one) && one > 0 ? one : 160_000;
        // 2026-10-17 (F1a) — on a weak link the read goes one swing at a time (videoUpload), so the
        // backstop covers that serial worst case; an overrun here would discard swings already read.
        return Math.min(15 * 60_000, perSwing * swings + 100_000);
      },
      when: ({ outputs }) => !noSwing(outputs),
      run: async ({ input, signal }) => {
        const vu = require('../../videoUpload') as typeof import('../../videoUpload');
        return vu._runPhaseKRead(input.sessionId, signal, input.extras);
      },
    },
    {
      // 2026-10-05 — the run SETTLES the status: a read that could not be done hands over to the body
      // read, and only if that finds nothing either does the swing show the read's failure. One answer,
      // at the end, instead of "failed" then a verdict a minute later.
      id: 'settle',
      after: ['pose'],
      budgetMs: 5_000,
      run: async ({ input, outputs }) => {
        // No read output = the read overran its budget or threw: that is a failed read too.
        const out = outputs.read as { readFailed?: string } | undefined;
        const failed = noSwing(outputs) ? NO_SWING_FOUND : out ? out.readFailed : "Analysis didn't finish — tap Analyze to try again.";
        if (!failed) return null;
        const st = session(input.sessionId)?.analysis_status;
        const { traceStep } = require('../../analysisTrace') as typeof import('../../analysisTrace');
        if (st === 'ok') {
          traceStep('read failed → the body read stands as the verdict', { reason: failed.slice(0, 80) }, { sessionId: input.sessionId });
          return 'body_read';
        }
        // A ball the camera saw never leave stands as the answer even if the body read itself failed.
        if (session(input.sessionId)?.primary_issue?.issue_id === 'no_launch') {
          useSwingSessionStore.getState().setSessionAnalysisStatus(input.sessionId, 'ok');
          return 'no_launch';
        }
        useSwingSessionStore.getState().setSessionAnalysisStatus(input.sessionId, 'failed', failed);
        traceStep('read failed and the body read found nothing → failed', { reason: failed.slice(0, 80) }, { sessionId: input.sessionId });
        return 'failed';
      },
    },
    {
      // The first swing's body read (services/swing/orchestrator/shotDetail — the one recipe every screen
      // uses), and the on-device verdict when the read could not name one. AFTER the read, not dependent
      // on it: a read that overran is exactly when the body read has to answer.
      id: 'pose',
      after: ['read'],
      budgetMs: 130_000,
      // Not once a newer capture has retired this swing: its body read would decode through that one's.
      when: ({ input, outputs }) => !isPutt(input.sessionId) && !noSwing(outputs) && retirementOf(input.sessionId) === input.retired,
      run: async ({ input, signal }) => {
        const shot0 = session(input.sessionId)?.shots.find((x) => x.clipUri);
        if (!shot0) return null;
        // The arc comes from the silent pass: the free on-device tracker, never the paid vision model
        // (2026-10-10). The player's Swing Trace toggle is what asks for more.
        const shotRun = runShotDetail(input.sessionId, shot0.id, { force: true, arc: 'tracker' });
        signal.addEventListener('abort', () => shotRun.cancel(), { once: true });
        await whenStageSettled(shotRunKey(input.sessionId, shot0.id), 'pose', signal);
        if (signal.aborted) return null;
        const s = session(input.sessionId);
        const shot = s?.shots.find((x) => x.id === shot0.id);
        // THIS run's body read only — never frames stored by an earlier analysis of another window.
        const ps = shotRun.snapshot();
        const bio = ps.stages.pose?.status === 'ok' ? ps.outputs.pose as import('../../poseAnalysisApi').SwingBiomechanics : null;
        if (!s || !shot) return null;
        // A ball the camera SAW never leave (no_launch) is the answer whatever the body did: it stands.
        if (s.analysis_status !== 'ok' && s.primary_issue?.issue_id === 'no_launch') {
          const { liveSessionStore } = require('./liveSessionStore') as typeof import('./liveSessionStore');
          liveSessionStore(signal).setSessionAnalysisStatus(input.sessionId, 'ok');
          return true;
        }
        if (!bio?.frames?.length) return null;
        if (s.analysis_status !== 'ok') {
          try {
            const poseMod = require('../../poseAnalysisApi') as typeof import('../../poseAnalysisApi');
            const { buildPoseSwingRead } = require('../poseSwingRead') as typeof import('../poseSwingRead');
            const { poseReadToPrimaryIssue } = require('../poseReadVerdict') as typeof import('../poseReadVerdict');
            // The impact the body read was given — the same one the swing's own row is named from (shotDetail).
            const impactMs = shotImpactMs(shot);
            const pi = poseReadToPrimaryIssue(buildPoseSwingRead(bio, poseMod.tempoFromPoseFrames(bio.frames, impactMs, 'video')));
            if (pi) {
              const { liveSessionStore } = require('./liveSessionStore') as typeof import('./liveSessionStore');
              liveSessionStore(signal).setSessionAnalysis(input.sessionId, pi, null);
              liveSessionStore(signal).setSessionAnalysisStatus(input.sessionId, 'ok');
              const { traceStep } = require('../../analysisTrace') as typeof import('../../analysisTrace');
              traceStep('body read named the verdict', { issue: pi.issue_id }, { sessionId: input.sessionId });
              // 2026-10-10 (bug sweep) — the caddie learns it too, exactly as from a full read (videoUpload
              // feeds the relationship engine there). It was shown on every screen and unknown to him.
              if (!signal.aborted) {
                try {
                  const { processSwingAnalysis } = require('../../relationshipEngine') as typeof import('../../relationshipEngine');
                  processSwingAnalysis({ club: s.club, primary_issue: pi });
                } catch { /* memory is best-effort; the verdict stands */ }
              }
            } else {
              /**
               * The body read MEASURED the swing and nothing stood out — that is an answer, not a failure
               * (SmartMotion's rule since 08-25: "a no-fault swing is recorded ok, not failed"). Said
               * plainly, with low confidence, so a stale headline from an earlier read never stands in.
               */
              const { liveSessionStore } = require('./liveSessionStore') as typeof import('./liveSessionStore');
              liveSessionStore(signal).setSessionAnalysis(input.sessionId, {
                issue_id: 'no_clear_fault',
                name: 'No clear fault',
                category: 'other',
                severity: 'minor',
                occurrence_count: 1,
                visual_reference_path: null,
                mechanical_breakdown: 'The full read didn\'t come back, but I measured your body through the swing and nothing stood out.',
                feel_cue: 'Re-analyze when you have a connection for the full read.',
                detected_in_shots: [shot0.id],
                confidence: 'low',
              } as import('../../../store/swingSessionStore').PrimaryIssue, null);
              liveSessionStore(signal).setSessionAnalysisStatus(input.sessionId, 'ok');
              const { traceStep } = require('../../analysisTrace') as typeof import('../../analysisTrace');
              traceStep('body read measured the swing, no fault — ok', {}, { sessionId: input.sessionId });
            }
          } catch { /* the settle stage reports the read's failure */ }
        }
        return true;
      },
    },
    {
      // The first swing's arc — the run is done when the whole swing is.
      id: 'arc',
      after: ['pose'],
      budgetMs: 210_000,
      when: ({ input }) => !isPutt(input.sessionId),
      run: async ({ input }) => {
        const shot0 = session(input.sessionId)?.shots.find((x) => x.clipUri);
        const r = shot0 ? liveRun(shotRunKey(input.sessionId, shot0.id)) : null;
        if (!r) return null;
        const snap = await r.done;
        return snap.stages.arc?.status === 'ok' ? true : null;
      },
    },
  ];
}

/** The window each session's live run is reading (see runSwingAnalysis's restart rule). */
const runWindow = new Map<string, string>();
function windowKey(sessionId: string): string {
  const sh = session(sessionId)?.shots.find((x) => x.clipUri);
  return `${sh?.clipStartSeconds ?? ''}|${sh?.clipEndSeconds ?? ''}`;
}

function report(key: string, stage: string, error: string): void {
  try {
    // A read that never finished is settled by the settle stage (after the body read has had its turn) —
    // failing it here showed "failed" and then a verdict a minute later.
    (require('../../../store/issueLogStore') as typeof import('../../../store/issueLogStore')).useIssueLogStore.getState()
      // diag: a failed READ is reported once, as swing_analysis_failed, by the settle stage's status write.
      .addAppEvent('orchestrator_stage_failed', { run: key, stage, error: error.slice(0, 120) }, 'diag');
  } catch { /* reporting never breaks a run */ }
}

/**
 * 2026-10-17 (Tim's range session, two captures two minutes apart: the first one's body read kept decoding
 * until its 120s budget ran out, through the second's analysis) — a NEW live capture retires the body
 * reads and arcs of the live captures before it (services/swing/orchestrator/shotDetail
 * retireSessionShotRuns). Their READS are left to finish — a read is a network call, and cancelling it
 * would strand that swing's status; the settle stage still answers for it. Uploads are not touched: an
 * upload's body read is its fallback verdict, and the player did not move on from it by recording.
 */
function retireEarlierCaptures(sessionId: string): void {
  const s = session(sessionId);
  if (!s || s.source === 'uploaded_video') return;
  const others = new Set<string>();
  for (const k of liveRunKeys()) {
    const m = /^(?:shot|swing):([^:]+)/.exec(k);
    if (m && m[1] !== sessionId) others.add(m[1]);
  }
  for (const id of others) {
    const o = session(id);
    if (o && o.source !== 'uploaded_video') retireSessionShotRuns(id);
  }
}

/**
 * Start (or join) this session's run and resolve with the READ's result as soon as the read settles —
 * the pose stage keeps going in the background, exactly as the old fire-and-forget tail did, but now
 * owned, ordered and budgeted.
 */
export function runSwingAnalysis(sessionId: string, extras?: ReadExtras): Promise<ReadResult> {
  /**
   * 2026-10-04 (sweep) — JOIN only while the read is still coming. Once it has settled the live run is
   * just its pose tail, and a new request (Analyze this moment after a scrub, the angle chip, a trim)
   * wants a NEW read; joining handed back the old result and the new window was never analysed.
   */
  const windowOf = () => windowKey(sessionId);
  const readSettled = (snap: { stages: Record<string, { status: string }> }) => {
    const st = snap.stages.read?.status;
    // 2026-10-05 — also a NEW request when the swing's window moved since the live run began (a trim saved
    // mid-read): joining would read the old window and never the one the player chose.
    return (st != null && st !== 'pending' && st !== 'running') || runWindow.get(sessionId) !== windowOf();
  };
  const run = getOrStartRun<In>(swingRunKey(sessionId), () => {
    runWindow.set(sessionId, windowOf());
    // A new analysis may have moved the window: the swing's shot runs (body + arc) start over.
    cancelRunsWithPrefix(`shot:${sessionId}:`);
    retireEarlierCaptures(sessionId);
    // 2026-10-04 — one issue-log trace per run (services/analysisTrace; Owner Tools → Analysis).
    const traceId = `swing:${sessionId}:${Date.now()}`;
    const s = session(sessionId);
    const { beginAnalysisTrace, traceStep, endAnalysisTrace } = require('../../analysisTrace') as typeof import('../../analysisTrace');
    beginAnalysisTrace(traceId, s?.source === 'uploaded_video' ? 'upload' : 'smartmotion', {
      clip_s: s?.upload?.duration_sec != null ? Math.round(s.upload.duration_sec * 10) / 10 : null,
      club: s?.club ?? null,
      putt: isPutt(sessionId),
      trimmed: s?.shots?.[0]?.clipStartSeconds != null,
    }, { sessionId });
    return {
      stages: stages(),
      input: { sessionId, extras, retired: retirementOf(sessionId) },
      hooks: {
        onStageFailed: report,
        onStageDone: (_k, stage, st) => traceStep(`stage ${stage}: ${st.status}`, { ms: st.ms ?? null, error: st.error ?? null }, { sessionId }),
      },
      onDone: () => {
        const fin = session(sessionId);
        const pi = fin?.primary_issue as { issue_id?: string; name?: string; confidence?: string } | null | undefined;
        endAnalysisTrace(traceId, {
          result: fin?.analysis_status ?? 'unknown',
          issue: pi?.issue_id ?? pi?.name ?? null,
          confidence: pi?.confidence ?? null,
          window: fin?.shots?.[0]?.clipStartSeconds != null ? `${fin.shots[0].clipStartSeconds?.toFixed(1)}-${fin.shots[0].clipEndSeconds?.toFixed(1)}s` : null,
        });
      },
    };
  }, readSettled);
  return new Promise<ReadResult>((resolve) => {
    const unsub = run.subscribe((snap) => {
      const st = snap.stages.read?.status;
      if (st && st !== 'pending' && st !== 'running') {
        queueMicrotask(() => unsub());
        // No read output = the read overran or threw: say so, so a caller waits for the run to settle (the
        // body read may still answer) instead of reading a half-finished store.
        resolve((snap.outputs.read as ReadResult | undefined)
          ?? { primary_issue: null, drill_recommendation: null, analyses: {}, ...(st === 'cancelled' ? {} : { readFailed: noSwing(snap.outputs) ? NO_SWING_FOUND : "Analysis didn't finish — tap Analyze to try again." }) });
      }
    });
  });
}

/** The pre-10-05 name — every caller of videoUpload.runPhaseKOnSession still lands here. */
export const runUploadAnalysis = (sessionId: string) => runSwingAnalysis(sessionId);
