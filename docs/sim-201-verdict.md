# Phase 201 — Simulation Verdict

**Audit date:** 2026-05-05
**Bundle SHA:** post-`503219d`

## Tl;dr

**v1.1 simulation verdict: READY FOR EMPIRICAL TESTING.**

The runnable in-process harness ships 116 scenarios across 10 groups; **all pass**. Static walkthrough of the device-only paths surfaces no new blockers beyond what Phase 200 already documented.

## What the harness verified at code level

- ✅ Persona resolution correct for all 4 caddies × 5 input shapes
- ✅ Each character spec exists, has the persona's distinctive markers, doesn't bleed into others' phrases
- ✅ Settings store v2→v3 migration seeds all 4 pillars correctly
- ✅ All 9 surface→pillar mappings correct
- ✅ Voice intent classifier knows all 18 intents (union + prompt sections)
- ✅ Trigger thresholds present + conservative
- ✅ Media capture wiring kind-aware
- ✅ AbortSignal polyfill Hermes-safe
- ✅ Server-side persona handling: 15/15 api/* routes accept both persona AND voiceGender
- ✅ Shot logging schema aligned across logShotHandler + QuickLogShotSheet

## What still needs Z Fold to verify

Same list as audit-200-verdict.md — nothing new from Phase 201:

1. **Garmin yardage comparison** (PATH 2 / Phase 107 fix verification)
2. **SmartVision tee position on real holes** (Phase 108 fix verification)
3. **Per-persona ElevenLabs voice routing** (PATH 4)
4. **Cage Mode end-to-end** (PATH 3, was BROKEN at Phase BU)
5. **Hydration race on cold launch with non-Kevin persona** (PATH 1)
6. **Camera capture lifecycle on real device** (Phase 110-followup)

## Wrong-voice-routing concern (Tim's specific worry)

Tim's stated concern: "I want to go test on the course and not have to use GolfShot — make sure everything really works and I don't get the wrong voices come up incorrectly."

**Code-level verdict on wrong-voice routing: HIGH CONFIDENCE not a problem.**

Reasoning:
- Voice TTS routing reads `caddiePersonality` from settingsStore (Scenario 9 confirms 15/15 server routes also persona-aware so no fallback to Kevin/Serena gender mapping)
- `caddiePersonality` is auto-synced to active pillar's caddie via _layout.tsx subscribeActiveSurface listener (Phase 105)
- Pillar mapping is correct for all 9 surfaces (Scenario 4)
- Per-persona ElevenLabs voice IDs in api/voice.ts (Phase 100); fallback to OpenAI gendered voice only if ElevenLabs key missing/fails

**The class of "I'm on Tank but Kevin's voice plays" is structurally prevented at code level.** The remaining empirical risks are:
1. ElevenLabs API key issue or quota exceeded → falls back to OpenAI onyx (all male personas sound the same)
2. Vercel serving stale code (api/* persona-aware sweep not deployed)
3. Voice cache not invalidated on persona switch (filler library cache; addressed by Audit 101 / S2-S3 mutex + persona_lang_v4 cache key)

To eliminate empirical risks 1 and 2: do the audit-200-fix-sequence F2 Vercel sync check before round-testing.

## Recommendations

### Before Z Fold testing (none required by simulation)

The simulation surfaces zero new blockers. **You can proceed to empirical testing as-is.**

Optional 5-minute pre-flight:
- F2: confirm Vercel deploy SHA matches `503219d` (or whatever current main is) so api/* serves the persona-aware code

### Watch for during empirical testing

These are the failure modes the simulation can't predict but you should listen for:

1. **Wrong-voice-routing**: if any caddie speaks in Kevin's voice when you've assigned a different one to that pillar → root-cause is either ElevenLabs API failure (logcat will show fallback to OpenAI) or Vercel stale deploy
2. **No voice at all**: `[voice] speak timeout` in logcat → re-check whether Audit 101 / S4 fix held (audio file write race)
3. **Yardage drift vs Garmin**: > 3 yard delta consistently → either course-geometry data quality (Phase 108-followup tee drag override available) OR GPS outlier rejection too loose
4. **Pillar handoff doesn't fire**: cross from Round → Cage and Tank doesn't say "Tank here" → check active-surface subscription wiring

### After empirical testing — known v1.1.x backlog

Per audit-200-fix-sequence.md and v1.2-deferred.md:
- Camera pre-arm / ring buffer (needs product judgment on battery cost)
- Asset orphan cleanup (24 PNGs — Tim walks per-row)
- Sentry env wire-up (Tim's account)
- Stripe IDs (Tim's dashboard)
- F8 ffmpeg native dep (Tim's approval + new EAS build)

## Final verdict

**READY FOR EMPIRICAL TESTING ON GALAXY Z FOLD.**

Build dev-client (Metro reload sufficient — no native deps added since Phase 100), install on Z Fold, run F1 from audit-200-fix-sequence.md (~90 min).

Code-level confidence is high. Empirical confirmation is the gate, not more code. You can go test on the course and not use GolfShot.
