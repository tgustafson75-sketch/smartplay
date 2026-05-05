import Anthropic from '@anthropic-ai/sdk';
import { getCaddieName, type VoiceGender } from '../../lib/persona';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuestionRequest {
  action: 'question';
  clip_index: number;
  total_clips: number;
  session_date: string;
  detection_method: string;
  position: 'early' | 'middle' | 'late';
  prior_labels: string | null;
  mode: 'quick' | 'coach' | 'skim';
  feel: string | null;
  shape: string | null;
  club: string;
  voiceGender?: VoiceGender;
  persona?: string | null;
}

interface ExtractRequest {
  action: 'extract';
  transcript: string;
  voiceGender?: VoiceGender;
  persona?: string | null;
}

interface VocabRequest {
  action: 'vocab';
  transcripts: string[];
  total_reviewed: number;
  voiceGender?: VoiceGender;
  persona?: string | null;
}

type RequestBody = QuestionRequest | ExtractRequest | VocabRequest;

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleQuestion(body: QuestionRequest): Promise<Response> {
  const modeInstruction =
    body.mode === 'quick'
      ? 'Ask ONE short question about contact quality or face location. Examples: "good or bad?", "where on the face?", "what\'d you feel?" Keep it under 12 words.'
      : body.mode === 'coach'
      ? 'Ask a deeper question that invites self-diagnosis. Examples: "what were you working on with that one?", "what\'d it feel like compared to the last one?", "why do you think it came out that way?" Up to 20 words.'
      : 'This shot has no label yet. Ask only if you genuinely can\'t tell what happened. Example: "this one\'s unlabeled — how was it?" Under 15 words.';

  const context = [
    `Shot ${body.clip_index + 1} of ${body.total_clips}`,
    `Club: ${body.club}`,
    `Session: ${body.session_date}`,
    `Position: ${body.position}`,
    body.feel ? `Tagged feel: ${body.feel}` : null,
    body.shape ? `Tagged shape: ${body.shape}` : null,
    body.prior_labels ? `Prior review labels: ${body.prior_labels}` : null,
  ].filter(Boolean).join('. ');

  // Audit 101 / B4 — prefer body.persona; fall back to voiceGender for legacy.
  const caddieName = getCaddieName(
    typeof body.persona === 'string' ? body.persona : (body.voiceGender ?? 'male'),
  );
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 80,
    system:
      `You are ${caddieName}, a golf coach reviewing cage session recordings with the user. ${modeInstruction} Vary your phrasing across clips. Never lecture. Output ONLY the question, no preamble, no quotes.`,
    messages: [{ role: 'user', content: context }],
  });

  const question = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : 'How was that one?';
  return Response.json({ question });
}

async function handleExtract(body: ExtractRequest): Promise<Response> {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system:
      'You are extracting structured labels from a golfer\'s self-description of a cage swing. Return valid JSON only, no markdown, no commentary.',
    messages: [
      {
        role: 'user',
        content: `The user is reviewing a recorded cage swing. They responded: "${body.transcript}"\n\nExtract labels. Return JSON:\n{\n  "strike_location": "center"|"heel"|"toe"|"top"|"thin"|"fat"|"unknown",\n  "contact_quality": "pure"|"good"|"okay"|"bad"|"unknown",\n  "self_diagnosis": string|null,\n  "intent": string|null,\n  "mental_state": string|null,\n  "notable_phrases": string[]\n}\nIf a field can't be confidently extracted, use "unknown" or null. Do not guess.`,
      },
    ],
  });

  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '{}';
  try {
    const labels = JSON.parse(raw);
    return Response.json({ labels });
  } catch {
    return Response.json({
      labels: {
        strike_location: 'unknown',
        contact_quality: 'unknown',
        self_diagnosis: null,
        intent: null,
        mental_state: null,
        notable_phrases: [],
      },
    });
  }
}

async function handleVocab(body: VocabRequest): Promise<Response> {
  if (body.transcripts.length === 0) {
    return Response.json({
      observed_terminology: { strike_terms: [], contact_terms: [], diagnostic_terms: [], feel_terms: [] },
      kevin_summary: "No transcripts to analyze yet.",
      total_clips_reviewed: 0,
    });
  }

  const transcriptBlock = body.transcripts
    .map((t, i) => `Clip ${i + 1}: "${t}"`)
    .join('\n');

  // Audit 101 / B4 — prefer body.persona; fall back to voiceGender for legacy.
  const caddieName = getCaddieName(
    typeof body.persona === 'string' ? body.persona : (body.voiceGender ?? 'male'),
  );
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system:
      `You are ${caddieName}, a golf coach analyzing the vocabulary a player uses when reviewing their swings. Extract recurring terminology and write a 2-3 sentence personal observation. Return valid JSON only, no markdown.`,
    messages: [
      {
        role: 'user',
        content: `Here are ${body.total_reviewed} swing review transcripts:\n\n${transcriptBlock}\n\nReturn JSON:\n{\n  "observed_terminology": {\n    "strike_terms": string[],\n    "contact_terms": string[],\n    "diagnostic_terms": string[],\n    "feel_terms": string[]\n  },\n  "kevin_summary": string\n}\n\nstrike_terms: words they use for face location (thin, fat, heel, toe, flush, topped, etc.)\ncontact_terms: quality words (pure, solid, okay, bad, duffed, etc.)\ndiagnostic_terms: mechanical observations (early extension, over the top, etc.)\nfeel_terms: sensation or mental words (tight, loose, rushed, smooth, etc.)\nkevin_summary: 2-3 warm, conversational sentences about their vocabulary patterns.`,
      },
    ],
  });

  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '{}';
  try {
    const parsed = JSON.parse(raw) as {
      observed_terminology: { strike_terms: string[]; contact_terms: string[]; diagnostic_terms: string[]; feel_terms: string[] };
      kevin_summary: string;
    };
    return Response.json({ ...parsed, total_clips_reviewed: body.total_reviewed });
  } catch {
    return Response.json({
      observed_terminology: { strike_terms: [], contact_terms: [], diagnostic_terms: [], feel_terms: [] },
      kevin_summary: "Good session. Keep building the vocabulary over time.",
      total_clips_reviewed: body.total_reviewed,
    });
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as RequestBody;

    if (body.action === 'question') return handleQuestion(body);
    if (body.action === 'extract') return handleExtract(body);
    if (body.action === 'vocab') return handleVocab(body);

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
