# Phase BS — Empirical Verification Status

**Date:** 2026-05-04

---

## Top-line

**Zero phases empirically verified on Galaxy Z Fold today.** Tim explicitly stated "I cannot test manually right now, we need to build correct so I can test final product." All shipped code is **code-correct** (passes tsc, lint at baseline) but **not on-device-verified**.

Every entry below shipping today reads `SHIPPED CODE-CORRECT, EMPIRICALLY UNVERIFIED`. The verification gate per `docs/critical-paths.md:228-230` (real device, real round, last 7 days) is open across the board.

---

## Per-phase status

### Phase BA-FOUNDATION (AC + AL + AH + Y.2)

These were **already shipped before today** (commits `d836040` AC, `0440cdb` AL, `d004753` AH, plus Y.2 in main). Today's BS audit confirms they're still in place; no new work landed on them. The original BA-FOUNDATION prompt asked me to ship them, but the BI gap analysis I did earlier today proved they were already shipped — so today's "BA-FOUNDATION" turned into a no-op verification, not a build.

- **AC earbud tap:** SHIPPED (honest disable + on-screen tap fallback). EMPIRICALLY UNVERIFIED on Galaxy Buds for the deferred Kotlin module path. The on-screen-tap fallback works code-level.
- **AL Mark propagation:** SHIPPED (`services/positionMarkBus.ts` pub/sub). EMPIRICALLY UNVERIFIED that all 4+ subscribers refresh on mark.
- **AH SmartFinder error handling:** SHIPPED (3 distinct user-facing failure messages). EMPIRICALLY UNVERIFIED in degraded GPS conditions.
- **Y.2 round-active state:** SHIPPED to `main`. EMPIRICALLY UNVERIFIED — has never been confirmed on-device through a full round.

What's needed to verify: per-path MIN VERIFY in `docs/critical-paths.md` (10-15 min each).

### Phase BI (Legacy review)

- Inventory complete — `docs/legacy-v2-inventory.md`
- Migration gap analysis complete — `docs/migration-gap-analysis.md` (40 findings, U/H/M/L prioritized)
- Club detection deep capture complete — `docs/legacy-club-detection-capture.md` (honest finding: no auto-detection in legacy; UX pattern from Tim's memory documented)
- Screenshot capture: PLACEHOLDER ONLY (`docs/legacy-v2-screenshots/README.md`). Tim must provide.

### Phase BJ (Capability research)

- 11 research docs complete (`docs/research-*.md`) — MediaPipe, Watch IMU, haptics, audio classification, hand tracking, AR, voice biometric, streaming TTS, Live Activities, Health Kit, plus consolidated `research-summary.md`
- BUILD-TODAY candidates surfaced: 2 (BO haptic notifications ~6-9h, BP TTS sentence pipeline ~11h)
- 8 capabilities QUEUED with concrete reasons
- `master-compendium.md`: NOT created (flagged as candidate, not Phase BJ scope)

### Phase BL (Auto club recognition for cage)

- Code shipped (12 files touched/added). Three trigger paths: photo capture / voice / manual picker.
- EMPIRICALLY UNVERIFIED. Specifically untested:
  - Sonnet vision OCR-style read of the club sole — actual recognition rate unknown
  - 3 confidence states routing UX (high → auto-register, medium → confirm prompt, low → manual fallback)
  - Voice intents (`club_change` / `club_query` / `club_menu`) — server classifier deployed only after commit + push
  - Per-club session segmentation in cageStore — clubSegments array population
  - Settings toggle hide/show on `cageAutoClubDetection`
- `docs/club-recognition-architecture.md` is the contract.

### Phase BM (Pre-beta blockers / scope-final)

- Stripe: DEFERRED per Tim. Architectural pattern decision (iOS IAP / RevenueCat / web) recorded but not built.
- Privacy policy: DRAFT at `docs/privacy-policy.md`. Hosting + legal review still on Tim.
- AV verification: docs say READY (foundation batch shipped). EMPIRICALLY UNVERIFIED — Tim runs the 142 AX scenarios on Z Fold.
- YouTube SwingLab links: HARDENED (`services/youtubeLinks.ts`).
- Future-feature triage: documented in `docs/v1-scope-final.md`.

### Phase BN (Serena voice persona)

- 3 portrait swap sites (paywall, briefing, greeting) — code shipped
- 2 new high-res Serena PNGs in `assets/avatars/`
- `CaddieAvatar.tsx` SERENA_AVATARS emotion map — 22 emotion keys mapping to 5 distinct Serena assets (most fall back to studio portrait)
- EMPIRICALLY UNVERIFIED. Tim hasn't toggled to female voice and hit each surface.
- 14 Serena emotional-state PNGs still missing (Tim generates via chatly.ai)

### Phase BQ (Upload pipeline diagnostic)

- Components 1+2 shipped: pipeline map (`docs/upload-pipeline-map.md`) + `[upload:*]` markers at 11 stage transitions in `services/videoUpload.ts`, plus front-of-pipeline (`pickVideo`/`probeVideo`/`save-tap`) and UI render boundaries
- `services/uploadDiagnostic.ts` helper with per-key timing registry
- Components 3-9 (empirical capture, root-cause analysis, targeted fix, multi-scenario test, regression protection, failure messaging, full architecture doc) **gated on Tim's empirical capture** which has not been run

### Phase U1 (Pose timeout + heuristic fallback)

- Initially HELD per BQ "no speculative fixes," then SHIPPED later when Tim said "build correct so I can test final."
- Code shipped: `analyzeSwingTentative` in `services/poseDetection.ts`, `mode: 'tentative'` branch in `api/swing-analysis.ts`, fallback wired into `runPhaseKOnSession`'s zero-results branch, 30s→15s timeout, per-stage failure messaging
- EMPIRICALLY UNVERIFIED. Specifically untested:
  - Whether the heuristic fires in the actual failure mode Tim sees
  - Whether tentative-read PrimaryIssueCard renders correctly (V.6 confidence-low prefix)
  - Per-stage failure copy messages

### Phase U2 (Avatar dual-import audit)

- SHIPPED (`KevinAvatar` import removed from caddie.tsx — was orphaned, never rendered).
- Lint improvement: 8 → 6 warnings (2 dead-code warnings removed).
- `docs/character-asset-architecture.md` codifies the rule.
- EMPIRICALLY UNVERIFIED on Z Fold but very low risk — the import was dead code; no rendering changed.

### Phase BR (Tutorial analysis)

- Foundation shipped: `tutorialStore`, `api/tutorial-analysis.ts`, library + upload + detail screens, caddie context injection in 3 client call sites + `api/kevin.ts`
- BR repaste components 9, 11, 14 shipped: recap reinforcement, non-instruction guard, SwingLab redirect
- DEFERRED to BR2: audio transcription (Whisper), Stream 1 (visual demo-swing pose detection), Component 8 (multi-tutorial conflict), Component 10 (YouTube recommendations gated on Phase BJ QUEUE), full Haiku/Sonnet token-budget routing
- EMPIRICALLY UNVERIFIED. Specifically untested:
  - End-to-end: pick video → enter title/notes → Sonnet extracts → store entry → activate → start round → Kevin references the lesson
  - Non-instruction guard alert + "Open Cage Mode" route
  - Recap practice-connection lines after a round with active tutorials

---

## What "empirically verified" means today (the bar)

Per `docs/critical-paths.md` and `docs/audit-AX-empirical.md`: real device (Galaxy Z Fold), real round (not simulated), within last 7 days. Code-level checks (tsc/lint) are explicitly insufficient — last round was the falsification of "code-level shipped = works."

That bar has not moved during today's session. Every phase shipped today is sitting at "code-level shipped, empirical-pending." The U1 + BQ work specifically lit up empirical-pending more visibly because their value is conditional on what failure mode Tim actually sees on next test.

---

## What's needed to flip to VERIFIED for each phase

| Phase | Verification action |
|---|---|
| BA-FOUNDATION (Y.2 + AL + AH) | Run AX-23 / AX-81 / AX-84 / AX-88 / AX-91 from `audit-AX-empirical.md` on Z Fold |
| BL | Mixed-club cage session: photo path × 1 club, voice path × 1 club, manual path × 1 club, confirm `clubSegments` populates in store |
| BN | Settings → Voice → Serena → cycle through Caddie home + paywall + briefing + greeting; confirm each surface shows Serena portrait |
| BQ | adb logcat with `grep -E "upload:\|V6-DIAG"` while uploading a video; capture full trace; identify last marker before any stop |
| U1 | After BQ trace, force a no_frames or no_network case; confirm tentative-fallback fires and renders with "Tentative read" prefix |
| U2 | Cold-start + Caddie home render check on Fold open + closed (low priority — dead code removed only, no rendering change expected) |
| BR | Add tutorial → activate → start round → ask Kevin a wedge question (with active wedge tutorial) → confirm Kevin's response references the practice cue |
| BR Component 9 | After above round → end → recap → confirm overall_summary references practice connection (or honestly calls out drift) |
| BR Component 11 | Add tutorial with off-topic title ("vacation video") → confirm "Doesn't look like a golf lesson" alert + Open Cage Mode option |

Total realistic empirical verification time on Z Fold: **2-4 hours of focused testing** assuming code is committed + EAS dev-client built first.
