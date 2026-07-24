/**
 * 2026-07-23 (Tim — "the app + Caddie must always feel like a real person… if we know what the local
 * fallback says every time, why don't we have it in Kevin's voice so we never hear the robot voice?").
 *
 * The caddie's offline / degrade path speaks a SMALL, FIXED set of lines ("Didn't catch that…", the
 * on-device re-prompt, the off-course practice nudge). Those are the moments the user hears the robotic
 * device-TTS voice. This module pre-renders those fixed lines in the persona's REAL voice via /api/voice
 * WHILE ONLINE and caches the mp3s to disk, so the offline path can play the real caddie instead of the
 * robot. [[feels-like-a-real-caddie]]
 *
 * Why a disk cache warmed online (not bundled assets):
 *   - It ships via OTA (no native build needed to add audio).
 *   - It renders whatever the CURRENT persona/gender is — including a user's custom caddie — so it's
 *     always the voice the player actually hears, not a fixed stock recording.
 *   - It self-heals: any line not yet cached is fetched the next time we're online.
 *
 * Safety floor: this is PURELY ADDITIVE. resolveCachedOfflineClipUri() returns null unless a valid clip
 * is on disk; callers (speakDeviceNotice) then fall back to device TTS exactly as before. A cold cache
 * (brand-new install, never online) simply behaves like today until the first online warm.
 *
 * DYNAMIC offline lines (live yardage/club reads from deadEndLine) are intentionally NOT here — they
 * carry real numbers and can't be pre-rendered; they keep device TTS.
 */
import { File, Paths } from 'expo-file-system';
import { getApiBaseUrl } from './apiBase';
import { DEAD_END_PRACTICE } from './localStatusResponder';

type Lang = 'en' | 'es' | 'zh';
type Gender = 'male' | 'female';

/** The fixed lines the offline/degrade path speaks, keyed by a stable slug. The `text` values MUST
 *  match verbatim what the code passes to speakDeviceNotice, so the reverse match lands. */
export const OFFLINE_LINES: { slug: string; language: Lang; text: string }[] = [
  { slug: 'didnt_catch_close', language: 'en', text: "Didn't catch that — try once more, a bit closer to the mic." },
  { slug: 'didnt_catch_again', language: 'en', text: "Didn't catch that — say it again?" },
  { slug: 'say_again',          language: 'en', text: 'Say that again for me?' },
  // Off-course practice nudge — the one FIXED deadEndLine branch (the others are dynamic reads).
  { slug: 'off_course_en', language: 'en', text: DEAD_END_PRACTICE.en },
  { slug: 'off_course_es', language: 'es', text: DEAD_END_PRACTICE.es },
  { slug: 'off_course_zh', language: 'zh', text: DEAD_END_PRACTICE.zh },
];

/** Normalize a spoken line for tolerant matching (whitespace/case only — punctuation stays because the
 *  em-dash lines are distinct). */
function norm(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

const TEXT_TO_LINE = new Map<string, { slug: string; language: Lang }>();
for (const l of OFFLINE_LINES) TEXT_TO_LINE.set(norm(l.text), { slug: l.slug, language: l.language });

function cacheKey(slug: string, gender: Gender): string {
  return `${gender}:${slug}`;
}

function fileFor(slug: string, gender: Gender): File {
  return new File(Paths.cache, `offline_voice_${gender}_${slug}.mp3`);
}

/** Minimum plausible mp3 size — mirrors the speak() path's small-payload guard so a truncated/empty
 *  render is never treated as a usable clip. */
const MIN_CLIP_BYTES = 1000;

// In-memory set of clips confirmed present on disk (populated by ensureOfflineClipsCached, which is the
// single writer). resolveCachedOfflineClipUri stays SYNC by consulting this rather than hitting disk.
const cachedKeys = new Set<string>();

/**
 * If the given spoken line is one of our fixed offline lines AND its persona-voice clip is cached on
 * disk, return the file uri to play. Otherwise null → caller uses device TTS. Sync + cheap.
 */
export function resolveCachedOfflineClipUri(text: string, gender: Gender): string | null {
  const line = TEXT_TO_LINE.get(norm(text));
  if (!line) return null;
  if (!cachedKeys.has(cacheKey(line.slug, gender))) return null;
  return fileFor(line.slug, gender).uri;
}

let warmInFlight: Promise<void> | null = null;

/**
 * Ensure every fixed offline line is cached as a persona-voice mp3 for `gender`. Idempotent + best-
 * effort: existing files are just registered; missing ones are fetched from /api/voice (only possible
 * when online) and saved. Never throws. De-duped so concurrent callers share one pass.
 */
export function ensureOfflineClipsCached(gender: Gender, persona: string): Promise<void> {
  if (warmInFlight) return warmInFlight;
  warmInFlight = (async () => {
    const apiBase = getApiBaseUrl();
    for (const line of OFFLINE_LINES) {
      const key = cacheKey(line.slug, gender);
      if (cachedKeys.has(key)) continue;
      const file = fileFor(line.slug, gender);
      // Already on disk from a prior session → register and skip the network.
      try {
        if (file.exists && (file.size ?? 0) >= MIN_CLIP_BYTES) { cachedKeys.add(key); continue; }
      } catch { /* fall through to fetch */ }
      // Fetch the persona-voice render. Fails cleanly when offline → we just try again next warm.
      try {
        const resp = await fetch(apiBase + '/api/voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: line.text, gender, language: line.language, persona }),
        });
        if (!resp.ok) continue;
        const buf = await resp.arrayBuffer();
        if (buf.byteLength < MIN_CLIP_BYTES) continue; // truncated/empty → don't cache a bad clip
        file.write(new Uint8Array(buf));
        cachedKeys.add(key);
      } catch { /* offline or transient — leave uncached, retry next warm */ }
    }
  })().finally(() => { warmInFlight = null; });
  return warmInFlight;
}

/** Test-only: reset in-memory cache registry. */
export function __resetOfflineVoiceCache(): void {
  cachedKeys.clear();
}

/** Test seam: register a slug as cached (used to assert resolve behavior without disk/network). */
export function __markCachedForTest(slug: string, gender: Gender): void {
  cachedKeys.add(cacheKey(slug, gender));
}
