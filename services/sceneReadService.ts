/**
 * 2026-06-13 — Smart Finder Scene Read (the "mind-blown" moment).
 *
 * Point the phone on a range or an active course; it reads the SCENE meta — the
 * tree, the water on your right, blue skies or rain, and whether the leaves are
 * moving — grounds it in the MEASURED wind/temp/distance, and ties it into the
 * caddie brain: what to do and how to think about it mentally.
 *
 * v1 reuses the EXISTING multimodal brain pipe (/api/kevin upgrades to Sonnet when
 * an image is present) — NO new server endpoint, fully OTA-safe. We send the captured
 * frame + a scene-read instruction + the sensor-truth block (services/sceneReadContext).
 *
 * HONESTY: the camera reports QUALITATIVE scene facts (water right, trees left,
 * overcast, leaves moving = wind present); the measured wind NUMBER comes from the
 * weather service and is handed to the brain so it never fabricates one from pixels.
 * Best-effort + offline-degrading: returns null on transport failure (caller keeps
 * the local read). See memory: smartfinder-unified-brain-read, api-base-url-spine.
 */

import { mayTalkToCaddie } from './featureAccess';
import { askCaddie } from './caddieBrain';
import { useSettingsStore } from '../store/settingsStore';
import { buildSceneSensorContext } from './sceneReadContext';

const SCENE_INSTRUCTION =
  "I'm looking at this shot. Read the scene for me: what's in view that matters — " +
  'water / out-of-bounds / trees / bunkers and WHICH side, the sky and light (clear, ' +
  'overcast, rain), and whether the foliage shows the wind moving. Ground it in the ' +
  'measured wind, temp, and distance I gave you (use that wind number — do not guess ' +
  "wind from the picture). Then tell me how to play it and how to think about it " +
  'mentally — a calm, confident plan. Keep it tight and spoken, no lists.';

/** The player's ask as the shared history keeps it — the instruction above is for the model only. */
const SCENE_HEARD = "I'm looking at this shot — read the scene for me.";

export interface SceneReadResult {
  /** The caddie's spoken scene read + mental approach. */
  text: string;
  /** True when a measured wind value was supplied to the brain. */
  hadWind: boolean;
}

/**
 * Run a scene read on a captured frame. `imageBase64` is raw base64 (no data: prefix).
 * Returns null on any transport failure so the caller can fall back gracefully.
 */
export async function readScene(input: {
  imageBase64: string;
  mediaType?: string;
  targetYards?: number | null;
}): Promise<SceneReadResult | null> {
  if (!input.imageBase64) return null;
  // 2026-08-25 — the one caddie access gate. A scene read is a brain turn with a picture attached.
  if (!mayTalkToCaddie({ userInitiated: true })) return null; // the player asked for this read
  const ctx = buildSceneSensorContext({ targetYards: input.targetYards ?? null });

  /**
   * 2026-10-28 (Brain review r5) — THROUGH askCaddie, like every other turn the player asks.
   *
   * This was a raw /api/kevin fetch with a hand-built body. Two things followed from that:
   *   1. IT PAID FOR A VOICE IT THREW AWAY. No skip_tts, so the server rendered TTS for every read,
   *      and both callers (app/smartfinder) speak `text` through speak(), which renders it again.
   *   2. IT WAS NOT PART OF THE CONVERSATION. askCaddie writes the shared history; this did not, so
   *      after a read "so what club?" or "what about the water?" reached a caddie with no idea he
   *      had just read the shot.
   * The narrow payload it kept (08-23) was for prompt size; the builder sends the same round flags
   * and hole, and the rest is who the player is — which a read that "ties into the caddie brain"
   * should have had. askCaddie also refuses the 200-with-error failure shape (B9) itself.
   */
  const turn = await askCaddie({
    message: SCENE_INSTRUCTION,
    heard: SCENE_HEARD,
    language: useSettingsStore.getState().language ?? 'en',
    image_base64: input.imageBase64,
    image_media_type: input.mediaType ?? 'image/jpeg',
    image_caption: ctx.caption,
    // The measured sensor truth (wind / temp / target) the read must be grounded in.
    liveBlock: ctx.block,
    skipTts: true,
    // 60 s — Sonnet with a large system prompt + image can take 30-40 s on a cold cache (5-min TTL).
    timeoutMs: 60_000,
  });
  if (!turn?.text) return null;
  return { text: turn.text, hadWind: ctx.hasWind };
}
