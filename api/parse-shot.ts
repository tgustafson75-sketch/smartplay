import type { VercelRequest, VercelResponse } from '@vercel/node';
import { completeJSON, providerFromHeaderSafe, type StructuredSchema } from './_aiProvider';

const SYSTEM_PROMPT = `You parse a golfer's spoken description of a shot they just hit. Output a structured JSON record.

Real golfers speak in many registers — capture all of them:

SELF-DEPRECATING: "missed that one", "duffed it", "chunked the wedge", "didn't catch it clean", "fat", "thin", "topped it", "skulled", "bladed", "shanked", "yipped"

LOST-IN-ENVIRONMENT: "lost it in the sun", "couldn't see where it went", "into the trees", "in the bunker", "drink", "drowned it", "wet", "went OB", "lost ball"

EMOTIONAL / ABSTRACT: "flushed it", "smoked it", "money", "pure", "crushed", "striped", "ripped", "absolutely killed it", "nutted"

ACTION-ORIENTED: "reload", "play another", "drop one", "again", "hitting another", "do over"

LIE / CONDITION: "buried", "clean lie", "sitting up", "bare lie", "in the rough", "fluffy", "tight", "hardpan", "fluffy lie"

CLUB-SPECIFIC: "seven iron", "pitching wedge", "driver", "three wood", "rescue", "hybrid", "putter", "lob wedge", "sand wedge", "gap wedge", "two iron", "five wood"

DISTANCE-SPECIFIC: "150 yards", "smooth eight", "hundred and twenty", "one fifty", "from 165"

DIRECTION-SPECIFIC: "left", "right", "pulled", "blocked", "pushed", "snap-hooked", "sliced", "fade", "draw", "pull", "block", "yanked it left", "leaked right"

Outcome sentiment classification:
- "good"   = clearly positive ("flushed", "smoked", "money", "pure", "striped", "to ten feet", "stuck it")
- "bad"    = clearly negative ("duffed", "chunked", "fat", "thin", "topped", "shanked", "OB", "lost", "in the water", "reload")
- "neutral" = factual without sentiment ("in the rough", "150 to the pin", "left side of the green", "couldn't see")
- null     = no signal at all

Club normalization: convert spoken to canonical short form. "seven iron" -> "7 iron", "pitching wedge" -> "PW", "three wood" -> "3 wood", "smooth eight" -> "8 iron", "rescue" -> "hybrid", "lob wedge" -> "LW", "sand wedge" -> "SW", "gap wedge" -> "GW".

Distance extraction: pull a single yardage number. "one fifty" -> 150. "hundred and twenty" -> 120. "from 165" -> 165. If no number stated, null.

Direction normalization (CRITICAL — only fill this when EXPLICITLY stated): "pulled", "yanked", "snap-hooked", "left" -> "left". "blocked", "pushed", "sliced", "leaked right", "right" -> "right". "straight", "down the middle" -> "straight". Otherwise direction is null. Phrases like "to ten feet", "to the back of the green", "stuck it close" describe distance or outcome — they do NOT imply direction "straight". Leave direction null unless the player used an explicit left/right/straight/pull/push word. Pure "fade" or "draw" without left/right framing -> null.

lie_followup TRUE when:
- User mentioned a lie/condition keyword that wasn't fully specified ("in the rough" without "thick" or "wispy")
- User mentioned a hazard but not the shot ("in the bunker" — the caddie should ask about the lie)

lie_followup FALSE when:
- User already specified lie quality ("buried in the rough", "clean lie in the bunker")
- User didn't mention lie at all (most shots — don't ask)
- User did a reload / penalty action

confidence:
- "high"   = club, direction, and/or outcome unambiguous
- "medium" = some signal but partial info
- "low"   = very vague ("yeah", "okay", "whatever") — set follow_up_question to a single short clarifying ask

Return ONLY valid JSON, no preamble, no code fences. Shape:
{
  "club": string | null,
  "distance": number | null,
  "direction": "left" | "straight" | "right" | null,
  "outcome": "good" | "neutral" | "bad" | null,
  "lie_followup": boolean,
  "confidence": "high" | "medium" | "low",
  "follow_up_question": string | null
}

Skip / cancel utterances ("skip", "later", "not now", "never mind") -> all fields null/false, confidence "high", follow_up_question null. The orchestrator handles skip separately.

When given a vocabulary profile of phrases this specific user has said before, weight ambiguous phrasings toward their established meaning.`;

const LIE_FOLLOWUP_SYSTEM = `You are parsing a golfer's response to "How's the lie?". Categorize the lie quality.

Output JSON only:
{
  "lie_quality": "perfect" | "good" | "fair" | "divot" | "rough" | "bunker" | "water" | "other" | null,
  "confidence": "high" | "medium" | "low",
  "raw_utterance": string
}

Examples:
- "clean lie" / "sitting up" / "good lie" / "perfect" -> "perfect"
- "decent" / "not bad" / "okay lie" -> "good"
- "in the rough" / "wispy rough" / "not great" -> "fair" or "rough"
- "divot" / "in a divot" -> "divot"
- "buried" / "down" / "deep" / "thick rough" -> "rough"
- "in the bunker" / "sand" -> "bunker"
- "in the water" / "wet" -> "water"
- unclear or off-topic -> "other" with low confidence`;

// ─── Structured schemas ───────────────────────────────────────────────────────

const SHOT_PARSE_SCHEMA: StructuredSchema = {
  name: 'shot_parse',
  openai: {
    type: 'object',
    properties: {
      club: { type: ['string', 'null'] },
      distance: { type: ['number', 'null'] },
      direction: { type: ['string', 'null'], enum: ['left', 'straight', 'right', null] },
      outcome: { type: ['string', 'null'], enum: ['good', 'neutral', 'bad', null] },
      lie_followup: { type: 'boolean' },
      raw_utterance: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      follow_up_question: { type: ['string', 'null'] },
    },
    required: ['club', 'distance', 'direction', 'outcome', 'lie_followup', 'raw_utterance', 'confidence', 'follow_up_question'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      club: { type: 'STRING', nullable: true },
      distance: { type: 'NUMBER', nullable: true },
      direction: { type: 'STRING', nullable: true, enum: ['left', 'straight', 'right'] },
      outcome: { type: 'STRING', nullable: true, enum: ['good', 'neutral', 'bad'] },
      lie_followup: { type: 'BOOLEAN' },
      raw_utterance: { type: 'STRING' },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      follow_up_question: { type: 'STRING', nullable: true },
    },
    required: ['club', 'distance', 'direction', 'outcome', 'lie_followup', 'raw_utterance', 'confidence', 'follow_up_question'],
  },
};

const LIE_FOLLOWUP_SCHEMA: StructuredSchema = {
  name: 'lie_followup_parse',
  openai: {
    type: 'object',
    properties: {
      lie_quality: { type: ['string', 'null'], enum: ['perfect', 'good', 'fair', 'divot', 'rough', 'bunker', 'water', 'other', null] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      raw_utterance: { type: 'string' },
    },
    required: ['lie_quality', 'confidence', 'raw_utterance'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      lie_quality: { type: 'STRING', nullable: true, enum: ['perfect', 'good', 'fair', 'divot', 'rough', 'bunker', 'water', 'other'] },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      raw_utterance: { type: 'STRING' },
    },
    required: ['lie_quality', 'confidence', 'raw_utterance'],
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const utterance = String(body?.utterance ?? '').trim();
    const context = body?.context ?? {};
    const isLieFollowup = Boolean((context as Record<string, unknown>).is_lie_followup);

    if (!utterance) {
      return res.status(200).json({
        club: null,
        distance: null,
        direction: null,
        outcome: null,
        lie_followup: false,
        raw_utterance: '',
        confidence: 'low',
        follow_up_question: null,
      });
    }

    const provider = providerFromHeaderSafe(req.headers as Record<string, string | string[] | undefined>);

    if (isLieFollowup) {
      const lieRaw = await completeJSON(provider, 'fast', LIE_FOLLOWUP_SYSTEM, [{ role: 'user', content: `Player said: "${utterance}"` }], { maxTokens: 200, temperature: 0, schema: LIE_FOLLOWUP_SCHEMA });
      // Defensive (smoke-test hardening) — completeJSON returns schema'd JSON
      // (worst case '{}'), but guard so any non-JSON degrades to low-confidence
      // instead of throwing a 500 on a live in-round voice call.
      let lieParsed: { lie_quality?: string | null; confidence?: string };
      try {
        lieParsed = JSON.parse(lieRaw) as { lie_quality?: string | null; confidence?: string };
      } catch {
        lieParsed = { lie_quality: null, confidence: 'low' };
      }
      return res.status(200).json({
        lie_quality: lieParsed.lie_quality ?? null,
        confidence: lieParsed.confidence ?? 'low',
        raw_utterance: utterance,
      });
    }

    const recentPhrases = Array.isArray((context as Record<string, unknown>).recent_user_phrases)
      ? ((context as Record<string, unknown>).recent_user_phrases as string[]).slice(0, 20)
      : [];

    const userPrompt = `Player said: "${utterance}"

Hole: ${(context as Record<string, unknown>).hole_number ?? 'unknown'}
${recentPhrases.length > 0 ? `\nThis user's recent phrasings:\n${recentPhrases.map(p => `- "${p}"`).join('\n')}` : ''}

Parse the shot. Return JSON only.`;

    const raw = await completeJSON(provider, 'fast', SYSTEM_PROMPT, [{ role: 'user', content: userPrompt }], { maxTokens: 400, temperature: 0, schema: SHOT_PARSE_SCHEMA });
    // Defensive (smoke-test hardening) — schema'd output is valid JSON (worst
    // case '{}'); guard so a malformed response yields an all-null parse
    // (handled by the typeof checks below) rather than a 500.
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = {};
    }

    const club = typeof parsed.club === 'string' ? parsed.club : null;
    const distance = typeof parsed.distance === 'number' ? parsed.distance : null;
    const modelDirection = parsed.direction === 'left' || parsed.direction === 'right' || parsed.direction === 'straight'
      ? parsed.direction
      : null;
    // Deterministic guard: only keep direction when the utterance contains an explicit
    // direction keyword. Outcome phrases like "to ten feet" or "to the back of the green"
    // shouldn't get inferred as direction "straight".
    const direction = directionInUtterance(utterance, modelDirection);
    const outcome = parsed.outcome === 'good' || parsed.outcome === 'bad' || parsed.outcome === 'neutral'
      ? parsed.outcome
      : null;
    const lie_followup = parsed.lie_followup === true;
    const confidence = parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
      ? parsed.confidence
      : 'low';
    const follow_up_question = typeof parsed.follow_up_question === 'string' ? parsed.follow_up_question : null;

    return res.status(200).json({
      club,
      distance,
      direction,
      outcome,
      lie_followup,
      raw_utterance: utterance,
      confidence,
      follow_up_question,
    });

  } catch (err) {
    console.log('[parse-shot] error:', err);
    return res.status(200).json({
      club: null,
      distance: null,
      direction: null,
      outcome: null,
      lie_followup: false,
      raw_utterance: '',
      confidence: 'low',
      follow_up_question: null,
    });
  }
}

const DIRECTION_KEYWORDS_LEFT = /\b(left|pulled?|pull|yanked?|snap[- ]?hook(ed)?|hooked)\b/i;
const DIRECTION_KEYWORDS_RIGHT = /\b(right|blocked?|block|pushed?|push|sliced?|slice|leaked?|fade(d)?[- ]right)\b/i;
const DIRECTION_KEYWORDS_STRAIGHT = /\b(straight|down the middle|middle of the fairway)\b/i;

function directionInUtterance(utterance: string, modelDirection: string | null): 'left' | 'right' | 'straight' | null {
  if (!modelDirection) return null;
  if (modelDirection === 'left' && DIRECTION_KEYWORDS_LEFT.test(utterance)) return 'left';
  if (modelDirection === 'right' && DIRECTION_KEYWORDS_RIGHT.test(utterance)) return 'right';
  if (modelDirection === 'straight' && DIRECTION_KEYWORDS_STRAIGHT.test(utterance)) return 'straight';
  // Model output not backed by an explicit keyword in the utterance — drop it.
  return null;
}

export const SHARED_SYSTEM_PROMPT = SYSTEM_PROMPT;
export const SHARED_LIE_PROMPT = LIE_FOLLOWUP_SYSTEM;
