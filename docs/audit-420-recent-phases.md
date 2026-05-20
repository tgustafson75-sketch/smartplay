# Phase 420 Audit: Recent phase landings (Phase 410 → Phase 418)

**Audit date:** 2026-05-20
**Scope:** every named phase commit between 2026-05-16 and 2026-05-20 plus
the un-numbered work that filled the gaps. Investigation only — no fixes.
**Methodology:** `git log --oneline -200`, `git show --stat <sha>` for
each named phase commit, cross-referenced against the surviving file
layout (`app/`, `store/`, `services/`).

## Status legend

- **COHERENT** — landed in one focused commit, no later revert
- **SCATTERED** — multiple follow-up commits in the same phase number
- **HALF-APPLIED** — landed then reverted, or kept references to removed code
- **CONTRADICTED** — superseded by a later phase that didn't clean up the previous one
- **OK** — verified on Z Fold per Tim's commit message
- **GIT-ONLY** — verified by diff inspection only, no device run

---

## Phase 410 — Profile/login hardening (`ff2f8e7`, 2026-05-16)

**Landing health:** COHERENT primary commit, HALF-APPLIED sibling.

- The primary Phase 410 commit `ff2f8e7` ("user profile storage + login audit") landed clean: 8 files, 541 insertions. New `app/welcome.tsx`, gate in `app/index.tsx`, three Settings additions, Sentry breadcrumb in `playerProfileStore.ts:226-255`, and two audit docs (`docs/audit-410-auth-state.md` + `docs/audit-410-profile-state.md`).
- Phase 410B (Supabase + Google auth scaffold, `148ea2e`) landed an hour later — 1,037 insertions across `lib/supabase.ts`, `lib/googleAuth.ts`, `store/authStore.ts`, `services/profileSync.ts`, replaced `app/auth.tsx` stub, added 4 dependencies — then was reverted 1h later in `d5cf1df`. Clean revert (–1,037 insertions, –12 files), but **the original Phase 410 commit message advertises 410B as "deferred 3-5 sessions" and the audit-410-auth-state.md still talks as if real auth is the planned successor**. After the 410B revert, that audit doc became slightly stale (no scaffold actually landed).
- Side-effects of the revert: `app/auth.tsx` no longer exists in the tree, and `app/_layout.tsx:586-590` carries a comment "intro / auth / hole-view-3d / smartfinder-camera / onboarding stack screens removed alongside their .tsx files." So the auth-screen registration was removed properly. No orphan references.
- Verified on device: the commit message says "Pre-tester checklist at docs/audit-410-pre-tester-checklist.md walks the 6 empirical scenarios to verify on the Z Fold before sending" — verification was a checklist, not an empirical confirmation in the commit message.

**Verdict:** COHERENT for the profile work, HALF-APPLIED for the auth scaffold (built, reverted, no replacement landed). No dead code in the tree because the revert was clean.

---

## "Phase 415" — there is no Phase 415

**Landing health:** SCATTERED (no umbrella commit).

No commit on `main` mentions "Phase 415." The body of work Tim is likely
remembering as Phase 415 is the **synthetic-round / GPS harness era**,
which spans ~38 commits between `40b7cd8` (2026-05-18) and `41d19f1`
(2026-05-19) — three days, never named as a single phase. Highlights:

- `40932d2` Synthetic round harness: mock GPS JSON + dev replay + validator
- `911dbb2` Synthetic round harness: actually drive the round, not just GPS
- `58b7a46` Synthetic round: bypass startRound cascade + surface errors
- `3bbb067` Synthetic round: randomized per-hole scoring
- `ab83de5` Settings card-style headers + Menifee Palms harness
- `8dd078f` Menifee Palms harness: extend mock to full 18 holes
- `45a8cee` Harness: slow pace + SmartVision player cart marker
- `30106e7` Harness: bypass holeDetection for synthetic transitions + cart icon
- `474ce00` Harness: live event log in telemetry panel
- `834b00f` Harness: synthesize realistic shot trace per hole
- `1024770` Harness: progressive shot logging so STROKE counter ticks mid-hole
- `6df574e` Harness: Export Report button (JSON via native share sheet)
- `25eceb0` GPS Audit v2: Comprehensive auto-running harness scenarios
- `73b2f95` Phase AU.1 — Comprehensive GPS Test Harness v2 (12 scenarios, JSON export)
- `99041e7` Harness: in-app bundle SHA badge to kill stale-bundle confusion
- `8f8add2` GPS Test Bench: live GPS subscription + sim stall watchdog

The single largest landing was `73b2f95` — added `services/audit/types.ts`, `services/audit/probes.ts`, `services/audit/noiseInjector.ts`, `services/audit/scenarios.ts`, `services/audit/scenarioRunner.ts`, plus extensions to `services/simulatedGPS.ts`, `services/positionMarkBus.ts`, and `app/gps-test.tsx`. This was tagged "Phase AU.1" — orthogonal to the 4xx phase series.

**Half-applied / contradictions:**

- `30106e7` "bypass holeDetection for synthetic transitions" added a code path that *intentionally* short-circuits production logic — useful for the harness, but the bypass code lives in production files (not gated to a dev-only flag in every spot). Worth a separate audit pass to confirm.
- `30afb92` "Revert SCORE swap on data strip; keep STROKE always" reverts an earlier strip change from `5c36f94`. Within the same harness window.
- `ba1103c` "Defensive: stop passing totalScore/scoreVsPar to CaddieDataStrip" — small follow-up, indicates the prior commit `5c36f94` was incomplete.
- `8692eba` fixes hardcoded bundle SHA in `gps-test.tsx` that had been hardcoded the same day in `1024770` — same-day re-fix.
- `21accea` "Audit export: write to file + share URI" fixes a regression in `73b2f95` that landed earlier the same day (Android share intent silently dropped MB-scale reports).

**Verdict:** SCATTERED. The synthetic-round / harness work was 3 days of iterative landings, each fixing the previous one's surface bugs. Three same-day re-fixes (audit export, bundle SHA, score-strip swap). No single "Phase 415" commit; no umbrella audit doc beyond what `73b2f95` itself documents. Production-code bypass paths from `30106e7` need a separate review.

---

## Phase 416 — SmartMotion two-card system (`2a30736`, 2026-05-19)

**Landing health:** SCATTERED across 3 named commits + 1 cleanup.

The Phase 416 work shipped in pieces over two days:

- `2a30736` Phase 416 — SmartMotion two-card system (827 insertions, +`app/swinglab/smartmotion.tsx`, +`app/(tabs)/swinglab.tsx` route swap)
- `77014bb` SmartMotion cleanup: direct camera, overlay toggles, integrated record (+`app/swinglab/quick-record.tsx`, refactored smartmotion.tsx down to "tabs → overlay toggles"). 384 lines of smartmotion.tsx rewritten the morning after the initial Phase 416 commit, per Tim's verbatim feedback: "the record is not all the way down at the bottom... Shot Tracer and Body Mechanics are integrated within SmartMotion... Logic is broken — Record takes you to the old SmartMotion interface and doesn't open the camera... should be intuitive and quick load."
- `a63d1b3` "Tools FAB: small right-side icon expands left + persona-aware Kevin TTS" — fixes the "fucking giant ass button" from `41d19f1`, plus a major bug fix in `/api/kevin` TTS where every persona was speaking in Kevin's voice (Serena → Kevin voice regression that had been live since persona widening). `api/kevin.ts` +77 lines.

**Dead code introduced:**

- **`app/smartmotion-quick.tsx` is now ORPHAN-ADJACENT.** Phase 416 routed SwingLab's SmartMotion card to `/swinglab/smartmotion` (the new two-card UI), but the *voice intent handler* and the *Tools menu* still navigate to the old `/smartmotion-quick`:
  - `services/intents/openToolHandler.ts:28-29` — `smartmotion`/`smart_motion` → `/smartmotion-quick`
  - `components/tools/GlobalToolsMenu.tsx:325` — navigates to `/smartmotion-quick`
  - `app/swinglab/library.tsx:256` — Library "open swing in SmartMotion" button → `/smartmotion-quick`
  - `app/_layout.tsx:712` — Stack.Screen registration still present
  - `app/(tabs)/caddie.tsx:2490` — Caddie tab routes to `/swinglab/smartmotion` (the NEW path)
  
  So the new Phase 416 UI is reachable from SwingLab tile + Caddie Tools FAB, but the **voice intent "open SmartMotion" + Global Tools menu + Library shortcut still go to the OLD 1,127-line `app/smartmotion-quick.tsx`**. Two parallel SmartMotion experiences live in the tree. The old one is NOT dead code — it is actively reachable — but it was implicitly superseded by Phase 416 with no migration cleanup.

- The Phase 416 commit message itself notes: "Body Mechanics tab: lightweight today; full spine/turn/X-factor graphs land with on-device pose detection. Shot Tracer tab: scaffolded with copy explaining future state." This is OK self-documented (seams, not regressions), but the `services/poseInference.ts` referenced in the commit message is scaffolded-only.

**Contradictions across Phase 416 follow-ups:**

- `2a30736` shipped THREE tabs (SmartMotion / Shot Tracer / Body Mechanics).
- `77014bb` immediately removed the tabs and replaced them with overlay toggles (Body Mechanics + Shot Tracer + Grid composite on the same video).
- The Phase 416 commit message even references a "next iteration target" with "4 tabs (Smart Motion / Shot Tracer / Body Mechanics / History)" — the OPPOSITE direction from where `77014bb` took it 8 hours later. The header comment in `app/swinglab/smartmotion.tsx:2-21` still describes the two-card design without acknowledging that the tabs were removed within a day.

**Verified on device:** Git-only. None of the Phase 416 / 77014bb / a63d1b3 commit messages mention Z Fold confirmation.

**Verdict:** SCATTERED + dead-code-adjacent. Phase 416 landed, then was substantially reshaped within hours, with the old code path (`app/smartmotion-quick.tsx`) left fully reachable from three surfaces. The header doc inside `app/swinglab/smartmotion.tsx` is now stale relative to the actual UI.

---

## "Phase 417" — there is no Phase 417

**Landing health:** N/A.

No commit references Phase 417. The number was skipped. The work between Phase 416 (`2a30736`) and Phase 418 (`3cf8d11`) is the `77014bb` SmartMotion cleanup and `a63d1b3` Tools FAB / persona TTS fix, both of which are part of the Phase 416 phase-batch above.

---

## Phase 418 — SmartMotion validation gate (`3cf8d11`, 2026-05-20)

**Landing health:** COHERENT primary commit + 1 trivial bundle bump.

- `3cf8d11` landed clean. 5 files, 333 insertions, 57 deletions. Added `services/swingValidity.ts` (67 lines, single source of truth for "is this an analyzable swing"), wired `api/swing-analysis.ts` to emit `valid_swing` + `validity_reason` (37 insertions), gated three consumers in `app/swinglab/smartmotion.tsx` (240 lines reshape: pose skeleton overlay, shot tracer overlay, metrics strip, Insight card, "No swing detected" badge), and added a pre-record framing guide in `app/swinglab/quick-record.tsx`.
- `e872f9b` ("Bump bundle hash to bypass stuck EAS asset processor") is purely a build-pipeline noop — adds 2 comment lines to `services/swingValidity.ts:1-2`. Not a logic change.

**Bug being fixed:** the Phase 418 commit explicitly addresses a prior coherence failure from Phase 416 — pose skeleton, metrics strip, and Insight card "each made their own (contradictory) call about whether a swing was present." The unified gate is the structural fix.

**Half-applied? No, but:**

- `services/swingValidity.ts:51-56` reads `analysis.valid_swing` ONLY when `typeof analysis.valid_swing === 'boolean'`. Falls back to a phrase heuristic on `analysis.observation` (lines 58-63). The phrase list in `NO_SWING_PHRASES` (lines 20-40) is reasonable but not exhaustive — anything Claude phrases creatively (e.g. "I can't tell what's happening here") will incorrectly pass the gate as `valid: true`. This is documented in the file as a fallback for legacy cached responses, but the heuristic is a known weak surface.
- `services/poseDetection.ts` got +8 lines (presumably to expose `valid_swing` + `validity_reason` on `SwingAnalysis`). Not yet inspected for completeness.
- The "Pre-record framing guide" in `quick-record.tsx` is a visual hint only — does NOT enforce framing. If the user records the floor again, the gate (not the guide) catches it.

**Verified on device:** Git-only per the commit message. The next bundle hash bump (`e872f9b`) was for EAS asset processor unsticking, not a verified-on-device flag.

**Verdict:** COHERENT. Best-landed phase in this window. Single focused commit, clear root cause analysis in the commit message, single source of truth in one file, three consumer call sites updated. Reasonable concern: the phrase-list fallback is fragile if/when the API returns ambiguous prose without the structured `valid_swing` field.

---

## "Phase 419" — there is no Phase 419

**Landing health:** N/A.

No commit message anywhere in `git log --all` references Phase 419. The phase number was skipped between 418 and Tim's current 420 audit ask. The only commit between `3cf8d11` (Phase 418) and HEAD is `e872f9b` (bundle hash bump), which is a build-pipeline noop, not a phase.

If Tim was thinking of "the last commit before Phase 418," that is `a63d1b3` (Tools FAB + persona TTS fix) — covered under the Phase 416 section above.

---

## Summary: phase landing health

| Phase | Status | Commits | Verified on device | Notes |
|---|---|---|---|---|
| 410 | COHERENT (primary) + HALF-APPLIED (auth scaffold) | 2 (one reverted) | Checklist only | 410B Supabase scaffold landed then reverted same day; no replacement |
| 415 | SCATTERED (does not exist as named phase) | ~38 over 3 days | Git-only | "Synthetic round / GPS harness era"; 3 same-day re-fixes; harness bypass code lives in production files |
| 416 | SCATTERED + dead-code-adjacent | 3 named + cleanups | Git-only | Tabs → overlay toggles within 8 hours; old `app/smartmotion-quick.tsx` still reachable from voice intent, Tools menu, and Library |
| 417 | Does not exist | 0 | N/A | Number skipped |
| 418 | COHERENT | 1 + 1 bundle bump | Git-only | Cleanest landing in this window; phrase-heuristic fallback is the only soft edge |
| 419 | Does not exist | 0 | N/A | Number skipped |

**Counts:**
- Coherent: **2** (Phase 410 primary, Phase 418)
- Scattered: **2** (Phase 415-era harness, Phase 416)
- Half-applied: **1** (Phase 410B auth scaffold — fully reverted, so no remaining file pollution, but the audit-410-auth-state.md doc is now stale)
- Empirically device-verified in commit messages: **0** of the named phases. Every phase ships with "git diff verified" tone only.

## Cross-phase artifacts that need a separate cleanup pass

1. **`app/smartmotion-quick.tsx` (1,127 lines)** — superseded by Phase 416's `app/swinglab/smartmotion.tsx`, but still reachable from:
   - `services/intents/openToolHandler.ts:28-29`
   - `components/tools/GlobalToolsMenu.tsx:325`
   - `app/swinglab/library.tsx:256`
   - `app/_layout.tsx:712`
   Either delete it and reroute the three callers to `/swinglab/smartmotion`, or formally split the two surfaces with different semantics. Right now the user gets a different UI depending on whether they tap the SwingLab tile or speak "open SmartMotion."

2. **`docs/audit-410-auth-state.md`** still references Phase 410B as the "deferred 3-5 session" successor. Phase 410B landed and was reverted. The doc has not been re-stamped to reflect that real auth is now indefinitely deferred (or that the next attempt should start from scratch, not from the reverted scaffold).

3. **`services/poseInference.ts`** is referenced by `app/swinglab/smartmotion.tsx:17-19` as "scaffolded but unwired — MoveNet integration ships with the next APK build." Confirm whether the file actually exists and is dormant, or if the reference is a future-tense stub.

4. **Harness bypass code in production paths** — `30106e7` "Harness: bypass holeDetection for synthetic transitions + cart icon" added `isHarness` / `isProbeActive` branches to non-debug files. Worth a sweep to confirm all bypass branches are dev-only.

**Audit owner:** Phase 420
**Date:** 2026-05-20
