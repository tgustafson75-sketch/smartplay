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
import { isSmartMotionActive } from './smartMotionRecordBus';
import { resolveSpokenCourse } from './courseNameResolver';

interface Pattern {
  rx: RegExp;
  build: (raw: string, match: RegExpMatchArray) => VoiceIntent;
}

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

// Optional explicit hole for a spoken score ("...on hole 7"); otherwise the handler uses the current
// hole. The stroke count itself is parsed from raw_text by logScoreHandler.
const scoreHoleParam = (raw: string): Record<string, unknown> => {
  const m = raw.match(/\bon\s+hole\s+(\d{1,2})\b/i) ?? raw.match(/\bhole\s+(\d{1,2})\b/i);
  if (m) { const h = parseInt(m[1], 10); if (h >= 1 && h <= 18) return { hole_number: h }; }
  return {};
};

// Ordered list — first match wins. Yardage patterns come before
// generic "what" patterns so "yardage to front" → green_front,
// not query_status:hole.
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
    rx: /\b(?:(?:let'?s|lets|i(?:'| a)?m\s+going\s+to|we'?ll)\s+play\s+(?:it\s+)?safe|play\s+(?:it\s+)?safe|(?:go|be|stay|keep\s+it)\s+conservative|conservative\s+mode|dial\s+(?:it\s+)?back)\b/i,
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
    rx: /\b(how\s+far|yardage|yards?\s+to|distance\s+to|how\s+many\s+yards?)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'distance_to_green' }),
  },

  // ── SCORE / ROUND STATUS ──────────────────────────────────
  // Routine is round-INDEPENDENT and deterministic — a command, not a question — so it belongs in
  // the precheck next to the other commands rather than depending on a brain round-trip.
  // These regexes are the mirror's, but the mirror only ever ran AFTER the brain had failed, so a
  // loose match cost nothing. Here they run BEFORE it, and a loose match INTERCEPTS. "Tell me a good
  // warm-up routine" is a request FOR a warm-up and must reach the caddie; only a POSSESSIVE or
  // demonstrative means the stored one. Same principle as NOT_ABOUT_TOOL above: naming the thing is
  // not asking for it.
  {
    rx: /\b(save|remember|keep)\b[^.?!]{0,20}\b(that|this|my)\s+(routine|stretches|warm.?up)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'routine_save' }),
  },
  {
    rx: /\b(what(?:'s|s)?|tell\s+me|recall|show\s+me|give\s+me|read|run\s+me\s+through)\b[^.?!]{0,20}\bmy\s+(routine|stretches|warm.?up)\b/i,
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
    rx: /\b(?:(?:i\s+)?(?:got|made|shot|had|carded|scored|took)|put\s+me\s+down\s+for|score\s+me|mark\s+me(?:\s+down)?\s+for|card\s+me)\s+(?:myself\s+)?(?:a\s+|an\s+)?(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|par|bogey|birdie|eagle|double\s*bogey|triple\s*bogey)\b(?!\s*(?:iron|woods?|hybrid|wedge|driver|putter|putts?|putted|degrees?|footer|feet|foot|yards?|holes?))/i,
    build: (raw) => intent(raw, 'log_score', scoreHoleParam(raw)),
  },
  {
    rx: /\b(?:i\s+)?(?:bogeyed|birdied|eagled|parred|double[\s-]*bogeyed|triple[\s-]*bogeyed)\b/i,
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

  // ── ROUND STATS (2026-07-25 coverage-audit gaps — all answered locally/offline) ──
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
  {
    rx: /\b(left[\s-]?handed|lefty|southpaw|right[\s-]?handed|righty)\b/i,
    build: (raw, m) => intent(raw, 'change_setting', {
      setting_name: 'handedness',
      new_value: /left|lefty|southpaw/i.test(m[1]) ? 'left' : 'right',
    }),
  },
  // 2026-07-24 (final QA — offline settings, local-first). Deterministic setting flips that used to
  // require the cloud classifier (dead-ended offline). Tight patterns only, so they can't misfire on
  // ordinary talk. changeSettingHandler already applies each of these.
  {
    // Caddie persona — anchored on a switch verb + one of the 4 KNOWN names, so a guest named e.g.
    // "Kevin" is never mistaken for a persona switch.
    rx: /\b(?:switch|change)(?:\s+(?:my\s+)?caddie)?\s+to\s+(kevin|serena|harry)\b|\bput\s+(kevin|serena|harry)\s+in\s+charge\b/i,
    build: (raw, m) => intent(raw, 'change_setting', { setting_name: 'caddie_persona', new_value: (m[1] ?? m[2]).toLowerCase() }),
  },
  {
    // Theme — "mode" anchors it (never "turn on the lights").
    rx: /\b(?:switch to |turn on |use |go )?(dark|light)\s+mode\b/i,
    build: (raw, m) => intent(raw, 'change_setting', { setting_name: 'theme', new_value: m[1].toLowerCase() }),
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

  // ── TOOL OPEN (high frequency) ────────────────────────────
  // 2026-06-17 — "Hey Caddy, what's the smart play?" is THE tagline trigger.
  // Must be deterministic — "smart play" also appears in Haiku's shot_strategy
  // examples, causing it to explain verbally instead of opening SmartFinder.
  // Precheck catches the canonical phrasings before Haiku sees them.
  // NOTE: this pattern is ordered AFTER the shot_strategy pattern above so
  // "what's the play" (no "smart") hits shot_strategy, while "what's the
  // SMART play" falls through to here.
  {
    // 2026-08-06 (voice audit) — NOT_ABOUT_TOOL guard, same as smartfinder/vision/swinglab below, so
    // "log an issue with the smart play" / "the smart play feature is broken" DON'T open SmartFinder.
    // The bare `the smart play` alternative (no verb anchor) was the exposure the others were spared.
    rx: new RegExp('^' + NOT_ABOUT_TOOL + "(?=.*\\b(?:what(?:'s|s)?\\s+the\\s+smart\\s+play|give\\s+me\\s+the\\s+smart\\s+play|the\\s+smart\\s+play|open\\s+smart\\s*play|smartplay\\s+here)\\b)", 'i'),
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'smartplay' }),
  },
  {
    rx: new RegExp('^' + NOT_ABOUT_TOOL + '(?=.*\\b(?:open\\s+smart\\s*finder|smart\\s*finder|rangefinder|range\\s+finder|lock\\s+(?:the\\s+)?distance)\\b)', 'i'),
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
    rx: /\b(undo(?:\s+that)?|scratch\s+that|delete\s+(?:that|the\s+last)(?:\s+(?:shot|score|putt))?|take\s+that\s+back|nix\s+that)\b/i,
    build: (raw) => intent(raw, 'undo'),
  },
  // "next hole" / "next tee" → advance. Deterministic so it never rides the cloud (offline dead-end).
  {
    // The mirror of the hole_read exclusion above: a bare move is deterministic and stays local and
    // instant, but "next hole, what's the read?" is a move AND a question. Handing that to navigate
    // advances the hole and silently drops the question, which is the same half-answer in reverse.
    rx: /^(?!.*\b(?:briefing|brief\s+me|the\s+read|rundown|hole\s+info|walk\s+me\s+through|tell\s+me\s+about)\b)(?=.*\b(?:next\s+hole|next\s+tee|on\s+to\s+the\s+next(?:\s+hole)?|done\s+here,?\s*next)\b)/i,
    build: (raw) => intent(raw, 'navigate', { direction: 'next_hole' }),
  },
  {
    rx: /\b(previous\s+hole|go\s+back\s+a\s+hole|back\s+(?:one|a)\s+hole|last\s+hole\s+again)\b/i,
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
export function precheckLocalIntent(transcript: string): VoiceIntent | null {
  if (!transcript || typeof transcript !== 'string') return null;
  const t = transcript.trim();
  if (!t) return null;
  // Cap length to avoid pathological regex backtracking on a wall of
  // text — high-frequency intents are always short.
  if (t.length > 200) return null;

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

  // 2026-07-25 (Tim — the app's whole point: "ask the caddie to find/pull up ANY of my data"). Checked
  // BEFORE the course-open below so "pull up my round at Mines" finds the ROUND record (not just opens
  // the Mines course). Fires only when the ask names a data noun (round/scorecard/recap/swing) — a bare
  // "pull up Highland Links" has none, so it falls through to the course-open path. → findMyDataHandler.
  {
    // 2026-07-30 (audit #11) — the (?!\s*lab) negative lookahead stops "open swing lab" / "open my swing
    // lab" from matching the `swing` data-noun and shadowing the SwingLab open_tool path. A real data ask
    // ("pull up my last swing") still matches; "swing lab" falls through to the tool/course open.
    const dm = t.match(/\b(?:pull up|bring up|find|show|open|get|see|look up)\s+(?:me\s+)?(?:my\s+)?(.*\b(?:round|rounds|scorecard|score\s*card|recap|swings?)\b(?!\s*lab).*)/i);
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
    const cdm = t.match(/\b(?:how far(?:\s+do\s+i\s+(?:hit|carry))?(?:\s+does)?(?:\s+is)?|what(?:'s|s|\s+is))\s+my\s+(.+?)(?:\s+(?:go|going|carry|carrying))?\??$/i);
    if (cdm) {
      const clubPhrase = cdm[1].trim();
      if (/\b(driver|wood|hybrid|iron|wedge|pitching|sand|lob|gap|approach|utility|pw|sw|lw|gw|aw|\d\s?h|\d\s?i|\d\s?w)\b/i.test(clubPhrase)) {
        return intent(t, 'query_status', { query_topic: 'club_distance', club_phrase: clubPhrase });
      }
    }
  }

  // 2026-07-30 (Tim — "if you name the caddie you should be able to CALL them by that name"). The static
  // switch-persona pattern only knows the 4 base names. Also recognize the user's OWN custom caddie name
  // so "switch to <name>" / "put <name> in charge" / "<name>, ..." activates the custom caddie.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
    const sm = t.match(/\bmy\s+(.{2,24}?)\s+(?:goes|carries|carry\s+is|flies)\s+(?:about\s+|around\s+|roughly\s+)?(\d{2,3})\b/i);
    if (sm && /\b(driver|wood|hybrid|rescue|iron|wedge|pitching|sand|lob|gap|degree|pw|sw|lw|gw|aw|\d\s?h|\d\s?i|\d\s?w)\b/i.test(sm[1])) {
      return intent(t, 'set_club_distance', { club_phrase: sm[1].trim(), yards: Number(sm[2]), raw_utterance: t });
    }
  }

  for (const p of PATTERNS) {
    const m = t.match(p.rx);
    if (m) return p.build(t, m);
  }
  return null;
}
