/**
 * THE TAB-AVATAR VOICE BYPASSES — which short utterances the on-screen mic acts on without the caddie.
 *
 * Moved out of hooks/useVoiceCaddie (2026-10-15) so the rule can be tested against the real phrase
 * lists; the hook still performs the effects (penalty, hero moment, vision, mute) in checkBypasses.
 *
 * 2026-10-15 (review) — the 6-word cap in matchesCommand kept out long sentences but not QUESTIONS,
 * and these act before the brain:
 *
 *   "Is that out of bounds?" / "Is that a penalty?" / "Do I take a drop?" / "I lost it right"
 *                                                     → a penalty stroke added to the card
 *   "How far to the bunker?" / "How far is the carry?" / "How far to clear the creek?"
 *                                                     → "You're 152 yards to the center." — a
 *                                                       different question answered, the real one
 *                                                       never reaching the caddie (the 08-23 rule:
 *                                                       questions reach the caddie)
 *   "What do you see here?"                           → SmartVision opened
 *
 * Now: the penalty bypass fires only on an explicit penalty COMMAND, the yardage shortcut only when the
 * WHOLE utterance is a bare yardage ask (anything naming a target goes to the caddie, who has the
 * hazards), and the penalty and vision bypasses both refuse a question or a story through the same
 * guard the local precheck uses (services/utteranceIsCommand).
 */
import { isNotACommand } from './utteranceIsCommand';

/**
 * Whole-utterance matches only (see YARDAGE in tabBypassKind). Each of these means exactly "how far am
 * I", which the resolved yardage answers. "How far to the bunker" does not, and is no longer caught.
 */
export const YARDAGE_PHRASES = [
  "what's my yardage",
  'what is my yardage',
  'my yardage',
  'yardage',
  'how far',
  'how far am i',
  'how many yards',
  "what's the distance",
  'distance to the green',
  'how far to the green',
  'cuántas yardas',
  'distancia al green',
];

export const HERO_PHRASES = [
  'did you get that',
  'save that',
  'save that shot',
  'save that one',
  'hero reel',
  "that's a keeper",
  // 2026-07-20 (bug-hunt fix) — removed bare "got that" / "save it": too colloquial,
  // they fired the hero-reel on ordinary speech ("you got that right", "save it for
  // the back nine") and dropped the user's real question. The specific phrases above
  // still catch a genuine "save that shot".
];

export const HERO_VIEW_PHRASES = [
  'show me my hero reel',
  'show my best shots',
  'show me my best',
  'hero reel',
  'my best shots',
  'show me my drives',
  'show me my irons',
];

/**
 * 2026-10-15 (review) — EXPLICIT penalty commands only. "out of bounds", "lost it", "lost ball",
 * "in the water", "ob" and "take a drop" describe what HAPPENED (or ask about it — "is that out of
 * bounds?", "do I take a drop?"), and a free drop or a provisional is not a penalty. Those now reach
 * the classifier / caddie, whose log_shot rule records a penalty only when the player is actively
 * reporting one (api/voice-intent). Earlier history: bare "water" / "drop" were removed 2026-07-20.
 */
export const PENALTY_PHRASES = [
  'penalty',
  'penalty stroke',
  'add a penalty',
  'add a penalty stroke',
  'penalty drop',
  'one stroke penalty',
];

export const MUTE_PHRASES = [
  'mute',
  'be quiet',
  'stop talking',
  'silence',
  // 2026-07-20 (bug-hunt fix) — removed bare "quiet": it muted on ordinary speech
  // ("the greens are quiet today"). "be quiet" / "mute" / "stop talking" still work.
  'silenciar',
];

/** 2026-10-15 — "what do you see" removed: it is a question, and it opened a camera tool. */
export const VISION_PHRASES = [
  'smart vision',
  'analyze the hole',
  'analyze this hole',
  'read the hole',
  'hole analysis',
];

// 2026-07-20 (bug-hunt fix) — the caddie voice bypasses (penalty / hero / mute / vision /
// yardage shortcuts) used raw `transcript.includes(phrase)` substring matching, so:
//   • a 2-char token like "ob" matched INSIDE ordinary words ("problem", "probably", "job"),
//     silently adding a penalty stroke and dropping the user's real question;
//   • single words ("water", "drop", "quiet") matched anywhere in a long conversational
//     sentence and fired the wrong action.
// matchesCommand fixes both: a bypass only fires when the utterance is SHORT (a command,
// not a question) AND the phrase appears as WHOLE WORDS — never as a substring inside a
// longer word, and never buried in a long sentence (those route to the brain instead).
export const normalizeUtterance = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export const matchesCommand = (raw: string, phrases: string[], maxWords = 6): boolean => {
  const t = normalizeUtterance(raw);
  if (!t) return false;
  // A real question ("what's the problem with my swing") is longer than a command
  // ("penalty", "be quiet", "hit it in the water" = 5) — cap the command length.
  if (t.split(' ').length > maxWords) return false;
  return phrases.some((p) => {
    const np = normalizeUtterance(p);
    if (!np) return false;
    // whole-word / whole-phrase match, tolerant of extra spacing between words
    const re = new RegExp(`(^|\\s)${np.replace(/\s+/g, '\\s+')}(\\s|$)`);
    return re.test(t);
  });
};

/** The whole utterance IS one of the phrases (after normalising punctuation and a trailing "please"). */
export const isExactly = (raw: string, phrases: string[]): boolean => {
  const t = normalizeUtterance(raw).replace(/^(?:hey |ok |okay |so )+/, '').replace(/ please$/, '');
  return !!t && phrases.some((p) => normalizeUtterance(p) === t);
};

export type TabBypassKind = 'penalty' | 'hero' | 'yardage' | 'vision' | 'hero_view' | 'mute';

/** Which bypass (if any) the on-screen mic should act on. Order is the hook's historical order. */
export function tabBypassKind(transcript: string, ctx: { isRoundActive: boolean; language: string }): TabBypassKind | null {
  if (ctx.isRoundActive && matchesCommand(transcript, PENALTY_PHRASES) && !isNotACommand(transcript)) return 'penalty';
  if (matchesCommand(transcript, HERO_PHRASES)) return 'hero';
  // Non-English yardage queries skip the bypass so Kevin answers in the player's language via the
  // full voice-intent pipeline. Only English gets the hardcoded shortcut — and only for a BARE ask.
  if (ctx.language === 'en' && isExactly(transcript, YARDAGE_PHRASES)) return 'yardage';
  if (matchesCommand(transcript, VISION_PHRASES) && !isNotACommand(transcript)) return 'vision';
  if (matchesCommand(transcript, HERO_VIEW_PHRASES)) return 'hero_view';
  if (matchesCommand(transcript, MUTE_PHRASES)) return 'mute';
  return null;
}
