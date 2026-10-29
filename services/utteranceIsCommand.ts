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
 *     "last year", "yesterday", "should have" …), a HABIT ("always", "every time", "usually",
 *     "once"), or REPORTED speech ("told me", "no way I …");
 *   · about someone else — "my partner got a 4", "the guys ahead parred it", "he made a 5". The
 *     player is telling the caddie what happened in his group, not giving it an order;
 *   · a conditional or a plan — "if I go for it and miss", "let me know when", "after this hole",
 *     "later", "tomorrow". The act is for a moment that has not arrived.
 *
 * WHAT STILL IS: a polite request is a command in English. "Can you open SmartFinder", "could you
 * pull up my last round", "will you mark the pin" all name an action verb straight after "can you" —
 * that shape is exempt. "Would you go for it?" asks for an opinion and names no action verb, so it
 * stays a question.
 *
 * Pure and dependency-free so both callers (and their tests) can import it.
 */

/**
 * Fillers and a vocative ("Kevin, …") that may precede the real first word.
 *
 * 2026-10-28 (Brain recheck r10) — "actually", "oh", "by the way", and the caddie's own name with no
 * comma. Speech-to-text drops the comma more often than not, so "Kevin I'm left handed" and "actually
 * I'm a lefty" missed every whole-utterance pattern built on this and went to a brain that cannot
 * change the setting. A bare name is accepted only for the caddies themselves: any other first word
 * without a comma is the sentence, not a vocative. Fillers may follow the vocative too ("Kevin,
 * actually …").
 */
const FILLER = String.raw`(?:hey|ok|okay|yo|so|um|uh|oh|hi|well|and|but|actually|alright|all\s+right|by\s+the\s+way|kevin|serena)`;
export const LEAD_IN = String.raw`^(?:${FILLER}[\s,]+)*(?:[a-z]+,\s*)?(?:${FILLER}[\s,]+)*`;

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

/**
 * 2026-10-28 (Brain review r4) — habits and reported speech are stories too. "Every time I go
 * aggressive here I make double" set risk mode to aggressive, "I always go conservative off the tee
 * and still make bogey" set it to safe, "my buddy told me to just go for it" and "theres no way I go
 * for it from here" did the same — each a player TALKING about the decision, which only the caddie
 * can answer. "Once" is a habit/past marker ("I birdied this hole once"), not "once more".
 */
const NEGATED = String.raw`haven'?t|hasn'?t|have\s+not|has\s+not|never|didn'?t|did\s+not`;
const PAST_OR_HYPOTHETICAL = String.raw`wish|last\s+(?:year|time|week|month|season)|yesterday|would\s+have|would'?ve|should\s+have|should'?ve|could\s+have|could'?ve|used\s+to`;
const HABITUAL = String.raw`always|usually|normally|typically|every\s*time|whenever|tends?\s+to|once(?!\s+(?:more|again))`;
const REPORTED = String.raw`(?:told|tells|telling)\s+me|no\s+way`;
const STORY_FRAME = new RegExp(String.raw`\b(?:${NEGATED}|${PAST_OR_HYPOTHETICAL}|${HABITUAL}|${REPORTED})\b`, 'i');
const PAST_OR_HYPOTHETICAL_RX = new RegExp(String.raw`\b(?:${PAST_OR_HYPOTHETICAL})\b`, 'i');
const HABITUAL_RX = new RegExp(String.raw`\b(?:${HABITUAL})\b`, 'i');

/**
 * 2026-10-28 (Brain review r4) — SOMEONE ELSE IS THE SUBJECT. The score patterns accept a missing
 * subject on purpose ("got a 4", "parred it" — how a player talks mid-round), so they also accepted
 * every other player's: "My partner got a 4 there", "The guys ahead parred it", "My dad birdied this
 * hole once", "He made a 5" each went onto HIS card. A third person named with no "I"/"me" of his own
 * is a report about the group. "Put me down for a 5, my partner got a 6" still names him, so it stays.
 */
const OTHER_PERSON = new RegExp(
  String.raw`\b(?:he|she|they|he'?s|she'?s|they'?re|everyone|everybody|someone|somebody|(?:the\s+)?guys|`
  + String.raw`(?:my|our|the|his|her|their)\s+(?:playing\s+)?(?:partners?|buddy|buddies|friends?|pal|dad|father|mom|mother|brothers?|sisters?|son|daughter|wife|husband|uncle|cousin|boss|kids?|opponents?|group|foursome|pro))\b`,
  'i',
);
/** A capitalised name straight before a scoring verb: "Mike got a 4", "Dave parred it". */
const NAMED_SCORER = /(?:^|[,.;]\s*)(?!(?:I|Just|Finally|So|Ok|Okay|Yeah|Well|Hey|Then|And|But|Also|Actually|Only|Still|We|Kevin|Serena)\b)[A-Z][a-z]+\s+(?:got|made|shot|had|carded|scored|took|bogeyed|birdied|eagled|parred|double[\s-]*bogeyed)\b/;
const SPEAKER = /\b(?:i|i'?m|im|i'?ve|i'?ll|i'?d|me|myself)\b/i;

/**
 * 2026-10-28 (Brain review r9) — A CONDITIONAL OR A PLAN IS NOT AN ORDER EITHER. "If I go for it and
 * miss I'm dead" and "Let me know when I should go for it" set risk mode to aggressive, "I need to go
 * home after this hole" left the round screen mid-hole, "I want to scan my scorecard after the round"
 * opened the importer. A leading if/unless, an "if I / if my" clause, "let me know when", or a moment
 * that has not arrived ("after this hole", "later", "tomorrow", "next time") is the player thinking
 * aloud. "When" already opens a question. A time inside an explicit open ("my round from yesterday")
 * is in the past, so it is untouched.
 *
 * 2026-10-28 (Brain recheck r10) — "let me know" only when it defers HIS act ("let me know when I
 * should"). A bare "let me know" turned "I'm going for it, let me know if that's dumb" into talk, and
 * the risk mode he had just called stayed at normal.
 */
const CONDITIONAL_OR_FUTURE = new RegExp(
  LEAD_IN + String.raw`(?:if|unless|even\s+if|in\s+case|suppose|supposing|assuming)\b`
  + String.raw`|\b(?:if|unless)\s+(?:i|i'?m|im|we|my)\b|\blet\s+me\s+know\s+(?:when|if|whether)\s+(?:i|we)\b|\bafter\s+(?:this|the|that)\s+(?:hole|round|shot|one)\b`
  + String.raw`|\b(?:later(?:\s+on)?|tomorrow|tonight|someday|some\s+day|next\s+(?:time|week|month|year|season|weekend))\b`,
  'i',
);

/** True when the utterance is shaped like a question (and is not a polite request). */
export function isQuestionShaped(utterance: string): boolean {
  const t = (utterance ?? '').trim();
  if (!t) return false;
  if (POLITE_REQUEST.test(t)) return false;
  return INTERROGATIVE_OPENER.test(t) || /\?\s*$/.test(t);
}

/** True when the utterance is a polite request ("can you take me home") — a command, whatever else it says. */
export function isPoliteRequest(utterance: string): boolean {
  return POLITE_REQUEST.test((utterance ?? '').trim());
}

/** True when the act is conditional or for later — "if I …", "let me know when", "after this hole", "tomorrow". */
export function isConditionalOrFuture(utterance: string): boolean {
  return CONDITIONAL_OR_FUTURE.test((utterance ?? '').replace(/’/g, "'").trim());
}

/** True when the utterance is told as a story — negated, past, hypothetical, habitual or reported — not given as an order. */
export function isStoryFramed(utterance: string): boolean {
  return STORY_FRAME.test(utterance ?? '');
}

/**
 * The two halves of the story frame the server's shot/mood fallbacks (api/_brain) need on their own:
 * "I didn't hold the green" is still a shot he just hit, but "last year I hit my driver in the water"
 * and "I usually hit my driver right" are not.
 */
export function isPastOrHypothetical(utterance: string): boolean {
  return PAST_OR_HYPOTHETICAL_RX.test(utterance ?? '');
}
export function isHabitual(utterance: string): boolean {
  return HABITUAL_RX.test(utterance ?? '');
}

/** True when the utterance is about another player — a third person named, and no "I"/"me" of his own. */
export function isAboutSomeoneElse(utterance: string): boolean {
  const t = (utterance ?? '').trim();
  if (!t) return false;
  if (NAMED_SCORER.test(t)) return true;
  return OTHER_PERSON.test(t) && !SPEAKER.test(t);
}

/**
 * The shared guard: true when a pre-brain shortcut must NOT act on this utterance, because it is a
 * question, a story, a report about someone else or a conditional/plan rather than an instruction.
 * Callers send it to the caddie instead.
 */
export function isNotACommand(utterance: string): boolean {
  return isQuestionShaped(utterance) || isStoryFramed(utterance) || isAboutSomeoneElse(utterance)
    || isConditionalOrFuture(utterance);
}

/**
 * 2026-10-28 (Brain review r5) — AN ORDER OPENS WITH ITS VERB.
 *
 * isNotACommand catches questions, stories, habits and other people. It cannot catch a plain
 * statement, and the tab mic's pre-round shortcut acts on a substring: "That was a quick round today"
 * and "Tomorrow I want to start a round at Hemet with my dad" each started a round with no confirm,
 * "I did cage mode for an hour this morning" started the camera recording. For the shortcuts that ACT
 * (start a round, start recording), the whole utterance has to be the order: after fillers and a
 * vocative it opens with an action verb, a polite "can you / let's", or the named thing itself
 * ("cage mode", "quick round at Hemet"). A leading subject or time frame ("that was", "I did",
 * "tomorrow", "I want to") is a sentence about it, and goes to the caddie.
 */
const ORDER_VERB = String.raw`(?:please\s+)?(?:(?:can|could|would|will)\s+(?:you|we)\s+(?:please\s+)?)?(?:just\s+)?`
  + String.raw`(?:let'?s|let\s+us|start|begin|open|launch|play|run|fire\s+up|turn\s+on|enter|switch\s+(?:to|into)|go\s+(?:to|into)|`
  + String.raw`pull\s+up|bring\s+up|take\s+me|show|record|watch|kick\s+off|time\s+for)\b`;

/** True when the utterance opens with an order: an action verb, or one of `named` (the thing itself). */
export function opensWithOrder(utterance: string, named: readonly string[] = []): boolean {
  const t = (utterance ?? '').replace(/’/g, "'").trim();
  if (!t || isNotACommand(t)) return false;
  const names = named.map(n => n.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, String.raw`\s+`)).filter(Boolean);
  const head = names.length ? String.raw`(?:${ORDER_VERB}|(?:a\s+|the\s+)?(?:${names.join('|')})\b)` : ORDER_VERB;
  return new RegExp(LEAD_IN + head, 'i').test(t);
}
