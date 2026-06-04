import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { KEVIN_TTS_INSTRUCTIONS } from './_kevinVoice';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });

// 2026-06-04 — ElevenLabs path removed. USE_ELEVENLABS had been
// hard-coded false since Fix CY (2026-05-26) after Tim's account
// hit a persistent 401. The dead branch was load-bearing for nothing
// but adding a failure surface. OpenAI gpt-4o-mini-tts is the
// confirmed winner; per-persona voice mapping below keeps the
// character distinction Tank/Serena/Harry/Kevin need.

const OPENAI_VOICES = {
  male:   'onyx' as const,
  female: 'nova' as const,
};

// 2026-05-26 — Fix DT/DU: per-persona OpenAI TTS voice mapping. Each
// voice picked to match the persona's character + age:
//   - kevin: onyx (deep, warm — middle-aged 'friend in the cart')
//   - serena: nova (clear, composed — professional female caddie)
//   - tank: ash (confident, expressive — high-intensity drill-sergeant)
//   - harry: fable (British male storyteller — natural older-mentor
//     gravitas; Tim reminded that Harry is an OLD guy, so the
//     grandfather/wise-counsel tone matters more than just 'calm').
// Falls through to gender-based default for any unknown persona.
const OPENAI_VOICES_BY_PERSONA: Record<string, 'alloy' | 'ash' | 'coral' | 'echo' | 'fable' | 'nova' | 'onyx' | 'sage' | 'shimmer' | 'verse'> = {
  kevin:  'onyx',
  serena: 'nova',
  tank:   'ash',
  harry:  'fable',
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2026-06-04 — Pre-warm. Client hits this endpoint with
  // { mode: 'warmup' } after splash completes so OpenAI TTS SDK +
  // network path are hot by the time the user actually taps to talk.
  //
  // Earlier shape (same-day) just returned 200 immediately, which
  // warmed the Lambda runtime but NOT the OpenAI SDK + TLS handshake
  // to api.openai.com — the dominant cold-start cost (~6-8s). This
  // version runs the full SDK path with a minimal single-space input
  // so the connection pool, auth, and first-call init are all hot.
  // Audio is discarded after arrayBuffer() consumption so the HTTP
  // connection releases back to the pool for the real speak() call.
  // Cost: ~$0.0001 per warmup (gpt-4o-mini-tts at ~$0.015/1000 chars,
  // ~5 chars including instructions overhead).
  if (req.body?.mode === 'warmup' || req.query?.mode === 'warmup') {
    try {
      const mp3 = await openai.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice: 'onyx',
        input: ' ',
        instructions: KEVIN_TTS_INSTRUCTIONS,
      });
      await mp3.arrayBuffer();
      console.log('[voice] warmup completed (OpenAI TTS SDK hot)');
    } catch (e) {
      // Silent — warmup failure never surfaces to the user. Worst
      // case is the user pays the cold-start cost on their first tap.
      console.log('[voice] warmup failed (non-fatal):', e instanceof Error ? e.message : String(e));
    }
    return res.status(200).json({ ok: true, mode: 'warmup' });
  }

  try {
    const { text, gender = 'male', language = 'en', persona = null, model_id: clientModelId = null } = req.body;

    // Audit 101 / B3 — validate text before passing to OpenAI TTS.
    // Non-strings throw inside the SDK; oversized strings burn cost
    // for no UX benefit. Cap at 4000 chars (well above any caddie
    // utterance the app generates — typical max is ~600 chars for
    // full Kevin responses).
    if (!text || typeof text !== 'string' || text.length === 0) {
      return res.status(400).json({ error: 'No text' });
    }
    if (text.length > 4000) {
      return res.status(413).json({ error: 'Text too long', max: 4000 });
    }

    console.log('[voice] generating:', text.slice(0, 50), persona ?? gender);

    // client model_id was an ElevenLabs-only param; ignored under
    // OpenAI TTS but kept in the body shape for caller compat.
    void clientModelId;

    // OpenAI gpt-4o-mini-tts — the only TTS path.
    // 2026-05-26 — Fix DB: per-persona voice mapping (was: shared onyx).
    // Falls back to gender-based default for unrecognized personas.
    const personaKeyTts = typeof persona === 'string' ? persona.toLowerCase() : '';
    const personaVoice = OPENAI_VOICES_BY_PERSONA[personaKeyTts];
    const voice = personaVoice
      ?? (gender === 'female' ? OPENAI_VOICES.female : OPENAI_VOICES.male);

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
