import OpenAI from 'openai';
import { KEVIN_TTS_INSTRUCTIONS } from '../../api/_kevinVoice';

// 2026-06-04 — Expo Router dev twin of api/voice.ts. ElevenLabs path
// removed in lockstep with api/voice.ts (same-day cleanup). OpenAI
// gpt-4o-mini-tts is the only TTS path. Persona → voice: nova for
// Serena, onyx for the rest.

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 25_000,
  maxRetries: 1,
});

const OPENAI_VOICES = {
  male:   'onyx'  as const,
  female: 'nova'  as const,
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, string | undefined>;
    const { text, gender = 'male', language = 'en', persona = '' } = body;

    if (!text) {
      return new Response(
        JSON.stringify({ error: 'No text' }),
        { status: 400 },
      );
    }

    console.log('[voice] generating:', text.slice(0, 50), persona || gender, language);

    // Persona maps to gender for OpenAI voice selection.
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
