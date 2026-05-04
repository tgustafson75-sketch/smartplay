# v1.0 Scope — Final (Phase BM)

**Date:** 2026-05-04
**Author:** Phase BM working session
**Inputs:** `docs/audits/v1-audit-2026-05-04.md`, in-session decisions

This document records the canonical v1.0 scope decisions from Phase BM. Any future phase that touches the items below should treat these decisions as load-bearing — change them only with an explicit phase decision, not drift.

---

## A. Critical-path blockers — disposition

| Audit blocker | Phase BM disposition |
|---|---|
| **Stripe (Wrap 2B) — NOT STARTED** | **DEFERRED.** Stripe (or its IAP-compliant equivalent — RevenueCat / Apple IAP / web checkout) does not ship in v1.0. Paywall remains a stub for internal beta. The architectural pattern decision (which iOS-compliant subscription path) is itself deferred — see "Open architectural decisions" below. |
| **Empirical verification of four critical paths** | **READY TO RUN.** Foundation batch confirmed shipped: `d836040` Phase AC, `0440cdb` Phase AL, `d004753` Phase AH. Tim runs the 142 AX scenarios (`docs/audit-AX-empirical.md`) on Galaxy Z Fold + earbuds when ready. Verification is not a code change; it gates external beta but not internal. |
| **Privacy policy URL missing** | **DRAFTED.** Template-adapted draft at `docs/privacy-policy.md`, sized for internal beta. Hosting + legal review still owned by Tim before external launch. |

---

## B. Future-feature triage

| Item | Decision | Reason |
|---|---|---|
| **Arena** (`app/arena/`, 5 routes + Stack.Screen wiring + drill-environment refs) | **KEEP — v1.0 functional scope.** Per the Play pillar in the product structure. Already wired into `app/_layout.tsx:260`, `app/(tabs)/swinglab.tsx`, and `app/(tabs)/caddie.tsx`. AX-119 through AX-125 verify the Arena flows. The v1.0 verdict is "functional, not marquee" — it ships, it works, it's not the headline. The 1.1 tier-progression and broader Arena polish can extend later. |
| **Serena voice persona** (`app/intro.tsx`, `app/settings.tsx:309,542`, `components/CaddieAvatar.tsx:44-46`) | **KEEP — intentional v1.0 scope.** Decision reversed from earlier "REMOVE" framing. Serena ships as the female-voice option of the caddie character. Underlying assets (Serena portrait variants, voice routing) are wired and functional. No further work needed for v1.0; deeper Serena-specific behavior (separate persona modeling) remains a 1.x consideration. |
| **golfcourseapi.com integration** (`services/golfCourseApi.ts`, `app/api-debug.tsx`, `app/course/[course_id].tsx`, `api/course-proxy.ts`) | **KEEP — v1.0 critical path.** Per the Play pillar foundation. This is the source of course discovery, hole geometry, tee/green coordinates that SmartFinder, SmartVision, and round-active state depend on. Removing it would break the Play tab, Course Detail, and on-course yardage. The audit's "should be absent post-brain-rewrite" framing was a mis-statement — the brain rewrite handled Kevin's response routing, not course data. |
| **YouTube SwingLab links** (`app/(tabs)/swinglab.tsx:447-451, :466-468`, `app/(tabs)/caddie.tsx:2649`) | **KEEP — hardened.** Phase BM hardening shipped: `services/youtubeLinks.ts` adds `Linking.canOpenURL` pre-flight, user-visible `Alert` on failure, and a single canonical entry point. All three call sites now go through `openYouTubeSearch` / `openYouTubeChannel`. Net lint/tsc impact: 0 regression (1 error + 8 warnings before, same after — the audit's pre-existing apostrophe error is untouched and lives in `app/diagnostic-card.tsx:157`). |
| **player_id in data models** | **KEEP AS SCAFFOLDING.** `services/cageStorage.ts:50,166`, `store/roundStore.ts:83,343,519` — data-model only, marked `// reserved for Phase 1.1 multi-player`. UI is not wired. Correct placement per the standing rule on data-model future-proofing. No action. |
| **HeyGen / LiveAvatar / Ray-Ban / smart-glasses / Google Places / Multiplayer UI** | **ABSENT — confirmed.** No UI hooks, no scaffolding leaking into v1.0. No action. |

---

## C. Hole imagery deferral

**Decision:** Phase AN (vector hole rendering, already shipped per Phase AV/AW) is the v1.0 hole-image pipeline. Phase S (full Mapbox Static Images + GeoJSON overlay pipeline) is **deferred to 1.0.1**.

**Reasoning:**
- v1.0's actual ship blockers (Stripe, privacy hosting, empirical verification) are not gated on imagery.
- The existing Phase AV satellite-tile path with GPS-coordinate-equipped Palms (Phase AW) covers the SmartVision route; bundled hole hero images cover the briefing screen.
- Adding a new imagery pipeline to v1.0 layers risk on a release whose gate is verification, not features.
- 1.0.1 is the right home: ships on a stable beta, gets its own focused verification cycle, and can swap in a custom Mapbox style created via DevKit MCP without disturbing v1.0.

**1.0.1 prerequisites (pre-staged, no action this phase):**
- Mapbox public token + DevKit secret token (Tim's preflight)
- DevKit MCP connected to Claude Code session
- `EXPO_PUBLIC_GOLFCOURSE_API_KEY` available locally and in EAS env

---

## D. Friction items (audit Phase E) — disposition

| Item | Disposition |
|---|---|
| **1 lint error** in `app/diagnostic-card.tsx:157` (apostrophe) | **DEFERRED.** Component-4 of Phase BM was reassigned to legacy-club-detection capture; friction cleanup is unowned by this phase. Triv ial to address in any subsequent phase. |
| **8 lint warnings** (mostly unused imports/vars in `app/(tabs)/caddie.tsx`) | **DEFERRED.** Same. |
| **196 console.log calls** | **KEEP for v1.0.** They're prefixed (`[smartfinder]`, `[V6-DIAG]`, `[lie-analysis]`, etc.) and serve as the de facto runtime trace while Sentry remains unconfigured. Migrate to `Sentry.addBreadcrumb()` when the DSN lands; production-strip after that. |
| **No test framework** | **DEFERRED post-beta.** v1.0 is verification-gated by the empirical AX scenarios (real device, real round) — a unit-test framework wouldn't have caught the device-level regressions the AX gates target. Adding jest + ts-jest + RTL is a clean post-beta task. |
| **11 debug routes shipped in `app/`** (api-debug, battery-debug, cage-debug, ghost-debug, kevin-learning, landmark-curate, patterns-debug, plan-debug, smartfinder-debug, subscription-debug, voice-debug) | **OPEN — flag for Tim.** They're reachable via Expo Router deep links. Recommend `__DEV__`-gating the route components or hiding their Stack.Screen entries in production. Not blocking internal beta; should resolve before external. |

---

## E. Sentry / analytics state

- `@sentry/react-native ~7.2.0` is installed and `Sentry.init` is wired in `app/_layout.tsx:59` (gated on `EXPO_PUBLIC_SENTRY_DSN`).
- `EXPO_PUBLIC_SENTRY_DSN` is unset everywhere (Vercel, eas.json, .env.local). Sentry never initializes today.
- `SENTRY_DISABLE_AUTO_UPLOAD=true` is set in all three eas.json profiles (correct while DSN is missing).
- TODO marker in `app/_layout.tsx:56` references the Wednesday MacBook setup — when DSN lands, also remove the disable-auto-upload flag.
- `services/analytics.ts` is in-house batcher with Sentry breadcrumbs as the only sink. With Sentry off, analytics is effectively off. **Decision: ship as-is for internal beta.** Add DSN before external beta.

---

## F. Open architectural decisions (deferred)

These are intentionally *not* decided in Phase BM. Each blocks a specific future phase, and each is easier to decide once internal beta data lands.

1. **Subscription billing pattern (iOS-compliant).** Apple App Store guideline 3.1.1 prohibits Stripe in-app for digital subscriptions on iOS. Choices:
   - (a) Apple IAP on iOS + Stripe on Android (two SDKs, two webhooks, two reconciliations)
   - (b) RevenueCat unifying both via native IAP (single SDK, single entitlement state — most common solo-dev choice)
   - (c) Web-only checkout + app reads entitlement (Netflix / Spotify pattern)
   - **Defer until:** Tim's call. Phase BM-Stripe is parked behind this gate.

2. **Cloud sync.** Currently zero. Profile, rounds, practice all live on-device only. Tradeoffs vary widely (Supabase, Firebase, custom Vercel + Postgres, etc.). **Defer until:** post-beta usage data informs the urgency.

3. **Native Bluetooth media-key listener (Phase AC continuation).** The current AC-shipped state is "honest disable" — toggle is hidden, on-screen tap is the working fallback. The Kotlin module (or its iOS equivalent) is a future native-development phase. **Defer until:** an external beta tester actually requests it.

4. **Phase BL — auto club detection.** Per `docs/legacy-club-detection-capture.md`, this is greenfield (no portable legacy code). Scope, vision approach, trigger logic, UX integration all need fresh design. **Defer until:** post-1.0, with capture-document open questions answered first.

---

## G. Beta-readiness verdict (post-Phase BM)

**Internal beta:** **GREEN, with caveats.**
- Code surfaces work; foundation batch is shipped; YouTube hardened; privacy policy drafted.
- Caveats: paywall is a stub (intentional, deferred); Sentry is dark; debug routes are reachable.
- Tim can install on his Z Fold and run real rounds against the deployed Vercel backend.

**External beta:** **YELLOW.** Blocked on:
1. Phase AV empirical verification (142 scenarios across 10 groups; foundation is ready, Tim runs)
2. Privacy policy hosted at a public URL, embedded in onboarding + Settings + store listings
3. Subscription billing pattern decision + implementation (above) **OR** explicit "free during external beta" disclosure

**Public launch (post-external beta):** also requires:
4. Privacy attorney review of `docs/privacy-policy.md`
5. App Store Connect + Google Play Console listings finalized (bundle ID `com.smartplaycaddie.app` is reserved-or-pending — Tim verifies)
6. Subscription billing live and tested end-to-end
7. Sentry DSN configured + auto-upload re-enabled
8. Debug routes hidden / `__DEV__`-gated

---

## H. Out of scope for this phase

For clarity, Phase BM does **not** address:
- Voice register differentiation (BA-BC — separate phase)
- New feature development (anything beyond audit-flagged blockers)
- 1.x roadmap items (Phase BL, multi-player, cloud sync, native earbud listener)
- Marketing materials
- App Store / Play Store listing copy
- Subscription pricing / product structure
