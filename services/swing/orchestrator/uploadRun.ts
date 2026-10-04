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

function needsWindow(id: string): boolean {
  const s = session(id);
  const shot = s?.shots?.[0];
  if (!s || !shot?.clipUri || s.source !== 'uploaded_video') return false;
  if (shot.clipStartSeconds != null && shot.clipEndSeconds != null && shot.clipEndSeconds > shot.clipStartSeconds) return false;
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
      budgetMs: 60_000,
      when: ({ input }) => needsWindow(input.sessionId),
      run: async ({ input }) => {
        const s = session(input.sessionId);
        const shot = s?.shots?.[0];
        if (!s || !shot?.clipUri) return null;
        const { findUploadSwingWindow } = require('../analysisOrchestrator') as typeof import('../analysisOrchestrator');
        const w = await findUploadSwingWindow(shot.clipUri, s.upload?.duration_sec ?? 0);
        useSwingSessionStore.getState().setShotClipBoundaries(input.sessionId, shot.id, w.startSec, w.endSec, w.impactSec);
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
      run: async ({ input }) => {
        const vu = require('../../videoUpload') as typeof import('../../videoUpload');
        return vu._runPhaseKRead(input.sessionId);
      },
    },
    {
      id: 'pose',
      deps: ['read'],
      budgetMs: 90_000,
      run: async ({ input }) => {
        const vu = require('../../videoUpload') as typeof import('../../videoUpload');
        return vu.runUploadPosePass(input.sessionId);
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
      .addAppEvent('orchestrator_stage_failed', { run: key, stage, error: error.slice(0, 120) }, stage === 'read' ? 'analysis_error' : 'diag');
  } catch { /* reporting never breaks a run */ }
}

/**
 * Start (or join) this session's run and resolve with the READ's result as soon as the read settles —
 * the pose stage keeps going in the background, exactly as the old fire-and-forget tail did, but now
 * owned, ordered and budgeted.
 */
export function runUploadAnalysis(sessionId: string): Promise<ReadResult> {
  const run = getOrStartRun<In>(`upload:${sessionId}`, () => ({ stages: stages(), input: { sessionId }, hooks: { onStageFailed: report } }));
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
