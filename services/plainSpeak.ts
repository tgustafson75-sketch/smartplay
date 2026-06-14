/**
 * 2026-06-13 (Tim) — Plain-speak mode.
 *
 * Kevin can get eloquent — sometimes over the user's (or Cecily's) head. When the user
 * SIGNALS they want it simple ("explain simply", "in plain english", "in terms I can
 * understand", "I'm new", "how do I learn golf", "what does that mean"), reshape the
 * brain message so the answer comes back SHORT, plain, jargon-free, and conversational
 * (dialogue mode), inviting a follow-up. NOT a global dumb-down — only on these signals.
 *
 * Pure, no imports → unit-testable. Mirrors the singAttempt/musicIntent pattern.
 */

export function detectPlainSpeakRequest(raw: string): boolean {
  const t = (raw ?? '').trim().toLowerCase();
  if (!t) return false;
  const simple =
    /\b(?:explain|say|put|tell|keep|make)\b[\w\s']{0,15}?\bsimpl(?:e|y|er)/.test(t) ||
    /\bsimpler\b/.test(t) ||
    /\bplain (?:english|terms|words)\b/.test(t) ||
    /\bin terms i (?:can )?understand\b/.test(t) ||
    /\bdumb(?:ed)? (?:it|that|this) down\b/.test(t) ||
    /\bbreak (?:it|that|this) down\b/.test(t) ||
    /\btoo (?:complicated|technical|fancy)\b/.test(t) ||
    /\bi don'?t (?:get|understand)\b/.test(t) ||
    /\blike i'?m (?:new|a beginner|five|5|a kid)\b/.test(t) ||
    /\beli5\b/.test(t) ||
    /\bwhat (?:does|is|'?s)\b[\w\s']{0,20}?\bmean\b/.test(t);
  const beginner =
    /\b(?:i'?m (?:new|a beginner|just (?:starting|learning))|new to (?:golf|this)|how do i (?:learn|start)\b|teach me|just getting started)\b/.test(t);
  return simple || beginner;
}

/**
 * Prefix that makes the brain answer plainly + conversationally. Prepended to the
 * user's message so the rest of their question/context is preserved.
 */
export function buildPlainSpeakPrefix(): string {
  return (
    '[EXPLAIN SIMPLY] Answer in plain, everyday language — short, warm, and conversational, ' +
    'like chatting with a friend who is new to golf. No jargon; if a golf term is unavoidable, ' +
    'explain it in a few plain words. Keep it brief (a couple of sentences) and invite a quick ' +
    'follow-up so it stays a back-and-forth. Here is what they asked: '
  );
}
