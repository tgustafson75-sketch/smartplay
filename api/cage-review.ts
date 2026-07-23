import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCaddieName, type VoiceGender } from '../lib/persona';
import { allowInference } from './_inferLimit';
import { completeText, completeJSON, providerFromHeaderSafe, type AiProvider } from './_aiProvider';

// ─── Action: generate a caddie question for a shot ───────────────────────────

async function handleQuestion(body: Record<string, unknown>, provider: AiProvider): Promise<Record<string, unknown>> {
  const {
    clip_index = 0,
    total_clips = 1,
    session_date = 'unknown',
    detection_method = 'manual',
    position = 'middle',
    prior_labels = null,
    mode = 'quick',
    feel = null,
    shape = null,
    club = null,
    voiceGender = 'male',
    persona = null,
  } = body;
  // Audit 101 / B4 — prefer persona; fall back to voiceGender for legacy.
  const caddieName = getCaddieName(typeof persona === 'string' ? persona : (voiceGender as VoiceGender));

  const shotNum = (clip_index as number) + 1;
  const positionStr = position === 'early' ? 'early in the session' : position === 'late' ? 'late in the session' : 'mid-session';
  const clubStr = club ? `Club: ${club}. ` : '';
  const feelStr = feel ? `Feel: ${feel}. ` : '';
  const shapeStr = shape ? `Shape: ${shape}. ` : '';
  const priorStr = prior_labels ? `Already tagged: ${prior_labels}. ` : '';
  const modeDescription = mode === 'quick'
    ? 'Ask one direct question about contact quality and strike location. Short and casual. One sentence.'
    : mode === 'coach'
    ? 'Dig into this shot. Ask about what they were working on or what they felt. Conversational, curious. One or two sentences.'
    : 'Ask a quick question, but only about what is not already labeled.';

  const prompt = `You are ${caddieName}, a warm and observant golf caddie. You're reviewing a cage session with your player.

Shot ${shotNum} of ${total_clips} — ${positionStr}. Session from ${session_date}. Detected via ${detection_method}.
${clubStr}${feelStr}${shapeStr}${priorStr}

Mode: ${modeDescription}

Generate exactly one question to ask the player about this shot. Be casual, sound like a real conversation. No fluff. No "Hey" or opener phrases — just the question.`;

  const question = (await completeText(provider, 'fast', '', [{ role: 'user', content: prompt }], { maxTokens: 80, temperature: 0 })).trim() || 'How did that feel?';
  return { question };
}

// ─── Action: extract labels from a voice transcript ──────────────────────────

async function handleExtract(body: Record<string, unknown>, provider: AiProvider): Promise<Record<string, unknown>> {
  const transcript = String(body.transcript ?? '').trim().slice(0, 1000);
  if (!transcript) {
    return {
      labels: {
        strike_location: 'unknown',
        contact_quality: 'unknown',
        self_diagnosis: null,
        intent: null,
        mental_state: null,
        notable_phrases: [],
      },
    };
  }

  const prompt = `Extract structured shot data from this golf player's verbal response after hitting a shot.

Response: "${transcript}"

self_diagnosis: what they think caused the miss or made it good (e.g. "came over the top", "stayed behind it"), or null.
intent: what they were trying to do (e.g. "draw it", "just make solid contact"), or null.
mental_state: emotional/mental cue if mentioned (e.g. "felt rushed", "very confident"), or null.
notable_phrases: verbatim phrases worth remembering about their feel vocabulary (max 3).`;

  const extractSchema = {
    name: 'shot_labels',
    openai: {
      type: 'object',
      properties: {
        strike_location: { type: 'string', enum: ['sweet_spot', 'toe', 'heel', 'thin', 'fat', 'top', 'unknown'] },
        contact_quality: { type: 'string', enum: ['pure', 'solid', 'ok', 'mishit', 'unknown'] },
        self_diagnosis: { type: ['string', 'null'] },
        intent: { type: ['string', 'null'] },
        mental_state: { type: ['string', 'null'] },
        notable_phrases: { type: 'array', items: { type: 'string' } },
      },
      required: ['strike_location', 'contact_quality', 'self_diagnosis', 'intent', 'mental_state', 'notable_phrases'],
      additionalProperties: false,
    },
    gemini: {
      type: 'OBJECT',
      properties: {
        strike_location: { type: 'STRING', enum: ['sweet_spot', 'toe', 'heel', 'thin', 'fat', 'top', 'unknown'] },
        contact_quality: { type: 'STRING', enum: ['pure', 'solid', 'ok', 'mishit', 'unknown'] },
        self_diagnosis: { type: 'STRING', nullable: true },
        intent: { type: 'STRING', nullable: true },
        mental_state: { type: 'STRING', nullable: true },
        notable_phrases: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['strike_location', 'contact_quality', 'self_diagnosis', 'intent', 'mental_state', 'notable_phrases'],
    },
  };

  const raw = await completeJSON(provider, 'fast', '', [{ role: 'user', content: prompt }], { maxTokens: 200, temperature: 0, schema: extractSchema });

  try {
    const labels = JSON.parse(raw) as Record<string, unknown>;
    return { labels };
  } catch {
    return {
      labels: {
        strike_location: 'unknown',
        contact_quality: 'unknown',
        self_diagnosis: null,
        intent: null,
        mental_state: null,
        notable_phrases: [],
      },
    };
  }
}

// ─── Action: build vocabulary profile from session transcripts ────────────────

async function handleVocab(body: Record<string, unknown>, provider: AiProvider): Promise<Record<string, unknown>> {
  const rawTranscripts = (body.transcripts as string[]) ?? [];
  const transcripts = rawTranscripts.slice(0, 20).map(t => String(t).slice(0, 200));
  const total_reviewed = Number(body.total_reviewed ?? rawTranscripts.length);
  // Audit 101 / B4 — prefer body.persona; fall back to body.voiceGender for legacy.
  const caddieName = getCaddieName(
    typeof body.persona === 'string'
      ? (body.persona as string)
      : ((body.voiceGender as VoiceGender | undefined) ?? 'male'),
  );

  if (transcripts.length === 0) {
    return {
      observed_terminology: { strike_terms: [], contact_terms: [], diagnostic_terms: [], feel_terms: [] },
      kevin_summary: 'Good work getting through those.',
      total_clips_reviewed: total_reviewed,
    };
  }

  const combined = transcripts.join(' | ');

  const prompt = `You are analyzing a golfer's vocabulary from a cage (practice) session review.

Their responses across ${total_reviewed} shots: "${combined}"

observed_terminology arrays:
- strike_terms: words they use to describe where they hit the face (e.g. "heel", "toe", "pure", "off the middle")
- contact_terms: words for quality of contact (e.g. "flush", "chunked", "thin", "caught it fat")
- diagnostic_terms: cause/effect language (e.g. "came over it", "stayed behind", "early release")
- feel_terms: sensation words (e.g. "heavy", "light", "rushed", "stuck")

kevin_summary: 1-2 sentences ${caddieName} would say about what they heard. Warm, observant, not preachy.
total_clips_reviewed: ${total_reviewed}`;

  const vocabSchema = {
    name: 'vocab_profile',
    openai: {
      type: 'object',
      properties: {
        observed_terminology: {
          type: 'object',
          properties: {
            strike_terms: { type: 'array', items: { type: 'string' } },
            contact_terms: { type: 'array', items: { type: 'string' } },
            diagnostic_terms: { type: 'array', items: { type: 'string' } },
            feel_terms: { type: 'array', items: { type: 'string' } },
          },
          required: ['strike_terms', 'contact_terms', 'diagnostic_terms', 'feel_terms'],
          additionalProperties: false,
        },
        kevin_summary: { type: 'string' },
        total_clips_reviewed: { type: 'number' },
      },
      required: ['observed_terminology', 'kevin_summary', 'total_clips_reviewed'],
      additionalProperties: false,
    },
    gemini: {
      type: 'OBJECT',
      properties: {
        observed_terminology: {
          type: 'OBJECT',
          properties: {
            strike_terms: { type: 'ARRAY', items: { type: 'STRING' } },
            contact_terms: { type: 'ARRAY', items: { type: 'STRING' } },
            diagnostic_terms: { type: 'ARRAY', items: { type: 'STRING' } },
            feel_terms: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['strike_terms', 'contact_terms', 'diagnostic_terms', 'feel_terms'],
        },
        kevin_summary: { type: 'STRING' },
        total_clips_reviewed: { type: 'NUMBER' },
      },
      required: ['observed_terminology', 'kevin_summary', 'total_clips_reviewed'],
    },
  };

  const raw = await completeJSON(provider, 'fast', '', [{ role: 'user', content: prompt }], { maxTokens: 400, temperature: 0, schema: vocabSchema });

  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      observed_terminology: data.observed_terminology ?? { strike_terms: [], contact_terms: [], diagnostic_terms: [], feel_terms: [] },
      kevin_summary: data.kevin_summary ?? 'Good session.',
      total_clips_reviewed: total_reviewed,
    };
  } catch {
    return {
      observed_terminology: { strike_terms: [], contact_terms: [], diagnostic_terms: [], feel_terms: [] },
      kevin_summary: 'Good session.',
      total_clips_reviewed: total_reviewed,
    };
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!allowInference(req, res, 'cage-review')) return;
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(200).json({ configured: false, reason: 'No AI provider configured' });
  }

  try {
    const body = req.body as Record<string, unknown>;
    const action = String(body.action ?? '');
    const provider = providerFromHeaderSafe(req.headers as Record<string, string | string[] | undefined>);

    console.log(`[cage-review] action=${action}`);

    if (action === 'question') return res.status(200).json(await handleQuestion(body, provider));
    if (action === 'extract')  return res.status(200).json(await handleExtract(body, provider));
    if (action === 'vocab')    return res.status(200).json(await handleVocab(body, provider));

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cage-review] error:', msg);
    return res.status(500).json({ error: msg });
  }
}
