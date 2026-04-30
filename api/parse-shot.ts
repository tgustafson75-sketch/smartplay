import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

Direction normalization: "pulled", "yanked", "snap-hooked", "left" -> "left". "blocked", "pushed", "sliced", "leaked right", "right" -> "right". "straight", "down the middle" -> "straight". Pure "fade" or "draw" without left/right framing -> null (it's a shape, not a miss direction).

lie_followup TRUE when:
- User mentioned a lie/condition keyword that wasn't fully specified ("in the rough" without "thick" or "wispy")
- User mentioned a hazard but not the shot ("in the bunker" — Kevin should ask about the lie)

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
  "lie_quality": "clean" | "rough" | "buried" | "tight" | "fluffy" | "hardpan" | "bunker" | "other" | null,
  "confidence": "high" | "medium" | "low"
}

Examples:
- "clean lie" / "sitting up" / "good lie" -> "clean"
- "in the rough" / "wispy rough" -> "rough"
- "buried" / "down" / "deep" -> "buried"
- "tight" / "bare" -> "tight"
- "fluffy" / "perched" -> "fluffy"
- "hardpan" / "dirt" -> "hardpan"
- "in the bunker" / "sand" -> "bunker"
- unclear or off-topic -> "other" with low confidence`;

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

    if (isLieFollowup) {
      const lieResult = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: LIE_FOLLOWUP_SYSTEM,
        messages: [{ role: 'user', content: `Player said: "${utterance}"` }],
      });
      const lieBlock = lieResult.content.find(b => b.type === 'text');
      const lieRaw = lieBlock && lieBlock.type === 'text' ? lieBlock.text.trim() : '';
      const lieParsed = safeParseJson(lieRaw);
      return res.status(200).json({
        ...lieParsed,
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

    const result = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const block = result.content.find(b => b.type === 'text');
    const raw = block && block.type === 'text' ? block.text.trim() : '';
    const parsed = safeParseJson(raw);

    const club = typeof parsed.club === 'string' ? parsed.club : null;
    const distance = typeof parsed.distance === 'number' ? parsed.distance : null;
    const direction = parsed.direction === 'left' || parsed.direction === 'right' || parsed.direction === 'straight'
      ? parsed.direction
      : null;
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

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return {};
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const SHARED_SYSTEM_PROMPT = SYSTEM_PROMPT;
export const SHARED_LIE_PROMPT = LIE_FOLLOWUP_SYSTEM;
