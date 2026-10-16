/**
 * IS THIS UTTERANCE A COMMAND? — ONE ANSWER, SHARED BY EVERY PRE-BRAIN SHORTCUT.
 *
 * 2026-10-15 (review of the pre-brain intercepts). Two places act on what the player said BEFORE the
 * caddie hears it: services/localIntentPrecheck (every voice/typed surface) and the tab-avatar
 * bypasses in hooks/useVoiceCaddie. Both match on WORDS, and words do not say whether they were an
 * instruction:
 *
 *   "Should I go for it?"                         → risk mode set to aggressive
 *   "I birdied this hole last year"               → a 3 logged on this hole
 *   "How long is the next hole?"                  → advanced to the next hole
 *   "I need to find my swing"                     → yanked to the swing library mid-round
 *   "Is that out of bounds?"                      → a penalty stroke added
 *   "How far is the carry?"                       → "You're 152 yards to the center."
 *
 * Every one of those was a question or a story the caddie should have answered, replaced by an act
 * the player never asked for — several of them changing the round. The rule the precheck's own router
 * comment states — *the precheck matches COMMANDS; routing a command is not answering a question* —
 * was being enforced per regex, and each regex enforced it differently or not at all. It belongs to
 * the DISPATCHER, once, so the next pattern somebody adds inherits it.
 *
 * WHAT IS NOT A COMMAND:
 *   · a question — it opens with an interrogative/auxiliary ("should", "is", "what", "did" …) or
 *     ends with "?";
 *   · a story — negated, past or hypothetical framing ("haven't", "never", "didn't", "wish",
 *     "last year", "yesterday", "should have" …).
 *
 * WHAT STILL IS: a polite request is a command in English. "Can you open SmartFinder", "could you
 * pull up my last round", "will you mark the pin" all name an action verb straight after "can you" —
 * that shape is exempt. "Would you go for it?" asks for an opinion and names no action verb, so it
 * stays a question.
 *
 * Pure and dependency-free so both callers (and their tests) can import it.
 */

/** Fillers and a vocative ("Kevin, …") that may precede the real first word. */
const LEAD_IN = String.raw`^(?:(?:hey|ok|okay|yo|so|um|uh|hi|well|and|but|alright|all\s+right)[\s,]+)*(?:[a-z]+,\s*)?`;

const INTERROGATIVE_OPENER = new RegExp(
  LEAD_IN
  + String.raw`(?:should|shall|can|could|do|does|did|is|are|am|was|were|what|what'?s|how|how'?s|how'?d|why|when|where|where'?s|which|who|would|will|have|has|had|`
  + String.raw`isn'?t|aren'?t|don'?t|doesn'?t|didn'?t|wasn'?t|won'?t|wouldn'?t|shouldn'?t|can'?t)\b`,
  'i',
);

/** "Can you / could you / will you (please) <action verb>" and "can I see/get/have …" are requests. */
const POLITE_REQUEST = new RegExp(
  LEAD_IN
  + String.raw`(?:(?:can|could|would|will)\s+(?:you|we)\s+(?:please\s+)?(?:just\s+)?`
  + String.raw`(?:open|pull\s+up|bring\s+up|show|read|look\s+at|check|log|mark|put|score|card|switch|change|turn|undo|scratch|delete|`
  + String.raw`take\s+me|go\s+to|start|record|watch|set|add|save|remember|find|close|exit|move|skip|play|begin|launch|load|import|scan|size\s+up|analy[sz]e)\b`
  + String.raw`|(?:can|could|may)\s+i\s+(?:please\s+)?(?:see|get|have)\b)`,
  'i',
);

const STORY_FRAME =
  /\b(?:haven'?t|hasn'?t|have\s+not|has\s+not|never|didn'?t|did\s+not|wish|last\s+(?:year|time|week|month|season)|yesterday|would\s+have|would'?ve|should\s+have|should'?ve|could\s+have|could'?ve)\b/i;

/** True when the utterance is shaped like a question (and is not a polite request). */
export function isQuestionShaped(utterance: string): boolean {
  const t = (utterance ?? '').trim();
  if (!t) return false;
  if (POLITE_REQUEST.test(t)) return false;
  return INTERROGATIVE_OPENER.test(t) || /\?\s*$/.test(t);
}

/** True when the utterance is told as a story — negated, past or hypothetical — not given as an order. */
export function isStoryFramed(utterance: string): boolean {
  return STORY_FRAME.test(utterance ?? '');
}

/**
 * The shared guard: true when a pre-brain shortcut must NOT act on this utterance, because it is a
 * question or a story rather than an instruction. Callers send it to the caddie instead.
 */
export function isNotACommand(utterance: string): boolean {
  return isQuestionShaped(utterance) || isStoryFramed(utterance);
}
