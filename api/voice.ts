import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { KEVIN_TTS_INSTRUCTIONS } from './_kevinVoice';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;

// Persona-keyed ElevenLabs voice IDs. Each voice ID is language-agnostic
// for English; for ES/ZH the multilingual model is used at request time.
const KEVIN_VOICE_ID  = '1fz2mW1imKTf5Ryjk5su';
const SERENA_VOICE_ID = 'RGb96Dcl0k5eVje8EBch';
const HARRY_VOICE_ID  = '5Jfxy1x2Df4No3LQBZXE';
const TANK_VOICE_ID   = 'gQOVuaEi4cxS2vkZAK3A';

const ELEVEN_VOICES_BY_PERSONA: Record<string, string> = {
  kevin:  KEVIN_VOICE_ID,
  serena: SERENA_VOICE_ID,
  harry:  HARRY_VOICE_ID,
  tank:   TANK_VOICE_ID,
};

// Phase 408 — per-caddie voice tuning. Replaces the prior flat
// { stability: 0.5, similarity_boost: 0.75 } that produced a uniform
// slow-neutral delivery across all four personas. Each caddie now has
// tuned values that target their character:
//   Kevin  — warm, faster, upbeat (lower stability, lifted style)
//   Serena — confident, faster, energetic-professional
//   Tank   — intense, fast, commanding (low stability, high style)
//   Harry  — measured wisdom with quiet energy (high stability, low style)
// speaker_boost is on for all four for cleaner output on mobile audio.
// These values are the Phase 408 starting points; empirical listening
// passes on the Z Fold inform follow-up adjustments.
type ElevenSettings = {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
};

const ELEVEN_SETTINGS_BY_PERSONA: Record<string, ElevenSettings> = {
  kevin:  { stability: 0.45, similarity_boost: 0.75, style: 0.55, use_speaker_boost: true },
  serena: { stability: 0.50, similarity_boost: 0.75, style: 0.50, use_speaker_boost: true },
  tank:   { stability: 0.35, similarity_boost: 0.70, style: 0.70, use_speaker_boost: true },
  harry:  { stability: 0.65, similarity_boost: 0.80, style: 0.30, use_speaker_boost: true },
};

// Fallback for legacy callers passing only gender (no persona) — uses
// Kevin's tuning since the legacy fallback voice IDs are also Kevin's.
const ELEVEN_SETTINGS_DEFAULT: ElevenSettings = ELEVEN_SETTINGS_BY_PERSONA.kevin;

// Legacy gender_lang map — back-compat fallback for callers that haven't
// been updated to pass `persona`.
const ELEVEN_VOICES_BY_GENDER: Record<string, string> = {
  male_en:   KEVIN_VOICE_ID,
  female_en: SERENA_VOICE_ID,
  male_es:   KEVIN_VOICE_ID,
  female_es: SERENA_VOICE_ID,
  male_zh:   KEVIN_VOICE_ID,
  female_zh: SERENA_VOICE_ID,
};

const OPENAI_VOICES = {
  male:   'onyx' as const,
  female: 'nova' as const,
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text, gender = 'male', language = 'en', persona = null } = req.body;

    // Audit 101 / B3 — validate text before passing to TTS providers. Without
    // this, a 10MB string burns ElevenLabs quota; non-strings throw inside
    // the SDK calls. Cap at 4000 chars (well above any caddie utterance the
    // app generates — typical max is ~600 chars for full Kevin responses).
    if (!text || typeof text !== 'string' || text.length === 0) {
      return res.status(400).json({ error: 'No text' });
    }
    if (text.length > 4000) {
      return res.status(413).json({ error: 'Text too long', max: 4000 });
    }

    console.log('[voice] generating:', text.slice(0, 50), persona ?? gender);

    // Try ElevenLabs first
    if (ELEVENLABS_KEY) {
      try {
        // Persona-keyed lookup wins; fall back to gender_lang for legacy callers.
        const personaKey = typeof persona === 'string' ? persona.toLowerCase() : '';
        const voiceId =
          ELEVEN_VOICES_BY_PERSONA[personaKey] ??
          ELEVEN_VOICES_BY_GENDER[gender + '_' + language] ??
          KEVIN_VOICE_ID;
        const model = language === 'en' ? 'eleven_turbo_v2' : 'eleven_multilingual_v2';
        // Phase 408 — per-persona voice settings. See
        // ELEVEN_SETTINGS_BY_PERSONA above for the tuning rationale.
        const voiceSettings =
          ELEVEN_SETTINGS_BY_PERSONA[personaKey] ?? ELEVEN_SETTINGS_DEFAULT;

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
          console.log('[voice] ElevenLabs success');
          res.setHeader('Content-Type', 'audio/mpeg');
          return res.status(200).send(Buffer.from(audioBuffer));
        }

        console.log('[voice] ElevenLabs failed:', elevenRes.status, '— falling back to OpenAI');

      } catch (elevenErr) {
        console.log('[voice] ElevenLabs error:', elevenErr, '— falling back to OpenAI');
      }
    }

    // OpenAI TTS fallback — use gpt-4o-mini-tts with caddie tone for consistent voice.
    // Persona maps to gender for the OpenAI fallback (Kevin/Harry/Tank → male,
    // Serena → female). Until OpenAI exposes more distinct male voices, all
    // three male personas share onyx — only ElevenLabs differentiates them.
    const effectiveGender =
      persona === 'serena' ? 'female'
      : persona === 'kevin' || persona === 'harry' || persona === 'tank' ? 'male'
      : gender;
    const voice = effectiveGender === 'female' ? OPENAI_VOICES.female : OPENAI_VOICES.male;

    const mp3 = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice,
      input: String(text),
      instructions: KEVIN_TTS_INSTRUCTIONS,
    });

    const audioBuffer = await mp3.arrayBuffer();
    console.log('[voice] OpenAI TTS success');

    res.setHeader('Content-Type', 'audio/mpeg');
    return res.status(200).send(Buffer.from(audioBuffer));

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[voice] error:', msg);
    return res.status(500).json({ error: 'Voice generation failed' });
  }
}
