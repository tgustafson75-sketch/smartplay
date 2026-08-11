/**
 * 2026-08-11 — extracted from hooks/useVoiceCaddie so both voice paths share ONE definition of
 * "the caddie just asked something".
 *
 * The rule below is not obvious, and getting it wrong has already stranded the user once:
 *
 *   2026-06-23 (Tim) — "Serena asks 'how are you feeling?' but isn't listening anymore, I have to
 *   re-tap the mic. Went through this multiple times."
 *
 * ROOT CAUSE then: the re-arm sites used `text.trim().endsWith('?')`, which is FALSE the moment the
 * question has ANY trailing text — "How are you feeling today? Take your time." / "...today?\"" /
 * "...today? 🙂". A perfectly valid question didn't re-arm the mic.
 *
 * When the earbud/global-mic path got its own re-arm on 2026-08-11, writing a second checker there
 * would have reintroduced exactly that bug on that surface — Tim's report that day was "she ends
 * with something like what's on your mind today", which is the trailing-text shape. One shared
 * function is the only way this stays fixed everywhere. [[no-half-fixes-enforce-every-surface]]
 */
export function endsAsQuestion(raw: string | null | undefined): boolean {
  const t = (raw ?? '').trim();
  if (!t) return false;
  // Strip trailing whitespace / closing quotes / brackets (Hermes-safe — no \p{Emoji} unicode-
  // property escape, which can throw on RN's engine).
  const stripped = t.replace(/[\s"'’”)\]}]+$/, '');
  if (stripped.endsWith('?')) return true;
  const lastQ = t.lastIndexOf('?');
  if (lastQ === -1) return false;
  // A question followed by only a SHORT closer (or trailing emoji) still wants an answer:
  // "How are you feeling today? Take your time." / "...today? 🙂".
  return t.slice(lastQ + 1).trim().length <= 30;
}
