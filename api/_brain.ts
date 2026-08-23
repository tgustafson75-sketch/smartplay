/**
 * THE BRAIN'S SHARED CORE — the behavioural rules that must be identical in every brain transport.
 *
 * 2026-08-13 (one-brain pass). SmartPlay has two brain endpoints: api/kevin.ts and api/pipecat-turn.ts.
 * They are not two copies of one caddie — they carry different response contracts and different
 * transport framing — but several blocks of BEHAVIOUR were duplicated between them verbatim, which is
 * the drift engine. Measured before extracting:
 *
 *   MENTAL GAME       byte-identical, 1,248 chars in both
 *   SELF-REFERENCE    83% similar — already drifting
 *   PERSPECTIVE       92% similar — already drifting
 *
 * The mental-game block is the cautionary one: it was MOVED into kevin.ts and never deleted from
 * pipecat-turn.ts, so "unifying" it created a second copy. That is the exact failure this file exists
 * to end — one owner, imported, never restated.
 *
 * What belongs here: rules about how the caddie READS and RESPONDS to the player, which must never
 * differ by which transport answered. What does NOT belong here: transport framing (earbud cadence vs
 * on-screen), response contracts, tool lists, or anything a specific surface legitimately does
 * differently. Those are allowed to differ; these are not.
 */

/** How the caddie reads "you"/"your" — the player is addressing the caddie, not narrating themselves. */
export function selfReferenceBlock(name: string): string {
  return `SELF-REFERENCE: when ${name} says "you" or "your", they mean YOU, the caddie/app — not themselves. "Log that for you", "did you get my score?", "you have my shot?" are all the player telling YOU to record/track/confirm it. Treat "you"-directed statements as commands to you (fire the matching tool), never as the player describing their own action.`;
}

/**
 * 2026-08-20 (QA sweep of every UI tool). The caddie was REFUSING valid personas with invented
 * reasons: "switch to Tank" → "Tank isn't available right now", "switch to Harry" → "Harry's
 * retired." Both are real, selectable caddies. Serena worked, so the tool and its enum were fine.
 *
 * This is a KNOWLEDGE gap, not the compliance problem that broke recommend_club. The system prompt
 * says "You are Kevin" and never mentions that other caddies exist; the roster lived only in the
 * switch_caddie tool description, and a tool description is consulted when choosing between tools,
 * not when answering "can I have Harry?" — so the model improvised an excuse. Prompts are good at
 * knowledge, which is exactly why this one is worth fixing with prompt text when the last one wasn't.
 *
 * The invented-unavailability failure is worse than a plain miss: the player is told a feature they
 * paid for does not exist, and they have no reason to ask twice.
 */
export function caddieRosterBlock(current: string): string {
  return `CADDIE ROSTER — Kevin, Serena, Harry and Tank are ALL available, always, plus the player's own custom caddie if they made one. You are currently ${current}. If they ask for a different one BY NAME, call switch_caddie with that name and confirm warmly. NEVER say a caddie is retired, unavailable, busy, or does not exist — every one of them can be switched to at any time. If you did not catch which caddie they meant, ask.`;
}

/** Whose perspective "I/me/my" and "you/your" carry, and how to take feedback about the caddie itself. */
export function perspectiveBlock(name: string): string {
  return `PERSPECTIVE + BEHAVIOR FEEDBACK: "I/me/my" = ${name} (the player); "you/your" = YOU (the caddie). When ${name} comments on YOUR behavior ("you keep repeating", "you said the same thing", "you're cutting me off", "you're too sensitive"), that is FEEDBACK about you — acknowledge it briefly and ADJUST; never echo the words back or restate them as if they were a new request. When ${name} talks about the PRODUCT in the third person ("we need the user to…", "the app should…", "users should be able to…"), that is design feedback FROM ${name}, the person building this — acknowledge it in one short line; do NOT act it out literally, do NOT narrate it back, and do NOT treat "the user" as a third party who isn't present.`;
}

/**
 * The mental-game contract. ALWAYS-ON, on the course and off it.
 *
 * Tim's framing: this is the core of the app — track how the golfer is actually doing and meet them
 * there. It is not a garnish on club selection, so it is not optional in any transport.
 */
/**
 * 2026-08-20 (Tim's OK on a frozen-path prompt change; QA pass).
 *
 * `recommend_club` was REACHABLE ON BOTH BRAINS AND FIRED ZERO TIMES. Three sessions made it
 * reachable; none checked that it fires. Probed live before writing this, on the deployed brain:
 *     "I'm 150 out, what should I hit"   → "I'd go with a smooth 8-iron here."   tool_actions: []
 *     "165 to the pin into a little wind" → "Sounds like a solid 7 iron."         tool_actions: []
 * Explicit club advice, every time, and nothing recorded. So advice→outcome pairing — the loop that
 * teaches the app whether its own recommendations work — has never once run.
 *
 * WHY THE TOOL DESCRIPTION WASN'T ENOUGH: it already says "Call this WHENEVER you tell the player
 * which club to hit… IN ADDITION to speaking your recommendation." A tool description is read as
 * "what this tool is for" when the model is deciding BETWEEN tools. It is weak at establishing that
 * a tool should fire ALONGSIDE a normal spoken answer, because answering already feels like a
 * complete response. That instruction has to come from the system prompt, which is where behavioural
 * rules live. register_bag is the control case: it has a system-prompt line and it DOES fire.
 *
 * Shared here so both brains get the identical text by CONSTRUCTION. kevin.ts and pipecat-turn.ts
 * previously drifted by two tools and ~255 description lines while each hand-maintained its own
 * copy — and the follow-up turn is precisely where recommend_club went missing before.
 */
export function clubAdviceBlock(): string {
  return `RECORDING YOUR CLUB ADVICE — non-negotiable, and it does NOT change what you say.
- Whenever you tell the player what to hit on THIS shot — "I'd go 8 here", "smooth 7", "that's a
  driver", "lay up with the 5" — you must ALSO call recommend_club with that exact club.
- Speak your answer exactly as you normally would. The tool call is silent and additional; it never
  replaces, delays, or shortens your reply. Answering WITHOUT calling it is an incomplete turn.
- This is how the app learns whether its own advice actually works: it pairs what you recommended
  against what they hit and how it finished. Skip the call and that shot teaches the player nothing.
- Include the shape only if you actually advised one (draw, fade, punch). Omit it otherwise.
- Do NOT call it for general club talk with no shot in front of them ("how far does my 7 go?") or
  when you are asking for more information rather than advising ("what's the distance?").`;
}

/**
 * 2026-08-21 (Tim, defining the answer he actually wants) — "about a twelve to fifteen word
 * response, or if it's about the club it could be LESS than twelve. What you need is not only club,
 * but we know the course — so if there's hazards, and what the club distance will put you in
 * relation to the hazard if you swing pure, and if you swing your TENDENCY where it could end up.
 * But in a brief, useful kind of way."
 *
 * This is not "be brief". It is BRIEF BECAUSE IT IS DENSE. A club on its own is a number the player
 * could have looked up; a club plus what a pure strike does versus what their own miss does is a
 * DECISION, and it fits in the same breath.
 *
 * It is also the ethos §6 rule made concrete: the intelligence gets deeper while the sentence gets
 * shorter. Every input already exists — learned distances, per-club tendency and miss side, the
 * caddie's own calibration, and (as of today, on this path) the hole's hazards.
 *
 * Deliberately NOT a template. A caddie reciting the same three-clause sentence every shot is a
 * different kind of robotic. This describes what must be CARRIED, and lets the caddie say it like a
 * person who has been on the bag for years.
 */
export function shotAnswerShapeBlock(): string {
  return `HOW TO ANSWER A SHOT QUESTION — short because it is dense, never short because it is thin.
- Club calls: UNDER 12 WORDS. Anything else: 12-15. One breath. No preamble, no restating the question.
- A bare number is a failure. "It's 158" is something he could read off a screen — you are on the bag
  to convert it into a decision.
- CARRY THREE THINGS when you have them, in whatever order sounds natural:
    1. the club,
    2. what a PURE strike does relative to the trouble ("clears the bunker", "past it, pin high"),
    3. where his OWN tendency would leave it ("your fade holds the right edge", "a thin one is short-right").
- Use his real miss and real distances, not generic ones. If you do not have a tendency for that club,
  leave it out rather than inventing one — two honest clauses beat three with a guess in them.
- Never LIST hazards. Use them to anchor the target: "past the bunker" tells him more than "bunker at 145".
- PLAYS-LIKE IS AN INPUT, NEVER THE ANSWER. Every rangefinder on the market brags about a wind- and
  elevation-adjusted number, and it is still a NUMBER. He does not want to know it plays 158; he wants
  to know what his shot does in relation to the water, the bunker, the fescue. Use plays-like to pick
  the club, then spend the sentence on the trouble.
- Name the trouble in his terms — water, bunker, fescue, OB, the wall — not "hazard".
- No hedging stacks ("maybe try possibly"). Commit to a club. He can overrule you.
- A TOOL CALL IS NEVER THE ANSWER. Recording something is bookkeeping the player cannot hear. If he
  gave you a fact AND asked a question in one breath — "I'm 150 out, what should I hit" — record the
  fact if there is a tool for it AND answer the question out loud in the same turn. Silence after a
  tool call reads as the caddie ignoring him.

Good: "Seven iron. Pure clears the bunker; your fade holds the right edge."          (11 words)
Good: "Smooth eight. Anything thin is short-right in the sand — favour left centre." (12 words)
Bad:  "It's 158 yards to the pin."                                                    (a number, not a call)
Bad:  "There's a bunker right at 145 and water long and the wind is into you and…"   (a list, not a decision)`;
}

export function mentalGameBlock(): string {
  return `MENTAL GAME — You are also a sports psychologist and emotional coach. This is as important as club selection.
- ALWAYS-ON, on the course AND off it (practice, get-to-know, casual chat): every time the player speaks,
  read the TONE and emotional state underneath the words — not just the literal request — and let it shape
  HOW you respond (pace, warmth, whether to coach or just listen). This is the core of the app: track how
  the golfer is doing and meet them there. A flat "give me the number" and an exasperated one get different you.
- Frustration signals: profanity (any f-word, s-word, etc.), "I can't", "what the hell", "again?!", repeated misses.
  When you hear these: briefly acknowledge the frustration, offer one mental reset cue. Never lecture. Never say "you can't say that."
  Examples: "That one stung. Breathe — next shot is a clean slate." / "Frustration's normal. You've hit this shot before. Stay in your process."
- Confidence signals: player sounds locked in, in the zone, positive self-talk → mirror the energy briefly.
- The tone of WHAT they say matters as much as the words. Read the emotional subtext.
- Use log_emotional_state when you detect a meaningful emotional shift (frustrated, confident, anxious, resigned).`;
}


/**
 * 2026-08-20 (QA pass) — EXTRACT THE ADVICE THE CADDIE ACTUALLY GAVE, rather than asking the model
 * to remember to report it.
 *
 * `recommend_club` fired ZERO times on the live brain. Three fixes were tried in order, and the
 * order matters because each one ruled something out:
 *   1. The tool description already said "call this WHENEVER you advise a club, IN ADDITION to
 *      speaking". Not enough — a tool description is read as "what this is FOR", not as a rule about
 *      answering.
 *   2. A system-prompt block saying the same thing. Deployed, probed: still zero.
 *   3. Found the real conflict — the prompt listed WHEN to use tools ("describes a shot to log,
 *      names a score, asks to open a tool") and club advice was not on that closed list. Fixed and
 *      deployed. STILL zero.
 *
 * Then the decisive probe. Told explicitly, in the user turn, to call the tool:
 *      "I'd go with a smooth 8-iron here.  Now, let me log that for you."   tool_actions: []
 * It ANNOUNCED the tool call and did not make one. The conversational turn runs on the 'fast' tier
 * (gpt-4o-mini), which is weak at emitting content AND tool_calls in one message; the agentic loop
 * then ends because the message carried no tool_calls. No amount of prompt wording fixes a model
 * that says "let me log that" instead of logging it.
 *
 * So this stops depending on compliance. The caddie's spoken answer IS the recommendation — parsing
 * the club out of it is not a guess about what the player might do, it is reading back what the
 * caddie just said. That is exactly `kind: 'spoken'` advice, the same thing the tool would have
 * carried, and it works identically on every provider and tier.
 *
 * DELIBERATELY CONSERVATIVE. A false positive here is worse than a miss: it would score adherence
 * against a recommendation that was never made, poisoning the club ladder the caddie recommends
 * FROM. So it fires only on an explicit advice cue attached to a named club, and never on general
 * club talk ("your 7-iron goes 165") or on a question back to the player ("what's the distance?").
 */
const CLUB_PATTERNS: Array<[RegExp, string]> = [
  [/\bdriver\b/i, 'driver'],
  [/\b(?:3|three)[ -]?wood\b/i, '3 wood'],
  [/\b(?:5|five)[ -]?wood\b/i, '5 wood'],
  [/\bhybrid\b/i, 'hybrid'],
  [/\b(?:pitching[ -]?wedge|pw)\b/i, 'pitching wedge'],
  [/\b(?:gap[ -]?wedge|gw)\b/i, 'gap wedge'],
  [/\b(?:sand[ -]?wedge|sw)\b/i, 'sand wedge'],
  [/\b(?:lob[ -]?wedge|lw)\b/i, 'lob wedge'],
  [/\bputter\b/i, 'putter'],
];
const NUMBERED_IRON = /\b(?:(\d)|(two|three|four|five|six|seven|eight|nine))[ -]?iron\b/i;
const WORD_TO_DIGIT: Record<string, string> = {
  two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};
/** Phrases that mark a sentence as ADVICE for the shot at hand, not commentary about a club. */
const ADVICE_CUE = /\b(?:I'?d (?:go|hit|play|take|club)|go with|let'?s go|I like|sounds like|that'?s (?:a|your)|this is a|take (?:the|your)|hit (?:the|your|a)|lay up with|club (?:up|down) to|stick with|smooth|easy|stock)\b/i;
const SHAPE = /\b(draw|fade|cut|punch|hook|knock[ -]?down)\b/i;
/** A sentence that OPENS like a question is the caddie asking, not advising. */
const INTERROGATIVE_OPENER = /^\s*(?:how|what|where|when|which|who|why|do|does|did|are|is|was|can|could|would|will|should|have|has)\b/i;

export function extractAdvisedClub(text: string): { club: string; shape?: string } | null {
  if (!text) return null;
  // Work sentence by sentence so a cue in one clause cannot vouch for a club in an unrelated one.
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    // A QUESTION is never advice. "How far do you normally hit your 7 iron?" carries both an advice
    // cue ("hit your") and a club, and would otherwise record a recommendation the caddie never made
    // — the exact false positive that poisons adherence. Keyed on the sentence OPENING rather than a
    // trailing '?', so a recommendation with a tag question ("I'd go with the 8, sound right?") is
    // still captured.
    if (INTERROGATIVE_OPENER.test(sentence)) continue;
    /**
     * 2026-08-20 — caught by `npm run probe-tools` on its FIRST run, on kevin, after 1139 unit tests
     * had passed. Asked "how far does my 7 iron normally go", the caddie replied:
     *     "I don't have your distances yet. If you tell me how far you hit your 7 iron, I can…"
     * "hit your" + "7 iron" tripped the advice cue, and we recorded a recommendation the caddie
     * never made — on a turn where it explicitly said it had no numbers. Exactly the false positive
     * that poisons adherence, and precisely the class no static test could have found, because it
     * depends on a sentence the MODEL chose to write.
     *
     * Both exclusions are narrow on purpose. A blanket "skip any sentence containing if" would drop
     * real advice ("If it's into the wind, I'd go 6 iron"), so this only skips the hypothetical
     * where the player is being asked to SUPPLY the number, and distance talk about a club.
     */
    if (/\bif (?:you|we)\s+(?:tell|share|let me know|give|say|know)\b/i.test(sentence)) continue;
    if (/\bhow far\b/i.test(sentence)) continue;
    if (!ADVICE_CUE.test(sentence)) continue;
    let club: string | null = null;
    const iron = NUMBERED_IRON.exec(sentence);
    if (iron) {
      const digit = iron[1] ?? WORD_TO_DIGIT[(iron[2] ?? '').toLowerCase()];
      if (digit) club = `${digit} iron`;
    }
    if (!club) {
      for (const [re, name] of CLUB_PATTERNS) {
        if (re.test(sentence)) { club = name; break; }
      }
    }
    if (!club) continue;
    const shape = SHAPE.exec(sentence)?.[1]?.toLowerCase();
    return shape ? { club, shape } : { club };
  }
  return null;
}


/**
 * 2026-08-20 (QA sweep) — the SAME compliance failure as recommend_club, on the tool the prompt
 * itself calls "the core of the app".
 *
 * Probed live: "I am so damn frustrated, I have topped three in a row" → the caddie answered
 * beautifully ("That one stung. Breathe — it happens to the best of us.") and logged NOTHING.
 * "I am really pissed off right now" → warm reply, no tool. "Honestly I feel great today,
 * everything is clicking" → no tool. It fired exactly once across the sweep, as a side effect of a
 * turn that was already calling log_shot.
 *
 * Same root cause as recommend_club: on the 'fast' tier the model treats the empathetic reply as a
 * complete turn and never emits tool_calls alongside it. Emotional tracking that only records when
 * the model happens to feel like it is not tracking.
 *
 * Difference from recommend_club: the signal is in the PLAYER's words, not the caddie's, so this
 * reads the player's utterance. The cues are deliberately the ones mentalGameBlock already names to
 * the model — profanity, "I can't", repeated misses, positive self-talk — so the deterministic path
 * and the prompted path are looking for the same thing rather than drifting apart.
 *
 * Conservative by design, but the asymmetry is gentler here than for club advice: a wrong emotional
 * note nudges tone, it does not poison a distance ladder. So this errs slightly toward recording,
 * while still requiring the player to be talking about THEMSELVES right now.
 */
const EMOTION_PATTERNS: Array<{ re: RegExp; state: string; valence: 'positive' | 'neutral' | 'negative' }> = [
  // Resignation reads as frustration's end state — check it FIRST, since "I'm done with this" also
  // trips several frustration cues and the more specific state is the more useful one to record.
  { re: /\b(?:i (?:give up|quit)|i'?m done with (?:this|it|golf)|what'?s the point|hopeless|why do i (?:even )?bother)\b/i, state: 'resigned', valence: 'negative' },
  { re: /\b(?:nervous|anxious|worried|scared|tense|tight|first[- ]tee jitters|shaky)\b/i, state: 'anxious', valence: 'negative' },
  { re: /\b(?:fuck\w*|shit\w*|goddamn|damn it|dammit|pissed|furious|so frustrat\w+|frustrated|sick of (?:this|it)|i can'?t (?:do|hit|stand)|terrible|awful|horrible|disaster)\b/i, state: 'frustrated', valence: 'negative' },
  { re: /\b(?:feel(?:ing)? (?:great|good|amazing)|locked in|dialed in|clicking|on fire|striping it|crushing it|loving (?:this|it)|so good today|best i'?ve (?:felt|hit))\b/i, state: 'confident', valence: 'positive' },
];
/** The speaker must be talking about THEMSELVES, now — not quoting, not asking. */
const FIRST_PERSON = /\b(?:i|i'?m|im|my|me|we)\b/i;

export function detectEmotionalState(playerText: string): { state: string; valence: 'positive' | 'neutral' | 'negative' } | null {
  if (!playerText) return null;
  const t = playerText.trim();
  // A question is the player asking something, not reporting how they feel.
  if (/^\s*(?:how|what|where|when|which|who|why|do|does|did|are|is|can|could|would|should)\b/i.test(t)) return null;
  if (!FIRST_PERSON.test(t)) return null;
  for (const { re, state, valence } of EMOTION_PATTERNS) {
    if (re.test(t)) return { state, valence };
  }
  return null;
}


/**
 * 2026-08-20 (Tim: "clean and surgical. We can't keep hitting these stupid ass breaks.")
 *
 * The third and last tool in the alongside-an-answer class. log_shot was INTERMITTENT, not dead:
 * live it fired on "I hit my 7 iron and pulled it left of the green" and missed on "I striped my
 * drive right down the middle" and "I chunked my wedge, came up 20 yards short".
 *
 * This one carries more risk than the other two, so it is deliberately the strictest. A wrong shot
 * record does not just miss data — it CORRUPTS the history the caddie learns distances and tendencies
 * from, and a corrupted ladder is invisible until it gives bad advice on the course. So the bar is:
 * the player must be REPORTING A SHOT THEY ALREADY HIT — a past-tense strike verb, a named club, and
 * first person. Anything less records nothing.
 *
 * Three things it must never mistake for a shot report, each proven by a test:
 *   - ADVICE: "I'd go with a 7 iron here" — the caddie's own recommendation, no strike happened.
 *   - A PLAN: "I'm going to lay up with my 7 iron" — that is plan_shot, and it is in the FUTURE.
 *   - CLUB TALK: "my 7 iron goes about 165" — a fact about a club, not a swing.
 */
const STRIKE_VERB = /\b(hit|hooked|sliced|pushed|pulled|striped|stripped|chunked|topped|thinned|blocked|duffed|flushed|smoked|bladed|skulled|shanked|drew|faded|punched|pured|caught|dumped|missed)\b/i;
/** Future/intent markers — a plan is not a shot. */
const FUTURE_MARKER = /\b(?:i'?m going to|going to|i'?ll|i will|gonna|i plan to|thinking of|should i|i'?d)\b/i;
const DIRECTION = /\b(left|right|long|short|middle|straight|fat|thin|high|low)\b/i;
const OUTCOME_PLACE = /\b(fairway|green|rough|trees|bunker|sand|water|hazard|o\.?b\.?|out of bounds|fringe|cart path|middle)\b/i;
const CONTACT = /\b(striped|stripped|flushed|smoked|pured|solid|clean|chunked|fat|topped|thinned|bladed|skulled|duffed|shanked)\b/i;
/** "my drive" / "off the tee" mean the driver even though the word never appears. */
const DRIVE_SYNONYM = /\b(?:my )?(?:drive|tee shot)\b|\boff the tee\b/i;
const GENERIC_WEDGE = /\bwedge\b/i;

export function extractShotReport(playerText: string): {
  club?: string; direction?: string; contactQuality?: string; outcome?: string;
} | null {
  if (!playerText) return null;
  const t = playerText.trim();
  if (/^\s*(?:how|what|where|when|which|who|why|do|does|did|are|is|can|could|would|should)\b/i.test(t)) return null;
  if (!FIRST_PERSON.test(t)) return null;
  // A plan or a recommendation is not a shot, even when it names a club and a target.
  if (FUTURE_MARKER.test(t)) return null;
  if (!STRIKE_VERB.test(t)) return null;

  let club: string | undefined;
  const iron = NUMBERED_IRON.exec(t);
  if (iron) {
    const digit = iron[1] ?? WORD_TO_DIGIT[(iron[2] ?? '').toLowerCase()];
    if (digit) club = `${digit} iron`;
  }
  if (!club) {
    for (const [re, name] of CLUB_PATTERNS) {
      if (re.test(t)) { club = name; break; }
    }
  }
  if (!club && DRIVE_SYNONYM.test(t)) club = 'driver';
  if (!club && GENERIC_WEDGE.test(t)) club = 'wedge';
  // No club = nothing worth attributing. A shot record without a club teaches the ladder nothing and
  // still costs a row in the history.
  if (!club) return null;

  const direction = DIRECTION.exec(t)?.[1]?.toLowerCase();
  const contactQuality = CONTACT.exec(t)?.[1]?.toLowerCase();
  const outcome = OUTCOME_PLACE.exec(t)?.[0]?.toLowerCase();
  // Require at least ONE descriptive signal beyond "I hit a club" — otherwise we are recording that
  // a swing happened, with nothing about it, which is noise in the history rather than data.
  if (!direction && !contactQuality && !outcome) return null;

  return {
    club,
    ...(direction ? { direction } : {}),
    ...(contactQuality ? { contactQuality } : {}),
    ...(outcome ? { outcome } : {}),
  };
}
