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

import { getApiBaseUrl } from './apiBase';
import { useSettingsStore } from '../store/settingsStore';
import { useRoundStore } from '../store/roundStore';
import { buildSceneSensorContext } from './sceneReadContext';

const SCENE_INSTRUCTION =
  "I'm looking at this shot. Read the scene for me: what's in view that matters — " +
  'water / out-of-bounds / trees / bunkers and WHICH side, the sky and light (clear, ' +
  'overcast, rain), and whether the foliage shows the wind moving. Ground it in the ' +
  'measured wind, temp, and distance I gave you (use that wind number — do not guess ' +
  "wind from the picture). Then tell me how to play it and how to think about it " +
  'mentally — a calm, confident plan. Keep it tight and spoken, no lists.';

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
  const settings = useSettingsStore.getState();
  const round = useRoundStore.getState();
  const ctx = buildSceneSensorContext({ targetYards: input.targetYards ?? null });

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/kevin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: SCENE_INSTRUCTION,
        language: settings.language ?? 'en',
        persona: settings.caddiePersonality,
        voiceGender: settings.voiceGender,
        image_base64: input.imageBase64,
        image_media_type: input.mediaType ?? 'image/jpeg',
        image_caption: ctx.caption,
        unified_context_block: ctx.block,
        // Scene reads during a round use on-course mode (correct caddie
        // posture) and inject only the current hole's data — NOT the full
        // known-courses list that /api/kevin builds off-course. This halves
        // the effective prompt size and respects the live-round context.
        isRoundActive: round.isRoundActive,
        currentHole: round.isRoundActive ? round.currentHole : null,
        activeCourseId: round.isRoundActive ? round.activeCourseId : null,
        activeCourse: round.isRoundActive ? round.activeCourse : null,
      }),
      // 60 s — Sonnet with a large system prompt + image can take 30-40 s on a
      // cold Anthropic cache (5-min TTL). The prior 30 s was causing silent
      // timeouts; the extra headroom prevents the call from aborting mid-stream.
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.warn('[sceneRead] api non-ok', res.status);
      return null;
    }
    const raw = (await res.json()) as { text?: string };
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!text) return null;
    return { text, hadWind: ctx.hasWind };
  } catch (e) {
    console.warn('[sceneRead] exception:', e);
    return null;
  }
}
