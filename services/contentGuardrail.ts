// Rule-based content filter for all Kevin text-to-speech paths.
// Catches profanity and sexual/crude language before it reaches the user's ears.
// Never throws — always returns a safe result.

// ─── Blocked patterns ─────────────────────────────────────────────────────────

const BLOCKED: RegExp[] = [
  // Profanity
  /\bf+u+c+k+\w*/i,
  /\bs+h+i+t+\w*/i,
  /\bb+i+t+c+h\w*/i,
  /\bc+u+n+t\b/i,
  /\bass+h+o+l+e/i,
  // Crude body-part terms (sexual context; includes "pussy willows" failure mode)
  /\bp+u+s+s+[yi]\w*/i,
  /\bc+o+c+k\b/i,
  /\bd+i+c+k\b/i,
  /\bb+o+n+e+r\b/i,
  // Explicit sexual language
  /\b(sex+ual+ly?|horny|erect+ion|orgasm|masturbat\w*)\b/i,
  // Slurs / derogatory
  /\bwh+o+r+e\b/i,
  /\bsl+u+t\b/i,
];

// ─── Fallback lines ───────────────────────────────────────────────────────────

const FALLBACKS = [
  "Let's keep it on the fairway — what else can I help with?",
  "That one's out of bounds. Ask me something golf-related.",
  "I'll leave that one alone. What's your next shot?",
];

let fallbackIdx = 0;

// ─── Public API ───────────────────────────────────────────────────────────────

export interface GuardrailResult {
  safe: boolean;
  text: string;
  /** audioBase64 is nulled out when content is blocked — dirty audio must not play. */
  audioBase64: string | null;
}

/**
 * Check Kevin brain output before it reaches TTS or the UI.
 * Returns the original values unchanged when clean; returns a safe fallback
 * and null audioBase64 when blocked.
 */
export function checkContent(text: string, audioBase64: string | null = null): GuardrailResult {
  const isBlocked = BLOCKED.some(p => p.test(text));
  if (!isBlocked) return { safe: true, text, audioBase64 };

  const fallback = FALLBACKS[fallbackIdx % FALLBACKS.length];
  fallbackIdx++;

  console.warn('[guardrail] blocked — flagged text snippet:', text.slice(0, 80));

  return { safe: false, text: fallback, audioBase64: null };
}
