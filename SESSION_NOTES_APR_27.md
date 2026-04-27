# SmartPlay Caddie — Session Notes — April 27, 2026

## What Shipped Tonight

- Kevin's brain rewrite: Anthropic Claude (sonnet/haiku cascade) + OpenAI gpt-4o-mini-tts
- Smart routing classifier (haiku for tactical, sonnet for conversation)
- Kevin tool routing: open_smartvision, open_swinglab, log_score, record_swing, open_smartfinder
- Round context flowing into Kevin's brain
- Persistent Kevin badge (top-right corner of tool screens, pulses on thinking + speaking)
- Voice reachable from inside any tool screen
- SmartVisionContext flowing live distances to Kevin
- Static SmartVision feature: Palms course imported, draggable T/A/P markers, live FROM TEE / APPROACH yardages
- Error handling: real 500s server-side, distinct diagnostic messages client-side
- Badge styling: corner crop fixed, top-right placement, transparent PNG asset

## Tags Pushed

- kevin-elite — canonical layout locked
- kevin-tools-wired — tool routing + SmartVision context
- kevin-errors-honest — fallback fix
- kevin-smartvision-live — Palms course, draggable markers, Kevin reads context
- kevin-badge-clean — badge styling polished

## Issues Observed During Testing

1. **Kevin says "let me look at the hole" without follow-through.** When asked a question with SmartVision open, Kevin acknowledges he'll look but doesn't deliver the tactical read with actual distances. Either the SmartVisionContext isn't reliably reaching the brain, or the system prompt addendum is being overridden by a softer preamble. NEEDS DIAGNOSTIC: confirm context is in the request body during the failure case, then tune system prompt to require numerical tactical read after any "let me look" preamble.

2. **Voice pitch variance, sometimes sounds low/depressed.** OpenAI gpt-4o-mini-tts is generative and varies in tone. We're likely not using the `instructions` parameter at all, or using minimal instructions. FIX: add solid voice instructions — "warm, encouraging, conversational, experienced caddie tone, never melancholy" — to the TTS call in api/kevin.ts.

## Tomorrow's First Priority — FIX THE TWO ISSUES ABOVE

Before any new feature work tomorrow:
1. Diagnose and fix the SmartVision context-aware response failure
2. Add voice instructions to the OpenAI TTS call for consistent Kevin tone

These are real product polish issues that affect the elite feel. Do them before SmartMotion deprecation.

## Tomorrow's Second Priority — DEPRECATE SMARTMOTION

SmartMotion is being killed as a separate concept. All swing work happens in SwingLab.

Three actions:
1. Mark SmartMotion as deprecated. Stop wiring it as a Kevin tool. Remove from menus.
2. Move existing video-capture capability into SwingLab (SwingLab already has the pose silhouette placeholder UI).
3. Update Kevin's tool routing: record_swing → opens SwingLab in record mode, OR eliminate record_swing entirely and route "watch this" to open_swinglab.

Note: Real GolFix-style pose overlay and traced swing path is genuinely a 1-2 week build (likely MediaPipe Pose). Tomorrow's deprecation is just consolidating the file structure and tool routing — the visual ML feature is its own future session.

## Tomorrow's Other Priorities (from previous discussion)

3+. SmartFinder build — commercial laser-rangefinder equivalent. Real ground-up work, separate session.
4. Layout controller + slide-up cards architecture for tools.
2. Mode system (Break 100 / 90 / 80) — round mode selector.
5. Phase 2 latency masking — pre-rendered filler audio clips fired within 150ms.
1. golfcourseapi.com integration — real course data with hazards, multi-course support.

## Known Rough Edges (Defer)

- Golfshot UI overlay text "368" bleeding through Palms hole image — fix is to trim source images, deferred
- Hardcoded "palms" course reference in hole-view.tsx — needs course-id selector when adding 2nd course
- Voice response latency — Phase 2 (filler audio) and Phase 3 (HeyGen) plans already mapped out

## Architecture Foundations Now in Place

- Persistent Kevin pattern (badge across tools)
- SmartVisionContext (any tool can feed Kevin's brain with live data)
- Real error handling (no more silent fallbacks)
- Cascade brain (Anthropic + OpenAI TTS, decoupled providers)
- Tool routing (Kevin can open any tool by voice intent)

These are the foundations for video Kevin (HeyGen Phase 3), other course imports, additional tools, and any future agent integrations.
