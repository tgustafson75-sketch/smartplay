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
 * the binary. utils/videoThumbnail routes every frame grab through this on Android and falls back to
 * the native retriever if the engine is not mounted or does not answer.
 */

type Grab = { b64: string; width: number; height: number };
export type WebLandmark = { x: number; y: number; z: number; visibility: number; presence: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pending = { resolve: (g: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

let inject: ((js: string) => void) | null = null;
let ready = false;
let seq = 0;
const pending = new Map<number, Pending>();

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

/** Messages posted by the page (window.ReactNativeWebView.postMessage). */
export function onFrameEngineMessage(raw: string): void {
  let msg: { type?: string; id?: number; ok?: boolean; b64?: string; w?: number; h?: number; error?: string; landmarks?: WebLandmark[] };
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg.type === 'ready') { ready = true; return; }
  if ((msg.type !== 'frame' && msg.type !== 'pose') || typeof msg.id !== 'number') return;
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.type === 'pose') {
    if (msg.ok && Array.isArray(msg.landmarks)) p.resolve(msg.landmarks);
    else p.reject(new Error(msg.error ?? 'frame engine: no pose'));
    return;
  }
  if (msg.ok && msg.b64 && msg.w && msg.h) p.resolve({ b64: msg.b64, width: msg.w, height: msg.h });
  else p.reject(new Error(msg.error ?? 'frame engine: no frame'));
}

/**
 * The frame at exactly `timeMs`, as a JPEG (base64, no data: prefix), longest side at most `maxDim`.
 * Rejects on timeout or any page-side failure — callers fall back to the native retriever.
 */
export function grabExactFrame(videoUri: string, timeMs: number, maxDim = 1280, timeoutMs = 6_000): Promise<Grab> {
  if (!isFrameEngineReady()) return Promise.reject(new Error('frame engine not ready'));
  const id = ++seq;
  return new Promise<Grab>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('frame engine timeout'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    inject?.(`window.__grab && window.__grab(${id}, ${JSON.stringify(videoUri)}, ${Math.max(0, Math.round(timeMs))}, ${Math.round(maxDim)}); true;`);
  });
}

/**
 * 2026-10-03 — BlazePose landmarks (33, normalized) for a JPEG, computed in the browser with the same
 * model the native module loads. The fallback for a native engine that fails at inference; the first
 * call loads the web runtime (from the CDN, then cached), so it gets a long timeout.
 */
let poseWarm = false;
export function detectPoseInBrowser(b64: string): Promise<WebLandmark[]> {
  if (!isFrameEngineReady()) return Promise.reject(new Error('frame engine not ready'));
  const id = ++seq;
  const timeoutMs = poseWarm ? 8_000 : 45_000;
  return new Promise<WebLandmark[]>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('browser pose timeout')); }, timeoutMs);
    pending.set(id, { resolve: (l: WebLandmark[]) => { poseWarm = true; resolve(l); }, reject, timer });
    inject?.(`window.__pose && window.__pose(${id}, ${JSON.stringify(b64)}); true;`);
  });
}
