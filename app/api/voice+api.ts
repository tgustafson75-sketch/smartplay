import OpenAI from 'openai';

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
  male:   'onyx'  as const,
  female: 'nova'  as const,
};

const getElevenVoiceId = (gender: string, language: string): string =>
  ELEVEN_VOICES[gender + '_' + language] ?? ELEVEN_VOICES['male_en'] ?? '';

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, string>;
    const { text, gender = 'male', language = 'en' } = body;

    if (!text) {
      return new Response(
        JSON.stringify({ error: 'No text' }),
        { status: 400 },
      );
    }

    console.log('[voice] generating:', text.slice(0, 50), gender, language);

    // Try ElevenLabs first
    if (ELEVENLABS_KEY) {
      try {
        const voiceId = getElevenVoiceId(gender, language);
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

    // OpenAI TTS fallback
    const voice = gender === 'female' ? OPENAI_VOICES.female : OPENAI_VOICES.male;

    const mp3 = await openai.audio.speech.create({
      model: 'tts-1-hd',
      voice,
      input: text,
      speed: 1.0,
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
