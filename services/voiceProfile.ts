/**
 * voiceProfile — Caddie voice formatter.
 *
 * Enforces the caddie voice character:
 *   • Calm, confident, brief, supportive
 *   • Max 2 sentences
 *   • No filler words, no number overload, no redundancy
 *
 * Usage:
 *   import { formatVoiceMessage } from '../services/voiceProfile';
 *   const clean = formatVoiceMessage(rawText);
 *   await speakJob(clean, PRIORITY.SHOT);
 */

// ---------------------------------------------------------------------------
// Filler words / phrases to strip
// ---------------------------------------------------------------------------

const FILLER_PATTERNS: RegExp[] = [
  // Hedging openers
  /\b(so|well|okay|ok|um|uh|right|now then|alright,)\s+/gi,
  // Intensifiers that pad without adding meaning
  /\b(very|really|actually|basically|literally|just|simply|definitely|absolutely|certainly)\s+/gi,
  // Wordy transitions
  /\b(as you can see|you know|i mean|in other words|at the end of the day|having said that)\b[,.]?\s*/gi,
  // Emotional padding
  /\b(don'?t worry|no worries|that'?s (okay|fine|alright)|you'?ve got this — )\s*/gi,
];

// ---------------------------------------------------------------------------
// Number normaliser — replace bare digit strings > 3 digits with approximations
// (prevents "You need to carry the ball 147.3 yards to clear the hazard")
// ---------------------------------------------------------------------------

function compressNumbers(text: string): string {
  // Keep 1–3 digit numbers as-is (distances like "145 yards" are fine)
  // Strip decimal precision: "147.3 yards" → "147 yards"
  return text.replace(/(\d+)\.\d+/g, '$1');
}

// ---------------------------------------------------------------------------
// Split into sentences
// ---------------------------------------------------------------------------

function toSentences(text: string): string[] {
  // Split on . ! ? followed by space or end-of-string
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Deduplicate — remove sentences that are semantic near-duplicates
// (same first 4 words)
// ---------------------------------------------------------------------------

function deduplicate(sentences: string[]): string[] {
  const seen = new Set<string>();
  return sentences.filter((s) => {
    const key = s.toLowerCase().split(/\s+/).slice(0, 4).join(' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Ensure sentence ends with punctuation
// ---------------------------------------------------------------------------

function ensurePunctuation(s: string): string {
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

// ---------------------------------------------------------------------------
// formatVoiceMessage(text)
// ---------------------------------------------------------------------------

/**
 * Clean and shorten any caddie text to match the calm, confident voice profile.
 *
 * Steps:
 *   1. Strip filler words
 *   2. Compress decimal numbers
 *   3. Split into sentences
 *   4. Remove duplicate sentences
 *   5. Keep max 2 sentences
 *   6. Ensure each sentence ends with punctuation
 */
export function formatVoiceMessage(text: string): string {
  if (!text?.trim()) return '';

  let out = text.trim();

  // 1. Strip fillers
  for (const pattern of FILLER_PATTERNS) {
    out = out.replace(pattern, '');
  }

  // 2. Compress numbers
  out = compressNumbers(out);

  // 3–4. Split + deduplicate
  const sentences = deduplicate(toSentences(out));

  // 5. Max 2 sentences
  const capped = sentences.slice(0, 2);

  // 6. Punctuation
  return capped.map(ensurePunctuation).join(' ');
}
