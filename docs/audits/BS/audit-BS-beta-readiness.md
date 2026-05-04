# Phase BS — Beta Readiness Verdict

**Date:** 2026-05-04
**Reference:** `docs/audits/v1-audit-2026-05-04.md` (pre-session v1 audit), `docs/v1-scope-final.md` (Phase BM canonical scope)

---

## Internal beta (Tim only)

**Status: NOT YET → flips to GO once today's work commits + EAS dev-client builds + Tim does ~1 hour of Z Fold testing on the foundation paths.**

**Blockers:**
1. **Nothing committed today** — see `audit-BS-commits.md`. Internal beta means Tim runs the *current* code on his Z Fold; today's local diff isn't accessible to a fresh build.
2. **Foundation paths (Path 2 ROUND, Path 3 CAGE, Path 4 VOICE) never empirically verified** — pre-session reality, unchanged today. Internal beta gating per `docs/critical-paths.md:228-230` requires real-device verification within 7 days.
3. **Sentry DSN unset** — crash data goes to /dev/null. Per `docs/v1-scope-final.md` §E, "ship as-is for internal beta" is the active call. Acceptable for Tim-only.

**What unblocks internal beta GO:**
1. Commit today's work (single bundled commit or per-phase — Tim's call)
2. Push to `origin/main`
3. Trigger EAS Android dev-client build
4. Install on Z Fold
5. Run abbreviated MIN VERIFY: Path 2 (15 min on home course), Path 3 (10 min cage), Path 4 (5 min voice exchanges)
6. If all three hold → internal beta GO

Estimated calendar time from "now" to internal beta GO: **~24-48 hours** if Tim has device-test time tomorrow. Less if EAS build is fast.

---

## External beta (recruited testers)

**Status: NOT YET → realistic distance ~2-4 weeks.**

**Blockers (in dependency order):**
1. **Internal beta verified** (per above; ~24-48 hr).
2. **Path 1 ONBOARD verified** — fresh-install MIN VERIFY (10-15 min) on at least one device. Today's session didn't touch onboarding so risk profile is the same as pre-session.
3. **Privacy policy hosted at a public URL** — `docs/privacy-policy.md` drafted today (BM); hosting + legal review is Tim's. Required by App Store Connect and Play Console listings even for invite-only TestFlight.
4. **Subscription billing decision + implementation** — Stripe (Wrap 2B) is DEFERRED. External beta needs either:
   - Functional subscription path (Apple IAP / RevenueCat / web checkout — architectural decision still open per `docs/v1-scope-final.md` §F.1), OR
   - Explicit "free during external beta, billing comes later" disclosure in onboarding + privacy policy.
   - The "free during beta" path is the lighter-weight unblock.
5. **Sentry DSN configured** — recommended before external beta so crash + breadcrumb data flows. ~30 min once DSN is in hand.
6. **App Store Connect / Play Console** — bundle IDs (`com.smartplaycaddie.app`) reserved or registered. Tim's manual check per BM Component 2 still pending.
7. **AV scenario verification** — `docs/audit-AX-empirical.md` defines 142 numbered scenarios. External beta gate per critical-paths.md is "all four critical paths verified end-to-end on a real device within the last 7 days." Tim runs.
8. **Tutorial / BL / U1 / BR empirical verification** — code shipped today; if any major flow turns out to be broken on Z Fold, fix-cycle adds time.

**Estimated calendar:** if internal beta verifies cleanly tomorrow, the long pole is privacy policy hosting + AX scenarios + the billing-pattern decision. **2-4 weeks** is honest given the dependencies, though the codebase is largely ready.

---

## Public launch

**Status: ~6-12 weeks out, blocked on multiple non-code items.**

**Blockers (in addition to all external-beta blockers):**
1. **Subscription billing live and tested end-to-end** — not just functional but with real test purchases verified.
2. **Privacy attorney review** — `docs/privacy-policy.md` is a template-adapted draft sized for internal beta. Public launch needs lawyer-reviewed final policy.
3. **App Store Connect approved app review** — typically 1-3 weeks Apple review + revisions cycle.
4. **Google Play approved internal track → production track** — typically 1-2 weeks.
5. **Debug routes hidden in production build** — 11 debug-named routes are reachable via deep link today (`docs/v1-scope-final.md` §D). Should be `__DEV__`-gated before public launch.
6. **D-U-N-S processing for Apple Developer organization** — 2-4 weeks per BS prompt's external-deps note.
7. **YouTube SwingLab links policy review** — current implementation opens external `youtube.com` URLs; if SmartPlay markets itself as a comprehensive caddie, external links to non-affiliated content needs review.
8. **Production performance under realistic load** — TTS round-trip, Sonnet vision latency on 4G, GPS battery profile during 4-hour rounds. Mostly empirical and largely covered by external beta.

**Realistic public launch timeline: 6-12 weeks** depending on app-store review queue, billing implementation pattern selection (RevenueCat shaves time vs custom), and how clean external beta runs.

---

## What this audit didn't (and can't) tell you

- **Whether Sonnet's tutorial extraction produces useful teaching context on real videos** — empirical only; needs Tim to upload a real coaching video and assess.
- **Whether Kevin's caddie advice meaningfully reflects active practice context** — empirical only; needs an active tutorial + a relevant on-course shot.
- **Whether the U1 heuristic-fallback fires on the actual upload-failure mode Tim sees** — `[upload:*]` markers will reveal which path fires, but only on a real upload attempt with adb logcat capturing.
- **Whether GPS yardages and SmartFinder updates hold through a real 18-hole round** — same status as pre-session.

The bar `docs/critical-paths.md` set ("real device, real round, last 7 days") was load-bearing for a reason: code-correctness is necessary but not sufficient.

---

## Compact verdict table

| Beta level | Status | Key unblock | Realistic distance |
|---|---|---|---|
| Internal beta (Tim) | NOT YET | Commit + EAS build + 1 hr device test | 24-48 hr |
| External beta | NOT YET | Privacy policy hosting + Path 1-4 verified + billing decision | 2-4 weeks |
| Public launch | NOT YET | All external-beta blockers + Stripe live + privacy attorney + store review | 6-12 weeks |
