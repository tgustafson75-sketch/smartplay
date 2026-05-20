# Phase 420 — Consolidation Sprint MAP (Two-Week Spine)

**Date:** 2026-05-20  
**Audit source docs (read these in order if you want the evidence):**
1. [audit-420-structure.md](audit-420-structure.md) — repo layout + file metrics
2. [audit-420-routes.md](audit-420-routes.md) — every Expo Router route + reachability
3. [audit-420-duplication.md](audit-420-duplication.md) — **the priority doc**
4. [audit-420-dead-code.md](audit-420-dead-code.md) — orphaned exports + commented blocks
5. [audit-420-pillars.md](audit-420-pillars.md) — ROUND / PRACTICE / PLAY honest state
6. [audit-420-caddie.md](audit-420-caddie.md) — persona / voice / brain layer
7. [audit-420-tools.md](audit-420-tools.md) — per-tool trust matrix
8. [audit-420-recent-phases.md](audit-420-recent-phases.md) — phase landing health
9. [audit-420-data-models.md](audit-420-data-models.md) — player_id / speaker_id / roster
10. [audit-420-build-health.md](audit-420-build-health.md) — tsc / lint / doctor / bundle
11. [audit-420-ux-walk.md](audit-420-ux-walk.md) — cold-launch tester flow

The product is feature-complete. This sprint adds nothing. It cleans, consolidates, removes duplication, hardens, and proves the critical path on device.

---

## Headline numbers

| Metric                                | Number       | Interpretation                              |
|---------------------------------------|--------------|---------------------------------------------|
| TypeScript errors                     | 0            | Build clean — strict mode, zero suppressions |
| TypeScript warnings                   | 0            | Clean                                       |
| Lint errors                           | 5            | All `react/no-unescaped-entities` — cosmetic |
| Lint warnings                         | 12           | 4 unused components in smartmotion.tsx + minor |
| expo-doctor                           | 17/17 pass   | Healthy                                     |
| Bundle (Hermes per platform)          | 5.2 MB       | Reasonable                                  |
| `console.log` calls                   | 355          | Hygiene concern, not blocker                |
| Orphaned routes                       | 14           | See [routes audit](audit-420-routes.md)      |
| Debug routes ungated for non-owners   | 10           | Launch hygiene fix                          |
| Dead-code LOC                         | ~3,400       | Removal in P1                                |
| Duplicate swing-capture surfaces      | 5 (3,649 LOC)| **#1 consolidation target**                  |
| `haversine` implementations            | 5            | Canonical = `utils/geoDistance.ts:13`        |
| GPS-fix caches                        | 3            | gpsManager / smartFinderService / shotLocation |
| Tools at trust ≥ 4                    | 2 of 8        | GPS, Manual Mark                            |
| Tools at trust 3 (unverified on bundle)| 4 of 8       | SmartFinder, SmartVision, SmartMotion, TightLie |
| Tools at trust 2                      | 2 of 8       | Auto-club detect, Health Connect motion     |
| Phases verified on device             | 0            | Per commit messages all "git-diff verified"  |

---

# P0 — BLOCKING (must fix before launch)

These break the user-visible critical path or expose a tester to a 404/crash in <60s.

## P0-1 — `/arena/practice` is a 404
**Evidence:** [app/(tabs)/swinglab.tsx:78](../app/(tabs)/swinglab.tsx#L78) routes the Arena card to `/arena/practice`. No `app/arena/` directory exists.  
**Impact:** Any tester tapping the Arena card on the SwingLab tab crashes into a not-found screen.  
**Effort:** S — either build a stub Arena screen or hide the card until Arena ships.  
**Order:** day 1.

## P0-2 — `/swinglab/range` likely missing
**Evidence:** [app/(tabs)/swinglab.tsx:65](../app/(tabs)/swinglab.tsx#L65) routes the Range Mode card to `/swinglab/range`. Per routes audit this file is unverified — confirm presence; if missing, same fix as P0-1.  
**Effort:** S — verify; build stub or hide.  
**Order:** day 1.

## P0-3 — Two parallel SmartMotion UIs
**Evidence:** [app/smartmotion-quick.tsx](../app/smartmotion-quick.tsx) (954 lines, OLD) still reachable from:
- `services/intents/openToolHandler.ts:28-29` (voice-intent "open SmartMotion")
- `components/tools/GlobalToolsMenu.tsx:325` (••• menu entry)
- `app/swinglab/library.tsx:256` (Library entry)

Meanwhile the canonical [app/swinglab/smartmotion.tsx](../app/swinglab/smartmotion.tsx) (Phase 416+418) is only reachable from the SwingLab tab card.  
**Impact:** "Open SmartMotion" voice command gives a DIFFERENT UI than tapping the card. User sees the app as broken even when both surfaces "work."  
**Effort:** M — repoint the 3 entry points to the canonical route, delete `smartmotion-quick.tsx` (954 LOC removed).  
**Order:** day 1-2.

## P0-4 — End-Round crash unverified
**Evidence:** Prior session summary documented "Maximum update depth exceeded" hitting End Round. No commit since claims a fix.  
**Impact:** If reproducible on the current bundle, every test round crashes at the finish line.  
**Effort:** S to reproduce + diagnose, M to fix. Reproduction on Z Fold first.  
**Order:** day 1 reproduction.

## P0-5 — Voice transcription is 100% unattributed
**Evidence:** [audit-420-data-models.md](audit-420-data-models.md). `speaker_id` declared on Shots but never written; ParsedShotRecord and VoiceIntent records have zero speaker tagging.  
**Impact:** **BLOCKING for multi-player launch.** Single-player works because there's only one speaker; the moment a second player tags in, every utterance is mis-attributed and there's no migration path on data already on disk.  
**Effort:** M — add `speaker_id: 'self'` default in 4 write paths so the field is consistently present even in single-player. Don't add a multi-player UI yet — just write the field.  
**Order:** day 2 — before any PGA Hope tester data persists.

## P0-6 — Placeholder buttons that look functional
**Evidence:** SmartMotion bottom bar has Tag Club (`onTagClub={/* TODO */}`), Compare (no real comparator), View Full Data (no onPress). User taps → nothing happens or wrong screen. See [audit-420-ux-walk.md](audit-420-ux-walk.md).  
**Effort:** S — either hide or wire to honest empty-state.  
**Order:** day 2.

## P0-7 — Debug routes ungated
**Evidence:** 10 `*-debug.tsx` + dev surfaces (`/gps-test`, `/acoustic-test`, `/api-debug`, `/battery-debug`, `/cage-debug`, `/ghost-debug`, `/patterns-debug`, `/plan-debug`, `/smartfinder-debug`, `/subscription-debug`) accessible without owner check.  
**Impact:** A tester or App Store reviewer landing on these via accidental tap or deep link sees raw diagnostic UI.  
**Effort:** S — single gate in [app/_layout.tsx](../app/_layout.tsx) that redirects non-owner deep links away from these prefixes.  
**Order:** day 2.

---

# P1 — CONSOLIDATION (duplication merge + dead-code removal)

The mandate of the sprint. Ordered by blast radius first.

## P1-1 — Collapse the 5 swing-capture surfaces (highest priority)
**Evidence:** [audit-420-duplication.md](audit-420-duplication.md) item 1.  
- `components/CageSessionOverlay.tsx` (1,085 lines, canonical per [app/cage/session.tsx:7-22](../app/cage/session.tsx#L7-L22))
- `app/swinglab/cage-drill.tsx` (1,039 lines) — full parallel flow
- `app/smartmotion-quick.tsx` (954 lines) — also targeted in P0-3
- `app/swinglab/quick-record.tsx` (260 lines) — minimal single-tap (Phase 416, keep)
- `components/CaptureOverlay.tsx` (311 lines) — pre-Phase-416 capture

Each runs its own phase machine + camera handling + acoustic detection.  
**Recommended canonical:**
- Single-swing capture → `app/swinglab/quick-record.tsx` (Phase 416)
- Multi-swing cage session → `components/CageSessionOverlay.tsx`
- Delete: `app/swinglab/cage-drill.tsx`, `app/smartmotion-quick.tsx`, `components/CaptureOverlay.tsx` (≈ 2,304 LOC removed)  
**Effort:** L — multi-day, needs careful import unwinding.  
**Order:** week 1, after P0.

## P1-2 — Two `CageSession` interfaces same name, different shape
**Evidence:**
- [types/cage.ts:1](../types/cage.ts#L1) — multi-clip master-video model (used by `services/cageStorage.ts`, `components/CageSessionOverlay.tsx`)
- [store/cageStore.ts:116](../store/cageStore.ts#L116) — Phase J cage-mode session with shots (36 importers)

**Recommended:** rename one. The store version is in 36 places — rename `types/cage.ts` version to `CageMasterSession` or `CageClipBundle`.  
**Effort:** M — type rename + sweep of 5-ish importers of the master-video version.  
**Order:** week 1.

## P1-3 — Three GPS-fix caches
**Evidence:**
- `services/gpsManager.ts:87 lastFix`
- `services/smartFinderService.ts:67 lastFix`
- `services/shotLocationService.ts:25 lastLocation`

Each diverges on simulator-on, mark-position, and round-end paths. This is the source of the prior "629,441y" off-course reading.  
**Recommended canonical:** `services/gpsManager.ts` is the canonical owner; the other two should read from it via a getter or subscribe to fix updates.  
**Effort:** M — 3-4 hours plus regression testing on simulated round.  
**Order:** week 1 — touches the round-critical path.

## P1-4 — Five `haversine` implementations
**Evidence:**
- Canonical: [utils/geoDistance.ts:13](../utils/geoDistance.ts#L13)
- Re-implementations: `services/gpsManager.ts:108`, `services/shotDetectionService.ts:65`, `services/mapboxImagery.ts:88`, `services/smartVisionOverlay.ts:178` (literally re-declares `haversineYards`)

**Recommended:** all 4 re-implementations import from `utils/geoDistance.ts`.  
**Effort:** S — 4 file edits + delete 4 local helpers.  
**Order:** week 1, low-risk while doing P1-3.

## P1-5 — Two watch-connected state stores
**Evidence:**
- [store/settingsStore.ts:86 watchConnected](../store/settingsStore.ts#L86) (read by `app/cage/index.tsx:57`)
- [store/watchStore.ts:33 isConnected](../store/watchStore.ts#L33) (read by `app/cage/summary.tsx:45`, `app/swinglab/cage-drill.tsx:120`)

Mid-session disconnect updates one screen, not the other.  
**Recommended canonical:** `store/watchStore.ts` (dedicated store). Remove `watchConnected` from settingsStore.  
**Effort:** S — 1 read site to update + remove from settings store + clear persisted field on next hydration.  
**Order:** week 1.

## P1-6 — `api/kevin.ts` and `api/voice.ts` hold duplicate ElevenLabs voice maps
**Evidence:** [audit-420-caddie.md](audit-420-caddie.md). This turn's `e872f9b` fix copy-pasted `ELEVEN_VOICES_BY_PERSONA` + `ELEVEN_SETTINGS_BY_PERSONA` into `api/kevin.ts:945-956` from `api/voice.ts:11-46` instead of importing a shared module.  
**Recommended:** extract to `api/_voiceTuning.ts` and import from both.  
**Effort:** S — 30 minutes.  
**Order:** week 1 — do while fresh, before next persona-tuning pass.

## P1-7 — OpenAI TTS fallback collapses Kevin/Harry/Tank to onyx
**Evidence:** [audit-420-caddie.md](audit-420-caddie.md). When ElevenLabs is unavailable, all three male personas speak in the same voice. Acceptable today (ElevenLabs is the primary path) but worth a note in the caddie tuning doc.  
**Effort:** S — document as a known limitation OR add per-persona tone instructions to the OpenAI fallback (max 1 hr).  
**Order:** week 2 if time.

## P1-8 — Remove dead-code LOC (~3,400 LOC)
**Evidence:** [audit-420-dead-code.md](audit-420-dead-code.md). Specific targets:
- `services/gpsAudit.ts` (418 lines, superseded by `services/audit/*` v2)
- `components/AddressSilhouette.tsx` (265, Phase 111 deprecated)
- `components/KevinHelpButton.tsx` + `WhatCanISayChip.tsx` + `TapToTalkButton.tsx` (Phase AT removed all consumers)
- `services/sensing/sensingSources.ts` + `services/watchService.ts` (118 each, Phase 417/418 scaffolds with no consumers)
- `components/swinglab/SkeletonOverlay.tsx` + `services/poseInference.ts` (dead pose-overlay scaffold)
- `services/swingCapture.ts` (pre-Phase-416)
- `services/modeSelector.ts` + entire `services/roles/*` subtree (rolemode chain never wired)
- Expo starter-template leftovers: `themed-text`, `themed-view`, `parallax-scroll-view`, `collapsible`, `icon-symbol*`, `hello-wave`

**Effort:** M — careful delete + tsc/grep gate after each removal.  
**Order:** week 2 — after P1-1 through P1-6.

## P1-9 — Remove `expo-image` (unused npm dep)
**Evidence:** [audit-420-build-health.md](audit-420-build-health.md). Only unused dep.  
**Effort:** S — `npm uninstall expo-image` + verify no imports.  
**Order:** week 2 with other dep hygiene.

## P1-10 — 14 orphaned routes
**Evidence:** [audit-420-routes.md](audit-420-routes.md). Includes `/hole-view` (1,484 LOC), `/owner-logs`, `/lie-analysis`, `/mark-green`, `/ghost-debug`, plus 9 others.  
**Recommended:** each is either (a) reachable via a deep link I missed (verify with one more grep pass), (b) actually orphaned (delete), or (c) intentionally owner-only (gate via P0-7).  
**Effort:** M — case-by-case decision per route.  
**Order:** week 2.

## P1-11 — Caddie tab is 3,870 lines
**Evidence:** [app/(tabs)/caddie.tsx](../app/(tabs)/caddie.tsx). Monolithic; mixes voice state, avatar, round CTA, more menu, scoring chip, mid-round chrome.  
**Recommended:** extract to ≥4 child components: `<CaddieAvatarBlock>`, `<PreRoundCTA>`, `<RoundActiveChrome>`, `<MoreMenu>`. Don't merge state — pass it down. This is a refactor, not a rewrite — keep behavior byte-identical.  
**Effort:** L — multi-day, schedule for week 2.  
**Order:** week 2 — risky if rushed; do AFTER duplication is resolved.

---

# P2 — POLISH (UX + labels + empty states)

## P2-1 — Caddie tab ••• pill vs pre-round Tools FAB
**Evidence:** [audit-420-ux-walk.md](audit-420-ux-walk.md). Three tool entry points on Caddie tab pre-round (••• corner, dropdown, FAB). New user doesn't know they're the same menu.  
**Recommended:** drop the dropdown chip if the FAB is keeping its slot. Or label the FAB "Quick tools" to differentiate.  
**Effort:** S.

## P2-2 — `Play` tab name is misleading
**Evidence:** Tab labeled "Play" is actually course discovery, not round-start. Round-start lives on the Caddie tab.  
**Recommended:** rename tab "Courses" or "Discover" or merge into Caddie. Defer decision to product; flag for sprint discussion.  
**Effort:** S after decision.

## P2-3 — `console.log` pruning before TestFlight
**Evidence:** 355 calls. Worst: `store/roundStore.ts` (29), `services/simulatedGPS.ts` (22), `services/listeningSession.ts` (16).  
**Recommended:** keep the [V6-DIAG] grep-target ones, prune the rest. Or gate via a `__DEV__` wrapper.  
**Effort:** M — 1-2 hours sweep.  
**Order:** week 2 before any public build.

## P2-4 — 5 lint errors (apostrophes)
**Evidence:** `react/no-unescaped-entities`. Cosmetic. Auto-fixable.  
**Effort:** S — 10-min `npx expo lint --fix`.

## P2-5 — Stale audit doc — `audit-410-auth-state.md`
**Evidence:** [audit-420-recent-phases.md](audit-420-recent-phases.md). Phase 410B auth scaffold landed then fully reverted; the audit doc still describes the reverted state.  
**Recommended:** add a `STATUS: REVERTED 2026-MM-DD` banner to that doc.  
**Effort:** S.

## P2-6 — `app/diagnostic-card.tsx` is JSX in app root
**Evidence:** [audit-420-structure.md](audit-420-structure.md). Should live in `components/`.  
**Effort:** S — file move + import-path fix.

## P2-7 — Swing Library empty-state copy
**Evidence:** [audit-420-ux-walk.md](audit-420-ux-walk.md). Verify the empty Library shows "no swings yet, record one" not just a blank list.  
**Effort:** S — read + tweak if missing.

---

# VERIFIED CLEAN (do not touch — already solid)

Things the audits found in good shape. Don't waste sprint time here.

| Area                                          | Evidence                                  |
|-----------------------------------------------|-------------------------------------------|
| TypeScript compile (zero errors, zero warnings, strict, zero suppressions) | [audit-420-build-health.md](audit-420-build-health.md) |
| `expo-doctor` 17/17 checks                    | [audit-420-build-health.md](audit-420-build-health.md) |
| App entry hydration gate                      | [app/index.tsx:21-49](../app/index.tsx#L21-L49) |
| Welcome screen                                | [app/welcome.tsx](../app/welcome.tsx) |
| Tab layout (5 tabs, distinct icons, restored everywhere) | [app/(tabs)/_layout.tsx](../app/(tabs)/_layout.tsx) |
| `BrandHeaderRow` + ••• pill consistency       | [components/brand/BrandHeaderRow.tsx](../components/brand/BrandHeaderRow.tsx) |
| Persona definition single source              | [lib/persona.ts](../lib/persona.ts) — ACTIVE_PERSONAS, getCaddieName, getCharacterSpec |
| Phase 418 validation gate (services/swingValidity.ts + smartmotion.tsx gating) | This turn's `3cf8d11` |
| GPS adaptive subscription                     | [services/gpsManager.ts](../services/gpsManager.ts) — trust 4 in tools matrix |
| Manual Mark bus                               | [services/positionMarkBus.ts](../services/positionMarkBus.ts) — trust 4 |
| Persona-aware Kevin TTS (this turn)           | This turn's `a63d1b3` |
| Tools FAB layout fix (this turn)              | This turn's `a63d1b3` |
| Scorecard tab is 772 LOC (NOT 35K — structure audit had a calc error) | Verified via `wc -l` |

---

# Dependency order summary

```
day 1
  P0-1  fix /arena/practice  (S, blocks tester walk)
  P0-2  fix /swinglab/range  (S)
  P0-4  reproduce End-Round crash on current bundle  (S)

day 2
  P0-3  collapse 2 SmartMotion UIs (M, removes 954 LOC immediately)
  P0-5  add speaker_id='self' to 4 write paths (M)
  P0-6  hide placeholder buttons in SmartMotion (S)
  P0-7  gate debug routes (S)

week 1
  P1-1  collapse swing-capture surfaces (L, multi-day)
  P1-2  rename one CageSession (M)
  P1-3  single GPS fix cache (M)
  P1-4  single haversine (S)
  P1-5  single watch-connected store (S)
  P1-6  shared _voiceTuning module (S)

week 2
  P1-8  dead-code removal pass (M)
  P1-9  drop expo-image (S)
  P1-10 resolve 14 orphan routes (M)
  P1-11 caddie.tsx refactor into child components (L)
  P2-3  console.log pruning (M)
  P2-1, P2-2, P2-4, P2-5, P2-6, P2-7  polish (S each)
```

---

# Empirical verification gate (end of sprint)

Sprint is not done until ALL of these are confirmed on a real Z Fold:

- [ ] Cold launch → welcome → caddie tab → no flashes, no double-redirects
- [ ] SwingLab tab: every card reaches a real screen (no 404)
- [ ] SmartMotion: Phase 418 validation gate stops fabrication on floor footage; real swing produces an honest read
- [ ] Tools FAB on caddie tab expands left to icons; no fake giant pill
- [ ] Each of the 4 personas speaks in their own voice (not Kevin everywhere)
- [ ] Round start → 18 holes simulated → End Round → recap → no "Maximum update depth" crash
- [ ] Debug routes return 404 / redirect for non-owner accounts
- [ ] APK build size unchanged or smaller than pre-sprint baseline (5.2 MB Hermes)

**The sprint is the gap between code-canonical and on-device-verified.** Nothing in P0–P2 is "done" until it's confirmed on the bundle.
