import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Action: generate a Kevin question for a shot ─────────────────────────────

async function handleQuestion(body: Record<string, unknown>): Promise<Record<string, unknown>> {
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
  } = body;

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

  const prompt = `You are Kevin, a warm and observant golf caddie. You're reviewing a cage session with your player.

Shot ${shotNum} of ${total_clips} — ${positionStr}. Session from ${session_date}. Detected via ${detection_method}.
${clubStr}${feelStr}${shapeStr}${priorStr}

Mode: ${modeDescription}

Generate exactly one question to ask the player about this shot. Be casual, sound like a real conversation. No fluff. No "Hey" or opener phrases — just the question.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 80,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content.find(b => b.type === 'text');
  const question = (block as { type: 'text'; text: string } | undefined)?.text?.trim() ?? 'How did that feel?';
  return { question };
}

// ─── Action: extract labels from a voice transcript ──────────────────────────

async function handleExtract(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const transcript = String(body.transcript ?? '').trim();
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

Return a JSON object with these exact keys:
- strike_location: one of "center", "heel", "toe", "top", "thin", "fat", "unknown"
- contact_quality: one of "pure", "good", "okay", "bad", "unknown"
- self_diagnosis: string or null — what they think caused the miss or made it good (e.g. "came over the top", "stayed behind it")
- intent: string or null — what they were trying to do (e.g. "draw it", "just make solid contact")
- mental_state: string or null — emotional/mental cue if mentioned (e.g. "felt rushed", "very confident")
- notable_phrases: array of verbatim phrases worth remembering about their feel vocabulary (max 3)

Return ONLY valid JSON. No markdown, no explanation.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content.find(b => b.type === 'text');
  const raw = (block as { type: 'text'; text: string } | undefined)?.text?.trim() ?? '{}';

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

async function handleVocab(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const transcripts = (body.transcripts as string[]) ?? [];
  const total_reviewed = Number(body.total_reviewed ?? transcripts.length);

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

Return a JSON object with:
- observed_terminology: object with arrays:
  - strike_terms: words they use to describe where they hit the face (e.g. "heel", "toe", "pure", "off the middle")
  - contact_terms: words for quality of contact (e.g. "flush", "chunked", "thin", "caught it fat")
  - diagnostic_terms: cause/effect language they use (e.g. "came over it", "stayed behind", "early release")
  - feel_terms: sensation words (e.g. "heavy", "light", "rushed", "stuck")
- kevin_summary: 1-2 sentences Kevin would say to this player about what he heard. Warm, observant, not preachy.
- total_clips_reviewed: ${total_reviewed}

Return ONLY valid JSON. No markdown, no explanation.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content.find(b => b.type === 'text');
  const raw = (block as { type: 'text'; text: string } | undefined)?.text?.trim() ?? '{}';

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

  try {
    const body = req.body as Record<string, unknown>;
    const action = String(body.action ?? '');

    console.log(`[cage-review] action=${action}`);

    if (action === 'question') return res.status(200).json(await handleQuestion(body));
    if (action === 'extract')  return res.status(200).json(await handleExtract(body));
    if (action === 'vocab')    return res.status(200).json(await handleVocab(body));

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cage-review] error:', msg);
    return res.status(500).json({ error: msg });
  }
}
