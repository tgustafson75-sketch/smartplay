/**
 * 2026-06-13 — Music intent detectors (pure, no imports → unit-testable).
 *
 * Split out of playSongFlow (which imports expo-router) so the detection logic can be
 * tested in the sim harness. "play [song]" → the clean YouTube portal; the sing
 * detector lives in singAttempt. Narrow on purpose: golf "play" phrases are excluded
 * so on-course chatter is never hijacked.
 */

/** A word that makes "play" about music whatever else the sentence says. */
const MUSIC_CUE = /\b(?:song|songs|music|tune|tunes|playlist|album|youtube|spotify|radio)\b/i;
/**
 * "play" / "put on" as a command to the caddie: first thing said, after an optional greeting or his
 * name, optionally asked politely. A question ("should I play", "how would you play") or a statement
 * about the player ("I'd play") never matches.
 */
const REQUEST_LEAD = /^(?:(?:hey|ok|okay|yo)\s+)?(?:(?!(?:i|we|you|they|he|she|it|i'll|i'd|we'll|we'd)\b)[a-z']+,?\s+)?(?:(?:please\s+)?(?:can|could|will|would)\s+you\s+(?:please\s+)?|please\s+|go\s+ahead\s+and\s+|just\s+)?(?:play|put\s+on)\b/i;
/**
 * What follows "play" in a shot decision or a rules call: a club, a number, a direction, a shape, a
 * piece of the hole, the ball, a lie, a provisional, a local rule ("play it as it lies", "play it
 * down", "play two clubs more", "play winter rules", "play preferred lies").
 */
const GOLF_TARGET = /^(?:(?:a|an|the|my|your|this|that|it|one|another)\s+)?(?:\d|one|two|three|four|five|half|driver|wood|woods|hybrid|hybrids|iron|irons|wedge|wedges|putter|pw|gw|sw|lw|club|clubs|ball|balls|lie|lies|provisional|preferred|winter|lift|percentages|position|stance|front|back|left|right|short|long|high|low|up|down|as|where|aggressive|conservative|draw|fade|cut|hook|slice|punch|bump|chip|lay|layup|hole|shot|tee|green|fairway|pin|flag|wind|break|line|off|for|to|from|into|over|under|around|at)\b/i;
/** Asked politely ("can you play …?") — the one request form that legitimately ends in '?'. */
const POLITE_ASK = /\b(?:can|could|will|would)\s+you\s+(?:please\s+)?(?:play|put\s+on)\b/i;
/** A song-shaped object: a quoted title, or "<title> by <artist>". */
const SONG_SHAPE = /["“][^"”]{2,}["”]|\S\s+by\s+[a-z]/i;

export function detectPlaySongRequest(raw: string): { query: string } | null {
  const t = (raw ?? '').trim();
  if (!t || !/\b(play|put\s+on)\b/i.test(t)) return null;
  // "how do I play this / how to play …" is a HELP question, not a song request.
  if (/\bhow\s+(?:do\s+i|to|can\s+i|should\s+i|does\s+(?:this|it))\s+play\b/i.test(t)) return null;
  // IN-APP playback targets — the word "play" must NOT trip YouTube here. "play my
  // last swing / the clip / that back / replay / my round/shot" are app actions, not
  // songs (Tim: "we don't want the word play in this app to break things").
  if (/\b(swing|clip|recording|replay|video\s+of\s+my|my\s+round|my\s+shot|last\s+shot)\b/i.test(t)) return null;
  if (/\bplay\s+(?:it|that|this)\s+back\b/i.test(t)) return null;
  // Exclude golf / app "play" phrases so we don't hijack on-course speech.
  if (/\bplay\s+(?:a\s+|the\s+)?(?:round|golf|nine|18|eighteen|hole|through|it\s+safe|safe|again|on|smart|the\s+\d)\b/i.test(t)) return null;
  if (/\blet'?s\s+play\b/i.test(t) && !/\bsong\b/i.test(t)) return null;
  /**
   * 2026-10-28 (Brain review r2) — "play" is the commonest verb in a CADDIE question. "Should I play a
   * 7 iron here?", "How would you play this hole?", "What should I play off the tee?", "Should I play
   * it left or right?" all opened the jukebox with whatever golf video came back, and the club call
   * never reached the brain — on every route, since the earbud, typed box and watch run this step.
   *
   * So without a MUSIC word, "play" is a song request only as a command to the caddie ("play …",
   * "Kevin, put on …", "can you play …"), never as a question he is asked, and never when what
   * follows is a club, a number, a direction or a piece of the hole.
   */
  if (!MUSIC_CUE.test(t)) {
    if (!REQUEST_LEAD.test(t)) return null;
    /**
     * 2026-10-28 (Brain review r3) — the lead alone let "Play the ball back in my stance?", "Play it as
     * it lies?", "Play a provisional?" and "Play two clubs more?" through: they open with "play", and
     * the golf list did not know the ball, a lie, a rule or a number word. A command that ends in a
     * question mark is a question; only the polite "can you play …?" is still a request.
     */
    if (/\?\s*$/.test(t) && !POLITE_ASK.test(t)) return null;
  }
  const m = t.match(/\b(?:can\s+you\s+|could\s+you\s+|please\s+)?(?:play|put\s+on)(?:\s+me|\s+us|\s+the\s+song|\s+a\s+song)?\s+(.+)$/i);
  if (!m) return null;
  const query = (m[1] ?? '')
    .replace(/\bplease\b[?.!]*$/i, '')
    .replace(/[?.!]+$/, '')
    .trim();
  if (query.length < 2) return null;
  // A named song ("Down Under by Men at Work", a quoted title) is a song even when its first word is golf.
  if (!MUSIC_CUE.test(t) && GOLF_TARGET.test(query) && !SONG_SHAPE.test(query)) return null;
  return { query };
}
