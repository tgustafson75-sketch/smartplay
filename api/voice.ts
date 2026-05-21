import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { KEVIN_TTS_INSTRUCTIONS } from './_kevinVoice';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;

// 2026-05-21 — Consolidation 1 / Merge B: persona voice tuning moved
// to api/_voiceTuning.ts so /api/voice and /api/kevin share the same
// source of truth. No behavior change — same IDs, same settings, same
// fallback.
import {
  ELEVEN_VOICES_BY_PERSONA,
  ELEVEN_SETTINGS_BY_PERSONA,
  ELEVEN_SETTINGS_DEFAULT,
  ELEVEN_VOICES_BY_GENDER,
  KEVIN_VOICE_ID,
} from './_voiceTuning';

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
