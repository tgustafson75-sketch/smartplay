import OpenAI from 'openai';
import { KEVIN_TTS_INSTRUCTIONS } from '../../api/_kevinVoice';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;

// Persona-keyed ElevenLabs voice IDs.
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

// Legacy gender_lang fallback for callers that haven't been updated to pass `persona`.
const ELEVEN_VOICES_BY_GENDER: Record<string, string> = {
  male_en:   KEVIN_VOICE_ID,
  female_en: SERENA_VOICE_ID,
  male_es:   KEVIN_VOICE_ID,
  female_es: SERENA_VOICE_ID,
  male_zh:   KEVIN_VOICE_ID,
  female_zh: SERENA_VOICE_ID,
};

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
    const body = await request.json() as Record<string, string>;
    const { text, gender = 'male', language = 'en', persona = '' } = body;

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
        const model = language === 'en'
          ? 'eleven_monolingual_v1'
          : 'eleven_multilingual_v2';

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
          return new Response(audioBuffer, {
            headers: { 'Content-Type': 'audio/mpeg' },
          });
        }

        console.log('[voice] ElevenLabs failed:', elevenRes.status, '— falling back to OpenAI');

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
