/**
 * 2026-06-13 (Cecily) — "Can the caddie sing the songs?"
 *
 * The caddie's voice is TTS, so it can't truly SING — but it can give a charming,
 * self-aware ATTEMPT: a short, joyful, kid-friendly few lines delivered with
 * sing-song flair. This detects a sing request in what the player said and reshapes
 * it into a brain prompt that makes the caddie give it a go (instead of refusing or
 * answering flat). The reply is then spoken by the normal voice path.
 *
 * Pure, sync, never throws → unit-tested. Honest: it's an *attempt* to sing, framed
 * playfully ("I'm no Beyoncé, but here goes 🎵"), not a claim of real singing.
 * Distinct from the "play [song]" YouTube portal — sing = the caddie performs; play =
 * pull up the real track. See memory: youtube-song-portal (planned).
 */

export interface SingRequest {
  /** The song the player asked for, or null for "sing me a song" / "sing something". */
  song: string | null;
}

/**
 * Detect a request for the caddie to SING. Returns the (optional) song, or null when
 * it isn't a sing request. Narrow on purpose — "sing" must be the request verb, not
 * incidental ("singing my praises").
 */
export function detectSingRequest(raw: string): SingRequest | null {
  const t = (raw ?? '').trim();
  if (!t || !/\bsing\b/i.test(t)) return null;
  // Guard against non-requests that contain "sing".
  if (/\b(sing(?:ing)?\s+(?:my|your|his|her|their)\s+praises|singing\s+in\s+the)\b/i.test(t)) return null;
  // Pull the song after the "sing [me/us/along] [a song] [called/about]" lead-in.
  const m = t.match(
    /\bsing(?:\s+(?:me|us|along))?(?:\s+a\s+song)?(?:\s+(?:called|about|named|that\s+goes|the\s+song))?\s*(.*)$/i,
  );
  const tail = (m?.[1] ?? '')
    .replace(/^(?:the\s+song|a\s+song|me|us|for\s+me|please)\s+/i, '')
    .replace(/\bplease\b[?.!]*$/i, '')
    .replace(/[?.!]+$/, '')
    .trim();
  return { song: tail.length > 1 ? tail : null };
}

/**
 * Build the brain prompt that makes the caddie playfully attempt the song. Honest +
 * kid-friendly; explicit "don't refuse, the fun is the attempt."
 */
export function buildSingMessage(song: string | null): string {
  const what = song ? `"${song}"` : 'a fun little song';
  return (
    `[SING REQUEST] Give ${what} a playful go right now — actually attempt to "sing" it. ` +
    `You're a golf caddie, not a pro singer, so be charming and self-aware about it (a quick wink ` +
    `like "I'm no superstar, but here goes 🎵"), then deliver a SHORT, joyful, kid-friendly bit ` +
    `— a line or two with a sing-song feel and a 🎵 here and there. Keep it warm and brief. ` +
    `Do NOT refuse and do NOT say you can't sing — the whole point is the fun attempt.`
  );
}
