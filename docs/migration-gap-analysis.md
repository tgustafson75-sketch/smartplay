# Migration Gap Analysis — Legacy v2 → v1.0 (Phase BI Component 2 + 3 + 6)

**Date:** 2026-05-04
**Companion to:** [docs/legacy-v2-inventory.md](legacy-v2-inventory.md), [docs/legacy-club-detection-capture.md](legacy-club-detection-capture.md)

This document classifies every legacy v2 capability against current v1.0 and gives a prioritized recommendation for each finding. The classifications come from code-level evidence; UX-feel claims (tone, latency-feel, voice cadence) are flagged as needing Tim's empirical input.

---

## Classification key

- ✅ **PRESERVED** — works as well or better in v1.0
- ⚠️ **PRESERVED-BUT-WORSE** — regression worth fixing
- 🟡 **DELIBERATELY DROPPED** — architectural decision, document why
- ❌ **ACCIDENTALLY DROPPED** — missed in migration, evaluate reintroduction
- 🆕 **NEW IN v1.0** — capability not in legacy

---

## Findings

### Cage / Practice

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1 | Manual club selection (14-button tap grid, default 7I) | ✅ PRESERVED | Both legacy `app/cage/index.tsx` and current still have the `CLUBS` constant + grid |
| 2 | Per-club confidence stats (`confidenceByClub: Record<string, number>`) | ✅ PRESERVED | `store/relationshipStore.ts` in both branches |
| 3 | Heuristic feel/shape pattern engine (`analyzeSession` → root cause + drill) | ✅ PRESERVED | `services/patternEngine.ts` retained, called as fallback |
| 4 | Synchronous "log shot → Kevin speaks" tempo (<100ms compute) | ⚠️ PRESERVED-BUT-WORSE | Current `cage/summary.tsx` orchestrates pose-detection per swing (4s+), can stall if CV fails. Legacy heuristic ran in <100ms. Recommendation: **add a hard timeout + fallback to legacy heuristic when CV unavailable.** Confirmed in code at `services/poseDetection.ts:1-252` with no apparent timeout |
| 5 | Acoustic strike detection (acoustic engine) | 🟡 DELIBERATELY DROPPED | Legacy stub returned `null`/`isAvailable: false`. Current also stubbed. Architecturally superseded by pose-detection (visual-first). Decision still holds. |
| 6 | Auto club recognition during cage sessions | N/A — **NOT FOUND IN LEGACY** | No vision/audio/pose-based club ID code in legacy `origin/master`. Captured separately in [legacy-club-detection-capture.md](legacy-club-detection-capture.md). Tim's confidence the feature existed remains unresolved against the code — need legacy source location or memory-based capture. |
| 7 | Pose-detection swing classification | 🆕 NEW IN v1.0 | `services/poseDetection.ts`, `services/swingIssueClassifier.ts`, Python `services/cage-analysis/` sidecar — none in legacy |
| 8 | Drill recommendation engine | 🆕 NEW IN v1.0 | `services/drillRecommendation.ts` |

### Round flow

| # | Capability | Status | Evidence |
|---|---|---|---|
| 9 | Manual shot logging (feel + shape buttons) | ✅ PRESERVED | Both branches |
| 10 | Scorecard with all-holes view + club summary + Kevin recap (Phase Z) | ✅ PRESERVED — and richer | Current `app/(tabs)/scorecard.tsx` has expanded scope; legacy had hole-by-hole entry only |
| 11 | Bottom tab bar (Caddie / Play / Score / SwingLab / Stats — Phase AE) | ✅ PRESERVED | `app/(tabs)/_layout.tsx` in both, current has trust-level visibility |
| 12 | GPS shot tracking, weather, rules decisions, voice logging fields | 🆕 NEW IN v1.0 | `store/roundStore.ts` extended with `start_location`, `end_location`, `RulesDecision`, weather snapshots, `raw_utterance`, `logged_via` |
| 13 | `caddieBrain` real intent routing | 🆕 NEW IN v1.0 (legacy was Day-6 stub) | Current `services/caddieBrain.ts` is 1000+ LOC with role registers; legacy returned empty strings |
| 14 | Manual Mark with system-wide GPS refresh (Phase AL) | 🆕 NEW IN v1.0 | `services/positionMarkBus.ts`, button in `app/(tabs)/caddie.tsx:1690` |
| 15 | SmartFinder measure error handling (Phase AH) | 🆕 NEW IN v1.0 | `app/smartfinder.tsx:311,372` try/catch with three failure messages |

### Voice flow

| # | Capability | Status | Evidence |
|---|---|---|---|
| 16 | `speak(text, gender, lang, apiUrl)` public API | ✅ PRESERVED | Same shape both branches |
| 17 | ElevenLabs primary + OpenAI fallback voice IDs | ✅ PRESERVED | Same `male: '1fz2mW1imKTf5Ryjk5su'` / `female: 'RGb96Dcl0k5eVje8EBch'`; `onyx` / `nova` fallbacks |
| 18 | Bypass-phrase intent routing (`useVoiceCaddie`) | ✅ PRESERVED | Hook still present, still routes |
| 19 | Audio mode race serialization (Phase V.7 `audioModeQueue`) | 🆕 NEW IN v1.0 | `services/voiceService.ts:11-18` |
| 20 | Listening session orchestrator (earbud → opener → mic → response) | 🆕 NEW IN v1.0 | `services/listeningSession.ts` (388 LOC), `initListeningSession()` called from [app/_layout.tsx:97](../app/_layout.tsx#L97) |
| 21 | Conversational logging orchestrator (shot detection → voice prompt) | 🆕 NEW IN v1.0 | `services/conversationalLoggingOrchestrator.ts` |
| 22 | VAD with metering + 2800ms silence threshold (Phase AB) | 🆕 NEW IN v1.0 | `hooks/useVoiceActivityDetection.ts` |
| 23 | Earbud tap engaging Kevin (Phase O.5) | 🟡 DELIBERATELY DROPPED (honest disable, Phase AC) | Legacy had `react-native-track-player`; current commit `9865fef` removed it due to Kotlin / New-Arch / reanimated v4 incompatibility. Phase AC (`d836040`) shipped honest "Coming soon" disable. **On-screen tap is the working fallback.** Decision is correct given the dependency conflict; reintroduction = its own native-development phase. |

### Onboarding

| # | Capability | Status | Evidence |
|---|---|---|---|
| 24 | Caddie gender (Kevin/Serena) selection | ✅ PRESERVED | Legacy `app/intro.tsx` had it; current has it in both `app/intro.tsx` and `app/settings.tsx:308-312` |
| 25 | Multi-step onboarding (welcome / name / mode / home-course / about-game / meet-kevin / ready) | 🆕 NEW IN v1.0 | `app/onboarding/` 8-file router |
| 26 | Trust spectrum L1-L4 visual treatments | 🆕 NEW IN v1.0 (per CLAUDE.md Phase R) | `store/trustLevelStore.ts`, `app/settings/trust-level.tsx` |
| 27 | `app/intro.tsx` legacy single-file flow | ⚠️ PRESERVED-BUT-WORSE | Both `app/intro.tsx` AND `app/onboarding/` exist. Routing precedence not obvious from code. Recommendation: **confirm one is canonical and either delete or guard the other.** This is in `v1-scope-final.md` as a triage item. |

### Avatar / Kevin

| # | Capability | Status | Evidence |
|---|---|---|---|
| 28 | Kevin photoreal portrait (`kevin_portrait.jpg`) | ✅ PRESERVED | Same asset used as base |
| 29 | Kevin canonical layout (April 26 commit `19165fb`) | ✅ PRESERVED — locked | `CLAUDE.md` documents the lock |
| 30 | Single-component CaddieAvatar (467 LOC legacy) | ⚠️ FORK | Legacy was 467 LOC. Current is 935 LOC `CaddieAvatar` **plus** a brand-new 154 LOC `components/kevin/KevinAvatar.tsx`. Both are imported in `app/(tabs)/caddie.tsx` (lines 24, 59). Recommendation: **audit which one renders per trust level and confirm the dual-import is intentional vs migration debt.** This is non-trivial — 935 LOC of CaddieAvatar may include legitimate Phase AT recompose-pipeline that CLAUDE.md says was removed in Phase AU. Worth a focused diff session before claiming "canonical." |
| 31 | Photoreal Kevin character through all surfaces | ⚠️ PRESERVED-BUT-WORSE | Phase BM identified 5 hardcoded `kevin_portrait.jpg` references that didn't swap on `voiceGender`. 3 fixed in this session (paywall / briefing / greeting). 2 remain intentionally Kevin (intro chooser tile + onboarding pre-selection). |
| 32 | Emotion-keyed avatar map (22 emotion states for Kevin) | 🆕 NEW IN v1.0 | `components/CaddieAvatar.tsx:17-40`. Legacy had simple voice-state branching. Serena counterpart map shipped this session at lines 44-72 (`SERENA_AVATARS`). |

### Tools / Utilities

| # | Capability | Status | Evidence |
|---|---|---|---|
| 33 | TightLie naming for lie analysis (Phase AS) | 🆕 NEW IN v1.0 | `app/lie-analysis.tsx`, branding referenced via voice intents `tool_name: 'tightlie'` aliased to `lie_analysis` |
| 34 | SmartVision satellite-tile imagery (Phase AV) | 🆕 NEW IN v1.0 | `app/smartvision.tsx`, `services/mapboxImagery.ts` |
| 35 | SmartFinder yardage card | ✅ PRESERVED, much expanded | Legacy had basic distance display; current has F/M/B yardages, error handling, simulated GPS support |
| 36 | YouTube SwingLab demo links | 🆕 NEW IN v1.0 (hardened in Phase BM) | `services/youtubeLinks.ts` (this session), wired in 3 call sites |
| 37 | Arena (Closest-to-Pin / Skills / Sim Round / Scramble) | ✅ PRESERVED | Both branches have `app/arena/` with similar structure |

### Stats / Persistence

| # | Capability | Status | Evidence |
|---|---|---|---|
| 38 | `roundStore` persisted across app restart | ✅ PRESERVED | Zustand persist in both |
| 39 | Hero moments storage in `relationshipStore` | ✅ PRESERVED | `HeroMoment[]` in both |
| 40 | Cloud sync of round / practice history | 🟡 DELIBERATELY DROPPED in v1.0 | Documented as on-device-only in `docs/privacy-policy.md`; cloud sync is opt-in post-1.0 roadmap |

---

## Items Tim's empirical walkthrough must address

These dimensions are not capturable from code:

1. **Voice tone / cadence** — Did legacy Kevin sound different (different opener style, different tempo, different vocabulary)? If yes, what felt better?
2. **Cage tempo** — Legacy synchronous `analyzeSession` → instant Kevin response. Current async pose-detection adds ~4s latency. Did legacy feel snappier?
3. **Drill specificity** — Legacy heuristic drills ("Impact bag drill, hands forward at impact"). Current ML-classified. Were legacy drills more actionable / less generic?
4. **Earbud tap behavior** — Did `react-native-track-player` ever actually fire on Galaxy Buds in legacy? Or was it always broken even before removal?
5. **Avatar feel** — Was legacy's simpler 467-LOC `CaddieAvatar` more responsive than current's 935-LOC version? Any drift / clipping / position issues observable?
6. **Hole-overhead vision** — Legacy `api/vision.ts` had `mode === 'hole'` for caddie advice on hole map. Was this used? Did it ship value?

---

## Prioritized recommendations

### 🔴 URGENT (build today / before next round attempt)

**U1. Pose-detection timeout + fallback** — finding #4 above. Add hard `Promise.race` timeout (suggest 6s per swing, 30s total) on `poseDetection.analyzeSwing()`; fall through to `analyzeSession()` heuristic (still in code) when CV times out or returns null. **Files:** `services/poseDetection.ts`, `app/cage/summary.tsx`. **Effort:** S (1-2 hours).

**U2. Avatar dual-import audit** — finding #30. Confirm whether `CaddieAvatar` (935 LOC) and `KevinAvatar` (154 LOC) being imported together in `app/(tabs)/caddie.tsx:24,59` is intentional Phase AU canonical, or one is migration debt. If debt, delete the unused one and verify against `19165fb`. **Files:** `components/CaddieAvatar.tsx`, `components/kevin/KevinAvatar.tsx`, `app/(tabs)/caddie.tsx`. **Effort:** S (1-2 hours of focused diff + manual render test).

### 🟠 HIGH (queue for next phase batch)

**H1. Onboarding routing canonicalization** — finding #27. Both `app/intro.tsx` and `app/onboarding/_layout.tsx` exist; precedence unclear. Confirm which ships, delete or guard the other. **Files:** `app/_layout.tsx`, `app/intro.tsx`, `app/onboarding/_layout.tsx`. **Effort:** S (1 hour).

**H2. Phase AT pipeline residue cleanup** — finding #30 sub-claim. CLAUDE.md says Phase AU removed the recompose pipeline, but `CaddieAvatar.tsx` is still 2.0× the legacy size. Some of that is legitimate (Fold awareness, emotion map) — but a pass to confirm no residual `PORTRAIT_OFFSET_F` / `kevinShiftFraction` / etc. is worth doing. **Files:** `components/CaddieAvatar.tsx`. **Effort:** S-M (2-3 hours).

### 🟡 MEDIUM (queue for future)

**M1. Native earbud module (Kotlin / equivalent iOS)** — finding #23. Phase AC honest-disable shipped; the real fix is its own native-dev phase. Wait until external beta tester actually requests it. **Effort:** L (10-20 hours, native dev).

**M2. Cloud sync** — finding #40. Currently zero. Defer until post-beta usage data informs urgency. Privacy policy already accommodates the on-device-only model. **Effort:** L (multi-day).

**M3. Phase BL — auto club detection** — see [legacy-club-detection-capture.md](legacy-club-detection-capture.md). Greenfield per current evidence; design needs to be done from scratch. Tim's "show club bottom with number to camera" UX is the validated approach to record. **Effort:** M-L (depends on detection method chosen).

### 🟢 LOW (leave dropped)

**L1. Acoustic strike detection** — finding #5. Legacy stub never built; current pose-detection supersedes. Decision validated.

**L2. Day-6 caddieBrain stub** — legacy stub, current is 1000+ LOC real implementation. Non-issue.

---

## What Phase BI does NOT cover (out of scope)

- Empirical walkthrough of legacy app (Tim's first-person observations needed)
- Screenshots of legacy surfaces (Tim provides → `docs/legacy-v2-screenshots/`)
- Quantitative usability comparisons (no telemetry from legacy available)
- Resolution of the "did auto club detection ever exist" question (still open — see capture doc)
