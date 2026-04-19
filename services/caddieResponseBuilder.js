/**
 * caddieResponseBuilder.js — Standardized CADDIE response system
 *
 * Three domains, three tones:
 *   app    → explain  (what it is, how it works)
 *   course → direct   (recommendation only, no padding)
 *   game   → insight  (pattern + optional adjustment)
 *
 * All responses: max 2 sentences, max ~10 words per sentence.
 * "short" mode: first sentence only.
 * "detailed" mode: both sentences where available.
 *
 * Flow:
 *   detectIntent(transcript) → { type, key }
 *   resolve data from LOCAL_RESPONSES[key]
 *   buildResponse(type, data, mode) → final string
 *   fallback if no match → FALLBACK_RESPONSE
 */

// ── Fallback ──────────────────────────────────────────────────────────────────
export const FALLBACK_RESPONSE = 'Ask about your shot, the course, or the app.';

// ── Question map ──────────────────────────────────────────────────────────────
// Ordered by specificity — first match wins.

export const questionMap = [
  // App
  { keywords: ['smartvision', 'shot vision', 'ball flight'],         type: 'app',    key: 'smartvision' },
  { keywords: ['bright mode', 'brightness'],                          type: 'app',    key: 'brightMode'  },
  { keywords: ['tutorial', 'caddie guidance', 'how do i use'],        type: 'app',    key: 'tutorial'    },
  { keywords: ['how does voice', 'voice work', 'how do i talk'],      type: 'app',    key: 'voiceMode'   },
  // Course
  { keywords: ['how far', 'distance', 'how many yards', 'yardage'],  type: 'course', key: 'distance'    },
  { keywords: ['what should i hit', 'what club', 'which club'],       type: 'course', key: 'club'        },
  { keywords: ['wind', 'breeze', 'into the wind', 'downwind'],        type: 'course', key: 'wind'        },
  { keywords: ['putt', 'putting', 'on the green', 'pace'],            type: 'course', key: 'putting'     },
  { keywords: ['chip', 'pitch', 'short game', 'around the green'],    type: 'course', key: 'shortGame'   },
  { keywords: ['bunker', 'sand', 'trap'],                              type: 'course', key: 'bunker'      },
  { keywords: ['strategy', 'layup', 'play it safe', 'course management'], type: 'course', key: 'strategy' },
  // Game
  { keywords: ["what's my miss", 'my miss', 'what do i miss', 'where do i miss'], type: 'game', key: 'miss'     },
  { keywords: ['right miss', 'missing right', 'slice', 'push', 'fading'],          type: 'game', key: 'missRight' },
  { keywords: ['left miss', 'missing left', 'hook', 'pull', 'pulling'],            type: 'game', key: 'missLeft'  },
  { keywords: ['what am i doing wrong', 'what do i do wrong', "why can't i hit"],  type: 'game', key: 'error'     },
  { keywords: ['tempo', 'rhythm', 'too fast', 'rushing', 'slow down'],             type: 'game', key: 'tempo'     },
  { keywords: ['topping', 'thin', 'skulling'],                                      type: 'game', key: 'topping'   },
  { keywords: ['fat', 'chunk', 'heavy', 'hitting it fat'],                          type: 'game', key: 'fat'       },
  { keywords: ['nervous', 'mental', 'pressure', 'focus', 'yips', 'anxious'],       type: 'game', key: 'mental'    },
];

// ── Intent detector ───────────────────────────────────────────────────────────

/**
 * detectIntent(transcript)
 * Returns the first matching questionMap entry, or null if none match.
 *
 * @param {string} transcript
 * @returns {{ keywords: string[], type: string, key: string } | null}
 */
export function detectIntent(transcript) {
  const lower = (transcript ?? '').toLowerCase();
  for (const item of questionMap) {
    if (item.keywords.some((k) => lower.includes(k))) {
      return item;
    }
  }
  return null;
}

// ── Domain classifier (for AI prompt tuning) ─────────────────────────────────

/**
 * classifyDomain — derives domain from a transcript when no intent entry matched.
 * Used to pick the right system prompt tone for OpenAI fallback.
 *
 * @param {string} transcript
 * @returns {'app' | 'course' | 'game'}
 */
export function classifyDomain(transcript) {
  const intent = detectIntent(transcript);
  if (intent) return intent.type;
  const t = (transcript ?? '').toLowerCase();
  if (/smartvision|tutorial|bright mode|voice|settings|how does|what is/.test(t)) return 'app';
  if (/hole|pin|flag|hazard|bunker|water|wind|layup|yardage|distance|course/.test(t)) return 'course';
  if (/miss|slice|hook|pull|push|tempo|rhythm|topping|fat|fix|swing|grip/.test(t)) return 'game';
  return 'course';
}

// ── Response builder ─────────────────────────────────────────────────────────

/**
 * buildResponse(type, data, mode)
 *
 * Confidence levels:
 *   high   — use data.positive (calm, affirming lead)
 *   medium — short: data.base / detailed: data.medium
 *   low    — use data.low (hedged, conservative)
 *
 * Short mode always uses the base/shortest version regardless of confidence.
 * No hype words, no exclamation points.
 *
 * @param {'app' | 'course' | 'game'} type
 * @param {object} data
 * @param {'short' | 'detailed'} mode
 * @returns {string}
 */
export function buildResponse(type, data, mode = 'short') {
  if (!data) return FALLBACK_RESPONSE;

  // ── Confidence-aware selection ──────────────────────────────────────────
  // Short mode: always cleanest version — no extra phrasing
  if (mode === 'short') {
    return _shortText(type, data) ?? FALLBACK_RESPONSE;
  }

  // Detailed mode: factor in confidence
  const confidence = data.confidence ?? 'high';

  if (confidence === 'high') {
    return data.positive ?? _shortText(type, data) ?? FALLBACK_RESPONSE;
  }
  if (confidence === 'medium') {
    return data.medium ?? _shortText(type, data) ?? FALLBACK_RESPONSE;
  }
  if (confidence === 'low') {
    return data.low ?? _shortText(type, data) ?? FALLBACK_RESPONSE;
  }

  return _shortText(type, data) ?? FALLBACK_RESPONSE;
}

/** Returns the shortest/base text for a given domain type. */
function _shortText(type, data) {
  if (type === 'app')    return data.base ?? data.short ?? data.what ?? null;
  if (type === 'course') return data.base ?? data.recommendation ?? null;
  if (type === 'game')   return data.base ?? data.pattern ?? null;
  return data.base ?? data.short ?? data.recommendation ?? data.pattern ?? null;
}

// ── Local response library ────────────────────────────────────────────────────
// Keys match questionMap[].key exactly.
// Each entry has:
//   domain      — 'app' | 'course' | 'game'
//   confidence  — 'high' | 'medium' | 'low'
//   base        — short mode text (always clean, no hedging)
//   positive    — high confidence detailed lead (calm, not hyped)
//   medium      — medium confidence phrasing
//   low         — low confidence / need more data
// Context-injecting entries are functions returning the same shape.

export const LOCAL_RESPONSES = {
  // ── App (confidence always high — these are factual) ─────────────────────
  smartvision: {
    domain: 'app',
    confidence: 'high',
    base: 'Shows your ball flight after each shot.',
    positive: 'Shot Vision tracks your ball flight in real-time.',
    medium: 'Shot Vision tracks ball flight — tap the camera after a shot.',
    low: 'Shot Vision is the camera feature — try it after your next shot.',
    // legacy fields kept for safety
    short: 'Shows your ball flight after each shot.',
    what: 'It tracks your ball flight in real-time',
    how: 'Tap the camera icon after a shot to replay it',
  },
  brightMode: {
    domain: 'app',
    confidence: 'high',
    base: 'Increases contrast for outdoor sunlight.',
    positive: 'Bright mode is built for outdoor sunlight.',
    medium: 'Bright mode boosts contrast — toggle it in the tools menu.',
    low: 'Try bright mode if the screen is hard to read outside.',
    short: 'Increases contrast for outdoor sunlight.',
    what: 'Bright mode boosts contrast for outdoor use',
    how: 'Toggle it in the tools menu on any screen',
  },
  voiceMode: {
    domain: 'app',
    confidence: 'high',
    base: 'Speak to get caddie advice hands-free.',
    positive: 'Tap the mic and ask anything — I answer based on your round.',
    medium: 'Tap the mic and ask about your shot or the hole.',
    low: 'Try tapping the mic and asking a question.',
    short: 'Speak to get caddie advice hands-free.',
    what: 'Tap the mic and ask anything',
    how: 'I answer based on your shot pattern and the hole',
  },
  tutorial: {
    domain: 'app',
    confidence: 'high',
    base: 'Walks you through every feature.',
    positive: 'The tutorial covers every feature step by step.',
    medium: 'Find the tutorial under CADDIE Guidance in the tools menu.',
    low: 'Try the tutorial under CADDIE Guidance in tools.',
    short: 'Walks you through every feature.',
    what: 'The tutorial covers all features step by step',
    how: 'Find it under CADDIE Guidance in the tools menu',
  },

  // ── Course (confidence driven by context availability) ───────────────────
  distance: (ctx) => ({
    domain: 'course',
    confidence: ctx?.distance ? 'high' : 'low',
    base: ctx?.distance
      ? `${ctx.distance} yards to the pin.`
      : 'Check your rangefinder for the exact yardage.',
    positive: ctx?.distance
      ? `${ctx.distance} yards — good number.`
      : 'Check your rangefinder for the exact yardage.',
    medium: ctx?.distance
      ? `${ctx.distance} yards to the pin.`
      : 'Check your rangefinder for the exact yardage.',
    low: 'Check your rangefinder for the exact yardage.',
    recommendation: ctx?.distance
      ? `${ctx.distance} yards to the pin.`
      : 'Check your rangefinder for the exact yardage.',
  }),
  club: (ctx) => ({
    domain: 'course',
    confidence: ctx?.club ? 'high' : 'medium',
    base: ctx?.club
      ? `${ctx.club} is the play here.`
      : 'Take one more club — most amateurs miss short.',
    positive: ctx?.club
      ? `${ctx.club} fits this perfectly. Commit to it.`
      : 'Take one more club than you think.',
    medium: ctx?.club
      ? `${ctx.club} looks right here. Play it smooth.`
      : 'Lean toward one more club — most miss short.',
    low: ctx?.club
      ? `Probably ${ctx.club}. Play it safe.`
      : 'When in doubt, take one more club.',
    recommendation: ctx?.club
      ? `${ctx.club} is the right call here. Commit to it.`
      : 'Take one more club — most amateurs miss short.',
  }),
  strategy: (ctx) => ({
    domain: 'course',
    confidence: ctx?.missPattern ? 'high' : 'medium',
    base: ctx?.missPattern === 'right'
      ? 'Play center. Avoid right.'
      : ctx?.missPattern === 'left'
      ? 'Aim right center. Let it release.'
      : 'Miss on the side with the most room.',
    positive: ctx?.missPattern === 'right'
      ? 'Play center — keeps the right side out of play.'
      : ctx?.missPattern === 'left'
      ? 'Aim right center and let it release through.'
      : 'Play to the fat part of the green.',
    medium: ctx?.missPattern === 'right'
      ? 'Trending right — start it center.'
      : ctx?.missPattern === 'left'
      ? 'Trending left — open it up a touch.'
      : 'Play center and take the trouble out of it.',
    low: 'Play center and take what the hole gives you.',
    recommendation: ctx?.missPattern === 'right'
      ? 'Play center. Avoid right.'
      : ctx?.missPattern === 'left'
      ? 'Aim right center. Let it release.'
      : 'Miss on the side with the most room.',
  }),
  wind: {
    domain: 'course',
    confidence: 'high',
    base: 'Into the wind, take two more clubs at 75%.',
    positive: 'Two extra clubs at 75% — let the shaft do the work.',
    medium: 'Into the wind, take extra club and swing easy.',
    low: 'Take at least one extra club into the wind.',
    recommendation: 'Into the wind, take two more clubs at 75% effort.',
  },
  putting: {
    domain: 'course',
    confidence: 'high',
    base: 'Pace over line. Head still.',
    positive: 'Pace is everything here. Head still, listen for it.',
    medium: 'Focus on pace and keep your head still.',
    low: 'Start it on line and trust your pace.',
    recommendation: 'Pace over line. Head still, listen for it.',
  },
  shortGame: {
    domain: 'course',
    confidence: 'high',
    base: 'Land it on the fringe and let it roll.',
    positive: 'Land it on the fringe — let it run to the hole.',
    medium: 'Pick a landing spot and commit. Let it roll out.',
    low: 'Land it short of the flag and let it work.',
    recommendation: 'Land it on the fringe and let it roll.',
  },
  bunker: {
    domain: 'course',
    confidence: 'high',
    base: 'Open the face. Swing through the sand.',
    positive: 'Open face, swing through the sand. Commit to it.',
    medium: 'Open the face and take a full swing through the sand.',
    low: 'Open the face and swing — trust the club.',
    recommendation: 'Open the face, swing through the sand. Commit to it.',
  },

  // ── Game (confidence driven by shot count context) ────────────────────────
  miss: (ctx) => {
    const hasMiss = ctx?.missPattern && ctx.missPattern !== 'balanced';
    return {
      domain: 'game',
      confidence: hasMiss ? 'high' : 'low',
      base: hasMiss
        ? ctx.missPattern === 'right' ? "You tend to miss right." : "You tend to miss left."
        : "Not enough shots to read a pattern yet.",
      positive: hasMiss
        ? ctx.missPattern === 'right'
          ? "You tend to miss right — we can work with that."
          : "You tend to miss left — easy fix once we know it."
        : "Keep logging shots and I can read your pattern.",
      medium: hasMiss
        ? ctx.missPattern === 'right' ? "Trending right on your misses." : "Trending left on your misses."
        : "Pattern is still forming — a few more shots.",
      low: "Not enough shots yet to call a miss direction.",
      pattern: hasMiss
        ? ctx.missPattern === 'right' ? "You tend to miss right" : "You tend to miss left"
        : "Your misses look balanced",
      adjustment: hasMiss
        ? ctx.missPattern === 'right'
          ? 'Aim slightly left and swing out through impact'
          : 'Hold the face open and stay through the ball'
        : 'Keep tracking — more shots needed',
    };
  },
  error: (ctx) => {
    const hasMiss = ctx?.missPattern && ctx.missPattern !== 'balanced';
    return {
      domain: 'game',
      confidence: hasMiss ? 'medium' : 'low',
      base: hasMiss
        ? ctx.missPattern === 'right' ? "You're leaking right at impact." : "You're pulling through the ball."
        : "Need more shots to read the pattern.",
      positive: hasMiss
        ? ctx.missPattern === 'right'
          ? "The miss is right — that's fixable. Swing out through it."
          : "You're pulling it — close the chain and stay through."
        : "A few more shots and I can tell you exactly.",
      medium: hasMiss
        ? ctx.missPattern === 'right'
          ? "Looks like a right leak — check your path."
          : "Looks like a pull — keep the face square."
        : "Pattern is still forming.",
      low: "Hit a few more and I can read the pattern.",
      pattern: hasMiss
        ? ctx.missPattern === 'right' ? "You're leaking right on impact" : "You're pulling through the ball"
        : "Hard to say without more shots",
      adjustment: hasMiss
        ? ctx.missPattern === 'right'
          ? 'Focus on swinging out toward right field'
          : 'Keep the face square and stay connected'
        : 'Hit a few more and I can read the pattern',
    };
  },
  missRight: {
    domain: 'game',
    confidence: 'high',
    base: "Missing right. Aim left.",
    positive: "You're close — just starting right. Aim left center.",
    medium: "Trending right. Start it left and let it work.",
    low: "Could be right miss. Focus on your start line.",
    pattern: "You're missing right",
    adjustment: 'Aim slightly left and swing out through impact',
  },
  missLeft: {
    domain: 'game',
    confidence: 'high',
    base: "Missing left. Hold the face open.",
    positive: "You're close — just pulling it. Hold the face through impact.",
    medium: "Trending left. Stay connected and hold the face.",
    low: "Could be a pull. Focus on keeping the face square.",
    pattern: "You're pulling left",
    adjustment: 'Hold the face open and stay through the ball',
  },
  tempo: {
    domain: 'game',
    confidence: 'high',
    base: "Tempo is rushing. Pause at the top.",
    positive: "Feel a pause at the top — everything flows from there.",
    medium: "Looks like you're rushing. One-second pause at the top.",
    low: "Try slowing the transition and see if it helps.",
    pattern: 'Your tempo is rushing',
    adjustment: 'Pause one second at the top before you fire',
  },
  topping: {
    domain: 'game',
    confidence: 'high',
    base: "Topping it. Keep your head down.",
    positive: "Stay down through the ball — you're coming up early.",
    medium: "Head is lifting. Eyes on the back of the ball.",
    low: "Try staying down longer and see if contact improves.",
    pattern: "You're topping it",
    adjustment: 'Keep your head down and eyes on the back of the ball',
  },
  fat: {
    domain: 'game',
    confidence: 'high',
    base: "Hitting it fat. Shift weight forward.",
    positive: "Weight forward earlier — you're bottoming out behind the ball.",
    medium: "Looks like you're getting stuck. Shift forward and stay over it.",
    low: "Try pressing your weight forward at address and see if it helps.",
    pattern: "You're hitting it fat",
    adjustment: 'Shift your weight forward earlier and stay over the ball',
  },
  mental: {
    domain: 'game',
    confidence: 'high',
    base: "Reset. One target, two breaths.",
    positive: "You've got this. One target, two breaths, commit.",
    medium: "Take a breath. Pick one target and go.",
    low: "Take a moment. Reset and trust the swing you have.",
    pattern: 'Reset your mind',
    adjustment: 'One target, two breaths, commit fully',
  },
};

// ── Primary entry point ───────────────────────────────────────────────────────

/**
 * matchLocalResponse(transcript, context, mode)
 *
 * Uses detectIntent → LOCAL_RESPONSES[key] → buildResponse pipeline.
 * Returns the built string, or null to fall through to OpenAI.
 *
 * @param {string} transcript
 * @param {object} context  — { distance?, club?, missPattern?, hole?, par? }
 * @param {'short' | 'detailed'} mode
 * @returns {string | null}
 */
export function matchLocalResponse(transcript, context, mode = 'short') {
  const intent = detectIntent(transcript);
  if (!intent) return null;

  const entry = LOCAL_RESPONSES[intent.key];
  if (!entry) return null;

  // Context-aware entries are functions; static entries are plain objects
  const data = typeof entry === 'function' ? entry(context) : entry;

  return buildResponse(intent.type, data, mode);
}

// ── Post-AI response formatter ────────────────────────────────────────────────

/**
 * formatAIResponse(rawText, mode)
 *
 * Applies length limits to any AI-generated text:
 *   short    — 1 sentence, max 12 words
 *   detailed — up to 2 sentences
 *
 * @param {string} rawText
 * @param {'short' | 'detailed'} mode
 * @returns {string}
 */
export function formatAIResponse(rawText, mode = 'short') {
  if (!rawText) return FALLBACK_RESPONSE;

  const sentences = rawText
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  if (mode === 'short') {
    const first = sentences[0] ?? '';
    const words = first.split(/\s+/).slice(0, 12).join(' ');
    return /[.!?]$/.test(words) ? words : words + '.';
  }

  return sentences.slice(0, 2).join(' ');
}

