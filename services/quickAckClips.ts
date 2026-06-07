/**
 * 2026-06-06 — Quick-ack pre-rendered TTS clip manifest.
 *
 * The brain (api/kevin.ts ~line 1271) has a `defaults` map of 8 short
 * acknowledgement strings used when a tool fires but no model text
 * came back: "Pulling up the layout.", "Locking that distance.",
 * "Heading to SwingLab.", "Got it.", "Logged.", "I hear you.",
 * "I'm watching.", "On it."
 *
 * These fire on every tool action and currently re-run OpenAI TTS
 * (~$0.001 + 400ms each). They're fixed text — perfect for one-time
 * pre-rendering per persona (4 personas × 8 strings = 32 clips).
 *
 * This module:
 *   - Maps each ack text to a slug + per-persona MP3 require()
 *   - resolveAckClip(text, persona) returns a require() module ref
 *     suitable for playLocalFile(), or null if the clip isn't
 *     bundled yet (Tim hasn't run scripts/render-ack-clips.ts).
 *
 * When clips are MISSING, callers fall back to the normal speak()
 * path — no regression. As clips are rendered + bundled, the same
 * code paths get faster + cheaper.
 *
 * Clip files live under assets/audio/acks/<persona>/<slug>.mp3.
 * The require() statements below are guarded — uncomment / add as
 * each persona's render lands. Today (2026-06-06): NO CLIPS BUNDLED
 * YET; resolveAckClip returns null for everything → speak() runs.
 *
 * Render workflow (one-time per persona):
 *   1. Run scripts/render-ack-clips.ts (calls /api/voice for each
 *      string × persona, saves to assets/audio/acks/<persona>/).
 *   2. Add the require() lines below for that persona.
 *   3. Ship via APK build (assets are bundled, not OTA — adding new
 *      mp3 files needs a new build).
 */

type Persona = 'kevin' | 'serena' | 'harry' | 'tank' | 'custom';

// The 8 default ack strings. Keys MUST match exactly what
// api/kevin.ts defaults map produces, so the speak path can do a
// strict equality check before falling back to TTS.
export const ACK_STRINGS = {
  open_smartvision:    'Pulling up the layout.',
  open_smartfinder:    'Locking that distance.',
  open_swinglab:       'Heading to SwingLab.',
  log_score:           'Got it.',
  log_shot:            'Logged.',
  log_emotional_state: 'I hear you.',
  record_swing:        "I'm watching.",
  generic:             'On it.',
} as const;

type AckSlug = keyof typeof ACK_STRINGS;

// Reverse lookup so resolveAckClip can match the rendered string
// back to a slug. Keyed by lowercased + trimmed text for tolerance.
const TEXT_TO_SLUG = new Map<string, AckSlug>();
for (const [slug, text] of Object.entries(ACK_STRINGS)) {
  TEXT_TO_SLUG.set(text.toLowerCase().trim(), slug as AckSlug);
}

// Per-persona × per-slug clip manifest. Today: all null (no clips
// bundled yet). When a clip ships, replace `null` with
// `require('../assets/audio/acks/<persona>/<slug>.mp3')`.
// Metro's bundler needs static require strings — no dynamic paths.
type ClipMap = Record<AckSlug, number | null>;
const EMPTY: ClipMap = {
  open_smartvision:    null,
  open_smartfinder:    null,
  open_swinglab:       null,
  log_score:           null,
  log_shot:            null,
  log_emotional_state: null,
  record_swing:        null,
  generic:             null,
};
const CLIPS: Record<Persona, ClipMap> = {
  kevin:  { ...EMPTY },
  serena: { ...EMPTY },
  harry:  { ...EMPTY },
  tank:   { ...EMPTY },
  custom: { ...EMPTY },
};

/**
 * Resolve a pre-rendered ack clip for the given text + persona, if
 * one is bundled. Returns the require()'d module ref suitable for
 * Audio.Sound.createAsync({ uri: '' } as never, but actually you
 * pass it as the source) — OR null when no clip exists, in which
 * case the caller should fall back to runtime TTS via speak().
 *
 * The return type is `number | null` because React Native's
 * require('./foo.mp3') yields a numeric asset id at bundle time.
 */
export function resolveAckClip(text: string | null | undefined, persona: string): number | null {
  if (!text) return null;
  const slug = TEXT_TO_SLUG.get(String(text).toLowerCase().trim());
  if (!slug) return null;
  const personaMap = CLIPS[persona as Persona] ?? CLIPS.kevin;
  return personaMap[slug] ?? null;
}

/** Diagnostic — how many clips are actually bundled (per persona). */
export function bundledAckClipCount(): Record<Persona, number> {
  const out: Record<Persona, number> = { kevin: 0, serena: 0, harry: 0, tank: 0, custom: 0 };
  for (const persona of Object.keys(CLIPS) as Persona[]) {
    out[persona] = Object.values(CLIPS[persona]).filter((v) => v != null).length;
  }
  return out;
}
