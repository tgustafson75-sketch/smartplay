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
import { analyzeSwing } from './poseDetection';
import { classifySession } from './swingIssueClassifier';
import { recommendDrill } from './drillRecommendation';
import { processSwingAnalysis } from './relationshipEngine';

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
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { kind: 'permission_denied' };

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
      videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    });

    if (result.canceled) return { kind: 'cancelled' };
    const asset = result.assets[0];
    if (!asset?.uri) return { kind: 'error', message: 'Picker returned no URI' };

    const sizeMB = asset.fileSize ? asset.fileSize / 1_000_000 : null;
    if (sizeMB != null && sizeMB > MAX_FILE_SIZE_MB) {
      return { kind: 'error', message: `Video is ${sizeMB.toFixed(0)}MB — over the ${MAX_FILE_SIZE_MB}MB cap.` };
    }

    return {
      kind: 'ok',
      uri: asset.uri,
      durationMillis: asset.duration ?? null,
      fileSize: asset.fileSize ?? null,
    };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Probe a video for audio presence + duration via expo-av. Best-effort. */
export async function probeVideo(uri: string): Promise<{ has_audio: boolean; duration_sec: number | null }> {
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
    return { has_audio, duration_sec };
  } catch {
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
  V6('STAGE 0 — runPhaseKOnSession enter', { sessionId });
  const store = useCageStore.getState();
  const session = store.sessionHistory.find(s => s.id === sessionId);
  if (!session) {
    V6('STAGE 0 ABORT — session not in store', { sessionId });
    return { primary_issue: null, drill_recommendation: null };
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
    V6('STAGE 6 FINAL — failed: no usable swings');
    store.setSessionAnalysisStatus(sessionId, 'failed', 'No usable swing in the upload.');
    return { primary_issue: null, drill_recommendation: null };
  }

  try {
    store.setSessionAnalysisStatus(sessionId, 'analyzing_frames');
    await new Promise(r => setTimeout(r, 50));

    const results: { swing_id: string; analysis: import('./poseDetection').SwingAnalysis }[] = [];
    const perSwingOutcomes: Array<{ swing_id: string; kind: string; detail?: string }> = [];

    store.setSessionAnalysisStatus(sessionId, 'analyzing_pose');
    for (const [i, swing] of swings.entries()) {
      if (!swing.clipUri) continue;
      V6('STAGE 2-3 — analyzeSwing call', { index: i, club: swing.club });
      const r = await analyzeSwing(swing.clipUri, {
        club: swing.club,
        swing_number: i + 1,
        prior_issues: results.slice(-3).map(x => x.analysis.detected_issue),
      });
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
      if (r.kind === 'ok') {
        results.push({ swing_id: swing.id, analysis: r.analysis });
        useCageStore.getState().setShotIssueTimestamps(sessionId, swing.id, r.frame_timestamps_sec);
      }
    }

    V6('STAGE 4 SUMMARY — per-swing outcomes', {
      totalSwings: swings.length,
      successful: results.length,
      perSwing: perSwingOutcomes,
    });

    if (results.length === 0) {
      V6('STAGE 6 FINAL — failed: zero usable analyses across all swings (frame extraction or vision API failed for every clip)');
      useCageStore.getState().setSessionAnalysisStatus(
        sessionId, 'failed',
        "I had trouble watching this one — could be lighting, angle, or video quality.",
      );
      return { primary_issue: null, drill_recommendation: null };
    }

    useCageStore.getState().setSessionAnalysisStatus(sessionId, 'analyzing_pattern');
    V6('STAGE 5 — classifySession call', { resultsCount: results.length });
    const primary_issue = classifySession(results);
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

    const drill_recommendation = primary_issue ? recommendDrill(primary_issue.issue_id as never) : null;
    V6('STAGE 6 FINAL — ok', {
      primary_issue_id: primary_issue?.issue_id ?? null,
      drill_id: drill_recommendation?.drill_id ?? null,
      ui_status: 'ok',
    });

    useCageStore.getState().setSessionAnalysis(sessionId, primary_issue, drill_recommendation);

    // Phase V.7+ — feed the relationship engine so Kevin's brain prompt
    // accumulates technical observations across uploads. Deduped within
    // 1h; escalates copy on the 3rd repeat in a week.
    if (primary_issue) {
      try {
        processSwingAnalysis({ club: session.club, primary_issue });
      } catch (e) {
        console.log('[videoUpload] relationship engine error', e);
      }
    }

    return { primary_issue, drill_recommendation };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
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
}): string {
  const upload: UploadMetadata = {
    uploaded_at: Date.now(),
    taken_at: args.taken_at ?? null,
    notes: args.notes ?? null,
    swinger: args.swinger ?? 'Me',
    tag: args.tag ?? null,
    has_audio: args.has_audio ?? false,
    duration_sec: args.duration_sec ?? null,
  };
  const sessionId = useCageStore.getState().ingestUploadedSwing({
    clipUri: args.uri,
    club: args.club,
    upload,
  });
  // Fire-and-forget Phase K. Errors logged, don't block ingest UX.
  void runPhaseKOnSession(sessionId).catch(e => console.log('[videoUpload] Phase K error', e));
  return sessionId;
}
