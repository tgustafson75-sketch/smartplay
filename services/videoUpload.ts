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
import { useCageStore, type UploadMetadata, type SwingTag, type PrimaryIssue, type DrillRecommendation } from '../store/cageStore';
import { analyzeSwing } from './poseDetection';
import { classifySession } from './swingIssueClassifier';
import { recommendDrill } from './drillRecommendation';

export const MAX_FILE_SIZE_MB = 200;

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
  const store = useCageStore.getState();
  const session = store.sessionHistory.find(s => s.id === sessionId);
  if (!session) return { primary_issue: null, drill_recommendation: null };

  const swings = session.shots.filter(s => s.clipUri);
  if (swings.length === 0) {
    store.setSessionAnalysisStatus(sessionId, 'failed', 'No usable swing in the upload.');
    return { primary_issue: null, drill_recommendation: null };
  }

  try {
    store.setSessionAnalysisStatus(sessionId, 'analyzing_frames');
    // Brief yield so the UI can render the new stage label before we hit
    // the (potentially blocking) analyze call.
    await new Promise(r => setTimeout(r, 50));

    const results: { swing_id: string; analysis: import('./poseDetection').SwingAnalysis }[] = [];

    store.setSessionAnalysisStatus(sessionId, 'analyzing_pose');
    for (const [i, swing] of swings.entries()) {
      if (!swing.clipUri) continue;
      const r = await analyzeSwing(swing.clipUri, {
        club: swing.club,
        swing_number: i + 1,
        prior_issues: results.slice(-3).map(x => x.analysis.detected_issue),
      });
      if (r.kind === 'ok') {
        results.push({ swing_id: swing.id, analysis: r.analysis });
        useCageStore.getState().setShotIssueTimestamps(sessionId, swing.id, r.frame_timestamps_sec);
      }
    }

    if (results.length === 0) {
      // analyzeSwing returned non-ok for every swing. This is the canonical
      // "I couldn't see the swing" path — bad lighting, wrong angle, etc.
      useCageStore.getState().setSessionAnalysisStatus(
        sessionId, 'failed',
        "I had trouble watching this one — could be lighting, angle, or video quality.",
      );
      return { primary_issue: null, drill_recommendation: null };
    }

    useCageStore.getState().setSessionAnalysisStatus(sessionId, 'analyzing_pattern');
    const primary_issue = classifySession(results);
    const drill_recommendation = primary_issue ? recommendDrill(primary_issue.issue_id as never) : null;

    useCageStore.getState().setSessionAnalysis(sessionId, primary_issue, drill_recommendation);
    return { primary_issue, drill_recommendation };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('[videoUpload] Phase K error', msg);
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
