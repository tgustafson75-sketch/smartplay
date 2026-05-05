import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 1 });

const SYSTEM_PROMPT = `You parse a golfer's spoken description of a shot they just hit. Output a structured JSON record.

Real golfers speak in many registers — capture all of them:

SELF-DEPRECATING: "missed that one", "duffed it", "chunked the wedge", "didn't catch it clean", "fat", "thin", "topped it", "skulled", "bladed", "shanked", "yipped"

LOST-IN-ENVIRONMENT: "lost it in the sun", "couldn't see where it went", "into the trees", "in the bunker", "drink", "drowned it", "wet", "went OB", "lost ball"

EMOTIONAL / ABSTRACT: "flushed it", "smoked it", "money", "pure", "crushed", "striped", "ripped", "absolutely killed it", "nutted"

ACTION-ORIENTED: "reload", "play another", "drop one", "again", "hitting another", "do over"

LIE / CONDITION: "buried", "clean lie", "sitting up", "bare lie", "in the rough", "fluffy", "tight", "hardpan"

CLUB-SPECIFIC: "seven iron", "pitching wedge", "driver", "three wood", "rescue", "hybrid", "putter", "lob wedge", "sand wedge", "gap wedge"

DISTANCE-SPECIFIC: "150 yards", "smooth eight", "hundred and twenty", "one fifty"

DIRECTION-SPECIFIC: "left", "right", "pulled", "blocked", "pushed", "snap-hooked", "sliced"

Outcome sentiment: good (positive feel), bad (negative feel), neutral (factual), null (no signal).

Club normalization to canonical short form: "seven iron" -> "7 iron", "pitching wedge" -> "PW", "three wood" -> "3 wood", "rescue" -> "hybrid", "lob wedge" -> "LW", "sand wedge" -> "SW", "gap wedge" -> "GW".

Distance: extract single yardage number. "one fifty" -> 150. No number stated -> null.

Direction (only fill when EXPLICITLY stated): "pulled"/"yanked"/"snap-hooked"/"left" -> "left". "blocked"/"pushed"/"sliced"/"right" -> "right". "straight"/"down the middle" -> "straight". Otherwise null. Phrases like "to ten feet" or "to the back of the green" describe outcome, not direction — leave direction null. Pure shape ("fade"/"draw") -> null.

lie_followup TRUE when user mentioned a lie/condition that needs more detail, OR mentioned a hazard without specifying lie quality. FALSE when lie was specified or never mentioned.

Return ONLY valid JSON, no preamble:
{
  "club": string | null,
  "distance": number | null,
  "direction": "left" | "straight" | "right" | null,
  "outcome": "good" | "neutral" | "bad" | null,
  "lie_followup": boolean,
  "confidence": "high" | "medium" | "low",
  "follow_up_question": string | null
}`;

const LIE_FOLLOWUP_SYSTEM = `Categorize the lie quality from the player's response. Output JSON: { "lie_quality": "clean" | "rough" | "buried" | "tight" | "fluffy" | "hardpan" | "bunker" | "other" | null, "confidence": "high" | "medium" | "low" }`;

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const utterance = String(body.utterance ?? '').trim();
    const context = body.context ?? {};
    const isLieFollowup = Boolean((context as Record<string, unknown>).is_lie_followup);

    if (!utterance) {
      return new Response(JSON.stringify({
        club: null,
        distance: null,
        direction: null,
        outcome: null,
        lie_followup: false,
        raw_utterance: '',
        confidence: 'low',
        follow_up_question: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (isLieFollowup) {
      const lieResult = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: LIE_FOLLOWUP_SYSTEM,
        messages: [{ role: 'user', content: `Player said: "${utterance}"` }],
      });
      const block = lieResult.content.find(b => b.type === 'text');
      const raw = block && block.type === 'text' ? block.text.trim() : '';
      const parsed = safeParseJson(raw);
      return new Response(JSON.stringify({ ...parsed, raw_utterance: utterance }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
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
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const block = result.content.find(b => b.type === 'text');
    const raw = block && block.type === 'text' ? block.text.trim() : '';
    const parsed = safeParseJson(raw);

    const modelDirection = parsed.direction === 'left' || parsed.direction === 'right' || parsed.direction === 'straight' ? parsed.direction : null;

    return new Response(JSON.stringify({
      club: typeof parsed.club === 'string' ? parsed.club : null,
      distance: typeof parsed.distance === 'number' ? parsed.distance : null,
      direction: directionInUtterance(utterance, modelDirection),
      outcome: parsed.outcome === 'good' || parsed.outcome === 'bad' || parsed.outcome === 'neutral' ? parsed.outcome : null,
      lie_followup: parsed.lie_followup === true,
      raw_utterance: utterance,
      confidence: parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low' ? parsed.confidence : 'low',
      follow_up_question: typeof parsed.follow_up_question === 'string' ? parsed.follow_up_question : null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    console.log('[parse-shot] error:', err);
    return new Response(JSON.stringify({
      club: null,
      distance: null,
      direction: null,
      outcome: null,
      lie_followup: false,
      raw_utterance: '',
      confidence: 'low',
      follow_up_question: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}

const DIRECTION_KEYWORDS_LEFT = /\b(left|pulled?|pull|yanked?|snap[- ]?hook(ed)?|hooked)\b/i;
const DIRECTION_KEYWORDS_RIGHT = /\b(right|blocked?|block|pushed?|push|sliced?|slice|leaked?)\b/i;
const DIRECTION_KEYWORDS_STRAIGHT = /\b(straight|down the middle|middle of the fairway)\b/i;

function directionInUtterance(utterance: string, modelDirection: string | null): 'left' | 'right' | 'straight' | null {
  if (!modelDirection) return null;
  if (modelDirection === 'left' && DIRECTION_KEYWORDS_LEFT.test(utterance)) return 'left';
  if (modelDirection === 'right' && DIRECTION_KEYWORDS_RIGHT.test(utterance)) return 'right';
  if (modelDirection === 'straight' && DIRECTION_KEYWORDS_STRAIGHT.test(utterance)) return 'straight';
  return null;
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
