/**
 * 2026-06-13 — Music intent detectors (pure, no imports → unit-testable).
 *
 * Split out of playSongFlow (which imports expo-router) so the detection logic can be
 * tested in the sim harness. "play [song]" → the clean YouTube portal; the sing
 * detector lives in singAttempt. Narrow on purpose: golf "play" phrases are excluded
 * so on-course chatter is never hijacked.
 */

export function detectPlaySongRequest(raw: string): { query: string } | null {
  const t = (raw ?? '').trim();
  if (!t || !/\b(play|put\s+on)\b/i.test(t)) return null;
  // "how do I play this / how to play …" is a HELP question, not a song request.
  if (/\bhow\s+(?:do\s+i|to|can\s+i|should\s+i|does\s+(?:this|it))\s+play\b/i.test(t)) return null;
  // Exclude golf / app "play" phrases so we don't hijack on-course speech.
  if (/\bplay\s+(?:a\s+|the\s+)?(?:round|golf|nine|18|eighteen|hole|through|it\s+safe|safe|again|on|smart|the\s+\d)\b/i.test(t)) return null;
  if (/\blet'?s\s+play\b/i.test(t) && !/\bsong\b/i.test(t)) return null;
  const m = t.match(/\b(?:can\s+you\s+|could\s+you\s+|please\s+)?(?:play|put\s+on)(?:\s+me|\s+us|\s+the\s+song|\s+a\s+song)?\s+(.+)$/i);
  if (!m) return null;
  const query = (m[1] ?? '')
    .replace(/\bplease\b[?.!]*$/i, '')
    .replace(/[?.!]+$/, '')
    .trim();
  if (query.length < 2) return null;
  return { query };
}
