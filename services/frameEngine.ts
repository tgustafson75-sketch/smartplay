/**
 * 2026-10-03 (Tim's 14.5s upload, reproduced on the emulator) — EXACT video frames on Android, in JS.
 *
 * expo-video-thumbnails on Android asks MediaMetadataRetriever for OPTION_CLOSEST_SYNC: the nearest
 * KEYFRAME, not the frame at the time asked for. Phone video puts a keyframe about once a second, so a
 * swing sampled sixteen times came back as two or three distinct pictures, and "top" and "impact" were
 * whatever keyframe happened to sit nearest. iOS asks with zero tolerance and gets the exact frame —
 * and so does every browser, which is why the web SmartMotion reads the same clip cleanly.
 *
 * So the browser does it here too: a hidden WebView (components/FrameEngineHost) seeks a <video> to
 * the exact time and hands back the drawn frame. No native change — react-native-webview ships in
 * the binary. utils/videoThumbnail routes frame grabs through this on Android and falls back to the
 * native retriever whenever the engine is not there or does not answer.
 *
 * 2026-10-03 (adversarial review, same night) — hardened:
 *   - MOUNTED ON DEMAND. The host renders nothing until the first request, so Android users who never
 *     analyze a clip never start a WebView renderer.
 *   - SELF-HEALING. A request the page never answers, or a dead renderer, bumps `generation`: the host
 *     remounts the WebView and every pending request is rejected at once instead of each waiting out
 *     its timeout.
 *   - The browser pose fallback remembers a failed runtime load for a few minutes rather than trying
 *     the CDN again on every frame (a weak course connection cost 45s per frame).
 */

type Grab = { b64: string; width: number; height: number };
/** Where the swing is, found the web SmartMotion way (motion between tiny frames). */
export type MotionWindow = { startMs: number; endMs: number; peakMs: number };
export type WebLandmark = { x: number; y: number; z: number; visibility: number; presence: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pending = { resolve: (g: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

let inject: ((js: string) => void) | null = null;
let ready = false;
let seq = 0;
const pending = new Map<number, Pending>();

// ── on-demand mount + remount ───────────────────────────────────────────────────────────────────
let wanted = false;
let generation = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** The host subscribes; it renders the WebView only once something has asked for a frame. */
export function subscribeFrameEngine(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
export function frameEngineState(): { wanted: boolean; generation: number } {
  return { wanted, generation };
}

function want(): void {
  if (!wanted) { wanted = true; notify(); }
}

/** Throw the page away and start a fresh one; every pending request fails now, not at its timeout. */
export function resetFrameEngine(reason: string): void {
  ready = false;
  inject = null;
  for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(`frame engine reset: ${reason}`)); }
  pending.clear();
  generation++;
  notify();
}

/** Called by the host when its page has loaded and can take requests. */
export function attachFrameEngine(injectJs: (js: string) => void): void {
  inject = injectJs;
}

export function detachFrameEngine(): void {
  inject = null;
  ready = false;
  for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('frame engine detached')); }
  pending.clear();
}

export function isFrameEngineReady(): boolean {
  return ready && inject != null;
}

/** Start the engine now without waiting — call it where an analysis is about to be needed. */
export function warmFrameEngine(): void {
  try {
    const { Platform } = require('react-native') as typeof import('react-native');
    if (Platform.OS === 'android') want();
  } catch { /* warming is best-effort */ }
}

/**
 * Ask for the engine and wait briefly for it to come up. False means "use native this time" — the
 * first frames of the very first analysis may come from the native retriever while the page loads.
 */
export async function ensureFrameEngine(waitMs = 2_500): Promise<boolean> {
  want();
  if (isFrameEngineReady()) return true;
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 100));
    if (isFrameEngineReady()) return true;
  }
  return false;
}

/** Messages posted by the page (window.ReactNativeWebView.postMessage). */
export function onFrameEngineMessage(raw: string): void {
  let msg: { type?: string; id?: number; ok?: boolean; b64?: string; w?: number; h?: number; error?: string; landmarks?: WebLandmark[]; durationMs?: number; window?: MotionWindow | null };
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg.type === 'ready') { ready = true; return; }
  if ((msg.type !== 'frame' && msg.type !== 'pose' && msg.type !== 'motion') || typeof msg.id !== 'number') return;
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.type === 'motion') {
    if (msg.ok) p.resolve({ durationMs: msg.durationMs ?? 0, window: msg.window ?? null });
    else p.reject(new Error(msg.error ?? 'frame engine: no motion read'));
    return;
  }
  if (msg.type === 'pose') {
    if (msg.ok && Array.isArray(msg.landmarks)) p.resolve(msg.landmarks);
    else p.reject(new Error(msg.error ?? 'frame engine: no pose'));
    return;
  }
  if (msg.ok && msg.b64 && msg.w && msg.h) p.resolve({ b64: msg.b64, width: msg.w, height: msg.h });
  else p.reject(new Error(msg.error ?? 'frame engine: no frame'));
}

function request<T>(js: (id: number) => string, timeoutMs: number, label: string): Promise<T> {
  if (!isFrameEngineReady()) return Promise.reject(new Error('frame engine not ready'));
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${label} timeout`));
      // The page bounds every step itself, so a request it never answered means it is wedged or dead.
      resetFrameEngine(`${label} timeout`);
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    inject?.(js(id));
  });
}

/**
 * The frame at exactly `timeMs`, as a JPEG (base64, no data: prefix), longest side at most `maxDim`.
 * Rejects past the end of the clip (callers probe duration that way) and on any page-side failure —
 * callers fall back to the native retriever.
 */
export function grabExactFrame(videoUri: string, timeMs: number, maxDim = 1280, timeoutMs = 8_000): Promise<Grab> {
  return request<Grab>(
    (id) => `window.__grab && window.__grab(${id}, ${JSON.stringify(videoUri)}, ${Math.max(0, Math.round(timeMs))}, ${Math.round(maxDim)}); true;`,
    timeoutMs, 'frame engine',
  );
}

/**
 * 2026-10-03 (Tim: "can the web be used instead?") — the swing window from LOCALISED MOTION, ported from
 * the web SmartMotion (smartmotion/src/lib/frames.ts findMotionWindow). No pose: tiny blurred frames,
 * the last substantial burst of motion. `window` is null when nothing stands out (sample the whole clip).
 */
export function findMotionWindow(videoUri: string, timeoutMs = 20_000): Promise<{ durationMs: number; window: MotionWindow | null }> {
  return request(
    (id) => `window.__motion && window.__motion(${id}, ${JSON.stringify(videoUri)}); true;`,
    timeoutMs, 'motion window',
  );
}

/**
 * 2026-10-03 — BlazePose landmarks (33, normalized) for a JPEG, computed in the browser with the same
 * model the native module loads. The fallback for a native engine that fails at inference. The first
 * call loads the web runtime (from the CDN, then cached); a failed load is remembered for a few
 * minutes so a weak connection fails each frame instantly instead of after a long wait.
 */
let poseWarm = false;
let poseUnavailableUntil = 0;
const POSE_RETRY_AFTER_MS = 5 * 60_000;

export async function detectPoseInBrowser(b64: string): Promise<WebLandmark[]> {
  if (Date.now() < poseUnavailableUntil) throw new Error('browser pose unavailable (recent load failure)');
  try {
    const lm = await request<WebLandmark[]>(
      (id) => `window.__pose && window.__pose(${id}, ${JSON.stringify(b64)}); true;`,
      poseWarm ? 8_000 : 35_000, 'browser pose',
    );
    poseWarm = true;
    return lm;
  } catch (e) {
    if (!poseWarm) poseUnavailableUntil = Date.now() + POSE_RETRY_AFTER_MS;
    throw e;
  }
}

/** Test seam. */
export function _resetFrameEngineForTest(): void {
  detachFrameEngine();
  wanted = false; generation = 0; poseWarm = false; poseUnavailableUntil = 0;
}
