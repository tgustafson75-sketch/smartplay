import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCaddieName, type VoiceGender, type Persona } from '../lib/persona';
import { completeVision, providerFromHeaderSafe, type AiImageInput, type StructuredSchema } from './_aiProvider';

/**
 * Phase BR — Tutorial teaching-content extraction.
 *
 * Player uploads an instructional video and types a brief title + optional
 * notes ("Marc Solomon - shallow attack on wedges, club stays low through
 * impact"). This endpoint takes that input plus 1 representative frame
 * from the video and returns a structured teaching summary — focus, key
 * cues, target clubs, target situations.
 *
 * The result is stored in tutorialStore and (when active) injected into
 * Kevin's system prompt during rounds so his caddie advice reflects what
 * the player is currently practicing.
 *
 * **Audio transcription** (Whisper integration on the video's audio
 * track) is intentionally not handled here yet — that's Phase BR2. Today
 * the player's typed notes are the primary signal. When BR2 ships, the
 * client will pass `transcript` in the request body and the prompt will
 * weight it as the primary signal over notes.
 */

const VALID_CLUBS = [
  'DR', '3W', '5W', '7W',
  '2H', '3H', '4H', '5H',
  '3I', '4I', '5I', '6I', '7I', '8I', '9I',
  'PW', 'GW', 'AW', 'SW', 'LW',
  'PT',
] as const;

type ClubId = typeof VALID_CLUBS[number];

type TutorialAnalysisResponse = {
  teaching_focus: string;
  key_cues: string[];
  target_clubs: ClubId[];
  target_situations: string[];
  instructor: string | null;
  confidence: 'high' | 'medium' | 'low';
};

const tutorialSchema: StructuredSchema = {
  name: 'tutorial_analysis',
  openai: {
    type: 'object',
    properties: {
      teaching_focus:     { type: 'string' },
      key_cues:           { type: 'array', items: { type: 'string' } },
      target_clubs:       { type: 'array', items: { type: 'string', enum: [...VALID_CLUBS] } },
      target_situations:  { type: 'array', items: { type: 'string' } },
      instructor:         { type: ['string', 'null'] },
      confidence:         { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['teaching_focus', 'key_cues', 'target_clubs', 'target_situations', 'instructor', 'confidence'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      teaching_focus:     { type: 'STRING' },
      key_cues:           { type: 'ARRAY', items: { type: 'STRING' } },
      target_clubs:       { type: 'ARRAY', items: { type: 'STRING', enum: [...VALID_CLUBS] } },
      target_situations:  { type: 'ARRAY', items: { type: 'STRING' } },
      instructor:         { type: 'STRING', nullable: true },
      confidence:         { type: 'STRING', enum: ['high', 'medium', 'low'] },
    },
    required: ['teaching_focus', 'key_cues', 'target_clubs', 'target_situations', 'instructor', 'confidence'],
  },
  anthropic: {
    input_schema: {
      type: 'object',
      properties: {
        teaching_focus:     { type: 'string' },
        key_cues:           { type: 'array', items: { type: 'string' } },
        target_clubs:       { type: 'array', items: { type: 'string', enum: [...VALID_CLUBS] } },
        target_situations:  { type: 'array', items: { type: 'string' } },
        instructor:         { type: ['string', 'null'] },
        confidence:         { type: 'string', enum: ['high', 'medium', 'low'] },
      },
      required: ['teaching_focus', 'key_cues', 'target_clubs', 'target_situations', 'instructor', 'confidence'],
      additionalProperties: false,
    },
  },
};

// Audit 101 / B4 — accept Persona | VoiceGender so callers can pass either.
const buildSystemPrompt = (g: Persona | VoiceGender) => {
  const caddieName = getCaddieName(g);
  return `You are extracting structured teaching content from a brief description of a golf instruction video. The player has watched the video and wants the lesson captured so their AI caddie (${caddieName}) can reference it during rounds.

Input: a short title and optional notes the player typed about the video, plus possibly a single representative video frame.

Output ONLY a JSON object:
{
  "teaching_focus": "<one short sentence: what is the instructor teaching? written conversationally so ${caddieName} can reference it naturally during a round>",
  "key_cues": ["<3-5 short phrases the player should remember when applying this lesson — direct from the instructor's vocabulary if visible in the notes>"],
  "target_clubs": ["<club codes from the catalog below — only the clubs this lesson directly applies to. Empty array if the lesson is non-club-specific>"],
  "target_situations": ["<short phrases describing when this lesson applies — 'approach shots inside 100 yards', 'tee shots into wind', 'putts inside 10 feet', etc>"],
  "instructor": "<instructor name if visible in title/notes, or null>",
  "confidence": "high | medium | low"
}

Club code catalog (use these EXACT strings, no variations):
- DR (Driver)
- 3W, 5W, 7W (woods)
- 2H, 3H, 4H, 5H (hybrids)
- 3I, 4I, 5I, 6I, 7I, 8I, 9I (irons)
- PW (Pitching Wedge), GW (Gap Wedge), AW (Approach Wedge), SW (Sand Wedge), LW (Lob Wedge)
- PT (Putter)

Confidence scale:
- high: notes are detailed, teaching focus is clear, target clubs/situations are explicit
- medium: notes give a clear topic but specifics need inference
- low: notes are sparse or ambiguous; you're producing a best-effort summary

Rules:
- teaching_focus is what ${caddieName} will reference during a round. Make it specific enough to act on, conversational enough to reference naturally. Bad: "Wedge play". Good: "Shallow attack angle on wedges — keep the club low through impact for crisper contact".
- key_cues are short — 3-8 words each. The player will remember these as cue-thoughts during the swing.
- target_clubs only when the lesson is club-specific. A general "tempo" lesson has empty target_clubs.
- target_situations only when the lesson is situation-specific. Empty array is fine.
- Never fabricate. If the notes don't say "Marc Solomon", instructor stays null.

Non-instruction guard (Phase BR Component 11):
- If the title + notes + (optional) frame clearly do NOT describe golf instruction — for example the title is "vacation video", the notes describe a non-golf topic, or the frame is plainly not a golf scene — return:
  { "teaching_focus": "not_instruction", "key_cues": [], "target_clubs": [], "target_situations": [], "instructor": null, "confidence": "low" }
  The client surfaces a friendly "this doesn't look like a golf lesson — use Cage Mode for swing analysis" prompt and skips storing the entry.
- Sparse-but-golf-shaped notes (e.g. "wedge thoughts" with no specifics) should NOT trigger this guard — return your best low-confidence summary instead. The guard is for clearly off-topic uploads, not for thin notes.

Output ONLY valid JSON. No code fences, no preamble.`;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No AI provider configured' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    const frame = body.frame as { b64?: string; media_type?: string } | undefined;

    if (!title) {
      return res.status(400).json({ error: 'title (string) is required' });
    }
    const voiceGender: VoiceGender = (body.voiceGender as VoiceGender | undefined) ?? 'male';
    // Audit 101 / B4 — prefer body.persona; fall back to voiceGender.
    const personaInput: Persona | VoiceGender =
      (typeof body.persona === 'string' ? (body.persona as string) : voiceGender) as Persona | VoiceGender;

    const inputLines: string[] = [];
    inputLines.push(`Title: ${title}`);
    if (notes) inputLines.push(`Notes: ${notes}`);
    if (transcript) inputLines.push(`Transcript (auto-extracted): ${transcript.slice(0, 4000)}`);
    inputLines.push(`\nReturn the structured teaching content as JSON.`);

    const images: AiImageInput[] = frame?.b64
      ? [{ b64: frame.b64, mimeType: frame.media_type ?? 'image/jpeg' }]
      : [];

    const provider = providerFromHeaderSafe(req.headers as Record<string, string | string[] | undefined>);
    const text = await completeVision(provider, 'quality', buildSystemPrompt(personaInput),
      inputLines.join('\n'), images,
      { maxTokens: 600, temperature: 0.2, schema: tutorialSchema },
    );
    if (!text) {
      return res.status(502).json({ error: 'Empty model response' });
    }

    let parsed: TutorialAnalysisResponse;
    try {
      parsed = JSON.parse(text) as TutorialAnalysisResponse;
    } catch {
      return res.status(502).json({ error: 'Model returned non-JSON', raw: text.slice(0, 300) });
    }

    return res.status(200).json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[tutorial-analysis] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
