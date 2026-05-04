# Phase BS — Risks and Unknowns

**Date:** 2026-05-04

---

## Known risks

### R1 — Foundation never empirically verified

Phase AC + AL + AH + Y.2 shipped commits weeks ago. Nobody has run a full round on Galaxy Z Fold to confirm any of: earbud tap (or its on-screen fallback) actually engages Kevin reliably, Mark propagation hits all 4+ subscribers, SmartFinder yardages update on movement, hole transitions fire on sustained position. Pre-session reality. Today did not move this needle.

**Impact:** if foundation is broken on real device, every persona AT RISK verdict in `audit-BS-personas.md` collapses to BROKEN regardless of today's tutorial / club / heuristic-fallback shipments.

**Mitigation:** ~1 hr Z Fold testing on home course covers it.

---

### R2 — Today's work is uncommitted

Single biggest risk vs the assumption that "today's session shipped X." The work exists only as local diff on this MacBook. **A laptop crash, a dirty checkout, a misfired `git checkout .` — and today's 1,478+ insertions are gone.** Tim's other machines / EAS builds / external testers cannot see any of it.

**Impact:** session output is fragile. Every hour that passes without a commit is an hour of uninsured work.

**Mitigation:** commit. Single bundled commit takes 5 minutes. Per-phase commits take 15-20 minutes.

---

### R3 — BR Sonnet extraction quality unknown

The whole tutorial-analysis premise rests on: when Tim types "Marc — shallow attack on wedges, club stays low through impact, weight forward" + an optional frame, Sonnet produces a teaching summary that materially helps Kevin's caddie advice during rounds. **There is zero empirical evidence this is true today.** The prompt is reasonable; the integration is sound; but the *value* is conditional on Sonnet's actual extraction quality on real notes.

**Impact:** Marcus's READY-conditional verdict in `audit-BS-personas.md` could collapse if extraction is too generic (e.g., "improve your wedge play" instead of "feel the club staying on the ground longer through impact").

**Mitigation:** empirical test with a real coaching video Tim can describe in detail. Iterate on the system prompt if first-pass output is weak.

---

### R4 — U1 heuristic fallback never fires (or always fires incorrectly)

U1's heuristic-fallback path triggers ONLY on the zero-results branch (every primary swing returned no_frames / no_network / error / detected_issue=none). **If the actual upload-failure mode Tim sees on Z Fold isn't this branch, U1 doesn't fire.** Possible alternative failure modes:
- `setSessionAnalysisStatus('failed')` not propagating to UI subscriber
- Exception thrown after analyzeSwing returns ok but during classifySession
- Render-time gate hiding cards despite analysis_status===ok
- Pre-V.6 frame-extraction issue that returns no_frames consistently

The `[upload:*]` markers from BQ Component 2 will tell us which.

**Impact:** if BQ trace shows the failure point is downstream of where U1 hooks in, we ship more code and Tim still sees "couldn't analyze."

**Mitigation:** empirical capture per `docs/upload-pipeline-map.md` happy-path-vs-failure-signature table. The trace is structured for exactly this triage.

---

### R5 — Earbud tap behavior on Galaxy Buds remains untested

Phase AC honest-disable shipped pre-session — toggle hidden, "Coming soon" copy. On-screen tap is the working fallback. **But discoverability** of the on-screen tap is itself an unverified UX risk — a Dave-shaped user expecting earbud-first interaction may give up before finding the tap target.

**Impact:** Dave persona AT RISK regardless of any other work.

**Mitigation:** quick discoverability test on Z Fold — does the on-screen Kevin badge / dropdown mic icon read as "tap to talk" without tutorial? Empirical.

---

### R6 — Vercel + Anthropic + OpenAI cost exposure on bad uploads

Each tutorial-analysis call is ~$0.005-0.02 in Anthropic tokens. Each swing-analysis call is similar. Each tentative-fallback adds another ~$0.005. **A user with a flaky network who retries uploads 5x in a row could burn through $0.10 worth of API calls without producing useful output.** Currently no rate-limiting / backoff in the client.

**Impact:** modest in beta; significant if a public-launch user has a misconfigured network.

**Mitigation:** post-empirical, add client-side backoff if `kind: 'no_network'` outcome repeats within 60s. Not urgent.

---

## Unknowns

### U1 — Does Sonnet's `mode: 'tentative'` produce useful observations?

The relaxed prompt is plausible but unmeasured. Sonnet might still hallucinate specifics, or might produce trivia-level "your tempo looks smooth" observations that don't help. Empirical test required.

### U2 — Does the practice_context block change Kevin's responses perceptibly?

Injection is in place (Sonnet system prompt). But Kevin's responses are influenced by *many* prompt components (player profile, recent shots, weather, course context, etc.). The practice_context could be drowned out by other context.

### U3 — Does Mark propagation actually reach SmartFinder + SmartVision + holeDetection + lieAnalysisContext + shotTracking + weatherService?

Pre-session reality — never empirically traced through all subscribers. Phase AL pub/sub is structurally correct but the propagation completeness is unverified.

### U4 — Does the BL three-tier UX feel right under cage conditions?

Specifically: is the "ID club" button at the right spot in the cage session header? Is the photo capture flow fast enough to not break swing tempo? Is the medium-confidence "Looks like X — confirm?" prompt the right friction level vs auto-registering at high?

### U5 — Does the U2 dual-import removal actually fix anything user-visible?

The lint warning went away (good). Whether the orphaned `KevinAvatar` import was contributing to any *runtime* issue (rendering glitch, state inconsistency) was the original BI URGENT-2 framing. The audit confirmed it was dead code only — no JSX render — so the answer is probably "no user-visible change." But **no on-device confirmation.**

### U6 — How does Tim's adb logcat experience actually look?

The `[upload:*]` and `[V6-DIAG]` and `[path*]` markers all assume Tim has adb logcat running with `grep`. If his Mac doesn't have adb installed, or USB debugging isn't enabled, or the device shows a permission prompt that he hasn't approved, the entire diagnostic story collapses.

### U7 — Does the redirected SwingLab "Add Tutorial" entry confuse pre-existing users?

For users (well — Tim) who had been uploading swing videos to the legacy biomech path: with BR Component 14 redirecting that entry to tutorial flow, what happens when they tap "Add Tutorial" expecting their old upload? They get a tutorial-shaped UI with title/notes fields instead of the metadata-and-club picker. Confusing? Documented as the right architectural call (different products), but UX impact unmeasured.

---

## External dependencies not yet resolved

These are organizational / 3rd-party items that gate beta progression independent of code:

- **D-U-N-S processing** for Apple Developer organization — 2-4 weeks per BS prompt note.
- **Apple Developer organization registration** — gated on D-U-N-S.
- **Privacy policy hosting** at a public URL (`smartplaycaddie.com/privacy` or equivalent). Tim owns.
- **Privacy attorney review** of the policy before public launch.
- **App Store Connect** registration with bundle ID `com.smartplaycaddie.app`.
- **Google Play Console** registration with package `com.smartplaycaddie.app`.
- **Stripe / RevenueCat / Apple IAP** account setup + product configuration — gated on the architectural decision still open.
- **Sentry production setup** — Tim mentioned "Wednesday MacBook scheduled" earlier; status unknown.
- **Mapbox EXPO_PUBLIC_MAPBOX_TOKEN** — value is in `.env.local` from earlier this session; state on EAS env is per `vercel env` (unsensitive flag still pending).
- **GolfCourseAPI key** — server-side `GOLFCOURSE_API_KEY` is sensitive-flagged in Vercel; value retrievable only at create time.

---

## What I would change about today's process

(Not strictly part of the audit; included because it's load-bearing for risk management.)

1. **Commit per-phase as we ship.** Today's "no commits without explicit go" was conservative; in practice it's left 1,478+ insertions uninsured. A per-phase auto-commit policy (with `--no-verify` skipped) would have produced 8-10 commits today, with an explicit push gate at the end.
2. **Empirical-test gating.** I'd defer Phase BR's foundation slice until the BQ trace landed first. We shipped BR atop unverified U1 atop unverified BQ instrumentation atop unverified BL atop unverified BN atop unverified U2 atop unverified BM. Stacked uncertainty.
3. **Phase-prompt verification protocol.** Three of today's prompts (BL, BR, BA-FOUNDATION) had stale-legacy-premise issues. A pre-execution verification step ("does the legacy claim match `git show origin/master`?") would have caught these without consuming pause-and-surface back-and-forth.

These are observations for the next session. Not a deliverable today.
