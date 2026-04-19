/**
 * aiService.js — Caddie AI response engine
 *
 * Routes voice commands through three layers:
 *   1. Local response builder (structured, domain-classified, mode-aware)
 *   2. OpenAI GPT-4o-mini (if key available + network up)
 *   3. Local knowledge engine (always available, instant, zero latency)
 *
 * ALL AI calls in the app funnel through here.
 * Never call OpenAI directly from UI components.
 *
 * Response modes:
 *   short    — 1 sentence, max 12 words
 *   detailed — up to 2 sentences
 */

import { matchLocalResponse, formatAIResponse, classifyDomain, detectIntent, FALLBACK_RESPONSE } from './caddieResponseBuilder.js';

const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// System prompt varies by domain and mode for consistent tone
const buildSystemPrompt = (domain, mode) => {
  const length = mode === 'short'
    ? 'Respond in exactly ONE sentence, max 10 words. No filler.'
    : mode === 'neutral'
    ? 'Respond in ONE clear sentence. No filler.'
    : 'Respond in 1-2 sentences max. First sentence: answer. Second: one specific adjustment if needed.';

  const tone = domain === 'app'    ? 'Explain what the feature does and how to use it.'
             : domain === 'course' ? 'Give a direct recommendation only. No explanation.'
             :                       'State the pattern, then give one specific fix.';

  return `You are SmartCaddie, a concise expert golf caddie AI.
${length}
${tone}
No filler phrases. No "Great question!". No preamble. No "I recommend".
Speak like a caddie on the bag, not a coach giving a lesson.`;
};

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * getAIResponse(transcript, context?, mode?)
 *
 * @param {string} transcript — what the golfer said
 * @param {object} [context]  — optional round context (hole, distance, club, missPattern, par)
 * @param {'short' | 'neutral' | 'detailed'} [mode] — response length mode (default: 'short')
 * @returns {Promise<string>} caddie response text
 */
export async function getAIResponse(transcript, context = {}, mode = 'short') {
  if (!transcript?.trim()) return getFallback(context, mode);

  const intent = detectIntent(transcript);
  console.log(`[aiService] INPUT: "${transcript}" | intent: ${intent?.key ?? 'none'} | domain: ${intent?.type ?? classifyDomain(transcript)} | mode: ${mode}`);

  // Layer 1 — structured local response library (instant, zero latency, fully consistent)
  const local = matchLocalResponse(transcript, context, mode);
  if (local) return local;

  const domain = intent?.type ?? classifyDomain(transcript);
  const lower  = transcript.toLowerCase();

  // Layer 2 — OpenAI with domain-tuned system prompt
  if (OPENAI_KEY && OPENAI_KEY.length >= 20 && OPENAI_KEY !== 'sk-your-key-here') {
    try {
      const contextHint = buildContextHint(context);
      const userMessage  = contextHint ? `${contextHint}\n\nGolfer: "${transcript}"` : transcript;

      // 8-second hard timeout — never blocks gameplay if OpenAI is slow
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(OPENAI_URL, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model:      'gpt-4o-mini',
          max_tokens: mode === 'short' ? 40 : mode === 'neutral' ? 55 : 80,
          messages: [
            { role: 'system', content: buildSystemPrompt(domain, mode) },
            { role: 'user',   content: userMessage },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const json   = await res.json();
        const raw    = json.choices?.[0]?.message?.content?.trim();
        if (raw) return formatAIResponse(raw, mode);
      }
    } catch {
      // Timeout, network error, or parse failure — fall through to local engine
    }
  }

  // Layer 3 — local knowledge engine
  const engineResult = localEngine(lower, context);
  // If localEngine returned a generic fallback, use the structured FALLBACK_RESPONSE instead
  if (!engineResult || engineResult === FALLBACK_RESPONSE) return FALLBACK_RESPONSE;
  return formatAIResponse(engineResult, mode);
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
function getFallback(ctx, mode = 'short') {
  if (ctx?.distance) {
    const s = `${ctx.distance} yards — trust your ${ctx.club || 'club'}.`;
    if (mode === 'detailed') return `${s} Commit to a smooth swing and hit your target.`;
    return s;
  }
  return 'Pick your target. Trust your swing.';
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
