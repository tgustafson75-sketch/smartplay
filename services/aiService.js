/**
 * aiService.js — Caddie AI response engine
 *
 * Routes voice commands through two layers:
 *   1. OpenAI GPT-4o-mini (if key available + network up)
 *   2. Local knowledge engine (always available, instant, zero latency)
 *
 * ALL AI calls in the app funnel through here.
 * Never call OpenAI directly from UI components.
 */

const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const SYSTEM_PROMPT = `You are SmartPlay, an expert AI golf caddie. 
Give direct, specific, practical advice in 1-2 sentences max.
No filler phrases. No "Great question!". No preamble.
Address exactly what was asked. Speak like an experienced caddie on the bag.`;

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * getAIResponse(transcript, context?)
 *
 * @param {string} transcript — what the golfer said
 * @param {object} [context]  — optional round context (hole, distance, club, missPattern)
 * @returns {Promise<string>} caddie response text
 */
export async function getAIResponse(transcript, context = {}) {
  if (!transcript?.trim()) return getFallback(context);

  const lower = transcript.toLowerCase();

  // Try OpenAI first if key is available
  if (OPENAI_KEY && OPENAI_KEY.length >= 20 && OPENAI_KEY !== 'sk-your-key-here') {
    try {
      const contextHint = buildContextHint(context);
      const userMessage  = contextHint ? `${contextHint}\n\nGolfer: "${transcript}"` : transcript;

      const res = await fetch(OPENAI_URL, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model:      'gpt-4o-mini',
          max_tokens: 120,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user',   content: userMessage   },
          ],
        }),
      });

      if (res.ok) {
        const json   = await res.json();
        const answer = json.choices?.[0]?.message?.content?.trim();
        if (answer) return answer;
      }
    } catch {
      // Fall through to local engine
    }
  }

  // Local knowledge fallback
  return localEngine(lower, context);
}

// ---------------------------------------------------------------------------
// Internal: context hint builder
// ---------------------------------------------------------------------------
function buildContextHint(ctx) {
  if (!ctx || Object.keys(ctx).length === 0) return '';
  const parts = [];
  if (ctx.hole)        parts.push(`Hole ${ctx.hole}`);
  if (ctx.distance)    parts.push(`${ctx.distance} yards to pin`);
  if (ctx.club)        parts.push(`Club in hand: ${ctx.club}`);
  if (ctx.missPattern) parts.push(`Miss pattern: tends ${ctx.missPattern}`);
  if (ctx.par)         parts.push(`Par ${ctx.par}`);
  return parts.length ? `[Context: ${parts.join(', ')}]` : '';
}

// ---------------------------------------------------------------------------
// Internal: local golf knowledge engine
// ---------------------------------------------------------------------------
function getFallback(ctx) {
  if (ctx?.distance) {
    return `${ctx.distance} yards — commit to a smooth swing and trust your ${ctx.club || 'club'}.`;
  }
  return 'Pick your target. Trust your swing. One shot at a time.';
}

function localEngine(lower, ctx) {
  // Distance / yardage
  if (/how far|distance|yardage|how many yards/.test(lower)) {
    return ctx?.distance
      ? `You have ${ctx.distance} yards to the pin.`
      : 'Check your rangefinder for the exact yardage.';
  }
  // Club selection
  if (/what club|which club|club should i|club for/.test(lower)) {
    return ctx?.club
      ? `Your ${ctx.club} is the right call here. Commit to it.`
      : 'Take one more club than you think — most amateurs miss short.';
  }
  // Slice / push right
  if (/slice|push|right miss|fad(ing|e)/.test(lower)) {
    return 'Drop the right elbow into your side on the downswing and swing out toward right field through impact.';
  }
  // Hook / pull left
  if (/hook|pull|left miss/.test(lower)) {
    return 'Hold the face slightly open through impact. Keep your left arm connected to your chest.';
  }
  // Tempo / rhythm
  if (/tempo|rhythm|timing|slow.*down|too fast|rushing/.test(lower)) {
    return 'Feel a one-second pause at the top before you fire. Quiet your transition and let it go.';
  }
  // Putting
  if (/putt|putting|green|pace/.test(lower)) {
    return 'Pace over line. Head still, listen for it.';
  }
  // Short game
  if (/chip|pitch|short game|bunker|sand/.test(lower)) {
    return 'Land it on the fringe and let it roll. Commit to your spot, not the hole.';
  }
  // Wind
  if (/wind|breeze|into the wind|downwind/.test(lower)) {
    return 'Into the wind take two extra clubs at 75% — swinging harder creates more spin and balloons it.';
  }
  // Mental
  if (/nervous|mental|pressure|focus|choke|yips/.test(lower)) {
    return 'One specific target. Two slow breaths. Commit fully. One shot at a time.';
  }
  // Strategy / layup
  if (/strategy|layup|play it safe|course management/.test(lower)) {
    return 'Miss on the side with the most room. Play to your pattern, not against it.';
  }
  // Advice / help generic
  if (/advice|help|tip|what should i do/.test(lower)) {
    return ctx?.distance
      ? `${ctx.distance} yards — smooth swing, ${ctx.missPattern === 'right' ? 'aim left center' : ctx.missPattern === 'left' ? 'let it release' : 'commit to your target'}.`
      : 'Pick your target early, commit to your pre-shot routine, and trust the swing you have.';
  }
  // Frustration
  if (/terrible|awful|hate|can't hit|useless|garbage/.test(lower)) {
    return "Shake it off — we're good. Reset and trust your swing. Next one is yours.";
  }
  // Generic fallback
  return ctx?.distance
    ? `${ctx.distance} yards. Smooth tempo, committed swing. You've got this.`
    : 'Pick your target. Trust your swing. One shot at a time.';
}
