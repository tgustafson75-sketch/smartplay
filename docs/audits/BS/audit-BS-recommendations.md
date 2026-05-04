# Phase BS — Recommended Next Moves

**Date:** 2026-05-04
**Synthesis of:** all 9 prior BS audit docs

---

## The single most important next move

**Commit and push today's work, then build EAS dev-client.**

Until that happens, nothing else in the queue produces value. Today's session output is a 1,478+ line local diff that doesn't exist anywhere else. Every minute that passes increases the risk of losing it without insuring against accident.

This recommendation is not optional. It is the binary gate.

---

## Recommended sequence (next 24-48 hours)

### Step 1 — Commit (5-20 minutes)

**Two viable commit strategies:**

**Strategy A — single bundled commit** (5 min):
```
git add .
git commit -m "Session 2026-05-04 — multi-phase bundle: BM/BJ/BI/U2/BN/BL/BQ/U1/BR

Phases shipped:
- BM: v1 audit, scope-final, YouTube hardening, privacy policy draft
- BJ: capability research (11 docs, 2 BUILD-TODAY candidates)
- BI: legacy review, migration gap analysis, club-detection capture
- U2: avatar dual-import cleanup (-2 lint warnings)
- BN: Serena portrait swap (3 surfaces) + emotion-keyed map
- BL: auto club recognition (3-tier triggers, vision OCR)
- BQ: upload pipeline diagnostic instrumentation
- U1: pose detection timeout + heuristic fallback
- BR: tutorial analysis foundation + recap reinforcement + non-instruction guard

tsc 0 errors. Lint 1 err + 6 warn (-2 vs baseline). No native modules added.
Empirical verification gated; see docs/audits/BS/."
```

**Strategy B — per-phase commits in dependency order** (15-20 min):
Commit BM (audit + docs first), then BJ, BI, U2, BN, BL, BQ, U1, BR sequentially. Cleaner history; each commit message references the relevant phase architecture doc. Cost: 10-15 minutes of `git add -p` style staging and message drafting.

**Recommend Strategy A for speed unless the granular history matters for code review later.** Tim's call.

### Step 2 — Push to origin/main (1 minute)

```
git push origin main
```

**Will require explicit go from Tim** per session-rule. I will not push without confirmation.

### Step 3 — EAS dev-client build (depends on EAS queue)

```
eas build --profile development --platform android --non-interactive
```

EAS queue time varies; usually 5-25 minutes. Output is an APK Tim installs on the Z Fold.

**Faster alternative if no native modules added:** Tim's existing dev-client binary on Z Fold may pick up today's JS changes via the running Metro tunnel (`https://xokzixe-anonymous-8082.exp.direct`). Today's changes are all JS / TS / asset / docs — **no native modules added** (verified per `audit-BS-health.md`). So a Metro reload should suffice. The tunnel URL pasted into Tim's dev-client's "Enter URL manually" gets him the new code in seconds.

### Step 4 — Empirical verification (~1-2 hours focused)

Per `audit-BS-critical-paths.md` "What flips Paths to VERIFIED" — abbreviated 1-hour pass:

1. **Path 4 VOICE** (10 min): cold-start app, tap Kevin badge / earbud, ask a tactical question. Confirm response.
2. **Path 3 CAGE** (20 min): start cage session, take ID-club photo (BL test), record one swing, end session, view summary.
3. **Path 2 ROUND** (15 min): start a round on home course, watch SmartFinder + SmartVision update with movement, tap Mark, walk to next hole, confirm hole transition.
4. **BR end-to-end** (15 min): add a tutorial → activate → start a round → ask Kevin a question on the practiced club → confirm response references the practice cue → end round → check recap.
5. **BR negative test** (5 min): add tutorial with off-topic title → confirm "Doesn't look like a golf lesson" alert.
6. **Upload trace** (5 min): with adb logcat capturing `[upload:*]` markers, attempt an upload that's previously failed; capture trace.

**adb logcat command:**
```
adb logcat -c
adb logcat -s ReactNativeJS:I | grep -E "upload:|V6-DIAG|path[1-4]:|audit:"
```

### Step 5 — Triage based on findings

**If everything verifies:**
- Internal beta GO.
- Move to SHORT TERM queue: BO haptic notifications + BP TTS sentence pipeline + BR2 audio transcription + Component 7 token-budget routing + BA-BC voice register differentiation.

**If something fails:**
- The trace tells you which stage. Fix scoped to that stage. Do not paint over with another phase prompt. Per BQ Component 5: "single targeted fix at root cause."
- Resist the urge to start a new phase. Honor the "diagnose first" pattern.

---

## What NOT to do next

### Do not start any new SHORT TERM phase before empirical verification

Building BO / BP / BR2 / BA-BC on top of a foundation that hasn't been verified empirically is exactly the stacked-uncertainty pattern that's left today's session at 0/4 critical paths verified. Code-correct does not mean working.

### Do not paste-storm more comprehensive phase prompts at the model

Today's session had 8+ comprehensive phase prompts paste-stormed in. Three of them (BL, BR, BA-FOUNDATION) had stale-legacy-premise issues that consumed time to surface. A leaner per-prompt ratio (one phase at a time, with empirical verification between) would have shipped less code total but with more confidence per shipment.

### Do not push commit + EAS build without verifying the tunnel works first

The fastest path to verifying today's output is the Metro tunnel — no EAS build cycle needed. Test that path first; if it works, full EAS build is a backup.

### Do not skip the BQ empirical capture

Even if upload analysis "seems to work" on the first test, capture the `[upload:*]` trace once. The marker structure is built specifically so failure-mode triage doesn't require speculative debug-fix cycles. Use it at least once.

---

## Confidence calibration

Where the audit sits on different dimensions:

| Dimension | Audit confidence | Why |
|---|---|---|
| What code shipped today | **High** | Direct file inspection + git status |
| What's NOT committed | **High** | git log empirical |
| tsc / lint health | **High** | Just ran it |
| Critical path empirical state | **High** | Pre-existing record of 0/4 verified |
| Persona verdicts | **Medium** | Code-shape-based; assumes empirical holds |
| Beta-readiness timeline | **Medium-Low** | Realistic but depends on D-U-N-S, app-review queues, and billing decision pace |
| Risk surfaces | **Medium** | Comprehensive but speculative on which ones actually fire |
| Phase queue ordering | **Medium** | Dependency-correct but priorities depend on what empirical shows |

The high-confidence findings drive the recommendations above. The medium-confidence ones depend on Tim's empirical pass to firm up.

---

## Closing

Today's session output is real and substantial. It's also fragile and unverified. The single recommended action — commit + push + verify — turns it from fragile to load-bearing. Without that, today's work is best characterized as "promising prototype on a developer's laptop."

The tools to do this verification (Metro tunnel, EAS, adb logcat with structured markers) are in place. The bottleneck is on-device test time, not code.
