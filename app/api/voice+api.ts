import OpenAI from 'openai';
import { KEVIN_TTS_INSTRUCTIONS } from '../../api/_kevinVoice';

// 2026-06-04 — Expo Router dev twin of api/voice.ts. Keep this in
// lockstep with the canonical route so local dev and production sound
// the same. OpenAI gpt-4o-mini-tts is the only TTS path.

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 25_000,
  maxRetries: 1,
});

const OPENAI_VOICES = {
  male:   'onyx'  as const,
  female: 'nova'  as const,
};

// 2026-06-04 — Per-persona TTS voices. Tank and Harry need their own
// timbre so switching caddies actually sounds different in dev builds.
// Falls back to the gender map below for any unknown persona.
const OPENAI_VOICES_BY_PERSONA: Record<string, 'alloy' | 'ash' | 'coral' | 'echo' | 'fable' | 'nova' | 'onyx' | 'sage' | 'shimmer' | 'verse'> = {
  kevin:  'onyx',
  serena: 'nova',
  tank:   'ash',
  harry:  'fable',
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

    // Persona takes priority so each caddie keeps a distinct voice in
    // the Expo dev server, not just a shared male/female bucket.
    const personaKeyTts = typeof persona === 'string' ? persona.toLowerCase() : '';
    const personaVoice = OPENAI_VOICES_BY_PERSONA[personaKeyTts];
    const voice = personaVoice ?? (gender === 'female' ? OPENAI_VOICES.female : OPENAI_VOICES.male);

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
