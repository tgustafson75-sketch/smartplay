/**
 * 2026-09-29 — THE FRAME RATE OF THE CLIP, NOT OF THE CAMERA.
 *
 * captureEngineStore.capturedFps is what the swing camera resolved RIGHT NOW: null once it unmounts,
 * and about the NEXT recording rather than the one on screen. Readers that judge a recorded clip —
 * the ball-trace gate, the club-path schedule, the caddie's capture-quality line — need the rate THAT
 * clip was captured at. A live SmartMotion recording stores it on the swing (upload.captured_fps);
 * an uploaded clip has none, and neither does a session saved before the field existed. Both read as
 * null = UNKNOWN, which every consumer already treats as "no claim either way".
 */

const validFps = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/** The captured rate stored on a session, or null (upload, older session, or garbage). */
export function sessionCapturedFps(
  session: { upload?: { captured_fps?: number | null } | null } | null | undefined,
): number | null {
  return validFps(session?.upload?.captured_fps);
}

/** The captured rate of the session whose clip is `clipUri`, or null. */
export function capturedFpsForClip(
  history: readonly { shots?: readonly { clipUri?: string | null }[]; upload?: { captured_fps?: number | null } | null }[] | null | undefined,
  clipUri: string | null | undefined,
): number | null {
  if (!clipUri || !Array.isArray(history)) return null;
  const s = history.find((x) => x?.shots?.[0]?.clipUri === clipUri);
  return sessionCapturedFps(s ?? null);
}

/**
 * The rate a capture-quality judgement should use: the clip under review when there is one (its own
 * rate, even when that is unknown), otherwise the live camera's — which describes the next recording.
 */
export function fpsInScope(
  reviewingClip: { fps: number | null } | null | undefined,
  liveCameraFps: number | null | undefined,
): number | null {
  if (reviewingClip) return validFps(reviewingClip.fps);
  return validFps(liveCameraFps);
}
