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
 * KNOWN GAP (Phase K v1): `extractKeyFrames(clipUri)` returns empty array
 * until `expo-video-thumbnails` (or equivalent video-frame-extraction
 * library) is added. With an empty frame array, the pipeline gracefully
 * reports "couldn't get clear frames" and the cards stay in placeholder
 * mode. Adding the dep + populating the function = ~5 lines; tracked as
 * a refinement-bundle item.
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
};

export type SwingAnalysisResult =
  | { kind: 'ok'; analysis: SwingAnalysis }
  | { kind: 'no_frames' }
  | { kind: 'no_network' }
  | { kind: 'error'; message: string };

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Sample 5 key frames from a swing clip via expo-video-thumbnails. Each frame
 * is extracted at a normalized time fraction (5%, 30%, 55%, 80%, 95% of the
 * clip — covers address through follow-through), resized + JPEG-compressed
 * via expo-image-manipulator, and returned as base64 ready for the vision
 * endpoint. Returns empty array on any failure (consumer treats as no_frames).
 */
import * as VT from 'expo-video-thumbnails';
import * as ImageManipulator from 'expo-image-manipulator';

const FRAME_TIME_FRACTIONS = [0.05, 0.30, 0.55, 0.80, 0.95];
// expo-video-thumbnails takes time in milliseconds; we don't have a clip-
// duration probe API, so use absolute timestamps approximating a 2-second
// swing window. Falls within a typical Cage Session capture clip length.
const APPROX_SWING_DURATION_MS = 2000;

export async function extractKeyFrames(clipUri: string): Promise<{ b64: string; media_type: string }[]> {
  if (!clipUri) return [];
  try {
    const frames = await Promise.all(
      FRAME_TIME_FRACTIONS.map(async (t) => {
        try {
          const r = await VT.getThumbnailAsync(clipUri, {
            time: Math.round(APPROX_SWING_DURATION_MS * t),
            quality: 0.8,
          });
          const m = await ImageManipulator.manipulateAsync(
            r.uri,
            [{ resize: { width: 1024 } }],
            { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true },
          );
          return m.base64 ? { b64: m.base64, media_type: 'image/jpeg' as const } : null;
        } catch {
          return null;
        }
      }),
    );
    return frames.filter((f): f is { b64: string; media_type: 'image/jpeg' } => f !== null);
  } catch (e) {
    console.log('[poseDetection] extractKeyFrames failed:', e);
    return [];
  }
}

/**
 * Analyze a single swing. Extracts frames, sends to vision endpoint, returns
 * structured swing fault. Returns no_frames result when frame extraction is
 * unavailable so the consumer renders honest empty-state instead of fake data.
 */
export async function analyzeSwing(
  clipUri: string,
  context: { club: string; swing_number: number; prior_issues?: string[] },
): Promise<SwingAnalysisResult> {
  const frames = await extractKeyFrames(clipUri);
  if (frames.length === 0) return { kind: 'no_frames' };

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  try {
    const res = await fetch(`${apiUrl}/api/swing-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames, context }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { kind: 'error', message: `Server returned ${res.status}` };
    const data = (await res.json()) as SwingAnalysis;
    return { kind: 'ok', analysis: data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/network|abort|timeout|fetch/i.test(msg)) return { kind: 'no_network' };
    return { kind: 'error', message: msg };
  }
}
