# Phase 200 — Component 3: Critical Paths Verification Status

**Audit date:** 2026-05-05
**Bundle SHA:** `c170ec5`

Per CLAUDE.md "Critical Path Verification Gates" — every PATH 1–4 must be verified end-to-end on a real device within 7 days for external beta-readiness. This document captures current empirical status post-Phase-110.

## Status legend
- **VERIFIED FUNCTIONAL** — passed MIN VERIFY on Galaxy Z Fold within 7 days
- **DEGRADED** — works with documented caveats / known issues
- **BROKEN** — fails MIN VERIFY

## Snapshot

| Path | Status | Last verified | Days stale |
|---|---|---|---|
| PATH 1 ONBOARD | DEGRADED suspected | Pre-bundle (BS-era) | ~14+ |
| PATH 2 ROUND | DEGRADED suspected | Pre-bundle | ~14+ |
| PATH 3 CAGE | UNKNOWN (BU said BROKEN; structural fixes shipped) | Studio session pre-BU | ~12+ |
| PATH 4 VOICE | UNKNOWN (S4 audio-write race fix shipped after F12 evidence) | Pre-bundle, F12 evidence captured Phase 100 | ~10+ |

## PATH 1 ONBOARD

**MIN VERIFY scenario:** cold install → onboarding → Caddie home with profile.

**Material changes since last verification:**
- Phase 100 BU-followup hydration gate (profile + settings stores)
- Phase 105 onboarding intro text reframed; team architecture migration
- Phase 105 auto-sync syncing caddiePersonality to active pillar surface
- Phase 100 / DOMException polyfill hotfix (this session) — fixed the polyfill from crashing on Hermes

**Status: DEGRADED suspected.**

Hydration gate fix was correct on inspection but covers only 2 of 13 persisted stores (audit-100-personas.md flag). Phase 105 migration v2 → v3 seeds caddieAssignments cleanly; persists across reload.

**Risks:**
- Cold launch with non-Kevin persona assigned to Round may flash Kevin if any of the 11 ungated stores hydrates after caddiePersonality reads.
- Phase 105 auto-sync subscription fires on every active-surface change and on every assignment change; race against onboarding's initial render not stress-tested.

**MIN VERIFY:** wipe data → install → step through onboarding → Caddie home loads. Switch to Harry via Settings → force-stop → cold launch. No Kevin flash; Harry's "I'm Harry" greeting plays.

## PATH 2 ROUND

**MIN VERIFY scenario:** open app → find course → start round → log shots → end → recap.

**Material changes since last verification:**
- Phase 107 GPS framework fixes (B1: live fix subscription, B2: outlier rejection, B3: smoothing, B4: stationary recover, B5: walking accuracy)
- Phase 108 SmartVision projection-based markers + tee drag override
- Phase 109 log_shot voice intent
- Phase 100 / Audit 101 SDK timeouts on Anthropic + OpenAI
- Phase 100 server-side persona sweep (api/* routes)
- Phase 105 team architecture per-pillar caddie

**Status: DEGRADED suspected.**

GPS fixes are the most impactful — sub-second yardage refresh during walking, conservative outlier rejection. Phase 108 SmartVision fix should make the tee dot land on the actual tee box.

**Risks:**
- Phase 107 / S4 voice-write race fix (audit 101) is the plausible F12 culprit; if [voice] speak timeout returns, we're back to PATH 4 problems mid-round.
- Phase 109 log_shot relies on parseSpokenClub for the club portion; if the user says something the parser doesn't recognize, the handler bails with "got the shot — which club?" follow-up.

**MIN VERIFY:** open app on Z Fold. Find course. Start round. Mark a shot. Walk a few yards — yardages auto-update without Mark. Use voice "I hit driver 240 left" → log_shot fires → shot in scorecard. End round. Recap renders with shot data + persona name in voice.

## PATH 3 CAGE

**MIN VERIFY scenario:** SwingLab → Cage Mode setup → record → analysis → drill.

**Material changes since last verification:**
- Pre-Phase-100: BV (canonical UI), BX (telemetry), BW (per-clip Phase K), BY-quick (FP hardening), BZ-v1 (review UI)
- Phase 100 / Audit 101: cage-related fixes (cageReview AsyncStorage error wrap, swingCapture clearTimeout-after-parse, cage-coach prompt caching)
- Phase 105 surface-pillar registration writes `cage` → Tank auto-engages
- Phase 106 evaluateCageEnd fires drill_plateau detector

**Status: UNKNOWN (was BROKEN at last empirical run).**

This is the highest-stakes MIN VERIFY in v1.1. Phase BU's verdict was BROKEN; five phases shipped to fix it, none verified. Phase 200's verdict on Marcus persona (AT RISK) entirely depends on this.

**MIN VERIFY (per audit-100-critical-paths.md Test Group E):**
1. SwingLab → Cage Mode → Tank engages with handoff line (Phase 105 verify)
2. All controls visible during recording (Fold open + closed)
3. 5 controlled real swings + 5 noise events
4. End session
5. Library entry appears within 30s
6. Per-shot Phase K analyses render
7. Drill recommendation surfaces
8. `adb logcat | grep "[path3:cage:"` shows canonical trace

**If MIN VERIFY passes:** PATH 3 transitions BROKEN → VERIFIED FUNCTIONAL. Marcus shifts AT RISK → READY.

## PATH 4 VOICE

**MIN VERIFY scenario:** earbud/badge tap → caddie engages → response → continuation/close.

**Material changes since last verification:**
- Phase 100 / B4 server-side persona sweep — system prompts now persona-aware on all api/* routes
- Phase 100 / S4 audio-write race fix — `audioFile.write` awaited before `Audio.Sound.createAsync` (likely F12 culprit)
- Phase 100 / S7 SDK timeouts on Anthropic + OpenAI
- Phase 100 / W4 Anthropic ephemeral prompt caching on hot endpoints
- Phase 100 / B3 api/voice text validation
- Phase 100 / W3 parallel filler TTS fetch (was 30-60s serial → ~5-10s)
- Phase 105 voice handoff lines on pillar transition
- Phase 109 log_shot voice intent
- Phase 110 media_capture + media_playback voice intents
- Phase 100 hotfix DOMException polyfill (this session)

**Status: UNKNOWN.**

Voice has had the most concentrated work. The S4 audio-write fix is the highest-confidence improvement; the [voice] speak timeout observed in Phase 100 F1 evidence is plausibly resolved.

**MIN VERIFY:**
1. Persona = Serena via Settings → Caddie Team → Round = Serena
2. Tap mic on Caddie home or earbud single-tap
3. Speak "what's the time" or "tell me a joke" → response in Serena's voice (ElevenLabs RGb96Dcl0k5eVje8EBch)
4. Repeat for Tank, Harry, Kevin
5. Test log_shot: "I hit 7-iron 165 to the green" → shot logs, ack in active caddie's voice
6. Test team handoff: open Cage → "Tank here. Let's work." plays
7. No `[voice] speak timeout` lines in adb logcat throughout

## Aggregate verdict

**External beta-readiness gate per CLAUDE.md:** "External beta-readiness requires all four paths verified working end-to-end on a real device within the last 7 days, on a real round."

**Current state: external beta BLOCKED.**
- All four paths UNKNOWN or DEGRADED-suspected.
- Substantial coded improvements since last verification.

**Single action to unblock:** Tim runs the four MIN VERIFY scenarios above on Galaxy Z Fold within ~90 minutes. Each path either passes or surfaces specific failure to fix.

**Internal beta:** Tim is the only user; he knows the limits. Continue.
