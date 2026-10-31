/**
 * 2026-06-06 — Local pre-classifier for high-frequency voice intents.
 *
 * Runs BEFORE /api/voice-intent (Anthropic Haiku) on every voice
 * command. Regex-matches a curated set of unambiguous, high-frequency
 * phrases and synthesizes a VoiceIntent directly. If no pattern
 * matches → returns null → caller falls through to the cloud
 * classifier as today.
 *
 * Saves the 200-500ms classifier round-trip + ~$0.0005 per matched
 * call. Covers the most-used status queries and the most-used tool
 * commands. Audit confirmed handlers are already local — the only
 * cost on these intents was the upstream classifier.
 *
 * Design rules:
 *   - Patterns are intentionally NARROW. False positives are worse
 *     than false negatives — if a regex is ambiguous, leave it out
 *     and let Haiku decide.
 *   - Every synthesized intent carries confidence: 'high' so the
 *     downstream router doesn't treat it as low-confidence (which
 *     would route to brain).
 *   - raw_text is the original transcript (untouched) so handlers
 *     that re-read it still work.
 *   - Returns null on any partial / ambiguous match.
 *
 * The patterns mirror the localStatusResponder regex set (Phase 3,
 * services/localStatusResponder.ts) because that's the proven
 * coverage; this just promotes them to fire on the happy path too.
 */

import type { VoiceIntent } from '../types/voiceIntent';
import { ACTIVE_PERSONAS, type Persona } from '../lib/persona';
import { isSmartMotionActive } from './smartMotionRecordBus';
import { resolveSpokenCourse } from './courseNameResolver';
import {
  LEAD_IN, isAboutSomeoneElse, isConditionalOrFuture, isPoliteRequest, isQuestionShaped, isStoryFramed,
} from './utteranceIsCommand';
import { routineAsk } from './routineUtterance';
import { parseSpokenHole } from './spokenHole';

interface Pattern {
  rx: RegExp;
  build: (raw: string, match: RegExpMatchArray) => VoiceIntent;
}

/**
 * 2026-10-28 (Brain recheck r10) — what may END a whole-utterance setting order (handedness, theme):
 * a softener, a thanks, "for me", or the caddie's name — "I'm a lefty, Kevin", "turn on dark mode for
 * me", "dark mode please". Anything else after the term makes it a sentence about the setting.
 */
const SETTING_TAIL = String.raw`(?:[\s,]+(?:now|actually|too|though|by\s+the\s+way|please|for\s+me|thanks|thank\s+you|kevin|serena))*\s*[.!]?$`;

const intent = (
  raw: string,
  intent_type: string,
  parameters: Record<string, unknown> = {},
): VoiceIntent => ({
  intent_type,
  parameters,
  confidence: 'high',
  follow_up_question: null,
  raw_text: raw,
});

// 2026-08-06 (Tim — "if I say 'log an issue with smart vision' it OPENS smart vision; we're still too
// sensitive — saying a tool name shouldn't fire it"). A leading negative lookahead for the bare-tool-name
// opens: when the utterance is clearly ABOUT the tool (logging/reporting an issue, a bug, a crash, feedback)
// the tool name is an OBJECT, not a command — so don't auto-open; let it fall through to the brain.
const NOT_ABOUT_TOOL = '(?!.*\\b(?:issue|issues|log|logged|logging|report|reporting|bug|bugs|problem|problems|feedback|complain|complaint|broke|broken|glitch|crash(?:ed|ing)?|not\\s+working|doesn\'?t\\s+work|isn\'?t\\s+working)\\b)';

// 2026-09-12 (Tim — "I'm going to talk to him about my bag and distances, hoping he understands a
// conversation versus trying to take me to a tool or screen I didn't ask for"). The same lesson as
// NOT_ABOUT_TOOL above, pointed at DISTANCES: naming a distance is not asking for the hole's.
//
// The POSSESSIVE forms were already safe — "how far do I hit my 7-iron" is claimed by the
// club_distance block inside precheckLocalIntent, which runs before this list. Measured, not
// assumed: what the bare `how far` / `how many yards` alternatives below were actually stealing is
// everything that names a club WITHOUT "my" in front of it — "how many yards do I hit a pitching
// wedge", "how far do I usually hit it", "what's my yardage gapping" — all of which came back as
// distance_to_green at confidence 'high', so the router answered locally and the caddie (who carries
// clubDistances, bagClubs, club_tendencies and club_variant_insight) never saw the question. In a
// round that is the yardage to the green instead of a wedge number; off the course it is
// queryStatusHandler's off-round gate saying "You're not in a round yet. Want to start one?" to a
// question that has nothing to do with being in a round.
//
// Any equipment word, or a "do I hit" phrasing, disqualifies the line outright.
/**
 * "How do I …?" and its relatives. Anchored at the START of the utterance (after an optional filler
 * like "hey Kevin," / "so") so a mid-sentence "how" cannot trip it: "what's my score, and how far is
 * the pin" keeps its local answer.
 *
 * WHY THE MEASUREMENT QUESTIONS ARE SAFE, precisely: the frame requires the auxiliary verb to be the
 * word DIRECTLY after "how". In "how far do I hit my 7 iron" that word is "far", so the alternative
 * never engages, and the club-distance answer — the most-asked offline question in the app — is
 * untouched. Same for "how many putts", "how much wind", "how long is this hole", "how old".
 *
 * An earlier version of this carried a `(?!\s+(?:far|many|much|long|old))` lookahead as well. Break-
 * testing showed removing it changed NOTHING: it could only ever have fired on "how do I far …",
 * which is not a sentence. It was unreachable, and a comment above it claimed it was what kept
 * "how far do I" local — a guard that certifies the wrong reason is worse than no guard, because the
 * next person trusts it. Deleted, and the real reason is written down instead.
 *
 * "WALK ME THROUGH …" IS DELIBERATELY NOT HERE. It reads like an instructional ask, and the first
 * version of this guard claimed it — which broke "walk me through the hole", a phrasing that already
 * has a correct local owner in the hole_read pattern and is answered OFFLINE from the hole data. A
 * pinned test caught it. Nothing is lost by leaving it out: "walk me through starting a round" matches
 * no pattern, so it falls through to the brain anyway, which is the destination this guard exists to
 * reach. A guard must not take a phrasing away from a feature that already answers it correctly.
 */
const INSTRUCTIONAL_QUESTION_RX =
  /^(?:(?:hey|ok|okay|yo|so|um|uh|hi)[\s,]+)*(?:\w+[\s,]+)??(?:how\s+(?:do|can|would|could|should)\s+(?:i|we|you)\b|how\s+(?:does|do)\s+(?:this|that|it|the\s+\w+|\w+)\s+work\b|where\s+(?:do|can)\s+i\s+(?:find|change|set|turn|see|get|add|edit|import|export)\b|(?:show|teach|tell)\s+me\s+how\s+to\b)/i;

const NOT_ABOUT_MY_CLUBS =
  '(?!.*\\b(?:driver|woods?|hybrids?|irons?|wedges?|putter|clubs?|bag|gapping|carry|carries)\\b)'
  + '(?!.*\\bi\\s+hit\\b)';

// Optional explicit hole for a spoken score ("...on hole 7"); otherwise the handler uses the current
// hole. The stroke count itself is parsed from raw_text by logScoreHandler.
// 2026-10-29 (Brain recheck r15) — "on the 12th", "on 12", "on number 12", "the 2nd" and "hole six" all
// name a hole too (services/spokenHole). Read only "on hole N" and a score on "the 12th" was written to
// whatever hole was lowest unscored, not the one he said.
const scoreHoleParam = (raw: string): Record<string, unknown> => {
  const h = parseSpokenHole(raw);
  return h != null ? { hole_number: h } : {};
};

// Ordered list — first match wins. Yardage patterns come before
// generic "what" patterns so "yardage to front" → green_front,
// not query_status:hole.
/**
 * The selectable base personas as a regex alternation, derived rather than typed out, so removing a
 * persona from ACTIVE_PERSONAS removes it from voice too. 'custom' is excluded deliberately — it has
 * its own rule, anchored on the player's own caddie name.
 */
const PERSONA_SWITCH_RX = (() => {
  const names = ACTIVE_PERSONAS.filter((p: Persona) => p !== 'custom').join('|');
  return new RegExp(
    String.raw`\b(?:switch|change)(?:\s+(?:my\s+)?caddie)?\s+to\s+(${names})\b|\bput\s+(${names})\s+in\s+charge\b`,
    'i',
  );
})();

/**
 * 2026-10-31 (Brain recheck r21, BRAIN-R21-1) — the two score-report rules, named so scoreSaidButNotLogged can ask
 * whether the words REPORT a score even when a question rule wins the precheck ("I got a 6, how far to the green?"
 * is a yardage query first, so the precheck never says log_score for it).
 */
const SCORE_VERB_RX = /\b(?:(?:i\s+)?(?:got|made|shot|had|carded|scored|took)|put\s+me\s+down\s+for|score\s+me|mark\s+me(?:\s+down)?\s+for|card\s+me)\s+(?:myself\s+)?(?:a\s+|an\s+)?(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|par|bogey|birdie|eagle|double\s*bogey|triple\s*bogey)\b(?!\s*(?:iron|woods?|hybrid|wedge|driver|putter|putts?|putted|degrees?|footer|feet|foot|yards?|holes?))/i;
const SCORE_NAMED_RX = /\b(?:i\s+)?(?:bogeyed|birdied|eagled|parred|double[\s-]*bogeyed|triple[\s-]*bogeyed)\b/i;

const PATTERNS: Pattern[] = [
  // ── GROUND-TRUTH GREEN MARK (must beat the yardage patterns below, since
  //    "I'm on the MIDDLE of the green" otherwise matches green_middle) ──────
  // 2026-06-13 — Tim's on-course flow: "I'm on the center of the green" /
  // "mark the green/pin/flag" / "I'm at the pin" → WRITE the green override at
  // the current GPS. Deterministic + OFFLINE — works with NO signal, exactly
  // when his Lakes round needed it (the cloud classifier was unreachable).
  // Routes to open_tool → the voice-direct in-place mark in openToolHandler.
  // Plain "I'm on the green" (no center/middle/pin qualifier) is intentionally
  // NOT matched here — it stays a position_declaration via the cloud parse.
  {
    rx: /\b(?:mark\s+(?:the\s+)?(?:green|pin|flag)|(?:i'?m|im|i\s+am|we'?re|we\s+are)\s+(?:on|at)\s+(?:the\s+)?(?:center|middle)\s+of\s+the\s+green|(?:i'?m|im|i\s+am)\s+(?:on|at)\s+(?:the\s+)?(?:pin|flag))\b/i,
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'mark_green' }),
  },
  /**
   * 2026-08-12 (Tim — "a huge part of the app is mental state and mental coaching, hence the
   * dynamics being in play") — RISK POSTURE, spoken.
   *
   * The posture was previously settable by nothing, which is why it read as dead. This is the
   * player's half: telling your caddie to play it safe or go at it is the most natural thing on a
   * golf course, and it must work OFFLINE and instantly — you say it standing over the ball, often
   * with no signal. Deterministic patterns, no cloud round-trip.
   *
   * Deliberately narrow: "safe" alone is far too common in golf speech ("safe side", "that's safe")
   * to hijack, so each pattern needs an explicit instruction verb or the word "play".
   */
  {
    rx: /\b(?:(?:let'?s|lets|i(?:'| a)?m\s+going\s+to|we'?ll)\s+play\s+(?:it\s+)?safe|play\s+(?:it\s+)?safe|(?:go|be|stay|keep\s+it)\s+conservative|conservative\s+mode|dial\s+(?:it\s+)?back(?![^.?!]*\b(?:wording|words|talk|talking|chatter|tone|voice|volume|jokes?|commentary|detail|info|information|explanations?)\b))\b/i,
    build: (raw) => intent(raw, 'change_setting', { setting_name: 'risk_mode', new_value: 'safe' }),
  },
  {
    rx: /\b(?:(?:let'?s|lets|we'?ll)\s+(?:be|get|go)\s+aggressive|be\s+aggressive|go\s+aggressive|aggressive\s+mode|(?:let'?s|lets)\s+attack|go\s+(?:for\s+it|at\s+it)|(?:i'?m|im)\s+going\s+for\s+it)\b/i,
    build: (raw) => intent(raw, 'change_setting', { setting_name: 'risk_mode', new_value: 'aggressive' }),
  },
  {
    rx: /\b(?:(?:back\s+to|play)\s+normal|normal\s+mode|(?:standard|regular)\s+(?:mode|play))\b/i,
    build: (raw) => intent(raw, 'change_setting', { setting_name: 'risk_mode', new_value: 'normal' }),
  },
  // ── DISTANCE / YARDAGE (most specific first) ──────────────
  {
    rx: /\b(front\s+(?:edge|of)|to\s+the\s+front|yards?\s+to\s+(?:the\s+)?front)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'green_front' }),
  },
  {
    rx: /\b(back\s+(?:edge|of)|to\s+the\s+back|yards?\s+to\s+(?:the\s+)?back)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'green_back' }),
  },
  {
    rx: /\b(middle\s+of\s+the\s+green|to\s+the\s+middle|yards?\s+to\s+(?:the\s+)?middle|to\s+the\s+pin|to\s+the\s+flag)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'green_middle' }),
  },
  {
    /**
     * The bare `how far` / `how many yards` alternatives are gone: they now need a "to" referent
     * ("how far TO the pin", "how far is it TO the green"), because without one the phrase is just
     * as likely to be about his own clubs. Both narrowings are subtractive — everything that stops
     * matching falls through to the cloud classifier, which lists "how far to the green" →
     * distance_to_green itself (api/voice-intent), so the in-round phrasings keep their answer and
     * only the fast path is lost. A bag question reaches the caddie, which is the point.
     */
    rx: new RegExp(
      '^' + NOT_ABOUT_MY_CLUBS + '(?=.*\\b(?:'
      + 'yardage'
      + '|(?:how\\s+far|how\\s+many\\s+yards?|yards?|distance)\\s+(?:is\\s+it\\s+)?to'
      + '|how\\s+far\\s+(?:am\\s+i|is\\s+(?:it|the\\s+(?:green|pin|flag|hole)))'
      + '|how\\s+many\\s+yards?\\s+(?:is\\s+it|left|to\\s+go)'
      + ')\\b)',
      'i',
    ),
    build: (raw) => intent(raw, 'query_status', { query_topic: 'distance_to_green' }),
  },

  // ── SCORE / ROUND STATUS ──────────────────────────────────
  // Routine is round-INDEPENDENT and deterministic — a command, not a question — so it belongs in
  // the precheck next to the other commands rather than depending on a brain round-trip.
  // These regexes are the mirror's, but the mirror only ever ran AFTER the brain had failed, so a
  // loose match cost nothing. Here they run BEFORE it, and a loose match INTERCEPTS. "Tell me a good
  // warm-up routine" is a request FOR a warm-up and must reach the caddie; only a POSSESSIVE or
  // demonstrative means the stored one. Same principle as NOT_ABOUT_TOOL above: naming the thing is
  // not asking for it. These two only DETECT a routine sentence; precheckLocalIntent then keeps the hit
  // only when services/routineUtterance says the whole utterance is the order (2026-10-28, r4).
  // "my pre-round routine" is the stored one too — the mirror's own example, which never matched here.
  {
    rx: /\b(save|remember|keep)\b[^.?!]{0,20}\b(that|this|my)\s+(?:pre[\s-]?round\s+)?(routine|stretches|warm.?up)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'routine_save' }),
  },
  {
    rx: /\b(what(?:'s|s)?|tell\s+me|recall|show\s+me|give\s+me|read|run\s+me\s+through)\b[^.?!]{0,20}\bmy\s+(?:pre[\s-]?round\s+)?(routine|stretches|warm.?up)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'routine_recall' }),
  },
  {
    rx: /\b(what(?:'s|s)?\s+my\s+score|how\s+am\s+i\s+doing|my\s+score|score\s+(?:today|so\s+far)|vs\.?\s+par|under\s+par|over\s+par)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'score' }),
  },
  // 2026-08-05 (Tim — CORE: "I told the caddie my score and he didn't log it or ask putts"). Scoring had
  // NO local precheck, so the most core round action relied ENTIRELY on the network classifier — a
  // cold/slow classifier (or a drift to the chat brain) meant the score silently never logged. Route
  // clear score REPORTS straight to log_score. logScoreHandler parses the stroke count from raw_text and
  // asks "How many putts?" when none was said inline. Verb-anchored; a club/putt/distance/hole negative
  // lookahead keeps false positives out ("5 iron", "3 putt(ed)", "5 degrees", "5 holes left" never match).
  // The score QUERY rule above wins for "what's my score".
  {
    rx: SCORE_VERB_RX,
    build: (raw) => intent(raw, 'log_score', scoreHoleParam(raw)),
  },
  {
    rx: SCORE_NAMED_RX,
    build: (raw) => intent(raw, 'log_score', scoreHoleParam(raw)),
  },
  {
    rx: /\b(what\s+hole|which\s+hole|hole\s+am\s+i\s+on|what\s+hole\s+is\s+this)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'hole' }),
  },
  {
    rx: /\b(how\s+many\s+(?:more\s+)?holes?\s+(?:left|to\s+go|remaining)|holes?\s+(?:left|remaining))\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'holes_left' }),
  },
  {
    rx: /\b(what(?:'s|s)?\s+(?:the\s+)?par|par\s+(?:here|of\s+this\s+hole|on\s+this))\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'par' }),
  },

  // ── PROFILE / COURSE ──────────────────────────────────────
  {
    rx: /\b(what(?:'s|s)?\s+my\s+handicap|my\s+handicap)\b/i,
    build: (raw) => intent(raw, 'handicap_query'),
  },
  {
    rx: /\b(what\s+course|which\s+course|where\s+am\s+i\s+playing|what(?:'s|s)?\s+the\s+course)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'course' }),
  },

  /**
   * ── READ THIS PUTT (2026-09-13) ───────────────────────────────────────────────────────────────────
   *
   * Tim: "most of the time I ask the Caddie to look at the Putt which works every time and I think it
   * opens SmartFinder in Putt mode… Or maybe it was actually opening tightlie but I get a pic analysis.
   * You just make a very simple assumption and ran with it."
   *
   * Every putt phrasing returned NULL here, so the cloud classifier decided — and api/voice-intent lists
   * "look at my putt" under query_status{putt_analysis} (PuttingLab STROKE analysis from glasses video,
   * which speaks and never navigates) while the utterance's own words pull hard toward open_tool{look}
   * (a general HOLE scene read). A coin flip between two wrong answers. Landing in putt mode at all
   * depended on zustand having persisted 'putt' from the last time he tapped the tab.
   *
   * Deterministic here, exactly like the B11 "what's the play" fix above, and for the same reason: a
   * route that a model re-decides every time is not a route.
   *
   * WHAT THIS DELIBERATELY DOES NOT TAKE — this is a COMMAND ("go read this putt"), and the precheck
   * must not swallow questions the caddie should answer himself:
   *   · "how's my putting" / "how many putts"  → putt_stats, below and unaffected (no read verb)
   *   · "longest putt"                          → longest_putt, below and unaffected
   *   · anything naming the STROKE or a lesson  → the negative lookahead sends it to the brain, which
   *     is what actually owns PuttingLab stroke analysis
   * [[a-question-intercepted-before-the-brain-is-never-heard]]
   */
  {
    rx: /^(?!.*\b(?:stroke|tempo|mechanics|takeaway|follow\s*through|lesson|drill)\b)(?=.*\b(?:look\s+at|read|check|analy[sz]e|size\s+up)\b)(?=.*\b(?:putt|green)\b)(?!.*\b(?:putts?\s+(?:so\s+far|this\s+round|today)|how\s+many)\b)/i,
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'putt_read' }),
  },
  {
    // "how's my read" is a green read too, and reaches none of the patterns above or below it.
    rx: /\bhow(?:'s|\s+is)\s+(?:my|the)\s+read\b/i,
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'putt_read' }),
  },

  // ── ROUND STATS (2026-07-25 coverage-audit gaps — all answered locally/offline) ──
  {
    /**
     * 2026-09-13 (Tim) — the Highlights card has shown LONGEST PUTT since June and the caddie could
     * not be asked about it, while LONGEST DRIVE beside it has had a topic since 2026-09-12. Drawn,
     * stored, unaskable — the half that keeps being missing.
     * [[smartplay-defect-class-unwired-halves]]
     *
     * Sits ABOVE putt_stats deliberately: "my longest putt today" matches that pattern's
     * `putts?\s+today` branch, and the more specific question has to win.
     */
    rx: /\b(longest\s+putt|furthest\s+putt|farthest\s+putt|my\s+best\s+putt|longest\s+one\s+i(?:'ve)?\s+(?:ever\s+)?made)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'longest_putt' }),
  },
  {
    rx: /\b(how\s+many\s+putts|putts?\s+(?:so\s+far|this\s+round|today)|how(?:'s|\s+is|\s+am\s+i)\s+(?:my\s+)?putting|putting\s+stats?)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'putt_stats' }),
  },
  {
    rx: /\b(greens?\s+in\s+regulation|hitting\s+(?:the\s+)?greens?|how\s+many\s+greens?|g\.?i\.?r\.?)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'gir' }),
  },
  {
    // "how'd I do on the front/back nine" — captures which nine in raw_text for the handler.
    rx: /\b(front\s+nine|back\s+nine|front\s+side|back\s+side|on\s+the\s+(?:front|back))\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'nine_split' }),
  },
  {
    rx: /\b(longest\s+drive|farthest\s+drive|furthest\s+drive|my\s+best\s+drive|biggest\s+drive)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'longest_drive' }),
  },
  {
    rx: /\b(last\s+time\s+(?:i|we)\s+(?:played|were)\s+here|how\s+did\s+i\s+(?:do|play|shoot)\s+(?:here\s+)?last\s+time|my\s+(?:best|average)\s+(?:round|score)\s+here|last\s+round\s+here)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'last_round_here' }),
  },
  // 2026-07-24 (final QA — "ask for settings", OFFLINE + local-first) — set handedness by voice.
  // Anchored on UNAMBIGUOUS handedness terms ("left/right-handed", "lefty", "righty", "southpaw")
  // so aiming/direction talk ("aim left", "the green's to the right", "go left") can NEVER trigger it.
  // Routes to changeSettingHandler, which sets the profile the swing analysis reads.
  //
  // 2026-10-28 (Brain review r9) — and only as a SELF-DECLARATION or an ORDER. Matched anywhere,
  // "We got paired with a lefty", "Phil Mickelson is a lefty", "I'm playing with a lefty today" and
  // "I putt left handed" each set handedness=left — mirroring every later swing read — and "This hole
  // is tough for a righty" set right. The whole utterance now has to be "I'm (a) lefty" / "I play
  // southpaw" / "set me to left-handed" / a bare "lefty"; anything else mentions the word and is the
  // caddie's.
  //
  // 2026-10-28 (Brain recheck r10) — but the order can still be addressed to him. "I'm a lefty,
  // Kevin", "set me to left handed for me", "just set me to lefty, thanks" and (via LEAD_IN) "actually
  // I'm a lefty" / "Kevin I'm left handed" missed the anchor, fell to the mention catch-all below and
  // reached a brain with no tool for handedness — so a lefty kept right-handed reads. A trailing
  // vocative, "for me" or a thanks is part of the order.
  {
    rx: new RegExp(
      LEAD_IN
      + String.raw`(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:just\s+)?`
      + String.raw`(?:(?:i'?m|im|i\s+am|i\s+play(?:\s+as)?|i\s+swing|i\s+golf|set\s+me\s+(?:up\s+)?(?:to|as)|(?:set|change|switch)\s+(?:my\s+)?handedness\s+to|`
      + String.raw`switch\s+(?:me\s+)?to|change\s+(?:me\s+)?to|make\s+me|put\s+me\s+(?:down\s+)?as)\s+)?(?:a\s+)?`
      + String.raw`(left[\s-]?handed|lefty|southpaw|right[\s-]?handed|righty)(?:\s+(?:golfer|player))?`
      + SETTING_TAIL,
      'i',
    ),
    build: (raw, m) => intent(raw, 'change_setting', {
      setting_name: 'handedness',
      new_value: /left|lefty|southpaw/i.test(m[1]) ? 'left' : 'right',
    }),
  },
  // 2026-07-24 (final QA — offline settings, local-first). Deterministic setting flips that used to
  // require the cloud classifier (dead-ended offline). Tight patterns only, so they can't misfire on
  // ordinary talk. changeSettingHandler already applies each of these.
  {
    // Caddie persona — anchored on a switch verb + one of the SELECTABLE names, so a guest named
    // e.g. "Kevin" is never mistaken for a persona switch.
    //
    // 2026-08-30 — derived from ACTIVE_PERSONAS instead of a hardcoded (kevin|serena|harry). Harry
    // is soft-removed and settingsStore's v6 migration exists to move players OFF him; matching him
    // here routed straight back to the persona the picker refuses to list.
    rx: PERSONA_SWITCH_RX,
    build: (raw, m) => intent(raw, 'change_setting', { setting_name: 'caddie_persona', new_value: (m[1] ?? m[2]).toLowerCase() }),
  },
  {
    // Theme — "mode" anchors it (never "turn on the lights").
    //
    // 2026-10-28 (Brain review r9) — and the whole utterance is the order. Every verb was optional, so
    // "Dark mode is hurting my eyes" turned dark mode ON, and "turn off dark mode" did too. A bare
    // "dark mode", a switch/turn-on/use verb, or a polite "can you" in front; "turn off X mode" is the
    // other one. Anything else talks ABOUT the theme.
    //
    // 2026-10-28 (Brain recheck r10) — the everyday ways to say it as well: "make it dark mode", "I
    // want dark mode", "turn on dark mode for me", "switch to dark mode, Kevin", "Kevin switch to dark
    // mode". Each was an order the catch-all below sent to a brain with no theme tool.
    rx: new RegExp(
      LEAD_IN
      + String.raw`(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:just\s+)?`
      + String.raw`(?:(?:switch|change|go|set|put)\s+(?:me\s+|it\s+|the\s+app\s+|(?:the\s+)?(?:theme|screen|display)\s+)?(?:to|into|in)\s+`
      + String.raw`|(?:turn\s+on|use|enable|give\s+me|make\s+it|put\s+me\s+in|i\s+(?:want|prefer)|i'?d\s+(?:like|prefer)|let'?s\s+(?:do|use|go\s+with))\s+|(turn\s+off|disable)\s+)?`
      + String.raw`(?:the\s+)?(dark|light)\s+(?:mode|theme)(?:\s+on)?`
      + SETTING_TAIL,
      'i',
    ),
    build: (raw, m) => {
      const named = m[2].toLowerCase();
      return intent(raw, 'change_setting', { setting_name: 'theme', new_value: m[1] ? (named === 'dark' ? 'light' : 'dark') : named });
    },
  },
  {
    // 2026-10-29 (Brain recheck r12) — "switch to light", "set the theme to dark", "turn the theme to
    // dark": a verb, the theme (or nothing), "to", and the colour. The colour is the order on its own;
    // only "dark mode" / "dark theme" were matched above, so these went nowhere and Kevin pretended.
    rx: new RegExp(
      LEAD_IN
      + String.raw`(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:just\s+)?`
      + String.raw`(?:switch|change|set|put|turn)\s+(?:me\s+|it\s+|the\s+app\s+|(?:the\s+)?(?:theme|screen|display)\s+)?(?:to|into)\s+(?:the\s+)?(dark|light)`
      + SETTING_TAIL,
      'i',
    ),
    build: (raw, m) => intent(raw, 'change_setting', { setting_name: 'theme', new_value: m[1].toLowerCase() }),
  },
  {
    // 2026-10-28 (Brain review r9) — a sentence that only MENTIONS handedness or a theme ("we got
    // paired with a lefty", "dark mode is hurting my eyes") is the caddie's. 'conversational', not
    // null: the cloud classifier would hand the same sentence back as a setting change.
    //
    // 2026-10-29 (Brain recheck r12) — "dark theme", "the theme is dark", and "handedness" were not
    // words this caught, so an order phrased with them reached Kevin with no declined note. The note
    // is what stops him saying "done" to a setting nothing changed.
    //
    // 2026-10-29 (Brain recheck r13) — a bare "theme" is a golf word too ("what's the theme of the
    // hole"), and the note told Kevin about app settings on a course-design question. "theme" counts only
    // when it is the app's: "my/the app's theme", "set/change/turn the theme", "the theme is/to/on …".
    rx: /\b(?:left[\s-]?handed|lefty|southpaw|right[\s-]?handed|righty|handedness|(?:dark|light)\s+(?:mode|theme)|(?:app'?s?|my|set|switch|change|make|turn)\s+(?:the\s+)?theme|theme\s+(?:is|was|to|into|on|off|setting|settings))\b/i,
    build: (raw, m) => intent(raw, 'conversational', {
      raw_utterance: raw, not_a_command: 'change_setting', setting_name: /theme|dark|light/i.test(m[0]) ? 'theme' : 'handedness',
    }),
  },
  {
    // Cart mode on/off.
    rx: /\bcart mode\s+(?:on|off)\b|\b(?:turn\s+(?:on|off)|enable|disable)\s+cart mode\b/i,
    build: (raw, m) => intent(raw, 'change_setting', { setting_name: 'cart_mode', new_value: /\boff\b|disable/i.test(m[0]) ? 'off' : 'on' }),
  },
  {
    // Ghost round on/off.
    rx: /\bghost(?: mode)?\s+(?:on|off)\b|\b(?:turn\s+(?:on|off)|enable|disable)\s+ghost(?: mode)?\b/i,
    build: (raw, m) => intent(raw, 'change_setting', { setting_name: 'ghost', new_value: /\boff\b|disable/i.test(m[0]) ? 'off' : 'on' }),
  },

  // ── CLOSE / EXIT A TOOL → HOME (deterministic) ────────────
  // 2026-06-16 (Tim — "close Smart Motion" white-screened) — closing a tool routes
  // HOME to the caddie locally, so it never rides the cloud classifier (which sent
  // it nowhere → white screen). "go back" stays a real back(); this is the
  // explicit close/exit/home set only.
  {
    rx: /\b(close\s+(?:smart\s*motion|this|it|the\s+(?:tool|camera|screen))|exit\s+(?:smart\s*motion|this|it|the\s+(?:tool|camera|screen))|go\s+home|take\s+me\s+home|back\s+to\s+(?:the\s+)?caddie)\b/i,
    build: (raw) => intent(raw, 'navigate', { direction: 'home' }),
  },

  // ── SHOT STRATEGY ("what's the play" = query_status, NOT open_tool) ─────
  // B11 fix 2026-06-22 — "what's the play" was ambiguous: it appeared under
  // open_tool { lie_analysis } in Haiku's prompt AND under query_status {
  // shot_strategy }, causing a coin-flip route that sometimes opened TightLie
  // camera instead of returning a verbal strategy answer. Deterministic precheck
  // catches all canonical "play" phrasings BEFORE Haiku sees them, routing
  // every one to shot_strategy. The only exclusion is "smart play" (see below).
  {
    rx: /\b(?:what(?:'s|s)?\s+(?:my|the)\s+play(?:\s+here)?|what\s+should\s+I\s+play(?:\s+here)?|what\s+do\s+I\s+play\s+here)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'shot_strategy' }),
  },

  // ── HOLE READ / BRIEFING (2026-08-06, Tim — "we need the prompt: what's the read?") ──
  // Per-hole reads are PULL-only now (the auto-intro/M12 briefing was removed — see roundStore
  // setCurrentHole). The player ASKS and gets the hole read on demand: hole # + par + yardage + the
  // course-intel sentence + shot strategy + prior-shot memory, assembled in queryStatusHandler
  // (query_topic:'hole_read'). Leading negative lookahead excludes PUTT/GREEN reads (a separate flow) so
  // "what's the read" on the green doesn't grab the hole briefing; "what's the play" already routed to
  // shot_strategy above, and "smart play" (SmartFinder) has no read/briefing/rundown words.
  {
    // 2026-08-23 — also excludes a MOVE. "Next hole, give me the briefing" matched here (line 272)
    // long before the next_hole pattern (line 343), so the player advanced nowhere and was briefed
    // on the hole they had just walked off — accurate, and about the wrong hole, which is the worst
    // kind of wrong. A compound "move me AND brief me" is two acts, and neither precheck pattern can
    // do both; it now falls through to the caddie, who calls declare_hole and briefs in one turn.
    rx: /^(?!.*\b(?:putts?|green)\b)(?!.*\b(?:next\s+hole|next\s+tee|on\s+to\s+the\s+next|previous\s+hole)\b)(?=.*\b(?:what(?:'s|s)?\s+the\s+read|give\s+me\s+the\s+read|read\s+(?:me\s+)?(?:this|the)\s+hole|briefing|brief\s+me|hole\s+info|(?:the\s+)?rundown|break\s+down\s+(?:this|the)\s+hole|(?:tell\s+me\s+about|walk\s+me\s+through)\s+(?:this|the)\s+hole)\b)/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'hole_read' }),
  },

  // ── SIM ROUND (2026-07-04, Tim — voice-narrated practice round) ──────────
  // Deterministic + offline: "start a sim round (at palms)" / "sim round" /
  // "start a simulated round" / "practice round simulation". Executed by
  // openToolHandler tool_name 'sim_round' (starts the narrated Palms sim).
  {
    rx: /\b(?:start|begin|play|do)\s+(?:a\s+)?sim(?:ulated|ulation)?\s+round\b|\bsim\s+round\s+at\b/i,
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'sim_round', raw_utterance: raw }),
  },

  // ── THE TAGLINE ───────────────────────────────────────────
  /**
   * 2026-09-13 (Tim) — "SmartPlay is not really a tool like SmartFinder. It's our 'what's the play
   * here' phrase as a tool. When the user asks for the SmartPlay, Caddie analyzes the situation in
   * that moment under our myriad of conditions and factors and provides user-centric strategy for
   * the shot... it's our answer to every other app's plays-like feature."
   *
   * From 2026-06-17 until today this did the OPPOSITE. The comment that used to live here said it
   * out loud: "'smart play' also appears in Haiku's shot_strategy examples, causing it to explain
   * verbally instead of opening SmartFinder" — the model wanted to answer strategically and was
   * deliberately overridden into opening a camera. So "what's the play" reached the brain with the
   * whole payload (lie, wind, elevation, plays-like, the bag, the player's tendencies, the hole and
   * the pin) while "what's the SMART play" took a photo. Adding the app's own tagline word made the
   * answer worse.
   *
   * A question intercepted before the brain is a question the caddie never heard — the precheck
   * matches COMMANDS, and this was never a command. Everyone else answers "plays like 165"; the
   * point of this phrase is that it answers with the decision. It goes to the brain now, exactly
   * where the un-"smart" phrasing already went.
   *
   * The NOT_ABOUT_TOOL guard stays: "log an issue with the smart play" is still about the feature,
   * not a request for a read. The visual scene read it used to open is unchanged and still reachable
   * inside SmartFinder.
   * [[a-toggle-that-does-nothing-for-the-default-user]] [[orphans-are-live-bugs-not-dead-code]]
   */
  /**
   * 2026-10-24 — SmartBay AI and SmartPlay Golf (SwingLab, hosted). An EXPLICIT open only, and ahead
   * of the smart-play read below: "open smartplay golf" matched `open smart play` and was answered
   * with a shot-strategy read, and "open smartbay" fell through to the classifier, which had no such
   * tool and opened a scene read instead.
   */
  {
    rx: new RegExp('^' + NOT_ABOUT_TOOL + '(?=.*\\b(?:open|pull\\s+up|bring\\s+up|launch|start|go\\s+to|take\\s+me\\s+to)\\s+(?:the\\s+|my\\s+)?smart\\s*bay\\b)', 'i'),
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'smartbay' }),
  },
  {
    rx: new RegExp('^' + NOT_ABOUT_TOOL + '(?=.*\\b(?:(?:open|pull\\s+up|bring\\s+up|launch|start|go\\s+to|take\\s+me\\s+to|play)\\s+(?:the\\s+)?smart\\s*play\\s+golf|(?:open|launch|play|start)\\s+the\\s+golf\\s+game)\\b)', 'i'),
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'smartplay_golf' }),
  },
  {
    // 2026-08-06 (voice audit) — NOT_ABOUT_TOOL guard, same as smartfinder/vision/swinglab below, so
    // "log an issue with the smart play" / "the smart play feature is broken" DON'T open SmartFinder.
    // The bare `the smart play` alternative (no verb anchor) was the exposure the others were spared.
    rx: new RegExp('^' + NOT_ABOUT_TOOL + "(?=.*\\b(?:what(?:'s|s)?\\s+the\\s+smart\\s+play|give\\s+me\\s+the\\s+smart\\s+play|the\\s+smart\\s+play|open\\s+smart\\s*play(?!\\s*golf)|smartplay\\s+here)\\b)", 'i'),
    build: (raw) => intent(raw, 'query_status', { query_topic: 'shot_strategy' }),
  },
  {
    /**
     * 2026-08-31 (Tim) — "my card" / "my business card". Matched LOCALLY so it opens instantly
     * without a cloud round-trip, which is the whole point of handing someone a card.
     *
     * Two deliberate narrowings:
     *   - a POSSESSIVE or the word "business"/"digital"/"contact" is required. A bare "card" mid-round
     *     means the SCORECARD every time, and this pattern sits BEFORE nothing that would rescue it.
     *   - "scorecard" and "score card" are excluded outright, so "pull up my score card" cannot be
     *     dragged in by the `my ... card` shape.
     * Non-owners reach the route and its own gate refuses them — same shape as the GPS bench.
     */
    rx: new RegExp('^' + NOT_ABOUT_TOOL + "(?!.*\\bscore\\s*card\\b)(?=.*\\b(?:my\\s+(?:business|digital|contact)?\\s*card|business\\s+card|digital\\s+card|contact\\s+card)\\b)", 'i'),
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'my_card' }),
  },
  /**
   * 2026-09-12 — SAYING A NUMBER IS NOT ASKING FOR A SCREEN.
   *
   * `rangefinder` was a bare alternative here, so "my rangefinder says 205" — the player FEEDING the
   * system a number — matched at confidence 'high' and opened /smartfinder. The 205 went nowhere.
   *
   * That is the exact scenario services/yardageResolver was built for: a user-stated number outranks
   * live GPS and the card, and the 08-24 note in services/caddieRequestBody reproduces it against
   * production with a rangefinder reading of 205. The resolver never got the chance — the precheck
   * had already spent the utterance on a screen. The cloud classifier has carried `state_yardage`
   * for this all along (api/voice-intent §3.5, "rangefinder reading"); it just never ran.
   *
   * Split in two rather than loosened: an EXPLICIT open still opens, numbers and all, while the bare
   * tool noun now steps aside for a spoken yardage and falls through to the classifier. Same shape
   * as the 08-06 NOT_ABOUT_TOOL fix — naming the tool is not commanding it.
   */
  {
    rx: new RegExp('^' + NOT_ABOUT_TOOL + '(?=.*\\b(?:open|pull\\s+up|bring\\s+up|launch|fire\\s+up|show\\s+me|go\\s+to|take\\s+me\\s+to)\\s+(?:the\\s+|my\\s+)?(?:smart\\s*finder|range\\s*finder))', 'i'),
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'smartfinder' }),
  },
  {
    rx: new RegExp('^' + NOT_ABOUT_TOOL + '(?!.*\\d{2,3})(?=.*\\b(?:smart\\s*finder|rangefinder|range\\s+finder|lock\\s+(?:the\\s+)?distance)\\b)', 'i'),
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'smartfinder' }),
  },
  {
    rx: new RegExp('^' + NOT_ABOUT_TOOL + '(?=.*\\b(?:open\\s+smart\\s*vision|smart\\s*vision|show\\s+(?:me\\s+)?the\\s+(?:hole|layout|map)|pull\\s+up\\s+the\\s+map)\\b)', 'i'),
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'smartvision' }),
  },
  {
    // 2026-06-24 (Tim) — only EXPLICIT "swing lab" auto-opens the hub. A vague
    // practice wish ("let's practice", "I want to practice") must NOT auto-navigate
    // — the caddie asks what to work on first (handled by the brain). The
    // "practice" phrasings were removed from this deterministic open.
    // 2026-08-06 — plus the NOT_ABOUT_TOOL guard so "log an issue with swing lab" doesn't open it.
    rx: new RegExp('^' + NOT_ABOUT_TOOL + '(?=.*\\b(?:open\\s+swing\\s*lab|swing\\s*lab)\\b)', 'i'),
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'swinglab' }),
  },

  // ── SCORECARD-PHOTO INGEST (the moat: "snap a card → the caddie ingests it") ──
  // 2026-07-25 (Tim). add_course = parse a scorecard into a COURSE layout; import_round = parse a played
  // scorecard's SCORES into round history. "course" wins the first; anything about a round/score/scorecard
  // hits the second. Narrow verbs (add/scan/import/upload/load) so ordinary talk never fires it.
  {
    rx: /\b(?:add|create|set\s*up|scan|import|load)\s+(?:a\s+)?(?:new\s+)?course\b|\bcourse\s+from\s+(?:a\s+)?(?:photo|picture|scorecard|card)\b/i,
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'add_course' }),
  },
  {
    rx: /\b(?:import|scan|upload|log|add)\s+(?:my\s+|a\s+|the\s+|last\s+|past\s+)*(?:round|rounds|score|scores|scorecard)\b|\bscorecard\s+(?:photo|picture|screenshot)\b/i,
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'import_round' }),
  },

  // ── UNDO + HOLE NAV + BARE START (2026-07-25 coverage-audit command gaps) ──
  // "undo / scratch that / delete that shot" → revert the last score/putt/shot.
  // 2026-07-25 (deep audit — S1) — REMOVED "never mind": it's the common phrase to DISMISS the
  // caddie, and matching it here silently reverted the last logged score/putt/shot (a destructive
  // mutation) on a hands-free path where the user may never hear the "reverted" line. Undo now
  // requires an explicit undo verb; "never mind" falls through to the brain as a plain dismissal.
  {
    // 2026-10-15 (review) — and only as an INSTRUCTION: at the start of a clause, optionally after
    // "oops / wait / actually / please" or a polite "can you". "I wish I could take that back" is a
    // golfer regretting a shot, and it reverted the last logged score.
    rx: /(?:^|[,.!;]\s*)(?:(?:ok|okay|alright|all\s+right|and|so|cool|great|nice|hey|right|good|perfect|done|oops|wait|actually|no|please|sorry)[\s,]+)*(?:[a-z]+,\s*)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(undo(?:\s+that)?|scratch\s+that|delete\s+(?:that|the\s+last)(?:\s+(?:shot|score|putt))?|take\s+that\s+back|nix\s+that)\b/i,
    build: (raw) => intent(raw, 'undo'),
  },
  // "next hole" / "next tee" → advance. Deterministic so it never rides the cloud (offline dead-end).
  {
    // The mirror of the hole_read exclusion above: a bare move is deterministic and stays local and
    // instant, but "next hole, what's the read?" is a move AND a question. Handing that to navigate
    // advances the hole and silently drops the question, which is the same half-answer in reverse.
    rx: /^(?!.*\b(?:briefing|brief\s+me|the\s+read|rundown|hole\s+info|walk\s+me\s+through|tell\s+me\s+about)\b)(?=.*(?:(?:(?:^|[,.!;]\s*)(?:(?:ok|okay|alright|all\s+right|and|so|cool|great|nice|hey|right|good|perfect|done|oops|wait|actually|no|please|sorry)[\s,]+)*(?:[a-z]+,\s*)?|\b(?:go|move(?:\s+on)?|head|skip|take\s+me|let'?s\s+go)\s+(?:to\s+)?(?:the\s+)?)(?:next\s+hole|next\s+tee)\b(?!\s+(?:is|was|looks?|has|like)\b|'s)|\bon\s+to\s+the\s+next(?:\s+hole)?\b|\bdone\s+here,?\s*next\b))/i,
    build: (raw) => intent(raw, 'navigate', { direction: 'next_hole' }),
  },
  {
    // 2026-10-15 (review) — "previous hole" as an INSTRUCTION (clause start, or after a motion verb).
    // "What did I make on the previous hole?" is a question about the card, and it moved the round.
    rx: /(?:(?:(?:^|[,.!;]\s*)(?:(?:ok|okay|alright|all\s+right|and|so|cool|great|nice|hey|right|good|perfect|done|oops|wait|actually|no|please|sorry)[\s,]+)*(?:[a-z]+,\s*)?|\b(?:go|move|head|take\s+me)\s+(?:back\s+)?(?:to\s+)?(?:the\s+)?)previous\s+hole\b(?!\s+(?:is|was|looks?|has|like)\b|'s)|\bgo\s+back\s+a\s+hole\b|\bback\s+(?:one|a)\s+hole\b|\blast\s+hole\s+again\b)/i,
    build: (raw) => intent(raw, 'navigate', { direction: 'previous_hole' }),
  },
  // Bare "start a round" (no course/name) → open the Play tab to pick one. A NAMED start
  // ("start a round at Pebble with Mike") is caught earlier / stays a quick_round via the brain.
  {
    rx: /^(?:hey\s+)?(?:let'?s\s+)?(?:start|begin|play)\s+(?:a\s+)?round\s*[.!?]?$|^(?:let'?s\s+)?tee\s+off\s*[.!?]?$/i,
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'play' }),
  },
];

/**
 * Try to classify the transcript locally without calling the cloud
 * classifier. Returns a high-confidence VoiceIntent on match, or
 * null when no pattern matches (caller falls through to cloud).
 */
/** "pin's back right", "the flag is at the front of the green", "they've got the pin tucked back left". */
const PIN_LOCATION_RX = /\b(?:pin|flag|hole\s+location)\b[^.?!]{0,40}\b(?:front|back|middle|left|right|tucked|centre|center)\b/i;

/**
 * 2026-10-15 (review) — THE INTENTS THAT CHANGE SOMETHING. A query answered locally ("what's my
 * score") is harmless if a story trips it; these move the round, write the card, change a setting or
 * take the player off the screen he is on. Each one is acted on before the caddie hears a word.
 */
/**
 * Opens that only match on an explicit imperative verb ("pull up / show me / open …"), where a time
 * word is part of WHAT to open ("pull up my round from yesterday"), not a story. The question half of
 * the guard still applies to them; the story half would take a real command away.
 */
const VERB_ANCHORED_OPENS = new Set(['find_my_data', 'open_course', 'open_tool']);

const ACTING_INTENTS = new Set([
  'change_setting', 'log_score', 'navigate', 'undo', 'find_my_data', 'open_tool', 'open_course',
  'correct_last_shot', 'set_club_distance', 'media_capture',
]);

/**
 * 2026-10-28 (Brain review r4) — query_status topics that WRITE. routine_save replaces the stored
 * pre-round routine with the caddie's last line, so it is an acting intent wearing a lookup's type and
 * gets the same question/story guard.
 */
const ACTING_TOPICS = new Set(['routine_save']);

/**
 * Intents where the PLAYER is the subject: a score on his card, his risk mode, his bag. Said about
 * someone else ("my partner got a 4", "my buddy is going for it", "my son's 7 iron carries 140") they
 * are a report, not an order.
 */
const PLAYER_SUBJECT_INTENTS = new Set(['log_score', 'change_setting', 'set_club_distance', 'correct_last_shot']);

/**
 * 2026-10-31 (Brain recheck r18, BRAIN-2) — A NEAR MISS IS NOT A SCORE. "I almost birdied that hole" and
 * "I nearly bogeyed it" wrote a birdie and a bogey onto the card, because the score words carry no story
 * frame and "almost" is not one. Kept to log_score alone: STORY_FRAME is shared with the brain's shot and
 * mood fallbacks, and a near miss only changes what may be written to the card.
 */
const NEAR_MISS_RX = new RegExp(
  String.raw`\b(?:(?:almost|nearly|just\s+missed|barely\s+missed)\s+(?:a\s+|an\s+|the\s+)?(?:birdi\w*|bogey\w*|par\w*|eagle\w*|double\w*|triple\w*|make|made|making|sink\w*|hol\w*|get|got|getting|\d)`
  + String.raw`|(?:came|was|were|got)\s+(?:so\s+)?close\s+to\s+(?:a\s+|an\s+)?(?:birdi\w*|bogey\w*|par\w*|eagle\w*|double\w*|triple\w*|make|made|making|sink\w*|hol\w*))\b`,
  'i',
);

const ROUTINE_ASK: Record<string, 'save' | 'recall'> = { routine_save: 'save', routine_recall: 'recall' };

/**
 * 2026-10-27 (Brain review B1) — THE STATUS LOOKUPS. Each of these answers with a bare readout from
 * queryStatusHandler ("152 to the middle.", "Through 7, you're 38, +3.", "Your Index is 12.4"), and
 * off-round several of them answer "You're not in a round yet". That is the right reply to a bare
 * status ask and the wrong reply to anything else.
 */
const STATUS_LOOKUP_TOPICS = new Set([
  'green_front', 'green_back', 'green_middle', 'distance_to_green', 'score', 'hole', 'holes_left', 'par',
  'course', 'longest_putt', 'putt_stats', 'gir', 'nine_split', 'longest_drive', 'last_round_here',
  'routine_recall', 'club_distance',
]);

/**
 * A decision, a reason, or a subject that is not the round's status. Any one of these turns a status
 * phrase into a question only the caddie can answer: "what should I hit TO THE PIN", "what CLUB gets me
 * to the back", "I'm worried about MY SCORE, should I lay up", "what's my handicap doing lately and WHY",
 * "my buddy SAYS my yardage is WRONG", "how am I doing on my TEMPO". "Left to play" is a count, not a
 * decision, so it is taken out before the test.
 */
const DECISION_OR_REASON_RX =
  /\b(?:should|shall|why|clubs?|or|play|playing|change|expect|lay\s*up|go\s+(?:at|for)|(?:do|should|would|can|could|will)\s+i\s+hit|land|fly|aim|carry|attack|wrong|says|said|think|worried|worry|nervous|strategy|plan|lately|improve|better|fix|swing|tempo|feel|feels|mental|confidence)\b/i;

/**
 * 2026-10-28 (Brain review r4) — a GOAL or a TREND is not a status ask either. "I want to shoot under
 * par today" → "Through 3, you're 15 — +2.", "My handicap went up after that tournament" → "Your
 * Index is 12.4", and off-round both got "You're not in a round yet". The player is talking about his
 * game; the caddie answers that.
 */
const GOAL_OR_TREND_RX =
  /\b(?:want(?:s|ed)?\s+to|wanna|goals?|trying\s+to|try\s+to|hop(?:e|ing)\s+to|target|went\s+(?:up|down)|gone\s+(?:up|down)|going\s+(?:up|down)|go\s+(?:up|down)|dropp(?:ed|ing)|climb(?:ed|ing)|balloon\w*|blows?\s+up|this\s+(?:year|season)|break\s+\d+)\b/i;

/**
 * 2026-10-28 (Brain review r9) — A STATEMENT IS NOT AN ASK. "I hit a 7 iron to the back of the green"
 * → "N yards to the back", "I'm not hitting the greens today" → a GIR count, "I don't care about my
 * score today" → the score, "I'm on the front nine of my life" → a nine split. A lookup is claimed
 * when the sentence ASKS — a question word, a "tell me / give me", or a bare noun phrase ("my score",
 * "yards to the back"). One that opens with the player as the subject and asks nothing is him talking
 * about his round, and a negation ("not", "don't") never asks for a readout either.
 */
const FIRST_PERSON_STATEMENT = new RegExp(LEAD_IN + String.raw`(?:i|i'?m|im|i'?ve|i'?d|i'?ll|we|we'?re|we'?ve)\b`, 'i');
const ASKS = /\?|\b(?:how|what|what'?s|whats|where|which|tell\s+me|give\s+me|show\s+me|remind\s+me|read\s+me|know|wondering)\b/i;
const LOOKUP_NEGATED = /\b(?:not|don'?t|do\s+not|doesn'?t|does\s+not)\b/i;

/**
 * 2026-10-29 (Brain recheck r15) — A CONDITION ON THE SHOT is a question too. "How far do I hit my 7 iron
 * INTO THE WIND" and "what's the yardage to the pin, it's DOWNHILL" were answered with the bare bag number
 * or the bare green yardage: the wind, the slope, the rough and the lie are the reason he is asking, and
 * DECISION_OR_REASON_RX has none of them. "Into" alone is left out — "how many yards into the green" is a
 * plain yardage — so only the words that change the number count.
 */
const SITUATION_RX = /\b(?:wind|windy|downhill|uphill|sidehill|sloping|slope|rough|bunker|trouble|lie|if|behind\s+me|against\s+me)\b/i;
const DISTANCE_TOPICS = new Set(['green_front', 'green_back', 'green_middle', 'distance_to_green']);

/**
 * 2026-10-31 (Brain recheck r18, BRAIN-1) — A HAZARD IS A QUESTION, NOT A YARDAGE. "How far to the water",
 * "how far is it to the trees" and "how far to clear the creek" matched the generic yardage rule, and the
 * answer was the green yardage: the caddie never heard that the question was about the hazard. A hazard
 * (or a carry over one) makes a distance question conditional on the shot, the same as wind or slope.
 * "Tree line" is left out: it is a landmark the green-distance tests pin as the green's, not a hazard.
 */
export const HAZARD_RX = /\b(?:water|creeks?|streams?|ponds?|lakes?|trees?(?!\s+line)|woods|hazards?|bunkers?|sand|out\s+of\s+bounds|carry|carrying|clear|clearing|cross|crossing)\b/i;

/**
 * 2026-10-31 (Brain recheck r18, BRAIN-4) — A DEICTIC HOLE. "What's my score on this hole" and "how many
 * putts on that hole" named no hole, so HOLE_SCOPED_TOPICS let them through, and queryStatusHandler
 * answered the ROUND total as if it were this hole. Only the topics that read the round total need this:
 * par and the distances already answer for the current hole, and a bare "par on this hole" stays local.
 */
const DEICTIC_HOLE_RX = /\b(?:(?:this|that|the\s+(?:current|last|previous|present))\s+(?:hole|one)|the\s+(?:hole|one))\b/i;
const DEICTIC_HOLE_TOPICS = new Set(['score', 'putt_stats', 'gir']);

/**
 * 2026-10-29 (Brain recheck r15) — a NAMED hole. queryStatusHandler answers score, putts, par, GIR and the
 * distances for the CURRENT hole or the round total, and reads no hole from the utterance, so "what's my
 * score on hole 7" got the round total and "what's the par on the 12th" got the par of the hole he stands
 * on. The brain has the spoken hole in its tool dispatch, so the named-hole ask goes there.
 */
const HOLE_SCOPED_TOPICS = new Set([
  'score', 'putt_stats', 'par', 'gir', 'distance_to_green', 'green_front', 'green_back', 'green_middle',
]);

/**
 * 2026-10-31 (Brain recheck r20, BRAIN-R20-2) — the one test for "this topic is about ONE hole the utterance
 * names or points at". The precheck uses it before the brain, and the offline score answer uses it too: without
 * it the failure path spoke the round total for "what's my score on this hole". A named hole (HOLE_SCOPED_TOPICS)
 * or a deictic hole (DEICTIC_HOLE_TOPICS) is an ask the round-total reader must not answer.
 */
export function holeScopedAsk(raw: string, topic: string): boolean {
  if (HOLE_SCOPED_TOPICS.has(topic) && parseSpokenHole(raw) != null) return true;
  return DEICTIC_HOLE_TOPICS.has(topic) && DEICTIC_HOLE_RX.test(raw);
}

/**
 * 2026-10-29 (Brain recheck r15) — a score for a PAST round. "What was my score last round" hit the score
 * lookup and the off-round gate deflected it ("You're not in a round yet"), while the putts for that same
 * round were answered from it. The score lookup reads the round in progress, so a past-round marker is the
 * caddie's question.
 */
const PAST_ROUND_RX = /\b(?:last\s+round|yesterday|last\s+time|last\s+week)\b/i;

/**
 * 2026-10-28 (Brain review r9) — a WANT or a NEED is not an order. "I need to go home" left the round
 * screen, "I want to scan my scorecard" opened the importer. The goal half of GOAL_OR_TREND_RX, not
 * the trend half: "went up and down for a 4" is a score, not a trend. A polite request is exempt.
 */
const INTENTION_RX = /\b(?:want(?:s|ed)?\s+to|wanna|need(?:s|ed)?\s+to|have\s+to|has\s+to|got\s+to|gotta|trying\s+to|try\s+to|hop(?:e|ing)\s+to|plan(?:ning)?\s+to)\b/i;

/**
 * 2026-10-28 (Brain recheck r10) — except the call he makes over the ball. "I want to go for it",
 * "I wanna go for it", "I want to play it safe here" ARE how a player calls the shot, not a plan
 * for later; INTENTION_RX sent each to a brain with no tool for risk mode, so posture stayed normal
 * while Kevin could still answer "let's go for it". His own want, now, about the risk call itself —
 * a negation ("I don't want to go for it") is still the caddie's.
 */
const RISK_CALL_RX = /\b(?:i\s+(?:really\s+|just\s+)?(?:want\s+to|wanna)|wanna)\s+(?:just\s+)?(?:go\s+(?:for|at)\s+it|play\s+(?:it\s+)?safe|(?:be|go|get)\s+aggressive|attack|(?:go|be|stay|play)\s+conservative)\b/i;
const RISK_CALL_NEGATED = /\b(?:not|don'?t|do\s+not|dont|never|no)\b/i;
const isRiskCall = (hit: VoiceIntent, raw: string): boolean =>
  hit.intent_type === 'change_setting' && hit.parameters?.setting_name === 'risk_mode'
  && RISK_CALL_RX.test(raw.replace(/’/g, "'")) && !RISK_CALL_NEGATED.test(raw.replace(/’/g, "'"));

function isStatusLookup(hit: VoiceIntent): boolean {
  if (hit.intent_type === 'handicap_query') return true;
  return hit.intent_type === 'query_status' && STATUS_LOOKUP_TOPICS.has(String(hit.parameters?.query_topic ?? ''));
}

export function precheckLocalIntent(transcript: string): VoiceIntent | null {
  const hit = classifyLocalIntent(transcript);
  if (!hit) return hit;
  const topic = String(hit.parameters?.query_topic ?? '');
  /**
   * 2026-10-28 (Brain review r4) — THE ROUTINE IS SAVED OR READ ONLY ON A BARE ORDER.
   *
   * "Do you remember my warm-up routine?" and "I want to keep my warm-up short today" replaced the
   * stored routine with the caddie's last line (queryStatusHandler routine_save), and "What should I
   * add to my warm-up?" got the stored text read back. services/routineUtterance decides whether the
   * whole utterance IS the order; anything else is a sentence about the routine, and it is the
   * caddie's. 'conversational' for the reason given below.
   */
  if (hit.intent_type === 'query_status' && ROUTINE_ASK[topic] && routineAsk(transcript) !== ROUTINE_ASK[topic]) {
    const raw = transcript.trim();
    return intent(raw, 'conversational', { raw_utterance: raw, not_a_command: topic });
  }
  /**
   * 2026-10-27 (Brain review B1) — A STATUS PHRASE INSIDE A QUESTION IS NOT A STATUS ASK.
   *
   * The question guard below covered only the ACTING intents, so every lookup pattern was unguarded:
   * "what should I hit to the pin" → "152 to the middle.", "what's the par-saving play here" → "This
   * hole plays a par 4.", "how many putts should I expect from 30 feet" → a putt count — each at
   * confidence 'high', on every route, and the caddie never heard the question. That is the bare-number
   * answer the 08-23 local-first removal was meant to kill, back through the front door.
   *
   * 'conversational', not null, for the same reason as the guard below: the cloud classifier would
   * re-steal it ("what should I hit to the pin" → distance_to_green).
   */
  if (isStatusLookup(hit)) {
    const raw = transcript.trim();
    if (holeScopedAsk(raw, topic)) {
      return intent(raw, 'conversational', { raw_utterance: raw, not_a_lookup: topic });
    }
    if (topic === 'score' && PAST_ROUND_RX.test(raw)) {
      return intent(raw, 'conversational', { raw_utterance: raw, not_a_lookup: topic });
    }
    /**
     * 2026-10-29 (Brain review r14) — A CLUB QUESTION WITH A DECISION IN IT. "What's my 7 iron, should I
     * go for the green?" and "how far do I hit my driver, should I lay up?" took the whole tail as the
     * club phrase, and the bag readout answered "Your seven iron goes about 165 yards." The decision is
     * the part AFTER the club, so only that part is tested. The bag head is not: "how far do I HIT my 7
     * iron" and "how far do I CARRY my 3 wood" are bag questions, and DECISION_OR_REASON_RX matches both
     * words. Club words themselves match nothing in it, so "what's my 7 iron" stays the bag read.
     */
    if (hit.intent_type === 'query_status' && topic === 'club_distance') {
      const phrase = String(hit.parameters?.club_phrase ?? '');
      /**
       * 2026-10-31 (Brain recheck r23, BRAIN-PLAYER-2) — A CARRY OVER A HAZARD IS THE CADDIE'S. "How far do I hit my 7
       * iron to clear the water" was answered "Your seven iron goes about 165 yards." and the hazard never reached the
       * brain. HAZARD_RX is tested with the club's own name taken off the front, so "sand wedge" and "3 woods" (which
       * contain "sand" and "woods") stay the bag read.
       */
      const hazardPart = phrase.replace(/^(?:\d\s?)?(?:(?:fairway\s+)?woods?|sand\s+wedge)\b/i, '');
      return DECISION_OR_REASON_RX.test(phrase) || SITUATION_RX.test(phrase) || HAZARD_RX.test(hazardPart)
        ? intent(raw, 'conversational', { raw_utterance: raw, not_a_lookup: 'club_distance' })
        : hit;
    }
    const withoutCounts = raw.replace(/\b(?:left|remaining|still)\s+to\s+play\b/gi, ' ');
    // 2026-10-28 (Brain review r4) — and a story or a goal: "I was 3 over through 9 at Menifee
    // yesterday" is not "what's my score". last_round_here is ABOUT a past round ("how did I do here
    // last time"), so its own past framing is the ask, not a story.
    const toldAsStory = topic !== 'last_round_here' && isStoryFramed(withoutCounts);
    const statement = (FIRST_PERSON_STATEMENT.test(withoutCounts) && !ASKS.test(withoutCounts)) || LOOKUP_NEGATED.test(withoutCounts);
    const conditioned = DISTANCE_TOPICS.has(topic) && (SITUATION_RX.test(withoutCounts) || HAZARD_RX.test(withoutCounts));
    if (DECISION_OR_REASON_RX.test(withoutCounts) || GOAL_OR_TREND_RX.test(withoutCounts) || toldAsStory || statement || conditioned) {
      return intent(raw, 'conversational', { raw_utterance: raw, not_a_lookup: String(hit.parameters?.query_topic ?? hit.intent_type) });
    }
    return hit;
  }
  if (!ACTING_INTENTS.has(hit.intent_type) && !(hit.intent_type === 'query_status' && ACTING_TOPICS.has(topic))) return hit;
  /**
   * 2026-10-15 (review) — A QUESTION OR A STORY IS NEVER AN ORDER.
   *
   * Verified against this file: "Should I go for it?" set risk mode to aggressive, "I birdied this
   * hole last year" logged a 3, "How long is the next hole?" advanced the hole, "Should I just go
   * home?" left the round screen, "Did you see that swing?" opened the swing library — every one at
   * confidence 'high', so the router acted and the caddie never heard the question.
   *
   * The guard is the shared one (services/utteranceIsCommand) so the tab-mic bypasses apply the same
   * rule. It belongs HERE, at the dispatcher, for the reason INSTRUCTIONAL_QUESTION_RX does: the next
   * pattern someone adds would bite too.
   *
   * It answers 'conversational', not null. A null is handed to the cloud classifier, which can make
   * the same mistake ("should I go for it" → change_setting); 'conversational' is the route both
   * routers send straight to the brain — the same lesson as the 09-30 tee-time fix above.
   *
   * The putt read is exempt: "how's my read" and "can you read this putt" were written as questions
   * on purpose (2026-09-13), and reading a putt changes nothing on the card.
   *
   * 2026-10-28 (Brain review r4) — and a score or a risk mode said about SOMEONE ELSE ("my partner got
   * a 4 there", "he made a 5") is a report about the group, not an entry on his card.
   *
   * 2026-10-28 (Brain review r9) — and a conditional, a plan or a want ("if I go for it and miss",
   * "after this hole", "I need to go home") — on the verb-anchored opens too, since "I want to scan
   * my scorecard after the round" is a plan, not a past time naming what to open.
   */
  const raw = transcript.trim();
  const blocked = hit.intent_type === 'open_tool' && hit.parameters?.tool_name === 'putt_read'
    ? false
    : isQuestionShaped(raw)
      || (!VERB_ANCHORED_OPENS.has(hit.intent_type) && isStoryFramed(raw))
      || (PLAYER_SUBJECT_INTENTS.has(hit.intent_type) && isAboutSomeoneElse(raw))
      || (hit.intent_type === 'log_score' && NEAR_MISS_RX.test(raw))
      || isConditionalOrFuture(raw)
      || (INTENTION_RX.test(raw) && !isPoliteRequest(raw) && !isRiskCall(hit, raw));
  if (blocked) {
    return intent(raw, 'conversational', {
      raw_utterance: raw, not_a_command: hit.intent_type,
      ...(hit.intent_type === 'change_setting' ? { setting_name: hit.parameters?.setting_name } : {}),
    });
  }
  return hit;
}

/**
 * 2026-10-31 (Brain recheck r19, BRAIN-B) — THE SCORE HALF OF A QUESTION, WHEN THE BRAIN IS DOWN. "I got a 4,
 * how far is the water" is sent to the brain only (r17), so the 4 is written by the brain's own log_score
 * tool. When that turn fails, nothing writes it, and the failure owner must say so instead of answering the
 * question as if the score were on the card. True only for a score said with a question, not a near miss
 * (which is narration) and not a score about someone else.
 */
export function scoreSaidButNotLogged(heard: string): boolean {
  const raw = (heard ?? '').trim();
  if (!raw) return false;
  // The same blockers the precheck applies to a log_score hit (near miss, story, conditional, someone else): a score
  // that would not have been written as a statement is not kept as one.
  const reportsScore = (classifyLocalIntent(raw)?.intent_type === 'log_score' || SCORE_VERB_RX.test(raw) || SCORE_NAMED_RX.test(raw))
    && !NEAR_MISS_RX.test(raw) && !isStoryFramed(raw) && !isConditionalOrFuture(raw);
  return reportsScore && isQuestionShaped(raw) && !isAboutSomeoneElse(raw);
}

/** The brain's own tool for a setting, where it has one (api/_brainTools); everything else it cannot change. */
const SETTINGS_THE_BRAIN_CAN_SET = new Set(['caddie_persona']);
/** What it is called, and words the patterns above DO take as the order. */
const SETTING_WORDS: Record<string, { label: string; say: string }> = {
  handedness: { label: 'handedness', say: `"I'm left handed"` },
  theme: { label: 'the app theme', say: '"switch to dark mode" or "switch to light mode"' },
  risk_mode: { label: 'risk mode', say: '"play it safe" or "go for it"' },
  cart_mode: { label: 'cart mode', say: '"cart mode on"' },
  ghost: { label: 'the ghost round', say: '"ghost mode on"' },
};

/**
 * 2026-10-28 (Brain recheck r10) — A SETTING THE PRECHECK DECLINED IS ONE NOBODY CHANGED.
 *
 * A 'conversational' answer goes straight to the brain, and api/_brainTools has no tool for
 * handedness, theme or risk mode. Nothing outside this file read `not_a_command`, so the caddie
 * heard "set me to left handed, if you can" with no idea it had not been applied, and could answer
 * "done". services/caddieRequestBody (the one payload builder every route goes through) appends this
 * directive to the turn's context, so a declined setting reaches the conversation as a fact: unchanged,
 * and the words that do change it. Null for anything else, including a setting that was applied.
 */
export function settingNotAppliedNote(heard: string): string | null {
  const t = (heard ?? '').trim();
  if (!t) return null;
  const hit = precheckLocalIntent(t);
  if (hit?.intent_type !== 'conversational' || hit.parameters?.not_a_command !== 'change_setting') return null;
  const name = String(hit.parameters?.setting_name ?? '');
  if (!name || SETTINGS_THE_BRAIN_CAN_SET.has(name)) return null;
  const words = SETTING_WORDS[name];
  if (!words) return null;
  return `[SETTING NOT CHANGED] The player's words mention ${words.label}, but they were not taken as an order and `
    + `nothing was changed. Never say it was changed or that you will remember it. If he meant it as an order, `
    + `tell him plainly it is not set yet and that saying ${words.say} on its own sets it.`;
}

function classifyLocalIntent(transcript: string): VoiceIntent | null {
  if (!transcript || typeof transcript !== 'string') return null;
  const t = transcript.trim();
  if (!t) return null;
  // Cap length to avoid pathological regex backtracking on a wall of
  // text — high-frequency intents are always short.
  if (t.length > 200) return null;

  /**
   * 2026-09-13 (Tim) — "part of the app's tutorial logic is a user can ask 'how do I ...?' and the
   * app can answer. Make sure this is the truth."
   *
   * IT WAS NOT, FOR THE ASKS MOST LIKELY TO BE ASKED. `services/knowledgeBase/howTo` holds 29
   * entries and `howToForPrompt()` is injected into the cached brain prompt unconditionally, so the
   * caddie has the real steps for all of them. But a question only reaches the brain if this function
   * lets it past, and it did not:
   *
   *   "how do I change my handicap" → handicap_query   — answered with what it IS, not how to change it
   *   "how do I add a course"       → open_tool{add_course}
   *   "how do I use SmartFinder"    → open_tool{smartfinder}
   *
   * The first is the worse one: the player asked how to do a thing and got a number back. The other
   * two yank them to a screen with no explanation, which is the opposite of a tutorial. All three are
   * this file's own documented rule, broken: THE PRECHECK MATCHES COMMANDS, and "how do I ...?" is a
   * question by construction. Routing a command is not answering a question, and a question
   * intercepted before the brain is a question the caddie never heard.
   *
   * So an instructional question returns null here, always, and lands on the brain that holds the
   * how-to block. This sits ABOVE every pattern rather than as a lookahead on the three that bit,
   * because the next pattern someone adds would bite too — the guard belongs to the DISPATCHER.
   *
   * Deliberately narrow: it matches the interrogative FRAME, not any sentence containing "how". A
   * golf question caught by it ("how do I stop slicing") also belongs on the brain, so a wide net
   * here costs nothing and a narrow one is still correct.
   * [[smartplay-defect-class-unwired-halves]]
   */
  if (INSTRUCTIONAL_QUESTION_RX.test(t)) return null;
  /**
   * 2026-09-25 (triple-check of set_pin_position) — a pin LOCATION is the caddie's, not a yardage
   * lookup. "the pin is at the back of the green" matched `back of` (green_back) and "pin is on the
   * back left of the green" matched `on the back` (nine_split — a back-nine SCORE), so the pin was
   * never recorded. A statement naming the pin/flag and a depth or side, with no distance question
   * in it, goes to the brain, which records it for the hole and plays to it.
   */
  if (PIN_LOCATION_RX.test(t) && !/\b(how\s+far|how\s+many|yards?|yardage|distance)\b/i.test(t)) return null;

  // 2026-06-15 (Tim — tap-to-talk record loop) — when the Smart Motion screen is
  // OPEN, a record/watch/stop command must be DETERMINISTIC and LOCAL. Previously
  // it rode the cloud classifier: classified as media_capture → recorder fired,
  // but classified as conversational → handed to the Kevin brain, which only
  // *talks* ("do you want me to watch your swing?") and never arms the recorder —
  // the loop. Routing it straight to media_capture here means the recorder arms
  // instantly (no cloud round-trip, no brain detour). mediaCaptureHandler reads
  // raw_utterance to pick start vs stop, so one pattern covers both. Narrow word
  // set — only fires while Smart Motion owns the surface, so it can't hijack
  // normal commands elsewhere.
  if (
    isSmartMotionActive() &&
    /\b(record|watch|swing away|hit away|fire away|rolling|begin|capture|start recording|go again|stop|done|finish|wrap|enough|cut it|that'?s it)\b/i.test(t)
  ) {
    return intent(t, 'media_capture', { capture_type: 'swing', raw_utterance: t });
  }

  /**
   * 2026-09-29 — a TEE TIME is the brain's (its find_tee_time tool), never a lookup. "Find a tee time
   * for a round at Menifee Lakes Saturday" matched the find_my_data block below (`find … round`), and
   * "Get me a tee time to play Menifee Lakes Palms Saturday" matched the course-open (`play <course>`),
   * both at confidence 'high' — so the booking hand-off was never reached. Any utterance naming a tee
   * time goes to the brain, ahead of both.
   *
   * 2026-09-30 (triple-check) — and it goes to the BRAIN, not back to "no match". A null from here is
   * handed to the cloud classifier (/api/voice-intent), whose enum has open_course / quick_round /
   * find_my_data and no tee-time rule — so "get me a tee time to play Menifee Lakes" could come back
   * as a course open or even a quick round. 'conversational' is the route both routers send straight
   * to the brain, where find_tee_time lives.
   */
  if (/\btee[\s-]?times?\b/i.test(t)) return intent(t, 'conversational', { raw_utterance: t });

  // 2026-07-25 (Tim — the app's whole point: "ask the caddie to find/pull up ANY of my data"). Checked
  // BEFORE the course-open below so "pull up my round at Mines" finds the ROUND record (not just opens
  // the Mines course). Fires only when the ask names a data noun (round/scorecard/recap/swing) — a bare
  // "pull up Highland Links" has none, so it falls through to the course-open path. → findMyDataHandler.
  {
    // 2026-07-30 (audit #11) — the (?!\s*lab) negative lookahead stops "open swing lab" / "open my swing
    // lab" from matching the `swing` data-noun and shadowing the SwingLab open_tool path. A real data ask
    // ("pull up my last swing") still matches; "swing lab" falls through to the tool/course open.
    //
    // 2026-10-15 (review) — and only as an INSTRUCTION. The verb now has to OPEN a clause (after an
    // optional "hey / please / Kevin," or a polite "can you"), and `get` / `see` are gone: "I need to
    // find my swing", "I can't get my swing going today" and "let's see how this round goes" are a
    // golfer talking about his game, and each one pushed him off the round to the swing library.
    const dm = t.match(/(?:^|[,.!;]\s*)(?:(?:hey|ok|okay|so|please|alright)[\s,]+)*(?:[a-z]+,\s*)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:pull up|bring up|find|show|open|look up)\s+(?:me\s+)?(?:my\s+)?(.*\b(?:round|rounds|scorecard|score\s*card|recap|swings?)\b(?!\s*lab).*)/i);
    if (dm) return intent(t, 'find_my_data', { query: dm[1].trim(), raw_utterance: t });
  }

  // 2026-07-23 (Tim — "tell the Caddie what course and where and the caddie pulls it up in the play
  // tab"). Deterministic, OFFLINE-first course open. We only CLAIM the intent when the spoken name
  // actually RESOLVES to a known bundled course — otherwise we fall through to the brain, so this can
  // never hijack "take me to the range", "play a song", or "go to hole five".
  {
    const cm = t.match(/\b(?:take me to|pull up|bring up|open up|open|load|go to|let'?s play|play|start)\s+(.+)/i);
    if (cm) {
      const resolved = resolveSpokenCourse(cm[1]);
      if (resolved) {
        return intent(t, 'open_course', { course_id: resolved.previewId, course_label: resolved.label, raw_utterance: t });
      }
    }
  }

  // 2026-07-24 (final QA — "what's my 7 iron", OFFLINE). "how far do I hit my <club>" / "what's my
  // <club>" / "how far does my <club> go". We only CLAIM it when the phrase names a club-ish token,
  // so "what's my score / handicap / plan" fall through to their own patterns / the brain. The handler
  // (queryStatusHandler:club_distance) does the precise club parse + honest bag read.
  {
    /**
     * 2026-09-12 (Tim — "I'm going to talk to him about my bag and distances") — `my` WAS MANDATORY,
     * and a golfer does not always say it.
     *
     * "How far do I hit my 7-iron" was claimed here; "how many yards do I hit a pitching wedge" was
     * not, because the possessive was the only determiner allowed and "how many yards" was not one
     * of the openers. It fell past this block into the generic yardage pattern below and came back
     * as the distance to the GREEN — the same club question answered about the hole, decided by
     * whether he happened to say "my". Nobody hears that distinction in their own speech.
     *
     * Article and bare forms accepted; the club-word test below still gates every one of them, so
     * "what's the score" and friends are no more claimable than they were.
     */
    const cdm = t.match(/\b(?:how\s+far|how\s+many\s+yards?)(?:\s+do\s+i\s+(?:hit|carry))?(?:\s+does)?(?:\s+is)?\s+(?:my|a|an|the)?\s*(.+?)(?:\s+(?:go|going|carry|carrying))?\??$/i)
      ?? t.match(/\b(?:what(?:'s|s|\s+is))\s+my\s+(.+?)(?:\s+(?:go|going|carry|carrying))?\??$/i);
    const clubPhrase = cdm ? cdm[1].trim() : null;
    // Dropping the mandatory `my` let a COURSE FEATURE in: "how far to the wood line" captures
    // "to the wood line", whose club-word test passes on `wood`. A club phrase never opens with a
    // preposition — that shape is always pointing at something out on the hole, so leave it to the
    // yardage patterns below.
    const pointsAtTheHole = clubPhrase != null
      && /^(?:to|over|past|from|across|around|behind|beyond|up|down)\b/i.test(clubPhrase);
    if (clubPhrase && !pointsAtTheHole) {
      /**
       * 2026-09-11 (Tim) — "how far do I hit my 60" fell through here, because this test wants a club
       * WORD and a golfer naming a wedge says its LOFT. clubFromLoftPhrase reads the grammar rather
       * than the number: a determiner in front ("my 60") is a club, a yardage word behind it is not.
       *
       * 2026-09-12 — and it had never once fired, because it was handed `clubPhrase`, which is the
       * capture group with the determiner already stripped off. "How far do I hit my 60" reached it
       * as "60"; the determiner branch it needs ("the|my|a|an|his|her|your|our" + two digits) cannot
       * match a bare number, so it returned null every time and the utterance fell through to the
       * generic yardage pattern and came back as the distance to the GREEN. Measured against the
       * pre-fix file, not inferred. The whole transcript is what the function was written to read —
       * its own guards already reject the yardage readings ("the 60 yards", "the 60 to the pin").
       * A fix that cannot fire is not a fix. [[state-what-you-measured-not-what-you-intended]]
       */
      const loftClub = (require('./clubNormalize') as typeof import('./clubNormalize')).clubFromLoftPhrase(t);
      if (loftClub || /\b(driver|woods?|hybrid|iron|wedge|pitching|sand|lob|gap|approach|utility|pw|sw|lw|gw|aw|\d\s?h|\d\s?i|\d\s?w)\b/i.test(clubPhrase)) {
        return intent(t, 'query_status', { query_topic: 'club_distance', club_phrase: clubPhrase });
      }
    }
  }

  // 2026-07-30 (Tim — "if you name the caddie you should be able to CALL them by that name"). The static
  // switch-persona pattern only knows the 4 base names. Also recognize the user's OWN custom caddie name
  // so "switch to <name>" / "put <name> in charge" / "<name>, ..." activates the custom caddie.
  try {
    const cn = require('../store/playerProfileStore').usePlayerProfileStore.getState().customCaddieName as string | null;
    const name = typeof cn === 'string' ? cn.trim() : '';
    if (name.length >= 2 && name.length <= 24) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const switchRx = new RegExp(`\\b(?:switch|change)(?:\\s+(?:my\\s+)?caddie)?\\s+to\\s+${esc}\\b|\\bput\\s+${esc}\\s+in\\s+charge\\b`, 'i');
      if (switchRx.test(t)) return intent(t, 'change_setting', { setting_name: 'caddie_persona', new_value: 'custom' });
    }
  } catch { /* profile unavailable — fall through to the static patterns */ }

  // 2026-08-07 (Tim — "I hit 3 hybrid for that last shot and shot info, location, brain, history,
  // scorecard is updated"). CORRECT the already-logged previous shot's club (→ correct_last_shot),
  // distinct from log_shot (adds a NEW shot) and club_change (sets the CURRENT club). Deterministic +
  // OFFLINE. Fires ONLY when the utterance BOTH references the LAST shot AND names a club, so a plain
  // "I hit driver 240" still logs a new shot and "that was tough" never hijacks. Checked before the
  // PATTERNS loop so it wins over any generic match.
  {
    // 2026-08-07 (regression audit) — the `actually` branch was `actually (that|it|the last)`, which
    // false-fired on plain narration like "actually that 7-iron was pure" and silently rewrote the last
    // shot's club. Tighten it to the CORRECTION form only — "actually that/it WAS …" — where the club is
    // the correction target (club follows "was"), never sitting between "that" and "was".
    const refsLast = /\b(?:(?:for|on)\s+(?:my\s+|that\s+)?(?:last|previous|prior)\s+(?:shot|one|swing)|(?:that|the|my)\s+(?:last|previous|prior)\s+(?:one|shot|swing)\s+(?:was|were)|(?:change|correct|fix|update|make)\s+(?:my\s+)?(?:last|previous|prior)\s+(?:shot|one|swing)|actually\s+(?:that|it)\s+was\b)/i.test(t);
    const namesClub = /\b(driver|wood|hybrid|rescue|iron|wedge|pitching|sand\s*wedge|lob|gap|approach|utility|putter|pw|sw|lw|gw|aw|\d\s?h(?:ybrid)?|\d\s?i(?:ron)?|\d\s?w(?:ood)?)\b/i.test(t);
    if (refsLast && namesClub) {
      return intent(t, 'correct_last_shot', { club_phrase: t, raw_utterance: t });
    }
  }

  // 2026-08-08 (Tim — "tell the caddie my yardages and it registers"). Declarative bag fact:
  // "my 7-iron goes 165" / "my driver carries about 250" → set_club_distance (offline, instant).
  // The GOES/CARRIES verb + a number makes it unambiguous: the QUERY form ("what's my 7 iron") has no
  // number, and the shot report ("I hit my 7-iron 165") has "hit" — neither matches here. Rich
  // multi-club sentences ("I carry driver, 3-wood, 5 through PW") ride the brain's register_bag tool.
  {
    /**
     * 2026-09-12 (Tim) — THE VERB SAYS WHICH NUMBER IT IS, so capture it.
     *
     * "adjusting obviously truthfully by total, then we extrapolate as honestly as possible average
     *  carry — that really makes a huge difference in overall strategy."
     *
     * This used to throw the verb away and the handler filed everything as CARRY. "My 3 wood goes
     * 230" — plainly the number he watches it stop at — was recorded as 230 of carry, overstating it
     * by the roll, which tells the caddie he flies a hazard he does not. That errs in the direction
     * that loses a ball.
     *
     *   carries / carry is / flies → CARRY (all three describe the flight)
     *   goes                       → TOTAL (where it ended up)
     *
     * And when both are in one breath — "goes 230 and carries 215" — each ladder gets its own real
     * number and nothing has to be inferred at all, which is the best case.
     */
    const sm = t.match(/\bmy\s+(.{2,24}?)\s+(goes|carries|carry\s+is|flies)\s+(?:about\s+|around\s+|roughly\s+)?(\d{2,3})\b/i);
    /**
     * 2026-10-28 (Brain review r9) — HIS number, stated as fact. "My buddy's driver goes 300" captured
     * "buddy's driver", parseSpokenClub found 'driver', and 300 was written over Tim's own driver;
     * "Maybe my 7 iron goes 160 now" and "Mike says my 7 iron goes 170" did the same. A possessive
     * inside the club phrase is someone else's club, and a hedge or reported speech ahead of "my" is
     * not a number he is giving. Both go to the caddie ('conversational' — the cloud classifier would
     * re-steal a null). The conditionals ("if my driver carries 250") are the shared guard's.
     */
    if (sm && (/\w['’]s\b/i.test(sm[1])
      || /\b(?:maybe|perhaps|probably|might|whether|says|said|thinks|thought|claims|reckons|swears|supposedly|guess)\b/i.test(t.slice(0, sm.index ?? 0)))) {
      return intent(t, 'conversational', { raw_utterance: t, not_a_command: 'set_club_distance' });
    }
    if (sm && /\b(driver|wood|hybrid|rescue|iron|wedge|pitching|sand|lob|gap|degree|pw|sw|lw|gw|aw|\d\s?h|\d\s?i|\d\s?w)\b/i.test(sm[1])) {
      const primaryKind: 'carry' | 'total' = /^goes$/i.test(sm[2].trim()) ? 'total' : 'carry';
      const primary = Number(sm[3]);
      // A SECOND number anywhere in the sentence, of the other kind.
      const carryM = t.match(/\bcarr(?:ies|y)\s+(?:is\s+)?(?:about\s+|around\s+|roughly\s+)?(\d{2,3})\b/i);
      const totalM = t.match(/\b(?:total|all\s+in|rolls?\s+out\s+to|goes)\s+(?:about\s+|around\s+|roughly\s+)?(\d{2,3})\b/i);
      const carryY = carryM ? Number(carryM[1]) : (primaryKind === 'carry' ? primary : null);
      const totalY = totalM ? Number(totalM[1]) : (primaryKind === 'total' ? primary : null);
      return intent(t, 'set_club_distance', {
        club_phrase: sm[1].trim(),
        yards: primary,
        distance_kind: primaryKind,
        ...(carryY != null ? { carry_yards: carryY } : {}),
        ...(totalY != null ? { total_yards: totalY } : {}),
        raw_utterance: t,
      });
    }
  }

  for (const p of PATTERNS) {
    const m = t.match(p.rx);
    if (m) return p.build(t, m);
  }
  return null;
}
