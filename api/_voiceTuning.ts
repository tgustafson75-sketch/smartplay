/**
 * 2026-05-21 — Consolidation 1 / Merge B: shared persona voice tuning.
 *
 * The persona-keyed ElevenLabs voice IDs and per-persona voice_settings
 * lived in TWO places (api/voice.ts and api/kevin.ts) — the second
 * copy was added when api/kevin gained persona-aware TTS in Fix A
 * (`a63d1b3`) and was a literal paste rather than an import. Drift
 * risk: anyone tuning a persona would touch one file and forget the
 * other (which is how Tim's "wrong voice for non-Kevin persona" bug
 * happened in the first place).
 *
 * Single source of truth now lives here. Both endpoints import from
 * this file. No behavior change vs the pre-merge state — both files
 * had byte-identical maps; this just guarantees they stay that way.
 *
 * NOTE: lives in /api as a leading-underscore module by Vercel
 * convention — Vercel treats files starting with `_` as private
 * helpers, never as routes. Co-locating with the consumers keeps
 * the deploy boundary obvious.
 */

// Persona-keyed ElevenLabs voice IDs. Language-agnostic for English;
// for ES/ZH the multilingual model is selected at request time
// (`eleven_multilingual_v2`). Voice IDs themselves don't change.
export const KEVIN_VOICE_ID  = '1fz2mW1imKTf5Ryjk5su';
export const SERENA_VOICE_ID = 'RGb96Dcl0k5eVje8EBch';
export const HARRY_VOICE_ID  = '5Jfxy1x2Df4No3LQBZXE';
export const TANK_VOICE_ID   = 'gQOVuaEi4cxS2vkZAK3A';

export const ELEVEN_VOICES_BY_PERSONA: Record<string, string> = {
  kevin:  KEVIN_VOICE_ID,
  serena: SERENA_VOICE_ID,
  harry:  HARRY_VOICE_ID,
  tank:   TANK_VOICE_ID,
};

// Phase 408 — per-caddie voice tuning. Replaces the prior flat
// { stability: 0.5, similarity_boost: 0.75 } that produced a uniform
// slow-neutral delivery across all four personas. Each caddie now
// has tuned values that target their character:
//   Kevin  — warm, faster, upbeat (lower stability, lifted style)
//   Serena — confident, faster, energetic-professional
//   Tank   — intense, fast, commanding (low stability, high style)
//   Harry  — measured wisdom with quiet energy (high stability,
//            low style)
// speaker_boost is on for all four for cleaner output on mobile
// audio. These values are the Phase 408 starting points; empirical
// listening passes on the Z Fold inform follow-up adjustments.
export type ElevenSettings = {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
};

export const ELEVEN_SETTINGS_BY_PERSONA: Record<string, ElevenSettings> = {
  kevin:  { stability: 0.45, similarity_boost: 0.75, style: 0.55, use_speaker_boost: true },
  serena: { stability: 0.50, similarity_boost: 0.75, style: 0.50, use_speaker_boost: true },
  tank:   { stability: 0.35, similarity_boost: 0.70, style: 0.70, use_speaker_boost: true },
  harry:  { stability: 0.65, similarity_boost: 0.80, style: 0.30, use_speaker_boost: true },
};

// Fallback for legacy callers passing only gender (no persona) —
// uses Kevin's tuning since the legacy fallback voice IDs are also
// Kevin's.
export const ELEVEN_SETTINGS_DEFAULT: ElevenSettings = ELEVEN_SETTINGS_BY_PERSONA.kevin;

// Legacy gender_lang map — back-compat fallback for /api/voice
// callers that haven't been updated to pass `persona`.
export const ELEVEN_VOICES_BY_GENDER: Record<string, string> = {
  male_en:   KEVIN_VOICE_ID,
  female_en: SERENA_VOICE_ID,
  male_es:   KEVIN_VOICE_ID,
  female_es: SERENA_VOICE_ID,
  male_zh:   KEVIN_VOICE_ID,
  female_zh: SERENA_VOICE_ID,
};
