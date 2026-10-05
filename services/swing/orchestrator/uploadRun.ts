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
import { getOrStartRun, type StageDef } from './engine';
import { useSwingSessionStore } from '../../../store/swingSessionStore';

type In = { sessionId: string };
type ReadResult = Awaited<ReturnType<typeof import('../../videoUpload').runPhaseKOnSession>>;

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

function needsWindow(id: string): boolean {
  if (isPutt(id)) return false;
  const s = session(id);
  const shot = s?.shots?.[0];
  if (!s || !shot?.clipUri || s.source !== 'uploaded_video') return false;
  // Only a window the PLAYER chose is kept; the finder's own answer is re-found on every analysis
  // (an automatic window that was wrong used to be re-read forever — Tim's 3870 clip, 10-04).
  if (shot.clipWindowSource === 'user' && shot.clipStartSeconds != null && shot.clipEndSeconds != null
    && shot.clipEndSeconds > shot.clipStartSeconds) return false;
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
        const w = await findUploadSwingWindow(shot.clipUri, s.upload?.duration_sec ?? 0);
        // Overran its budget or the run was replaced: the read has moved on without this window.
        if (signal.aborted) return null;
        useSwingSessionStore.getState().setShotClipBoundaries(input.sessionId, shot.id, w.startSec, w.endSec, w.impactSec, 'auto');
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
      // The read's own worst case (probe + locate + frames + POST with retry) is ~150s.
      budgetMs: 160_000,
      run: async ({ input, signal }) => {
        const vu = require('../../videoUpload') as typeof import('../../videoUpload');
        return vu._runPhaseKRead(input.sessionId, signal);
      },
    },
    {
      id: 'pose',
      deps: ['read'],
      budgetMs: 90_000,
      when: ({ input }) => !isPutt(input.sessionId),
      run: async ({ input, signal }) => {
        const vu = require('../../videoUpload') as typeof import('../../videoUpload');
        return vu.runUploadPosePass(input.sessionId, signal);
      },
    },
  ];
}

function report(key: string, stage: string, error: string): void {
  try {
    const sessionId = key.replace(/^upload:/, '');
    if (stage === 'read') {
      // The read is what the player waits for: a read that never finished must not leave a spinner.
      const st = session(sessionId)?.analysis_status;
      if (st !== 'ok' && st !== 'failed') {
        useSwingSessionStore.getState().setSessionAnalysisStatus(sessionId, 'failed', "Analysis didn't finish — tap Analyze to try again.");
      }
    }
    (require('../../../store/issueLogStore') as typeof import('../../../store/issueLogStore')).useIssueLogStore.getState()
      // diag: a failed READ is already reported once, as swing_analysis_failed, by the status write above.
      .addAppEvent('orchestrator_stage_failed', { run: key, stage, error: error.slice(0, 120) }, 'diag');
  } catch { /* reporting never breaks a run */ }
}

/**
 * Start (or join) this session's run and resolve with the READ's result as soon as the read settles —
 * the pose stage keeps going in the background, exactly as the old fire-and-forget tail did, but now
 * owned, ordered and budgeted.
 */
export function runUploadAnalysis(sessionId: string): Promise<ReadResult> {
  /**
   * 2026-10-04 (sweep) — JOIN only while the read is still coming. Once it has settled the live run is
   * just its pose tail, and a new request (Analyze this moment after a scrub, the angle chip, a trim)
   * wants a NEW read; joining handed back the old result and the new window was never analysed.
   */
  const readSettled = (snap: { stages: Record<string, { status: string }> }) => {
    const st = snap.stages.read?.status;
    return st != null && st !== 'pending' && st !== 'running';
  };
  const run = getOrStartRun<In>(`upload:${sessionId}`, () => {
    // 2026-10-04 — one issue-log trace per run (services/analysisTrace; Owner Tools → Analysis).
    const traceId = `upload:${sessionId}:${Date.now()}`;
    const s = session(sessionId);
    const { beginAnalysisTrace, traceStep, endAnalysisTrace } = require('../../analysisTrace') as typeof import('../../analysisTrace');
    beginAnalysisTrace(traceId, 'upload', {
      clip_s: s?.upload?.duration_sec != null ? Math.round(s.upload.duration_sec * 10) / 10 : null,
      club: s?.club ?? null,
      putt: isPutt(sessionId),
      trimmed: s?.shots?.[0]?.clipStartSeconds != null,
    });
    return {
      stages: stages(),
      input: { sessionId },
      hooks: {
        onStageFailed: report,
        onStageDone: (_k, stage, st) => traceStep(`stage ${stage}: ${st.status}`, { ms: st.ms ?? null, error: st.error ?? null }),
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
        resolve((snap.outputs.read as ReadResult | undefined) ?? { primary_issue: null, drill_recommendation: null });
      }
    });
  });
}
