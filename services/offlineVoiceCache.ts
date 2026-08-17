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
import { ACK_PHRASES, CADDIE_NOTICE_DIDNT_CATCH, CADDIE_NOTICE_MIC_TROUBLE, LISTEN_CUES, GOTIT_CUES } from './caddieAckLines';

type Lang = 'en' | 'es' | 'zh';
type Gender = 'male' | 'female';

/** The fixed lines the offline/degrade path speaks, keyed by a stable slug. The `text` values MUST
 *  match verbatim what the code passes to speakDeviceNotice, so the reverse match lands. */
export const OFFLINE_LINES: { slug: string; language: Lang; text: string }[] = [
  { slug: 'didnt_catch_close', language: 'en', text: "Didn't catch that — try once more, a bit closer to the mic." },
  { slug: 'didnt_catch_again', language: 'en', text: "Didn't catch that — say it again?" },
  { slug: 'say_again',          language: 'en', text: 'Say that again for me?' },
  // 2026-07-26 (deep audit — robotic device-TTS on the HAPPY PATH) — every captured turn speaks a rotating
  // ack + the bare "Didn't catch that." via speakDeviceNotice; none were cached, so they always played in
  // the robotic OS voice (north-star defect, heard every turn). Pre-render the ENGLISH set in the persona
  // voice, built from the SAME source listeningSession speaks (caddieAckLines) so they can't drift. es/zh
  // acks keep the device-TTS fallback until there are non-English testers.
  { slug: 'didnt_catch_short', language: 'en', text: CADDIE_NOTICE_DIDNT_CATCH },
  // 2026-08-17 — the mic-failed line (spoken instead of "Didn't catch that." when the microphone
  // never opened). Same treatment: it's a line the user hears at a bad moment, so it must not be
  // the moment they also hear the robot voice.
  { slug: 'mic_trouble_en', language: 'en', text: CADDIE_NOTICE_MIC_TROUBLE.en },
  ...ACK_PHRASES.en.map((text, i) => ({ slug: `ack_en_${i}`, language: 'en' as const, text })),
  // 2026-08-08 (Tim — verbal listen/got-it cues replace the earcons his Tozo T6 never hears). Rendered
  // in the persona's real voice; listeningSession resolves + plays them at tap-to-listen / tap-again.
  // De-duped against pools above so a shared phrase ("Got it.") isn't rendered twice.
  ...LISTEN_CUES.idle.map((text, i) => ({ slug: `listen_idle_${i}`, language: 'en' as const, text })),
  ...LISTEN_CUES.round.filter(t => !LISTEN_CUES.idle.includes(t)).map((text, i) => ({ slug: `listen_round_${i}`, language: 'en' as const, text })),
  ...GOTIT_CUES.filter(t => !ACK_PHRASES.en.includes(t)).map((text, i) => ({ slug: `gotit_${i}`, language: 'en' as const, text })),
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

const TEXT_TO_LINE = new Map<string, { slug: string; language: Lang; text: string }>();
for (const l of OFFLINE_LINES) TEXT_TO_LINE.set(norm(l.text), { slug: l.slug, language: l.language, text: l.text });

// 2026-07-24 (audit) — key by PERSONA too. The /api/voice render depends on the persona, so a clip
// cached for Kevin must NOT be served after a switch to Tank (it would play in the old caddie's voice).
// Persona in the key + filename means each caddie gets its own cached clips; a switch just re-renders.
function personaSlug(persona: string): string {
  return (persona || 'kevin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'kevin';
}

/**
 * 2026-08-12 (Tim, three times in a row) — "tell me again how you fixed the 'we're off the course
 * right now' message… I'm still getting the same thing."
 *
 * I hadn't fixed it. The TEXT was fixed on 2026-08-06, when he asked for that line to be reverted
 * for reading robotic — DEAD_END_PRACTICE.en became "Good moment to sharpen your tempo or short
 * game". The sentence he kept hearing does not exist anywhere in this codebase.
 *
 * It was coming off his own phone. The cache filename was keyed by SLUG only
 * (`offline_voice_kevin_male_off_course_en.mp3`), so the mp3 rendered from the OLD wording stayed on
 * disk under the same name forever. TEXT_TO_LINE maps the NEW text to the same slug, finds that
 * file, and plays six-day-old audio. Editing a line could never take effect on a device that had
 * already cached it — for ANY of these lines, not just this one.
 *
 * The fingerprint is now part of the identity: change the words and the filename changes with them,
 * so the old clip is simply no longer found and a fresh one is rendered. Non-cryptographic and short
 * — it only has to notice that a string differs. [[no-deferred-wiring-placeholders]]
 */
function textFingerprint(text: string): string {
  let h = 5381;
  const t = norm(text);
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function cacheKey(slug: string, gender: Gender, persona: string, text: string): string {
  return `${personaSlug(persona)}:${gender}:${slug}:${textFingerprint(text)}`;
}

function fileFor(slug: string, gender: Gender, persona: string, text: string): File {
  return new File(
    Paths.cache,
    `offline_voice_${personaSlug(persona)}_${gender}_${slug}_${textFingerprint(text)}.mp3`,
  );
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
export function resolveCachedOfflineClipUri(text: string, gender: Gender, persona: string): string | null {
  const line = TEXT_TO_LINE.get(norm(text));
  if (!line) return null;
  if (!cachedKeys.has(cacheKey(line.slug, gender, persona, line.text))) return null;
  return fileFor(line.slug, gender, persona, line.text).uri;
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
      const key = cacheKey(line.slug, gender, persona, line.text);
      if (cachedKeys.has(key)) continue;
      const file = fileFor(line.slug, gender, persona, line.text);
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
    /**
     * 2026-08-12 — delete clips whose wording has since changed.
     *
     * Fingerprinting the filename stops a stale clip being PLAYED, but the old mp3 still sits in the
     * cache directory. On Tim's phone that file is a recording of a sentence he asked us to stop
     * saying six days ago, so leaving it there is both waste and a landmine for the next person who
     * reads the cache folder and believes the app still says it. Sweep anything matching our naming
     * scheme that isn't in the CURRENT expected set — across personas and genders, since a persona
     * switch orphans clips too.
     */
    try {
      const expected = new Set<string>();
      for (const g of ['male', 'female'] as Gender[]) {
        for (const l of OFFLINE_LINES) expected.add(fileFor(l.slug, g, persona, l.text).name);
      }
      // 2026-08-12 — readDirectoryAsync, not Paths.cache.list(): the latter was used exactly once
      // here (by me, today) and nowhere else in the app, so it was unproven on this engine. This is
      // the pattern clipStorageGc already uses successfully.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const FS = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
      const dir = FS.cacheDirectory;
      if (dir) {
        const names = await FS.readDirectoryAsync(dir).catch(() => [] as string[]);
        for (const name of names) {
          if (!name.startsWith(`offline_voice_${personaSlug(persona)}_`) || !name.endsWith('.mp3')) continue;
          if (expected.has(name)) continue;
          await FS.deleteAsync(dir + name, { idempotent: true }).catch(() => { /* locked file is harmless */ });
        }
      }
    } catch { /* listing unavailable — the fingerprint alone already prevents stale playback */ }
  })().finally(() => { warmInFlight = null; });
  return warmInFlight;
}

/** Test-only: reset in-memory cache registry. */
export function __resetOfflineVoiceCache(): void {
  cachedKeys.clear();
}

/** Test seam: register a slug as cached (used to assert resolve behavior without disk/network). */
export function __markCachedForTest(slug: string, gender: Gender, persona = 'kevin'): void {
  // Look the CURRENT text up by slug so a test registration carries the same fingerprint the resolve
  // path computes — otherwise the seam would register a key that can never be hit.
  const line = OFFLINE_LINES.find((l) => l.slug === slug);
  if (!line) return;
  cachedKeys.add(cacheKey(slug, gender, persona, line.text));
}
