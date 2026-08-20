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
