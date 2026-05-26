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
    const { text, gender = 'male', language = 'en', persona = null, model_id: clientModelId = null } = req.body;

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
        // 2026-05-26 — Fix AY: prefer client-provided model_id when sent,
        // and DEFAULT to eleven_multilingual_v2 for English (was
        // eleven_turbo_v2). Turbo is ~25% faster but doesn't reliably
        // render every voice in the persona catalog — Tank/Serena/Harry
        // showed up degraded or silent on splash for some users. The
        // multilingual model handles every voice ID we have, costs us a
        // small latency hit, and removes a class of "non-Kevin intro
        // silently fails" reports.
        const model = (typeof clientModelId === 'string' && clientModelId.length > 0)
          ? clientModelId
          : 'eleven_multilingual_v2';
        // Phase 408 — per-persona voice settings. See
        // ELEVEN_SETTINGS_BY_PERSONA above for the tuning rationale.
        const voiceSettings =
          ELEVEN_SETTINGS_BY_PERSONA[personaKey] ?? ELEVEN_SETTINGS_DEFAULT;

        // 2026-05-22 — Latency optimization (no regression).
        // optimize_streaming_latency=2 trades a tiny amount of quality
        // for ~25% faster synthesis on the ElevenLabs side. Level 2 is
        // the documented sweet spot for short spoken-word responses
        // (caddie lines, briefings, per-hole intros); levels 3-4 start
        // to affect intonation noticeably and aren't worth it for the
        // 2-3 second clips this endpoint generates. Query param is
        // ignored by ElevenLabs if unrecognized — safe degradation
        // path. The OpenAI fallback below is unchanged.
        const elevenRes = await fetch(
          'https://api.elevenlabs.io/v1/text-to-speech/' + voiceId + '?optimize_streaming_latency=2',
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
          // instead of silently failing the player. Lockstep with
          // app/api/voice+api.ts.
          // 2026-05-26 — Fix AY: bumped suspicious-payload threshold
          // 1000 → 5000 bytes. A real intro mp3 (~5s) is 40-80KB, so 5KB
          // is conservative. ElevenLabs error JSON blobs (quota / model
          // × voice mismatch / unsupported language) sometimes exceed
          // 1KB when the error message is verbose, slipping past the
          // old gate as "audio" and playing as silence on the client.
          if (audioBuffer.byteLength >= 5000) {
            console.log('[voice] ElevenLabs success', { bytes: audioBuffer.byteLength, language, persona, model });
            res.setHeader('Content-Type', 'audio/mpeg');
            return res.status(200).send(Buffer.from(audioBuffer));
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
