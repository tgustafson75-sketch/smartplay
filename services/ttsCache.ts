/**
 * 2026-06-05 — TTS audio cache.
 *
 * Persist successfully-fetched TTS bytes to local FS, keyed by a stable
 * hash of (persona, language, text). On subsequent calls for the same
 * key, play from cache without hitting the network. This is what makes
 * the greeting offline-safe for every persona AFTER the first successful
 * fetch — the user hears the correct persona voice instantly, even on
 * cellular dead zones.
 *
 * Storage strategy:
 *   - cache directory: <cache>/tts-cache/
 *   - filename: <key>.mp3 where key is a 16-char hex hash
 *   - existence check is the cache-hit signal (no AsyncStorage index)
 *   - Paths.cache survives app updates but the OS may evict under
 *     storage pressure; that's fine — next fetch repopulates.
 *
 * Storage budget: greetings are a small bounded set (~12 captions ×
 * 4 personas × 3 languages = ~144 files × ~45KB = ~6.5MB worst case).
 * If caller-side decisions ever extend caching beyond greetings,
 * revisit with a size-based LRU eviction policy.
 */

import { File, Directory, Paths } from 'expo-file-system';

const TTS_CACHE_DIR_NAME = 'tts-cache';

// 32-bit FNV-1a hash → 8-char hex. Stable, deterministic, no native dep.
// Collision rate at <1k entries is negligible for our use case (cache
// miss on collision just re-fetches; no correctness issue).
function hash32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Combine persona + language + text. Persona and language are short,
// text dominates. Hash twice (different seeds via separator) for a
// 16-char composite — well below realistic collision risk.
export function ttsCacheKey(persona: string | null, language: string, text: string): string {
  const norm = `${persona ?? 'null'}|${language}|${text}`;
  return hash32(norm) + hash32('salt' + norm);
}

function getCacheDir(): Directory {
  return new Directory(Paths.cache, TTS_CACHE_DIR_NAME);
}

function getCacheFile(key: string): File {
  return new File(getCacheDir(), `${key}.mp3`);
}

/** Read cached TTS bytes for a key. Returns null on miss. */
export async function readCachedTTS(key: string): Promise<Uint8Array | null> {
  try {
    const file = getCacheFile(key);
    // `.exists` is a sync property; `.bytes()` returns a Promise.
    // A throw at any step is treated as cache miss — caller re-fetches.
    if (!file.exists) return null;
    return await file.bytes();
  } catch (e) {
    console.log('[ttsCache] read failed (treating as miss):', e);
    return null;
  }
}

/** Write TTS bytes to cache. Creates the cache directory on first use. */
export function writeCachedTTS(key: string, bytes: Uint8Array): void {
  try {
    const dir = getCacheDir();
    if (!dir.exists) {
      dir.create({ intermediates: true, idempotent: true });
    }
    const file = getCacheFile(key);
    file.write(bytes);
  } catch (e) {
    // Cache write failure is non-fatal — next call just re-fetches.
    console.log('[ttsCache] write failed (non-fatal):', e);
  }
}
