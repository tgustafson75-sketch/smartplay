import OpenAI from 'openai';
import { KEVIN_TTS_INSTRUCTIONS } from '../../api/_kevinVoice';
// 2026-05-26 — Fix BQ: centralized voice tuning. Was duplicated by
// hand in this file vs api/_voiceTuning.ts → silent drift risk if
// one was updated and the other forgotten (Tank intro plays Kevin's
// voice on the local Expo Router path). Now both /api/voice.ts
// (Vercel) and this Expo Router twin import from a single source
// of truth. Change voice IDs / settings in _voiceTuning.ts, both
// endpoints get the update.
import {
  ELEVEN_VOICES_BY_PERSONA,
  ELEVEN_VOICES_BY_GENDER,
  ELEVEN_SETTINGS_BY_PERSONA,
  ELEVEN_SETTINGS_DEFAULT,
  KEVIN_VOICE_ID,
} from '../../api/_voiceTuning';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 25_000,
  maxRetries: 1,
});

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;

const OPENAI_VOICES = {
  male:   'onyx'  as const,
  female: 'nova'  as const,
};

const resolveVoiceId = (persona: string | null | undefined, gender: string, language: string): string => {
  const personaKey = typeof persona === 'string' ? persona.toLowerCase() : '';
  return (
    ELEVEN_VOICES_BY_PERSONA[personaKey] ??
    ELEVEN_VOICES_BY_GENDER[gender + '_' + language] ??
    KEVIN_VOICE_ID
  );
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, string | undefined>;
    const { text, gender = 'male', language = 'en', persona = '', model_id } = body;

    if (!text) {
      return new Response(
        JSON.stringify({ error: 'No text' }),
        { status: 400 },
      );
    }

    console.log('[voice] generating:', text.slice(0, 50), persona || gender, language);

    // Try ElevenLabs first
    if (ELEVENLABS_KEY) {
      try {
        const voiceId = resolveVoiceId(persona, gender, language);
        // 2026-05-24 — Prefer client-provided model_id (carries the
        // detected utterance language) over the language-based
        // fallback. Older clients that omit model_id still resolve to
        // the same monolingual/multilingual pair.
        // 2026-05-26 — Fix AY: default English to eleven_multilingual_v2
        // (was eleven_monolingual_v1). Multilingual reliably renders
        // every voice ID in our persona catalog (Kevin/Serena/Harry/Tank);
        // monolingual_v1 was the original Eleven model and isn't
        // guaranteed for newer voice IDs. Client-provided model_id
        // still wins so callers can override.
        const model = model_id ?? (language === 'en'
          ? 'eleven_multilingual_v2'
          : 'eleven_multilingual_v2');
        // Phase 408 — per-persona voice settings.
        const personaKey = typeof persona === 'string' ? persona.toLowerCase() : '';
        const voiceSettings = ELEVEN_SETTINGS_BY_PERSONA[personaKey] ?? ELEVEN_SETTINGS_DEFAULT;

        const elevenRes = await fetch(
          'https://api.elevenlabs.io/v1/text-to-speech/' + voiceId,
          {
            method: 'POST',
            headers: {
              'xi-api-key': ELEVENLABS_KEY,
              'Content-Type': 'application/json',
              'Accept': 'audio/mpeg',
            },
            body: JSON.stringify({
              text,
              model_id: model,
              voice_settings: voiceSettings,
            }),
          },
        );

        if (elevenRes.ok) {
          const audioBuffer = await elevenRes.arrayBuffer();
          // 2026-05-24 — User-reported: all personas silent in Spanish.
          // ElevenLabs sometimes returns 200 with an error JSON payload
          // (quota issues, invalid model_id × voice combos, voice not
          // supporting the language) that's <1KB. Client previously
          // forwarded that as "audio," failed its own >100 byte check,
          // and played silence. Validate before returning so non-English
          // requests fall through to OpenAI TTS (which DOES speak ES/ZH)
          // instead of silently failing the player.
          // 2026-05-26 — Fix AY: 1000 → 5000 bytes. Lockstep with
          // api/voice.ts — see comment there for rationale (real intro
          // mp3 is 40-80KB so 5KB is conservative; ElevenLabs verbose
          // error blobs occasionally exceed 1KB and slip past as silence).
          if (audioBuffer.byteLength >= 5000) {
            console.log('[voice] ElevenLabs success', { bytes: audioBuffer.byteLength, language, persona, model });
            return new Response(audioBuffer, {
              headers: { 'Content-Type': 'audio/mpeg' },
            });
          }
          console.log('[voice] ElevenLabs returned suspiciously small payload — falling back to OpenAI', {
            bytes: audioBuffer.byteLength, language, persona, model,
          });
        } else {
          console.log('[voice] ElevenLabs failed:', elevenRes.status, '— falling back to OpenAI');
        }

      } catch (elevenErr) {
        console.log('[voice] ElevenLabs error:', elevenErr, '— falling back to OpenAI');
      }
    }

    // OpenAI TTS fallback — gpt-4o-mini-tts with caddie tone for consistent voice.
    // Persona maps to gender for OpenAI voice selection (no per-persona OpenAI
    // voices today; ElevenLabs differentiates).
    const effectiveGender =
      persona === 'serena' ? 'female'
      : persona === 'kevin' || persona === 'harry' || persona === 'tank' ? 'male'
      : gender;
    const voice = effectiveGender === 'female' ? OPENAI_VOICES.female : OPENAI_VOICES.male;

    const mp3 = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice,
      input: text,
      instructions: KEVIN_TTS_INSTRUCTIONS,
    });

    const audioBuffer = await mp3.arrayBuffer();
    console.log('[voice] OpenAI TTS success');

    return new Response(audioBuffer, {
      headers: { 'Content-Type': 'audio/mpeg' },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[voice] error:', msg);
    return new Response(
      JSON.stringify({ error: 'Voice generation failed' }),
      { status: 500 },
    );
  }
}
