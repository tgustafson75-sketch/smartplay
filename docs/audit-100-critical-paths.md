# Phase 100 — Component 3: Critical Paths Verification Status

**Audit date:** 2026-05-05
**Bundle SHA:** `94e7d29`

Per CLAUDE.md "Critical Path Verification Gates" — every PATH 1–4 must be verified end-to-end on a real device within 7 days for external beta-readiness. This document captures current empirical status.

## Status legend
- **VERIFIED FUNCTIONAL** — passed MIN VERIFY on Galaxy Z Fold within 7 days
- **DEGRADED** — works but with documented caveats / known issues
- **BROKEN** — fails MIN VERIFY

## Snapshot

| Path | Status | Last verified | Days stale |
|---|---|---|---|
| PATH 1 ONBOARD | DEGRADED (suspected) | Pre-bundle (BS-era) | ~7+ |
| PATH 2 ROUND | DEGRADED (suspected) | Pre-bundle (BS-era + 3-round Palms simulation in `84bfc76` was code-walk, not real-device) | ~7+ |
| PATH 3 CAGE | BROKEN at last empirical run; structural fixes shipped post-run; **status currently UNKNOWN** | Studio session (pre-BU) | ~5+ |
| PATH 4 VOICE | DEGRADED (suspected) | Pre-bundle | ~7+ |

## PATH 1 ONBOARD

**MIN VERIFY scenario** (per CLAUDE.md): cold install → onboarding → Caddie home with profile.

**Recent changes affecting this path:**
- `c752adb` Phase BU audit (no code)
- `98c5822` BS-followup + BN-expanded + BU-followup — settings store hydration gate in `app/index.tsx` (blocks routing until both `usePlayerProfileStore` AND `useSettingsStore` finish hydrating); 4-persona widening; intro.tsx Step 1 now 4-card 2x2 grid
- Hydration fix is the critical one. The original Tim-reported bug ("Kevin's voice when set on Serena") is on this path's first 2 seconds of cold launch.

**Current status: DEGRADED suspected, possibly VERIFIED FUNCTIONAL pending re-test.**

The hydration fix is correct on inspection. If it holds in practice, PATH 1 is functional. If not, the original bug recurs.

**MIN VERIFY for re-test:**
1. Cold install (or wipe data).
2. Step through onboarding to completion.
3. Land on Caddie home, confirm avatar matches initial-default Kevin.
4. Switch to Serena via Settings, force-stop, cold launch.
5. Verify no Kevin flash before Serena renders. Greeting voice (if it plays) is Serena's.

**Risk:** if hydration fix has a corner case (e.g. `useTrustLevelStore`, `useCageStore`, `useGhostStore` also not gated), a deep-customized cold launch may still flicker. Mitigation: BV-PREP Test Group B catches this.

---

## PATH 2 ROUND

**MIN VERIFY scenario:** open app → find course → start round → log shots → end → recap.

**Recent changes affecting this path:**
- All persona widening touches voice in-round (caddie chat / brain / kevin endpoints). Persona-aware system prompts in api/brain.ts, api/kevin.ts, etc.
- Hydration fix (PATH 1) impacts round entry indirectly.
- Pre-BU: `ef50864` Phase BH (in-round diagnostic Coach), `d07b947` Phase BG (GPS subscriber gaps closed) shipped.
- `84bfc76` 3-round Palms simulation report is **code-walk predictive, not real-device**.

**Current status: DEGRADED suspected.**

PATH 2 has the longest empirical-stale window. Last real Z Fold round was likely BH-era. Persona widening introduced changes to every voice surface that could surface a regression mid-round.

**MIN VERIFY for re-test:**
1. Open app on Z Fold.
2. SwingLab → search a course → tap (i) → Course Detail → "Start Round Here".
3. Or: Caddie tab → start a round directly.
4. Mark a shot via voice or tap.
5. End round.
6. Recap renders with hole summaries + overall summary.
7. Check: persona name in recap text matches selected persona.

**Specific risks:**
- Recap caching keyed by `roundId|language` (briefingGenerator.ts). If a recap was cached pre-persona-widening, it'll still say "Kevin" even after persona switch. Cache invalidation on persona switch was added (BU-followup); first-time test should be clean.
- BH in-round diagnostic Coach: `services/listeningSession.ts` calls `/api/kevin` with `register: 'coach'`. Persona threading: needs verification.

---

## PATH 3 CAGE

**MIN VERIFY scenario:** SwingLab → Cage Mode setup → record → analysis → drill.

**Recent changes affecting this path:** ALL OF THEM. Five phases shipped specifically to address Cage Mode failures:
- `1e47e6a` BX — `[path3:cage]` telemetry markers at every stage
- `08f0803` BV — reconcile dual UIs to single canonical overlay (deleted 1005 lines of legacy session.tsx body, replaced with 30-line wrapper)
- `eb6a587` BW — per-detection clip extraction + Phase K reshape with clipBoundaries
- `9a20264` BY-quick — multi-criterion detection validation (TPR/FPR hardening)
- `94e7d29` BZ-v1 — review UI uplift (per-shot list, action sheet, comparison view, share, annotations, library filters)

**Current status: PHASE BU said BROKEN; structural fixes shipped; current empirical status UNKNOWN.**

**This is the highest-leverage MIN VERIFY in the entire app.** Phase BU established the BLOCKING failures; Phase 100's verdict on whether they're resolved hinges on this single Z Fold session.

**MIN VERIFY for re-test (per `docs/verification-BV-PREP.md` Test Groups E1–E4 + telemetry recipes):**
1. Cage Mode card on SwingLab tab (or via Tools menu / Cage Setup card — all should converge on overlay per BV).
2. All controls visible during recording (no overlap, no off-screen Stop button).
3. Hit 5 controlled real swings + 5 known noise events (clap, club drop, voice, footstep, door).
4. End session.
5. Within 30 seconds: library entry appears (CAGE badge).
6. Tap entry: `N SWINGS · TAP TO JUMP` card visible. Per-row: index, detected issue, confidence, method, time.
7. Tap a row: video scrubs to that swing's start + autoplays.
8. Tap "•••" on a row: action sheet opens. Mark as good rep, add note, share, delete all functional.
9. From action sheet: "Compare with another swing" → banner appears → tap second row → two-pane view renders → Play both / Pause / Restart all work.
10. `adb logcat | grep "[path3:cage:"` shows the canonical trace per `docs/cage-telemetry-map.md` Recipe 1.
11. `adb logcat | grep "swing-detected" | wc -l` ≈ number of real swings ± 1 false positive.
12. `adb logcat | grep "swing-rejected" | wc -l` ≈ number of noise events.

**Pass criterion:** 12/12 checks. **Partial pass:** ≥10/12 with documented gaps. **Fail:** ≤9/12.

If MIN VERIFY passes: PATH 3 transitions BROKEN → VERIFIED FUNCTIONAL. Marcus persona shifts BROKEN → READY.

If MIN VERIFY partially passes: targeted fix on the specific gap (likely 1–2h work).

If MIN VERIFY fails: BU's BLOCKING verdict stands, root cause analysis required, possibly a new BU.2 audit.

---

## PATH 4 VOICE

**MIN VERIFY scenario:** earbud/badge tap → caddie engages → response → continuation/close.

**Recent changes affecting this path:**
- All persona widening: 17 server-side API routes + 6 Expo Router routes are persona-aware now.
- ElevenLabs voice routing keyed by persona (Kevin, Serena, Harry, Tank).
- `services/voiceService.ts:speak()` reads `caddiePersonality` from settings store and threads as `persona` in `/api/voice` body.
- Filler library cache key changed to `persona_lang_v4` (BU-followup); forces regen on existing installs.
- BA-BC pre-bundle: voice register differentiation (caddie / coach / psychologist), uncertainty guardrail.

**Current status: DEGRADED suspected.**

The voice path has the most bundled changes since last empirical run. Risk: any single persona's TTS roundtrip fails (network, ElevenLabs key, cache regen) and the fallback OpenAI path activates → all male personas (Kevin/Harry/Tank) sound identical onyx-voiced, defeating the persona feel.

**MIN VERIFY for re-test:**
1. Persona = Serena. Tap mic on Caddie home or earbud single-tap.
2. Confirm avatar enters listening state within 1–2s.
3. Speak: "what's the time" or "tell me a joke."
4. Verify response audio plays through earbud (not phone speaker).
5. Verify voice is Serena's (ElevenLabs RGb96Dcl0k5eVje8EBch).
6. Repeat for Tank, Harry, Kevin. Each should sound distinctly different.
7. If any persona falls back to OpenAI onyx/nova: ElevenLabs path failed for that persona. Check logcat for ElevenLabs errors.
8. `[path4:voice]` markers should appear in logcat (if instrumented; PATH 4 telemetry isn't as comprehensive as PATH 3 BX markers).

**Pass criterion:** all 4 personas produce distinct, recognizable ElevenLabs voices. Latency acceptable (<5s end-of-utterance to start-of-response).

---

## Aggregate verdict

**External beta-readiness gate per CLAUDE.md:** "External beta-readiness requires all four paths verified working end-to-end on a real device within the last 7 days, on a real round (not just simulated). Until that's true: internal personal beta only."

**Current state: external beta BLOCKED.**
- PATH 3 was BROKEN at last empirical; status UNKNOWN today.
- Other 3 paths: DEGRADED-suspected (code looks right, untested).

**Single action to unblock:** Tim runs all 4 MIN VERIFY scenarios on Galaxy Z Fold within ~60–90 minutes total. Fill `docs/verification-BV-PREP-results.md`. Each path either passes or surfaces specific failure.

**Internal beta:** Tim is the only user; he knows the limits. Can continue.
