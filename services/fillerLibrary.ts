import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { File, Paths } from 'expo-file-system';
import { FILLER_PHRASES } from '../constants/fillerPhrases';
import type { FillerCategory, FillerClip, FillerLibrary } from '../types/filler';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'filler_library_v1';
const CLIP_PREFIX = 'filler_clip_';

// ─── Module state ─────────────────────────────────────────────────────────────

let library: FillerLibrary | null = null;
// Audit 101 / S2 — replaced `isGenerating: boolean` with an in-flight
// Promise. Concurrent callers (cold launch + persona switch racing) now
// share the same generation pass instead of one early-exiting and the
// other clobbering state mid-flight (TOCTOU race on the dual
// allFilesExist() checks).
let inFlight: Promise<void> | null = null;
// Round-robin counters per category — reset on app restart (acceptable)
const rrCounters: Partial<Record<FillerCategory, number>> = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Persona = 'kevin' | 'serena' | 'harry' | 'tank';

function voiceHash(persona: Persona, language: string): string {
  // v4 = persona-keyed (was gender-keyed in v3). All male personas
  // (Kevin/Harry/Tank) used to share the same male_<lang>_v3 cache,
  // which meant Tank/Harry users heard Kevin's filler clips. v4
  // keys each persona separately so each character has their own
  // ElevenLabs-rendered filler set.
  return `${persona}_${language}_v4`;
}

function clipFile(id: string): File {
  return new File(Paths.cache, `${CLIP_PREFIX}${id}.mp3`);
}

async function loadFromStorage(): Promise<FillerLibrary | null> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    return json ? (JSON.parse(json) as FillerLibrary) : null;
  } catch (err) {
    // Audit follow-up (2026-05-13) — was silently swallowing. Log so a
    // corrupted/unreadable filler cache shows up in console rather than
    // mysteriously producing empty libraries with no clue why.
    // Returning null is intentional: caller (initFillerLibrary +
    // generateLibrary) treats null as "no cache yet, regenerate."
    console.warn('[filler] loadFromStorage failed:', err);
    return null;
  }
}

async function saveToStorage(lib: FillerLibrary): Promise<void> {
  // Audit 101 / S5 — caller may continue if storage write fails; we log
  // and re-throw so generateLibrary can keep the in-memory cache from
  // diverging from disk (S3 — save-before-flip discipline).
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
  } catch (err) {
    console.warn('[filler] saveToStorage failed:', err);
    throw err;
  }
}

function allFilesExist(lib: FillerLibrary): boolean {
  return lib.clips.every(c => clipFile(c.id).exists);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Load cached library into memory on app start. Call once — idempotent. */
export async function initFillerLibrary(): Promise<void> {
  if (library) return;
  const cached = await loadFromStorage();
  if (cached && allFilesExist(cached)) {
    library = cached;
    console.log('[filler] library loaded from cache:', cached.clips.length, 'clips');
  } else if (cached) {
    // Index exists but audio files were purged from cache — reset so regeneration triggers
    await AsyncStorage.removeItem(STORAGE_KEY);
    console.log('[filler] cache miss — audio files gone, will regenerate');
  }
}

export function isLibraryGenerated(): boolean {
  return library !== null && library.clips.length > 0;
}

export function isLibraryGenerating(): boolean {
  return inFlight !== null;
}

export function getLibraryInfo(): { clipCount: number; generatedAt: number; hash: string } | null {
  if (!library) return null;
  return {
    clipCount: library.clips.length,
    generatedAt: library.generated_at,
    hash: library.voice_settings_hash,
  };
}

/**
 * Generate and cache all filler clips. Safe to call fire-and-forget.
 * Skips if already generated with matching voice settings. Idempotent.
 */
export async function generateLibrary(
  apiUrl: string,
  persona: Persona,
  language: 'en' | 'es' | 'zh',
): Promise<void> {
  // Audit 101 / S2 — promise-based mutex: concurrent callers share the
  // single in-flight generation. Returning the same Promise means second
  // caller's `await` resolves when the first finishes.
  if (inFlight) return inFlight;

  inFlight = doGenerate(apiUrl, persona, language).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doGenerate(
  apiUrl: string,
  persona: Persona,
  language: 'en' | 'es' | 'zh',
): Promise<void> {
  const hash = voiceHash(persona, language);
  // Derive gender for the OpenAI fallback in /api/voice (back-compat).
  // ElevenLabs picks by persona directly; gender only matters when
  // ElevenLabs is unavailable.
  const gender: 'male' | 'female' = persona === 'serena' ? 'female' : 'male';

  // Check if already valid
  if (library && library.voice_settings_hash === hash && allFilesExist(library)) {
    console.log('[filler] library already up to date');
    return;
  }

  // Re-check storage in case another run persisted since initFillerLibrary
  const cached = await loadFromStorage();
  if (cached && cached.voice_settings_hash === hash &&
      cached.clips.length === FILLER_PHRASES.length && allFilesExist(cached)) {
    library = cached;
    console.log('[filler] library loaded from storage after re-check');
    return;
  }

  console.log('[filler] generating', FILLER_PHRASES.length, 'clips...');

  // Audit 101 / W3 — parallelize TTS fetches with a concurrency cap.
  // Prior code processed each phrase serially: ~40 phrases × ~1-2s
  // ElevenLabs roundtrip = 30-60s observed cold-launch lag on persona
  // switch. Pool of 4 concurrent fetches cuts this to ~5-10s while
  // staying well under any per-IP rate limit.
  const clips = await runWithConcurrency(
    FILLER_PHRASES,
    4,
    (phrase) => generateOneClip(phrase, persona, language, gender, apiUrl),
  );

  const newLib: FillerLibrary = {
    clips: clips.filter((c): c is FillerClip => c !== null),
    generated_at: Date.now(),
    voice_settings_hash: hash,
  };

  // Audit 101 / S3 — save BEFORE flipping in-memory. If save throws, the
  // in-memory cache stays at the prior state, which forces a clean
  // regeneration on the next call instead of a silent in-mem/persisted
  // divergence.
  try {
    await saveToStorage(newLib);
    library = newLib;
    console.log('[filler] generation complete:', newLib.clips.length, '/', FILLER_PHRASES.length, 'clips');
  } catch {
    // saveToStorage already logged the error; leave `library` untouched
    // so the next generateLibrary call retries from a clean state.
  }
}

// Generate a single filler clip. Returns null on any failure (keeps the
// pool moving — partial libraries are fine, the runtime falls back to
// synthesized speech for missing clip IDs).
async function generateOneClip(
  phrase: typeof FILLER_PHRASES[number],
  persona: Persona,
  language: string,
  gender: 'male' | 'female',
  apiUrl: string,
): Promise<FillerClip | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(apiUrl + '/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ text: phrase.text, gender, language, persona }),
    });
    if (!res.ok) {
      console.log('[filler] clip generation failed:', phrase.id, res.status);
      return null;
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 100) {
      console.log('[filler] empty audio for:', phrase.id);
      return null;
    }

    const f = clipFile(phrase.id);
    // Audit 101 / S4 — await the write (Promise.resolve handles both
    // sync and async write returns from expo-file-system).
    await Promise.resolve(f.write(new Uint8Array(buf)));

    let duration_ms = 1200;
    try {
      const { sound, status } = await Audio.Sound.createAsync(
        { uri: f.uri },
        { shouldPlay: false },
      );
      if (status.isLoaded && status.durationMillis) {
        duration_ms = status.durationMillis;
      }
      await sound.unloadAsync();
    } catch {
      // keep fallback duration
    }

    return {
      id: phrase.id,
      category: phrase.category,
      text: phrase.text,
      duration_ms,
      audio_path: f.uri,
      generated_at: Date.now(),
    };
  } catch (err) {
    console.log('[filler] error generating clip:', phrase.id, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Tiny concurrency limiter — N workers race through the queue.
async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Round-robin clip picker — returns null if library not ready or category empty.
 */
export function getClipForCategory(category: FillerCategory): FillerClip | null {
  if (!library) return null;
  const pool = library.clips.filter(c => c.category === category);
  if (pool.length === 0) return null;
  const idx = rrCounters[category] ?? 0;
  rrCounters[category] = (idx + 1) % pool.length;
  return pool[idx % pool.length];
}

// Phase V.7 — fallback used when the library hasn't finished regenerating
// (e.g. immediately after a voiceHash bump, where the cache is empty for
// ~30s while clips are TTS-generated). Returns a phrase text from the
// in-memory FILLER_PHRASES so the caller can speak it via the live TTS
// pipeline instead of falling silent.
const fallbackRR: Partial<Record<FillerCategory, number>> = {};
export function getFallbackTextForCategory(category: FillerCategory): string | null {
  const pool = FILLER_PHRASES.filter(p => p.category === category);
  if (pool.length === 0) return null;
  const idx = fallbackRR[category] ?? 0;
  fallbackRR[category] = (idx + 1) % pool.length;
  return pool[idx % pool.length].text;
}

/**
 * Delete all cached audio files and clear the library index. Used for regeneration
 * after voice settings change, or from the debug screen.
 */
export async function clearLibrary(): Promise<void> {
  if (library) {
    for (const clip of library.clips) {
      try {
        const f = clipFile(clip.id);
        if (f.exists) f.delete();
      } catch {}
    }
  }
  await AsyncStorage.removeItem(STORAGE_KEY);
  library = null;
  console.log('[filler] library cleared');
}

/** Classify a voice transcript into a filler category using keyword heuristics. */
export function classifyQuery(transcript: string): FillerCategory {
  const t = transcript.toLowerCase();

  if (
    t.includes('ghost') || t.includes('past me') || t.includes('match') ||
    t.includes('versus') || t.includes('vs ') || t.includes('against')
  ) return 'ghost';

  // Social: greetings and direct personal questions only.
  // Requests like "tell me a joke" fall through to conversational (they're chat, not greetings).
  if (
    t.includes('hey ') || t.includes('hi ') || t.includes('hello') ||
    t.includes('how are you') || t.includes('what\'s up') || t.includes('whats up')
  ) return 'social';

  if (
    t.includes('yard') || t.includes('club') || t.includes('iron') || t.includes('wood') ||
    t.includes('driver') || t.includes('wedge') || t.includes('putter') ||
    t.includes('shot') || t.includes('play') || t.includes('aim') ||
    t.includes('target') || t.includes('green') || t.includes('fairway') ||
    t.includes('how far') || t.includes('distance') || t.includes('pin') ||
    t.includes('flag') || t.includes('lay up') || t.includes('layup') ||
    t.includes('go for') || t.includes('carry')
  ) return 'tactical';

  return 'conversational';
}
