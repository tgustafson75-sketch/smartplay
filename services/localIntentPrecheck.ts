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
  {
    rx: /\b(what(?:'s|s)?\s+my\s+score|how\s+am\s+i\s+doing|my\s+score|score\s+(?:today|so\s+far)|vs\.?\s+par|under\s+par|over\s+par)\b/i,
    build: (raw) => intent(raw, 'query_status', { query_topic: 'score' }),
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

  // ── CLOSE / EXIT A TOOL → HOME (deterministic) ────────────
  // 2026-06-16 (Tim — "close Smart Motion" white-screened) — closing a tool routes
  // HOME to the caddie locally, so it never rides the cloud classifier (which sent
  // it nowhere → white screen). "go back" stays a real back(); this is the
  // explicit close/exit/home set only.
  {
    rx: /\b(close\s+(?:smart\s*motion|this|it|the\s+(?:tool|camera|screen))|exit\b|go\s+home|take\s+me\s+home|back\s+to\s+(?:the\s+)?caddie)\b/i,
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
    rx: /\b(?:what(?:'s|s)?\s+the\s+smart\s+play|give\s+me\s+the\s+smart\s+play|the\s+smart\s+play|open\s+smart\s*play|smartplay\s+here)\b/i,
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'smartplay' }),
  },
  {
    rx: /\b(open\s+smart\s*finder|smart\s*finder|rangefinder|range\s+finder|lock\s+(?:the\s+)?distance)\b/i,
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'smartfinder' }),
  },
  {
    rx: /\b(open\s+smart\s*vision|smart\s*vision|show\s+(?:me\s+)?the\s+(?:hole|layout|map)|pull\s+up\s+the\s+map)\b/i,
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'smartvision' }),
  },
  {
    // 2026-06-24 (Tim) — only EXPLICIT "swing lab" auto-opens the hub. A vague
    // practice wish ("let's practice", "I want to practice") must NOT auto-navigate
    // — the caddie asks what to work on first (handled by the brain). The
    // "practice" phrasings were removed from this deterministic open.
    rx: /\b(open\s+swing\s*lab|swing\s*lab)\b/i,
    build: (raw) => intent(raw, 'open_tool', { tool_name: 'swinglab' }),
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

  // 2026-07-23 (Tim — "tell the Caddie what course and where and the caddie pulls it up in the play
  // tab"). Deterministic, OFFLINE-first course open. We only CLAIM the intent when the spoken name
  // actually RESOLVES to a known bundled course — otherwise we fall through to the brain, so this can
  // never hijack "take me to the range", "play a song", or "go to hole five".
  {
    const cm = t.match(/\b(?:take me to|pull up|bring up|open up|load|go to|let'?s play|play|start)\s+(.+)/i);
    if (cm) {
      const resolved = resolveSpokenCourse(cm[1]);
      if (resolved) {
        return intent(t, 'open_course', { course_id: resolved.previewId, course_label: resolved.label, raw_utterance: t });
      }
    }
  }

  for (const p of PATTERNS) {
    const m = t.match(p.rx);
    if (m) return p.build(t, m);
  }
  return null;
}
