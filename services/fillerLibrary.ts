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
let isGenerating = false;
// Round-robin counters per category — reset on app restart (acceptable)
const rrCounters: Partial<Record<FillerCategory, number>> = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function voiceHash(gender: string, language: string): string {
  return `${gender}_${language}_v1`;
}

function clipFile(id: string): File {
  return new File(Paths.cache, `${CLIP_PREFIX}${id}.mp3`);
}

async function loadFromStorage(): Promise<FillerLibrary | null> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    return json ? (JSON.parse(json) as FillerLibrary) : null;
  } catch {
    return null;
  }
}

async function saveToStorage(lib: FillerLibrary): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
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
  return isGenerating;
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
  gender: 'male' | 'female',
  language: 'en' | 'es' | 'zh',
): Promise<void> {
  if (isGenerating) return;

  const hash = voiceHash(gender, language);

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

  isGenerating = true;
  console.log('[filler] generating', FILLER_PHRASES.length, 'clips...');
  const clips: FillerClip[] = [];

  for (const phrase of FILLER_PHRASES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const res = await fetch(apiUrl + '/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ text: phrase.text, gender, language }),
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        console.log('[filler] clip generation failed:', phrase.id, res.status);
        continue;
      }

      const buf = await res.arrayBuffer();
      if (buf.byteLength < 100) {
        console.log('[filler] empty audio for:', phrase.id);
        continue;
      }

      const f = clipFile(phrase.id);
      f.write(new Uint8Array(buf));

      // Measure duration via expo-av
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
        // keep fallback
      }

      clips.push({
        id: phrase.id,
        category: phrase.category,
        text: phrase.text,
        duration_ms,
        audio_path: f.uri,
        generated_at: Date.now(),
      });

    } catch (err) {
      console.log('[filler] error generating clip:', phrase.id, err);
    }
  }

  const newLib: FillerLibrary = {
    clips,
    generated_at: Date.now(),
    voice_settings_hash: hash,
  };

  library = newLib;
  await saveToStorage(newLib);
  isGenerating = false;
  console.log('[filler] generation complete:', clips.length, '/', FILLER_PHRASES.length, 'clips');
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
