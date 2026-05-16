# Phase 409 Audit: TightLie pipeline — real vs stub

**Date:** 2026-05-16
**Scope:** TightLie / lie-analysis end-to-end pipeline — camera
capture, Sonnet vision call, structured output, caddie voice
playback, persistence, caddie-brain integration.
**Methodology:** read-only inspection of `app/lie-analysis.tsx`,
`api/lie-analysis.ts`, `services/lieAnalysisService.ts`,
`services/lieAnalysisContext.ts`, `components/lieAnalysis/AnalysisResult.tsx`,
`store/roundStore.ts` (ShotResult), `services/intents/openToolHandler.ts`,
`api/voice-intent.ts`, and the caddie-brain prompt builder at
`app/api/kevin+api.ts`.

> **Headline:** Tim's hypothesis ("TightLie may currently function as a
> camera with limited or stubbed analysis") is **WRONG**. TightLie's
> vision pipeline is fully functional — real Sonnet 4.6 vision call,
> structured JSON output, caddie voice playback, honest uncertainty
> handling. The gap is **persistence + integration**: the analysis
> result is ephemeral. Tap "Got it" → it disappears.

---

## Verdict by component

| Component | State | Evidence |
|-----------|-------|----------|
| Camera capture | **REAL** | `app/lie-analysis.tsx:134-146` — `CameraView.takePictureAsync` at quality 0.85, ImageManipulator resize to 1024px + JPEG 0.75 compression + base64 |
| Sonnet vision call | **REAL** | `api/lie-analysis.ts:157` — `claude-sonnet-4-6`, max 400 tokens, temperature 0.3 |
| System prompt | **REAL** | `api/lie-analysis.ts:41-76` — caddie-voice analyst with explicit lie-category catalog (clean/sitting down/buried/sidehill/tight/fluffy/hardpan/wet/sand/leaves) |
| Structured JSON output | **REAL** | `api/lie-analysis.ts:59-68` — { situation_description, tactical_advice, recommended_club, alternative_play, confidence_level, conservative_call, follow_up_question, goal_aware_note } |
| Response parsing | **REAL** | `api/lie-analysis.ts:178-195` — defensive normalization with fallbacks |
| `play_intent` propagation (aggressive/conservative) | **REAL** | `services/intents/openToolHandler.ts:85-89` → `app/lie-analysis.tsx:35-36` → `services/lieAnalysisContext.ts:102` → `api/lie-analysis.ts:126-127` |
| Goal-aware context (mode, score, trust level) | **REAL** | `api/lie-analysis.ts:128-137` — populates `goal_aware_note` when score shifts the call |
| Caddie voice playback of recommendation | **REAL** | `app/lie-analysis.tsx:62-89` — dialog templates + speak() gated on voiceEnabled |
| Re-capture flow | **REAL** | `components/lieAnalysis/AnalysisResult.tsx:81` — Try again button resets phase to 'camera' |
| Low-quality / re-prompt | **REAL** | `services/lieAnalysisService.ts:127-129` — low confidence + follow_up_question triggers "Hard to read" state |
| Error handling (network / camera denied / payload too large) | **REAL** | `app/lie-analysis.tsx:280-283` (no_network → save for later), 122 (too_large), etc. |
| **Lie storage on shot record** | **MISSING** | `ShotResult` interface in `store/roundStore.ts:73-107` has zero lie fields |
| **Caddie brain integration** | **MISSING** | Caddie brain doesn't read any lie context; "what should I hit" responses don't incorporate the just-captured lie |
| **Hole / recap lie summary** | **MISSING** | No surface in recap or scorecard shows which lies were analyzed |

## State of TightLie

**TightLie is a fully functional vision-powered lie analyzer. The
camera, vision call, prompt, structured output, voice playback, error
handling, and even the play_intent + goal-aware context are all real
and well-engineered.** What's missing is the **integration layer** —
the analysis displays, plays audio, then the user taps "Got it" and
the result vanishes. The caddie brain has no memory of what was just
analyzed, so a follow-up "what should I hit" question gets advice
without lie context.

This is a UX-completeness gap, not a stub implementation. Smaller
scope than the audit prompt anticipated.

## What this phase ships

The vision pipeline is fine. The integration work is:

1. **New `LieAnalysis` type + `pendingLieAnalysis` slot on roundStore**
   Captures the structured output for the next-shot context. NOT
   per-shot (the analysis happens BEFORE the shot fires), so it's a
   "what's the next shot looking at" slot on the round state.

2. **"Got it" stores the result** in `pendingLieAnalysis` so the
   shot logger can copy it onto the actual shot record AND the
   caddie brain can read it for advice.

3. **ShotResult gains `lie_analysis?: LieAnalysis`** so the shot
   record carries lie context for recap + stats over time. Populated
   by `logShot` from `pendingLieAnalysis` (and cleared after).

4. **Caddie brain prompt builder reads `pendingLieAnalysis`** and
   injects a brief `[CURRENT LIE]` block into the system prompt
   when present. Lets "what should I hit" and similar questions
   incorporate the lie reality without the user re-stating it.

5. **No new UI**. Recap surface for lie history is deferred to a
   focused session — the audit doc anchors it as priority 3.

## Empirical verification deferred

Tim's Z Fold round-day pass against real lies surfaces calibration
issues (e.g., "this lie was rated moderate but it's actually easy",
"sand bunker getting categorized as rough"). That feedback informs
the next prompt-tuning iteration — out of scope for this commit
since the vision call itself is real and well-engineered already.
