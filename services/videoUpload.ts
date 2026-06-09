/**
 * Phase R — Video upload service.
 *
 * Pipeline:
 *   1. Picker (expo-image-picker, video media type)
 *   2. Validation (file size cap, format hint)
 *   3. Probe duration + audio presence via expo-av
 *   4. Hand off to cageStore.ingestUploadedSwing — surfaces it in the swing
 *      library as a one-shot CageSession with source: 'uploaded_video'
 *   5. Background Phase K analysis via runPhaseKOnSession (parallel to the
 *      live cage post-session pipeline in app/cage/summary.tsx)
 *
 * Storage: clipUri stays as the picker-returned local URI. No cloud upload
 * in v1.0. Cloud sync is 1.x.
 */

import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { useCageStore, type UploadMetadata, type SwingTag, type PrimaryIssue, type DrillRecommendation } from '../store/cageStore';
import { analyzeSwing, analyzeSwingTentative } from './poseDetection';
import { classifySession } from './swingIssueClassifier';
import { recommendDrill } from './drillRecommendation';
import { processSwingAnalysis } from './relationshipEngine';
import { synthesizeCageInsight } from './contextSynthesizer';
import { uploadLog, uploadAdoptSessionKey, uploadResetTiming } from './uploadDiagnostic';
import { cageLog } from './cageTelemetry';

export const MAX_FILE_SIZE_MB = 200;

// Phase V.6 diagnostic — single grep target for the full pipeline trace:
//   adb logcat | grep V6-DIAG
const V6 = (msg: string, data?: Record<string, unknown>): void => {
  if (data) console.log('[V6-DIAG] ' + msg + ' ' + JSON.stringify(data));
  else console.log('[V6-DIAG] ' + msg);
};

export type PickResult =
  | { kind: 'ok'; uri: string; durationMillis?: number | null; fileSize?: number | null }
  | { kind: 'cancelled' }
  | { kind: 'permission_denied' }
  | { kind: 'error'; message: string };

/** Open the system video picker. */
export async function pickVideo(): Promise<PickResult> {
  uploadResetTiming();
  uploadLog('capture-start');
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      uploadLog('capture-end', { status: 'failed', reason: 'permission_denied' });
      return { kind: 'permission_denied' };
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
      videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    });

    if (result.canceled) {
      uploadLog('capture-end', { status: 'cancelled' });
      return { kind: 'cancelled' };
    }
    const asset = result.assets[0];
    if (!asset?.uri) {
      uploadLog('capture-end', { status: 'failed', reason: 'no_uri' });
      return { kind: 'error', message: 'Picker returned no URI' };
    }

    const sizeMB = asset.fileSize ? asset.fileSize / 1_000_000 : null;
    if (sizeMB != null && sizeMB > MAX_FILE_SIZE_MB) {
      uploadLog('capture-end', { status: 'failed', reason: 'oversize', size_mb: sizeMB });
      return { kind: 'error', message: `Video is ${sizeMB.toFixed(0)}MB — over the ${MAX_FILE_SIZE_MB}MB cap.` };
    }

    uploadLog('capture-end', {
      status: 'ok',
      size_mb: sizeMB,
      duration_ms: asset.duration ?? null,
      uri_tail: asset.uri.slice(-40),
    });
    return {
      kind: 'ok',
      uri: asset.uri,
      durationMillis: asset.duration ?? null,
      fileSize: asset.fileSize ?? null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    uploadLog('capture-end', { status: 'failed', reason: 'exception', message: msg });
    return { kind: 'error', message: msg };
  }
}

/** Probe a video for audio presence + duration via expo-av. Best-effort. */
export async function probeVideo(uri: string): Promise<{ has_audio: boolean; duration_sec: number | null }> {
  uploadLog('preprocess-start', { uri_tail: uri.slice(-40) });
  try {
    const { sound, status } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
    let duration_sec: number | null = null;
    let has_audio = false;
    if (status.isLoaded) {
      duration_sec = status.durationMillis ? status.durationMillis / 1000 : null;
      // expo-av doesn't directly expose audio-track presence on a video URI
      // played through Audio.Sound — but if the sound loads and reports
      // a non-zero duration we know it decoded an audio track. (Silent video
      // tracks load with isLoaded:false or zero duration on most platforms.)
      has_audio = duration_sec != null && duration_sec > 0;
    }
    await sound.unloadAsync().catch(() => {});
    uploadLog('preprocess-complete', { status: 'ok', has_audio, duration_sec });
    return { has_audio, duration_sec };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    uploadLog('preprocess-complete', { status: 'failed', message: msg });
    return { has_audio: false, duration_sec: null };
  }
}

/**
 * Run Phase K analysis on a freshly-ingested upload session. Parallel to
 * the post-cage-session flow in app/cage/summary.tsx.
 *
 * Phase V — emits analysis-status transitions throughout so the swing
 * detail surface can render real progress copy and surface failures.
 */
export async function runPhaseKOnSession(sessionId: string): Promise<{
  primary_issue: PrimaryIssue | null;
  drill_recommendation: DrillRecommendation | null;
}> {
  uploadLog('phase-k-enter', { session_id: sessionId }, sessionId);
  V6('STAGE 0 — runPhaseKOnSession enter', { sessionId });
  cageLog('phase-k-enter', 'ok', { session_id: sessionId });
  const store = useCageStore.getState();
  const session = store.sessionHistory.find(s => s.id === sessionId);
  if (!session) {
    uploadLog('phase-k-abort', { status: 'failed', reason: 'session_not_in_store' }, sessionId);
    V6('STAGE 0 ABORT — session not in store', { sessionId });
    cageLog('phase-k-result', 'fail', { session_id: sessionId, reason: 'session_not_in_store' });
    return { primary_issue: null, drill_recommendation: null };
  }

  // 2026-05-22 — Putting sessions (glasses POV or putt/chip tag) do NOT
  // fit Phase K's full-body swing pose model. Route through the dedicated
  // puttingAnalysisService instead. Phase K returns nulls so the legacy
  // swing-biomechanics card hides on the cage-review surface; PuttingLab
  // result lands via puttingAnalysisService.analyzePutt and is rendered
  // by the cage-review "Putting" tab (next sprint).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAnalyzerKind } = require('./swingLibrary') as typeof import('./swingLibrary');
    if (getAnalyzerKind(session) === 'putting') {
      uploadLog('phase-k-skip-putting', { session_id: sessionId, source_device: session.upload?.source_device ?? null, tag: session.upload?.tag ?? null }, sessionId);
      V6('STAGE 0 SKIP — putting session routes to puttingAnalysisService');
      const putting = await import('./puttingAnalysisService');
      const puttShot = session.shots.find(s => s.clipUri) ?? null;
      const videoUri = puttShot?.clipUri ?? null;
      // 2026-06-08 (audit #1) — restrict frame sampling to THIS putt's
      // window in a multi-putt master clip; without boundaries we sampled
      // the whole video and analyzed a neighboring putt.
      // 2026-06-08 (audit #2) — if only the start is known, still window the
      // sample (~30s putt clip) instead of falling back to the whole video
      // and analyzing a neighboring putt.
      const puttBoundaries = puttShot?.clipStartSeconds != null
        ? { startSec: puttShot.clipStartSeconds, endSec: puttShot.clipEndSeconds ?? puttShot.clipStartSeconds + 30 }
        : undefined;
      void (async () => {
        try {
          // 2026-05-22 — Extract putt-phase key frames locally before
          // the analyze call. Mirrors the full-swing pipeline (which
          // sends 5 keyframes per swing) but uses putt-tuned fractions
          // (setup/address/impact/follow-through/roll). When extraction
          // fails (no expo-video-thumbnails / web), analyzePutt's
          // spoken-read fallback takes over — no regression.
          let frames_base64: string[] = [];
          if (videoUri) {
            try {
              const extractor = await import('./puttFrameExtractor');
              frames_base64 = await extractor.extractPuttFramesForAnalysis(videoUri, puttBoundaries);
            } catch (e) {
              console.log('[videoUpload] putt frame extract failed (non-fatal):', e);
            }
          }
          const result = await putting.analyzePutt({
            video_url: videoUri,
            frames_base64,
            spoken_read: session.upload?.notes ?? null,
            notes: session.upload?.notes ?? null,
            // 2026-06-08 (audit #12) — pass the user-marked ball + aim so
            // the vision model anchors its read to the real setup.
            ball_area_norm: session.ball_area_norm ?? null,
            target_norm: session.target_norm ?? null,
          });
          // 2026-05-22 — Persist the PuttingAnalysis on the session so
          // the cage-review Putting tab can render it without re-running
          // analysis. addPuttingAnalysis also flips analysis_status='ok'.
          useCageStore.getState().addPuttingAnalysis(sessionId, result);
          uploadLog('putting-analysis-attached', { session_id: sessionId, score: result.overallScore }, sessionId);
          // 2026-05-23 (Fix #5) — Synthesize an overall-fault PrimaryIssue
          // from the putting result and persist it alongside the granular
          // putting card. Closes the gap where glasses POV uploads
          // showed grip/stroke detail but no overall fault summary —
          // PrimaryIssueCard now renders BOTH on the swing detail
          // screen (granular + overall read). Synthesis is purely
          // structural (no new vision call). DrillCard stays gated on
          // drill_recommendation being non-null at the render site so
          // no empty drill card appears for putts.
          try {
            const liveSession = useCageStore.getState().sessionHistory.find(s => s.id === sessionId);
            const firstShotId = liveSession?.shots[0]?.id ?? null;
            const thumb = liveSession?.shots[0]?.perShotAnalysis?.visual_reference_path ?? null;
            const synthesized = putting.synthesizePrimaryIssueFromPutting(result, firstShotId, thumb);
            useCageStore.getState().setSessionAnalysis(sessionId, synthesized, null);
            uploadLog('putting-primary-issue-synthesized', {
              session_id: sessionId,
              name: synthesized.name,
              severity: synthesized.severity,
            }, sessionId);
          } catch (e) {
            console.log('[videoUpload] putting primary-issue synth failed (non-fatal):', e);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log('[videoUpload] putting analyze failed (non-fatal):', msg);
        }
      })();
      return { primary_issue: null, drill_recommendation: null };
    }
  } catch (e) {
    console.log('[videoUpload] analyzer-router check failed (non-fatal, continuing with swing pipeline):', e);
  }

  const swings = session.shots.filter(s => s.clipUri);
  V6('STAGE 0 — session loaded', {
    source: session.source ?? 'live_cage',
    club: session.club,
    shotCount: session.shots.length,
    usableShotCount: swings.length,
    uploadDurationSec: session.upload?.duration_sec ?? null,
    uploadHasAudio: session.upload?.has_audio ?? null,
    uploadNotes: session.upload?.notes ?? null,
  });

  // Probe filesystem for the actual file size so we can rule out size /
  // codec / corruption issues at the entry boundary.
  for (const [i, swing] of swings.entries()) {
    if (!swing.clipUri) continue;
    try {
      const info = await FileSystem.getInfoAsync(swing.clipUri);
      V6('STAGE 0 — clip ' + i + ' file info', {
        exists: info.exists,
        size: info.exists ? (info as { size?: number }).size ?? null : null,
        uri_tail: swing.clipUri.slice(-60),
      });
    } catch (e) {
      V6('STAGE 0 — clip ' + i + ' file probe failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (swings.length === 0) {
    uploadLog('phase-k-no-swings', { status: 'failed', reason: 'no_usable_swings' }, sessionId);
    V6('STAGE 6 FINAL — failed: no usable swings');
    cageLog('phase-k-result', 'fail', { session_id: sessionId, reason: 'no_usable_swings', shot_count: session.shots.length });
    store.setSessionAnalysisStatus(sessionId, 'failed', 'No usable swing in the upload.');
    return { primary_issue: null, drill_recommendation: null };
  }

  // 2026-05-28 — Fix FP: audio transcription is handled by the
  // pre-existing swingCommentaryService (started at app/_layout.tsx),
  // which subscribes to cageStore and transcribes every clip's audio
  // to shot.commentary_transcript. NOT re-fired here — that would
  // duplicate the network call. See swingCommentaryService for the
  // file-size + sub-pipeline behavior.

  try {
    store.setSessionAnalysisStatus(sessionId, 'analyzing_frames');
    await new Promise(r => setTimeout(r, 50));

    const results: { swing_id: string; analysis: import('./poseDetection').SwingAnalysis }[] = [];
    const perSwingOutcomes: Array<{ swing_id: string; kind: string; detail?: string }> = [];

    store.setSessionAnalysisStatus(sessionId, 'analyzing_pose');
    uploadLog('pose-detection-start', { swings_to_analyze: swings.length }, sessionId);

    // 2026-05-26 — Fix DP (commit 1/3): hoist session-level context
    // ABOVE the per-swing loop. caddieName/playerContext/swingTag/
    // priorAnalyzedFault are identical for every swing in the session;
    // resolving them once instead of per-iteration drops ~50ms ×
    // swings.length of redundant store reads/dynamic imports and sets
    // up commit 2 (parallel batches) so closures don't re-resolve in
    // every concurrent task.
    let caddieName: string | undefined;
    try {
      const { getActiveCaddie } = await import('./caddieResolver');
      const { getCaddieName } = await import('../lib/persona');
      caddieName = getCaddieName(getActiveCaddie());
    } catch { /* persona resolver optional */ }
    let playerContext: {
      handicap?: number | null;
      dominant_miss?: string | null;
      experience?: string | null;
      first_name?: string | null;
    } | undefined;
    try {
      const profileMod = await import('../store/playerProfileStore');
      const p = profileMod.usePlayerProfileStore.getState();
      playerContext = {
        handicap: typeof p.handicap_index === 'number' ? p.handicap_index : (typeof p.handicap === 'number' ? p.handicap : null),
        dominant_miss: p.dominantMiss ?? null,
        experience: p.experienceContext ?? null,
        first_name: p.firstName ?? p.name ?? null,
      };
    } catch { /* profile lookup optional */ }
    const swingTag = session.upload?.tag ?? null;
    // Phase 502 — Reanalyze "look for something else" signal (see
    // longer comment below in commit-2 batch closure).
    const priorAnalyzedFault: string | null =
      (session.primary_issue && typeof session.primary_issue.primary_fault === 'string')
        ? session.primary_issue.primary_fault
        : null;

    // 2026-05-28 — Fix FQ (speed #10): hoist cageAngleCtx ABOVE the
    // per-swing loop. Was dynamically required + read from the
    // calibration store on every iteration. Identical for every swing
    // in the session, so resolving once saves ~50ms × swings.length.
    let cageAngleCtx: 'down_the_line' | 'face_on' | 'glasses_pov' | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const calMod = require('../store/cageOverlayCalibrationStore');
      cageAngleCtx = calMod.useCageOverlayCalibrationStore.getState().cameraAngle as 'down_the_line' | 'face_on';
    } catch { /* ignore — default in analyzer */ }

    // 2026-05-28 — Fix FQ (bug #3) / Fix FU: bounded wait for the
    // audio transcript when the clip has audio AND swingCommentaryService
    // is genuinely still trying to transcribe. Three exits:
    //   1. has_audio === false (silent clip) → skip wait
    //   2. transcript already present on any shot → no wait
    //   3. transcription service status === 'done' for every shot →
    //      service has finished and produced empty (e.g. Cage Mode's
    //      silent practice clips) — waiting is pointless, would just
    //      eat 5s for nothing. This is the Fix FU refinement.
    // Otherwise wait up to 5s for transcripts to land, polling every
    // 250ms. Past 5s we proceed and let the re-analyze path catch the
    // late transcript (typical Whisper return is 3-8s).
    if (session.upload?.has_audio) {
      const haveTranscriptAlready = session.shots.some(
        s => (s.commentary_transcript ?? '').trim().length > 0,
      );
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getTranscriptionStatus } = require('./swingCommentaryService') as typeof import('./swingCommentaryService');
      const everyShotTranscriptionDone = session.shots.every(
        s => getTranscriptionStatus(s.id) === 'done',
      );
      if (!haveTranscriptAlready && !everyShotTranscriptionDone) {
        // 2026-06-07 — Trimmed 5s → 2.5s. Transcripts arriving after
        // this still apply via re-analyze in the background; the
        // user shouldn't wait 5s for an audio transcript before
        // analysis kicks off.
        const TRANSCRIPT_BUDGET_MS = 2_500;
        const POLL_MS = 250;
        const deadline = Date.now() + TRANSCRIPT_BUDGET_MS;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, POLL_MS));
          const liveSession = useCageStore.getState().sessionHistory.find(s => s.id === sessionId);
          if (liveSession?.shots.some(s => (s.commentary_transcript ?? '').trim().length > 0)) {
            uploadLog('coach-audio-wait-resolved', { ms: Date.now() - (deadline - TRANSCRIPT_BUDGET_MS) }, sessionId);
            break;
          }
          // 2026-05-28 — Fix FU: also exit when the transcription
          // service flips to 'done' for every shot (it gave up or
          // returned empty). Avoid the worst case where Cage Mode's
          // silent clips would otherwise eat the full 5s budget.
          if (session.shots.every(s => getTranscriptionStatus(s.id) === 'done')) {
            uploadLog('coach-audio-wait-skip-service-done', { ms: Date.now() - (deadline - TRANSCRIPT_BUDGET_MS) }, sessionId);
            break;
          }
        }
      }
    }

    // 2026-05-26 — Fix DQ (commit 2/3): parallelize per-shot analysis
    // in batches of USE_PARALLEL_BATCH_SIZE. Sequential 10-shot
    // session = ~150s (10 × ~15s) and routinely hit the client's 55s
    // abort. Batched concurrency 3 brings it to ~50s (3-4 batches ×
    // ~15s). All side effects (uploadLog/cageLog/V6/store writes)
    // stay per-swing inside the closure; results land in indexed
    // slots so output order matches input order regardless of when
    // each batch member completes.
    //
    // Safety: USE_PARALLEL_PER_SHOT flag can be flipped false for a
    // one-line revert to pre-commit-2 sequential behavior. Cage and
    // SmartMotion are the WOW path; regression here is unacceptable.
    const USE_PARALLEL_PER_SHOT = true;
    const USE_PARALLEL_BATCH_SIZE = 3;

    // Build the per-swing work item once so both sequential and
    // parallel paths share the same closure (zero behavior drift).
    type SwingWork = { swing: typeof swings[number]; index: number };
    const work: SwingWork[] = swings
      .map((swing, index) => ({ swing, index }))
      .filter(w => !!w.swing.clipUri);

    const runOne = async ({ swing, index: i }: SwingWork): Promise<void> => {
      // Phase BW — clipBoundaries for multi-swing master videos.
      const boundaries = (
        typeof swing.clipStartSeconds === 'number' &&
        typeof swing.clipEndSeconds === 'number'
      )
        ? { startSec: swing.clipStartSeconds, endSec: swing.clipEndSeconds }
        : undefined;
      uploadLog('frame-analysis-start', {
        index: i,
        club: swing.club,
        bounded: boundaries != null,
      }, sessionId);
      V6('STAGE 2-3 — analyzeSwing call', {
        index: i,
        club: swing.club,
        bounded: boundaries != null,
      });
      cageLog('phase-k-per-shot-start', 'ok', {
        session_id: sessionId,
        shot_id: swing.id,
        index: i,
        bounded: boundaries != null,
        boundary_start_sec: boundaries?.startSec ?? null,
        boundary_end_sec: boundaries?.endSec ?? null,
      });
      // Snapshot prior_issues at THIS swing's start. In parallel mode,
      // all swings in a batch see the same snapshot (the prior batch's
      // results) — acceptable since prior_issues is loose informational
      // context for the prompt, not a hard dependency.
      const priorIssuesSnapshot = results.slice(-3).map(x => x.analysis.detected_issue);
      // 2026-05-27 — Fix ES (Phase 2.5): pass the session's cage
      // targeting markers (if any) into the analyzer context. Server
      // uses them as a strong anchor in the vision prompt — "ball at
      // (x,y) within radius r in frame 0; impact = first frame ball
      // is absent." Reduces false-positive impact reads + tightens
      // the fault-frame selection. No-op when the user hasn't set
      // them up (which is the common case during early beta).
      const liveSession = useCageStore.getState().sessionHistory.find(s => s.id === sessionId);
      const ballAreaCtx = liveSession?.ball_area_norm ?? null;
      const targetCtx = liveSession?.target_norm ?? null;
      // 2026-05-27 — Fix EU: thread the user's chosen cage camera angle
      // into the analyzer. Cage Mode lets the user pick down-the-line
      // vs face-on at SETUP; that picks the right read framing
      // (DTL=path/plane/EE, face-on=weight/rotation). Without this,
      // 2026-05-28 — Fix FQ: cageAngleCtx now hoisted above the loop
      // (computed once per session — see above). Read the LIVE shot
      // from the store for commentary_transcript so a transcript that
      // landed AFTER `swings` was snapshotted (line 221) is still seen
      // by the analyzer. The closure variable `swing` was frozen at
      // snapshot time.
      const liveShot = useCageStore.getState().sessionHistory
        .find(s => s.id === sessionId)?.shots.find(x => x.id === swing.id);
      const coachAudio = (liveShot?.commentary_transcript ?? swing.commentary_transcript ?? '').trim();
      // 2026-06-01 — Fix GE: library uploads use tier='quick' (Haiku
      // 4.5 only, no OpenAI/Sonnet escalation). Prior config left
      // library on the full chain "where deeper analysis matters
      // more." In practice on Tim's clips, Haiku was already producing
      // the actual answer (detected_issue='none' on clean swings,
      // mis-routed to Tentative by the GD bug, OR a real fault with
      // confidence good enough to meet speedBar). Either way, the
      // chain rarely improved the read but reliably added 20-40s.
      // Net trade: ~30s server-side savings per upload, with the
      // safety net intact — Haiku failing to produce a parseable
      // result falls through to OpenAI/Sonnet escalation on the
      // server (api/swing-analysis.ts quickShortCircuit gate only
      // skips escalation when winner.parsed != null).
      const r = await analyzeSwing(swing.clipUri!, {
        club: swing.club,
        swing_number: i + 1,
        prior_issues: priorIssuesSnapshot,
        caddie_name: caddieName,
        player_context: playerContext,
        swing_tag: swingTag,
        prior_analyzed_fault: priorAnalyzedFault,
        ball_area_norm: ballAreaCtx,
        target_norm: targetCtx,
        tier: 'quick',
        ...(cageAngleCtx ? { angle: cageAngleCtx } : {}),
        ...(coachAudio.length > 0 ? { coach_audio: coachAudio } : {}),
      }, boundaries, {
        faultFrameBaseName: `${sessionId}_${swing.id}_fault`,
      });
      uploadLog('frame-analysis-complete', {
        index: i,
        kind: r.kind,
        status: r.kind === 'ok' ? 'ok' : 'failed',
        detected_issue: r.kind === 'ok' ? r.analysis.detected_issue : null,
        confidence: r.kind === 'ok' ? r.analysis.confidence : null,
        message: r.kind === 'error' ? r.message : (r.kind === 'no_network' ? 'no_network' : (r.kind === 'no_frames' ? 'no_frames' : null)),
      }, sessionId);
      V6('STAGE 4 — analyzeSwing returned', {
        index: i,
        kind: r.kind,
        detected_issue: r.kind === 'ok' ? r.analysis.detected_issue : null,
        severity: r.kind === 'ok' ? r.analysis.severity : null,
        confidence: r.kind === 'ok' ? r.analysis.confidence : null,
        observation: r.kind === 'ok' ? r.analysis.observation : null,
        follow_up_question: r.kind === 'ok' ? (r.analysis.follow_up_question ?? null) : null,
        error: r.kind === 'error' ? r.message : null,
      });
      perSwingOutcomes.push({
        swing_id: swing.id,
        kind: r.kind,
        detail: r.kind === 'error' ? r.message : (r.kind === 'ok' ? r.analysis.detected_issue : undefined),
      });
      cageLog('phase-k-per-shot-result', r.kind === 'ok' ? 'ok' : 'fail', {
        session_id: sessionId,
        shot_id: swing.id,
        index: i,
        kind: r.kind,
        detected_issue: r.kind === 'ok' ? r.analysis.detected_issue : null,
        confidence: r.kind === 'ok' ? r.analysis.confidence : null,
      });
      if (r.kind === 'ok') {
        results.push({ swing_id: swing.id, analysis: r.analysis });
        useCageStore.getState().setShotIssueTimestamps(sessionId, swing.id, r.frame_timestamps_sec);
        useCageStore.getState().setShotAnalysis(sessionId, swing.id, {
          detected_issue: r.analysis.detected_issue,
          severity: r.analysis.severity,
          confidence: r.analysis.confidence,
          observation: r.analysis.observation,
          fault_frame_index: r.analysis.fault_frame_index ?? -1,
          visual_reference_path: r.fault_frame_uri ?? null,
        });
        // 2026-05-24 — Promote the display-quality fault frame to the
        // session level. In parallel mode the "last successful with
        // display URI wins" semantics still hold — the LAST batch to
        // complete writes its display URI (effectively the latest
        // diagnostic frame in completion order, vs swing order).
        if (r.fault_frame_display_uri || r.analysis.fault_frame_index != null) {
          useCageStore.getState().setSessionFaultFrame(sessionId, {
            uri: r.fault_frame_display_uri ?? null,
            index: r.analysis.fault_frame_index ?? null,
            fraction: r.fault_frame_fraction ?? null,
          });
        }
      }
    };

    if (USE_PARALLEL_PER_SHOT && work.length > 1) {
      // Batched parallel path. Each batch awaits Promise.allSettled
      // so a single failing swing doesn't abort the others — failures
      // are captured per-swing inside runOne via the r.kind branches.
      for (let batchStart = 0; batchStart < work.length; batchStart += USE_PARALLEL_BATCH_SIZE) {
        const batch = work.slice(batchStart, batchStart + USE_PARALLEL_BATCH_SIZE);
        V6('STAGE 2-3 — parallel batch start', {
          batch_start: batchStart,
          batch_size: batch.length,
          total_work: work.length,
        });
        await Promise.allSettled(batch.map(runOne));
      }
    } else {
      // Sequential path — preserved for the feature-flag-off case
      // and for single-swing sessions (no concurrency to gain).
      for (const item of work) {
        await runOne(item);
      }
    }

    V6('STAGE 4 SUMMARY — per-swing outcomes', {
      totalSwings: swings.length,
      successful: results.length,
      perSwing: perSwingOutcomes,
    });

    uploadLog('pose-detection-complete', {
      status: results.length > 0 ? 'ok' : 'failed',
      successful: results.length,
      attempted: swings.length,
    }, sessionId);

    if (results.length === 0) {
      // Phase U1 — heuristic-fallback path. Before declaring full failure,
      // try a single-frame tentative observation. The user gets a useful
      // tentative read with an honest "low confidence" caveat instead of a
      // generic "couldn't analyze". The fallback fires on whichever swing
      // we have a clipUri for; for an uploaded video that's always the
      // single ingested swing. Live-cage sessions with multiple swings
      // pick the first.
      const failureKinds = perSwingOutcomes.map(o => o.kind);
      uploadLog('phase-k-zero-results', {
        reason: 'every_swing_failed_primary_analysis',
        failure_kinds: failureKinds,
      }, sessionId);
      V6('STAGE 6 — primary failed, attempting heuristic fallback', {
        failure_kinds: failureKinds,
        swings_to_retry: swings.length,
      });

      const firstSwingWithClip = swings.find(s => s.clipUri);
      if (firstSwingWithClip?.clipUri) {
        uploadLog('tentative-fallback-start', {
          swing_id: firstSwingWithClip.id,
        }, sessionId);
        const tentative = await analyzeSwingTentative(firstSwingWithClip.clipUri, {
          club: firstSwingWithClip.club,
          swing_number: 1,
        });
        uploadLog('tentative-fallback-complete', {
          kind: tentative.kind,
          status: tentative.kind === 'ok' ? 'ok' : 'failed',
          observation_head: tentative.kind === 'ok'
            ? (tentative.analysis.observation ?? '').slice(0, 200)
            : null,
          message: tentative.kind === 'error' ? tentative.message
            : tentative.kind === 'no_network' ? 'no_network'
            : tentative.kind === 'no_frames' ? 'no_frames'
            : null,
        }, sessionId);

        if (tentative.kind === 'ok') {
          // Synthesise a tentative PrimaryIssue. The PrimaryIssueCard's
          // Phase V.6 branch already prefixes "Tentative read — your swing
          // was hard to read clearly, but ..." when confidence === 'low'.
          // Use the relaxed Sonnet observation as the mechanical_breakdown
          // and a recovery hint as feel_cue.
          const tentativeIssue: PrimaryIssue = {
            issue_id: 'tentative_read',
            name: 'Tentative observation',
            category: 'other',
            severity: 'minor',
            occurrence_count: 1,
            visual_reference_path: null,
            mechanical_breakdown: tentative.analysis.observation || 'I could see the swing but not clearly enough to call a specific tendency.',
            feel_cue: tentative.analysis.follow_up_question
              || 'Try a clearer recording — wider angle, better lighting — for a full analysis.',
            detected_in_shots: [firstSwingWithClip.id],
            confidence: 'low',
          };
          useCageStore.getState().setSessionAnalysis(sessionId, tentativeIssue, null);
          uploadLog('result-store', {
            status: 'ok',
            primary_issue_id: tentativeIssue.issue_id,
            drill_id: null,
            via: 'tentative_fallback',
          }, sessionId);
          V6('STAGE 6 FINAL — tentative ok', {
            observation_head: tentative.analysis.observation.slice(0, 200),
          });
          return { primary_issue: tentativeIssue, drill_recommendation: null };
        }
      }

      // Tentative also failed — surface stage-specific copy so the user
      // knows what to try next, instead of a generic "trouble watching".
      const allNoFrames = failureKinds.every(k => k === 'no_frames');
      const allNoNetwork = failureKinds.every(k => k === 'no_network');
      const allError = failureKinds.every(k => k === 'error');
      const message = allNoFrames
        ? "Couldn't read the frames — try a clearer recording with better lighting and a wider angle."
        : allNoNetwork
        ? "Lost connection to the analyzer. Check your network and try Re-analyze."
        : allError
        ? "The analyzer hit a snag. Try Re-analyze, or report this if it keeps happening."
        : "Couldn't analyze this swing — try a clearer recording or check your connection, then Re-analyze.";

      V6('STAGE 6 FINAL — failed: zero usable analyses + tentative failed', {
        failure_kinds: failureKinds,
        message,
      });
      useCageStore.getState().setSessionAnalysisStatus(sessionId, 'failed', message);
      return { primary_issue: null, drill_recommendation: null };
    }

    useCageStore.getState().setSessionAnalysisStatus(sessionId, 'analyzing_pattern');
    uploadLog('classifier-start', { results_count: results.length }, sessionId);
    V6('STAGE 5 — classifySession call', { resultsCount: results.length });
    let primary_issue = classifySession(results);

    // 2026-05-26 — Fix DR (commit 3/3): tentative-fallback ALSO fires
    // when the classifier returned null AND every primary read came
    // back as 'inconclusive' (i.e. the footage was readable but the
    // analyst couldn't pin a tendency on any swing). Prior behavior
    // left primary_issue=null in that case, surfacing as 'no dominant
    // fault' silence. Tentative uses different frame sampling and a
    // more permissive prompt — gives the user a useful low-confidence
    // read instead of dead-ending. The original zero-results
    // tentative path is unchanged above.
    //
    // 2026-06-01 — Fix GD: bug. Prior code conflated TWO outcomes:
    //   - detected_issue === 'none'  → model SUCCEEDED, read the
    //     swing, correctly said "no clear fault" (e.g. clean swing).
    //   - primary_fault === 'inconclusive' → model FAILED to read
    //     the footage (unreadable lighting/angle/blur).
    // Only the second deserves the tentative fallback. The first is a
    // legitimate, honest "no fault" read and should surface as such.
    // Bug symptom: EVERY clean-swing upload landed as "Tentative
    // observation" because Haiku said detected_issue='none' (correct)
    // and we treated it as if it had failed. Tim: "every video has
    // tentative observation, has been consistent for a long time."
    //
    // Fix: split the cases.
    if (!primary_issue && results.length > 0) {
      const allInconclusive = results.every(r =>
        r.analysis.primary_fault === 'inconclusive',
      );
      const allNoneDetected = results.every(r =>
        r.analysis.detected_issue === 'none' &&
        r.analysis.primary_fault !== 'inconclusive',
      );

      if (allNoneDetected) {
        // 2026-06-01 — Fix GD: honest "no clear fault" path. Model
        // read the swing(s) successfully and called no fault. Surface
        // that as a real PrimaryIssue with issue_id='no_clear_fault'
        // and high confidence — NOT as a tentative observation. Uses
        // the first swing's actual observation text when present so
        // the player gets the model's real read, not a placeholder.
        const firstSwingWithClip = swings.find(s => s.clipUri);
        const firstResult = results[0];
        const observation = (firstResult?.analysis.observation ?? '').trim();
        V6('STAGE 5 FINAL — no clear fault (model read OK, no tendency)', {
          swings: results.length,
          observation_head: observation.slice(0, 200),
        });
        uploadLog('no-clear-fault-surfaced', {
          swings: results.length,
          via: 'detected_issue_none',
        }, sessionId);
        primary_issue = {
          issue_id: 'no_clear_fault',
          name: 'No clear fault',
          category: 'other',
          severity: 'minor',
          occurrence_count: results.length,
          visual_reference_path: null,
          mechanical_breakdown: observation
            || 'I watched the swing and didn\'t see a single tendency standing out today. That\'s a clean read — keep doing what you\'re doing.',
          feel_cue: 'Trust the swing. Hit a few more if you want a deeper pattern check.',
          detected_in_shots: firstSwingWithClip ? [firstSwingWithClip.id] : [],
          confidence: 'high',
        };
      } else if (allInconclusive) {
        const firstSwingWithClip = swings.find(s => s.clipUri);
        if (firstSwingWithClip?.clipUri) {
          V6('STAGE 5 — all results inconclusive, attempting tentative fallback', {
            swing_id: firstSwingWithClip.id,
          });
          uploadLog('tentative-fallback-start', {
            swing_id: firstSwingWithClip.id,
            via: 'post_classifier_all_inconclusive',
          }, sessionId);
          const tentative = await analyzeSwingTentative(firstSwingWithClip.clipUri, {
            club: firstSwingWithClip.club,
            swing_number: 1,
          });
          uploadLog('tentative-fallback-complete', {
            kind: tentative.kind,
            status: tentative.kind === 'ok' ? 'ok' : 'failed',
            via: 'post_classifier_all_inconclusive',
          }, sessionId);
          if (tentative.kind === 'ok') {
            primary_issue = {
              issue_id: 'tentative_read',
              name: 'Tentative observation',
              category: 'other',
              severity: 'minor',
              occurrence_count: 1,
              visual_reference_path: null,
              mechanical_breakdown: tentative.analysis.observation
                || 'I could see the swing but no single tendency stood out.',
              feel_cue: tentative.analysis.follow_up_question
                || 'Try a clearer recording — wider angle, better lighting — for a full analysis.',
              detected_in_shots: [firstSwingWithClip.id],
              confidence: 'low',
            };
            V6('STAGE 5 FINAL — post-classifier tentative ok', {
              observation_head: tentative.analysis.observation.slice(0, 200),
            });
          }
        }
      }
    }
    V6('STAGE 5 — classifySession returned', {
      primary_issue_id: primary_issue?.issue_id ?? null,
      primary_issue_name: primary_issue?.name ?? null,
      severity: primary_issue?.severity ?? null,
      confidence: primary_issue?.confidence ?? null,
      occurrence_count: primary_issue?.occurrence_count ?? null,
      reason_if_null: primary_issue ? null : (results.length === 1
        ? 'single swing returned detected_issue=none'
        : 'multi-swing: no usable consensus AND no fallback (all analyses returned none)'),
    });

    uploadLog('classifier-complete', {
      status: 'ok',
      primary_issue_id: primary_issue?.issue_id ?? null,
      severity: primary_issue?.severity ?? null,
      confidence: primary_issue?.confidence ?? null,
    }, sessionId);

    const drill_recommendation = primary_issue ? recommendDrill(primary_issue.issue_id as never) : null;
    V6('STAGE 6 FINAL — ok', {
      primary_issue_id: primary_issue?.issue_id ?? null,
      drill_id: drill_recommendation?.drill_id ?? null,
      ui_status: 'ok',
    });

    useCageStore.getState().setSessionAnalysis(sessionId, primary_issue, drill_recommendation);
    uploadLog('result-store', {
      status: 'ok',
      primary_issue_id: primary_issue?.issue_id ?? null,
      drill_id: drill_recommendation?.drill_id ?? null,
    }, sessionId);

    // Phase V.7+ — feed the relationship engine so Kevin's brain prompt
    // accumulates technical observations across uploads. Deduped within
    // 1h; escalates copy on the 3rd repeat in a week.
    if (primary_issue) {
      try {
        processSwingAnalysis({ club: session.club, primary_issue });
      } catch (e) {
        console.log('[videoUpload] relationship engine error', e);
      }
      // Phase AQ — fire-and-forget Sonnet synthesis of a cage-session
      // memory note. Persists into cageStore.recentInsights, injected
      // into pre-round briefing so practice meaningfully informs rounds.
      void synthesizeCageInsight({
        sessionId,
        club: session.club,
        shotCount: session.shots.length,
        primaryIssueName: primary_issue.name,
        severity: primary_issue.severity,
        drillName: drill_recommendation?.drill_name ?? null,
        dominantMiss: session.dominantMiss ?? null,
      }).catch(() => {});
    }

    // Pose-detection biomechanics — fire-and-forget AFTER Phase K so it
    // never blocks the user reaching the swing detail screen. Reads the
    // first usable swing's clipUri + duration, samples 5 keyframes via
    // expo-video-thumbnails, hits /api/pose-analysis per frame, computes
    // hip turn / shoulder coil / weight shift / posture / head drift.
    // Stores result back to the session via setSessionBiomechanics.
    // Failures silent (pose API has known reliability variance, env-var
    // gated). Detail screen renders the Biomechanics card iff result is
    // present — zero UX regression when API isn't configured.
    const firstClipSwing = swings.find(s => s.clipUri);
    if (firstClipSwing?.clipUri) {
      const durationSec = session.upload?.duration_sec ?? 3;
      void (async () => {
        try {
          const poseMod = await import('./poseAnalysisApi');
          const biomech = await poseMod.analyzeSwingFromVideo(firstClipSwing.clipUri!, durationSec * 1000);
          useCageStore.getState().setSessionBiomechanics(sessionId, biomech);
          uploadLog('pose-analysis', { ok: !!biomech, frames: biomech?.frames.length ?? 0 }, sessionId);
        } catch (poseErr) {
          // Non-fatal — Phase K result already shown. Pose API is opt-in.
          console.log('[pose] background analysis failed', poseErr);
        }
      })();
    }

    return { primary_issue, drill_recommendation };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    uploadLog('phase-k-throw', { status: 'failed', message: msg }, sessionId);
    V6('STAGE 6 FINAL — failed: pipeline threw', { error: msg, stack: e instanceof Error ? (e.stack ?? '').split('\n').slice(0, 5).join(' | ') : null });
    useCageStore.getState().setSessionAnalysisStatus(
      sessionId, 'failed',
      "I had trouble watching this one — could be lighting, angle, or video quality.",
    );
    return { primary_issue: null, drill_recommendation: null };
  }
}

/**
 * One-shot ingest helper: hand off picker result + metadata to the store
 * and kick off Phase K analysis. Returns the new session id.
 */
export function ingestVideoFromPick(args: {
  uri: string;
  club: string;
  notes?: string | null;
  swinger?: string | null;
  tag?: SwingTag | null;
  taken_at?: number | null;
  has_audio?: boolean;
  duration_sec?: number | null;
  /** 2026-05-22 — Source device tag. 'meta_glasses' routes the session
   *  through puttingAnalysisService (POV downward video the swing-pose
   *  model can't read). 'phone' = legacy full-body upload. */
  source_device?: 'meta_glasses' | 'phone' | 'unknown' | null;
  /** 2026-05-23 — Camera perspective override. When provided, wins over
   *  the auto-infer from familyStore.active_member_id. Caller (upload
   *  screen perspective picker) sets this when the user explicitly
   *  picks "You" vs "Someone else." */
  perspective?: 'pov_self' | 'watching_someone' | null;
  /** 2026-05-25 — Path A "watch then analyze" flag. When true, ingest
   *  creates the session but does NOT auto-fire runPhaseKOnSession.
   *  Caller (upload screen for short clips) is responsible for firing
   *  the analysis later — typically after the user watches the video
   *  play through on the swing detail screen via ?watch=1 nav param.
   *  Default false preserves current background-analysis behavior. */
  deferAnalysis?: boolean;
}): string {
  // 2026-05-23 — Perspective auto-inference. If the caller didn't pass
  // an explicit perspective, look at familyStore — when a family
  // member is currently active (Tim tapped Emma to coach her), this
  // video is almost certainly Tim WATCHING someone else swing → route
  // to full Phase K swing analysis. Otherwise default to 'pov_self'.
  // The upload-screen picker can override either way. Wrapped in
  // try/catch because familyStore may not be loaded in test envs.
  let inferredPerspective: 'pov_self' | 'watching_someone' = 'pov_self';
  if (args.perspective != null) {
    inferredPerspective = args.perspective;
  } else {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fam = require('../store/familyStore') as typeof import('../store/familyStore');
      const activeId = fam.useFamilyStore.getState().active_member_id;
      if (activeId) inferredPerspective = 'watching_someone';
    } catch { /* no-op — familyStore absent, keep default 'pov_self' */ }
  }

  const upload: UploadMetadata = {
    uploaded_at: Date.now(),
    taken_at: args.taken_at ?? null,
    notes: args.notes ?? null,
    swinger: args.swinger ?? 'Me',
    tag: args.tag ?? null,
    has_audio: args.has_audio ?? false,
    duration_sec: args.duration_sec ?? null,
    source_device: args.source_device ?? null,
    perspective: inferredPerspective,
  };
  const sessionId = useCageStore.getState().ingestUploadedSwing({
    clipUri: args.uri,
    club: args.club,
    upload,
  });
  uploadLog('storage-local', {
    status: 'ok',
    session_id: sessionId,
    club: args.club,
    has_audio: upload.has_audio,
    duration_sec: upload.duration_sec,
  });
  // Promote the pre-session timing key to a session-keyed one so the
  // analysis-trigger / pose-detection / ui-render markers all share a
  // continuous elapsed-total clock from pickVideo through to UI render.
  uploadAdoptSessionKey(sessionId);
  uploadLog('analysis-trigger', { session_id: sessionId, deferred: !!args.deferAnalysis }, sessionId);
  // Fire-and-forget Phase K — unless caller deferred. When deferred,
  // the swing detail screen fires runPhaseKOnSession after the user
  // watches the clip play through (Path A: watch-then-analyze for
  // short library uploads, gated by the ?watch=1 nav param).
  if (!args.deferAnalysis) {
    void runPhaseKOnSession(sessionId).catch(e => {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('[videoUpload] Phase K error', e);
      uploadLog('analysis-trigger-throw', { status: 'failed', message: msg }, sessionId);
    });
  }
  return sessionId;
}
