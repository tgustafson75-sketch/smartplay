/**
 * 2026-08-31 — BUILD A SHAREABLE SWING LINK.
 *
 * Tim: "I want to be able to send out, even if it's by link form, exactly what you would get from
 * swing library analysis — the reports, the video playback. Maybe better ways to have that linkable,
 * instead of exporting PDFs or photos."
 *
 * A PDF is a dead end — it cannot move, cannot be corrected, and nobody forwards one. This produces
 * a URL that shows the swing MOVING with the skeleton on it, the same read the player got, and a
 * button to get the app. See api/swing-share.ts for the page and the privacy decision.
 *
 * WHY FRAMES RATHER THAN THE CLIP. The recording is 60-120s and 60-200MB; uploading that from a golf
 * course is not a feature, it is a punishment. So the share carries a handful of stills sampled
 * ACROSS THE SWING WINDOW — which the analysis already located — plus the pose that was already
 * computed, and the page animates them. Under a megabyte, seconds on cellular, and it moves.
 * Real video needs clip trimming, which needs a native module this app does not ship.
 *
 * HONESTY: only what the analysis actually produced travels. A metric that was never measured is
 * omitted, never filled in with a plausible number — this page is read by people who are not yet
 * customers, and a fabricated stat on it would be the most expensive lie the product could tell.
 * [[illustration-data-points]]
 */
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as ImageManipulator from 'expo-image-manipulator';
import { getApiBaseUrl, appKeyHeaders } from './apiBase';
import { resolveClipUri } from './videoUpload';
import { frameTimesMs, SHARE_FRAME_COUNT } from './swing/shareSampling';

/** The page renders at phone width; 480px is generous for it and roughly a third the bytes of 800. */
const SHARE_FRAME_WIDTH = 480;

export { frameTimesMs, SHARE_FRAME_COUNT };

export type ShareKeypoint = { x: number; y: number; name: string; score: number };
export type ShareInput = {
  clipUri: string;
  /** The located swing window, in seconds. Falls back to the whole clip. */
  startSec?: number | null;
  endSec?: number | null;
  title?: string;
  player?: string | null;
  club?: string | null;
  headline?: string | null;
  observation?: string | null;
  fault?: string | null;
  fix?: string | null;
  drill?: string | null;
  /** The player's own words. Travels beside the analysis, never merged into it. */
  feel?: string | null;
  metrics?: { label: string; value: string }[];
  /** Pose keypoints per extracted frame, ALREADY normalized 0..1. Optional — no pose, no overlay. */
  pose?: ShareKeypoint[][];
  /** Opaque per-device string used only for rate limiting; hashed server-side, never stored raw. */
  creator?: string | null;
};

export type ShareResult =
  | { ok: true; id: string; url: string }
  | { ok: false; reason: 'no_clip' | 'no_frames' | 'too_large' | 'offline' | 'server' };

async function grabFrame(uri: string, timeMs: number): Promise<string | null> {
  try {
    const { uri: raw } = await VideoThumbnails.getThumbnailAsync(uri, { time: timeMs, quality: 0.7 });
    const out = await ImageManipulator.manipulateAsync(
      raw,
      [{ resize: { width: SHARE_FRAME_WIDTH } }],
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    return out.base64 ?? null;
  } catch {
    return null; // one missing frame is a shorter loop, not a failed share
  }
}

/**
 * Build the payload and create the link. Returns a URL ready to hand to the share sheet.
 * Never throws — every failure is a typed reason the caller can say out loud.
 */
export async function createSwingShare(input: ShareInput): Promise<ShareResult> {
  const base = getApiBaseUrl();
  if (!base) return { ok: false, reason: 'offline' };

  const uri = (await resolveClipUri(input.clipUri).catch(() => null)) ?? input.clipUri;
  if (!uri) return { ok: false, reason: 'no_clip' };

  const start = input.startSec ?? 0;
  const end = input.endSec && input.endSec > start ? input.endSec : start + 3;
  const times = frameTimesMs(start, end);

  // Serial on purpose: concurrent thumbnail reads on one file are the SIGSEGV class this app has
  // already been bitten by, and the media chain serializes them anyway.
  const frames: { b64: string; timeMs: number }[] = [];
  for (const t of times) {
    const b64 = await grabFrame(uri, t);
    if (b64) frames.push({ b64, timeMs: t });
  }
  if (frames.length < 2) return { ok: false, reason: 'no_frames' };

  // Pose is aligned to the frames we actually got; if the counts disagree, drop the overlay rather
  // than draw a skeleton against the wrong frame. A misregistered overlay is worse than none.
  const pose = input.pose && input.pose.length === frames.length ? input.pose : undefined;

  const payload = {
    title: input.title || 'Swing analysis',
    player: input.player ?? undefined,
    club: input.club ?? undefined,
    capturedAt: Date.now(),
    frames,
    pose,
    headline: input.headline ?? undefined,
    observation: input.observation ?? undefined,
    fault: input.fault ?? undefined,
    fix: input.fix ?? undefined,
    drill: input.drill ?? undefined,
    feel: input.feel ?? undefined,
    metrics: (input.metrics ?? []).filter((m) => m?.label && m?.value),
  };

  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/swing-share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...appKeyHeaders() },
      body: JSON.stringify({ payload, creator: input.creator ?? undefined }),
      signal: AbortSignal.timeout(45_000),
    });
    if (res.status === 413) return { ok: false, reason: 'too_large' };
    if (!res.ok) return { ok: false, reason: 'server' };
    const data = (await res.json()) as { ok?: boolean; id?: string; url?: string };
    if (!data.ok || !data.id || !data.url) return { ok: false, reason: 'server' };
    return { ok: true, id: data.id, url: data.url };
  } catch {
    return { ok: false, reason: 'offline' };
  }
}

/**
 * NO CLIENT REVOKE HELPER SHIPS YET, deliberately. The SERVER supports withdrawal —
 * `POST /api/swing-share { id, revoke: true }`, and a withdrawn link renders an honest "this swing
 * was removed" page rather than a 404 — but nothing in the app calls it, because there is no
 * "stop sharing" affordance yet. An exported function with no caller is the orphan class this repo
 * keeps finding as live bugs, so the capability waits on the UI that would use it rather than
 * sitting here looking finished. [[orphans-are-live-bugs-not-dead-code]]
 */
