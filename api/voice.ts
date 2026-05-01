import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { KEVIN_TTS_INSTRUCTIONS } from './_kevinVoice';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;

const ELEVEN_VOICES: Record<string, string> = {
  male_en:   '1fz2mW1imKTf5Ryjk5su',
  female_en: 'RGb96Dcl0k5eVje8EBch',
  male_es:   '1fz2mW1imKTf5Ryjk5su',
  female_es: 'RGb96Dcl0k5eVje8EBch',
  male_zh:   '1fz2mW1imKTf5Ryjk5su',
  female_zh: 'RGb96Dcl0k5eVje8EBch',
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
    const { text, gender = 'male', language = 'en' } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'No text' });
    }

    console.log('[voice] generating:', String(text).slice(0, 50), gender);

    // Try ElevenLabs first
    if (ELEVENLABS_KEY) {
      try {
        const voiceKey = gender + '_' + language;
        const voiceId = ELEVEN_VOICES[voiceKey] ?? ELEVEN_VOICES['male_en'] ?? '';
        const model = language === 'en' ? 'eleven_turbo_v2' : 'eleven_multilingual_v2';

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
              voice_settings: { stability: 0.5, similarity_boost: 0.75 },
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

    // OpenAI TTS fallback — use gpt-4o-mini-tts with Kevin tone for consistent voice
    const voice = gender === 'female' ? OPENAI_VOICES.female : OPENAI_VOICES.male;

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
