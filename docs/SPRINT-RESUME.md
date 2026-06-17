# SPRINT RESUME — read this first

> **STANDING ENGINEERING RULES:** see [docs/ENGINEERING-PRINCIPLES.md](ENGINEERING-PRINCIPLES.md). **Read these before any fix prompt.** The anti-bandaid rules are non-negotiable — they exist because six weeks of GPS/voice band-aids almost shipped a broken product. **Find when it last worked. Prefer removing code. No new user-facing error surfaces without root cause. Two attempts then archaeology. Trust the user's lived reality. Competitor parity check. Parallel sweeps + post-sweep audit. Double-check before commit.**

If you are a fresh chat with no prior context: this is your starting point. Then read [SPRINT-LOG.md](SPRINT-LOG.md) for the daily detail and [audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md) for the full prioritized plan.

---

## Where we are right now

- **Sprint:** Two-week consolidation sprint, started 2026-05-20. Target: app ready by June. **Day 5 — 2026-05-24.**

### LATEST (2026-06-16) — read this before the Day-5 TL;DR below

**Active focus: closing the critical-path verification gate.** The dominant 1.0 blocker remains *verification on real hardware*, not more code (see BUILD-STATE-AUDIT.md §B).

- **Just shipped:** (1) Meta-glasses ingest boundary validation (`9a1cb6f`, on main + OTA prod) — Zod-validates the external Meta View JSON at the ingest boundary. (2) **Completed the Path 2 / Path 4 diagnostic markers** — `critical-paths.md` documented them but only 4/9 (ROUND) and 2/10 (VOICE) were actually emitted, so MIN VERIFY couldn't grep the boundaries. All 19 now emit; added run-sim.ts Scenario 13 as a drift guard. Programmatic gates green (sim 501/501, tsc 0, lint 0). See SPRINT-LOG.md 2026-06-16.
- **What's next (P0 queue):**
  1. **Path 2 + Path 4 MIN VERIFY on a real Z Fold round** — markers now exist; this is the gate. Update `critical-paths.md` "Last verification dates" after.
  2. **Wire `ingestMetaGlassesJson` into the custom-caddie UI** (`app/profile/custom-caddie.tsx:184` references it but never invokes it — the hardening is inert until then).
  3. Path 1 ONBOARD + Path 3 CAGE MIN VERIFY (still `_not verified_`).
- **Not done (deliberate):** Jest framework (conflicts with the sim-based verification philosophy), store schema-versioning (already complete), DI refactor of lazy requires (intentional boot-order devices).

### TL;DR (2026-05-24)

**Canonical inventory now lives at [BUILD-STATE-AUDIT.md](../BUILD-STATE-AUDIT.md)** (repo root). Read that for the full feature-by-feature breakdown across BUILT-VERIFIED / BUILT-UNVERIFIED / LEFT-FOR-1.0 / FUTURE. The list below is the running operational state — the audit is the authoritative classification.

**Days 3-5 (2026-05-22 → 2026-05-24) — major shipped items, all OTA-able + tagged `[SHIPPED-UNVERIFIED]` in the audit:**

- **Metric honesty system landed.** Forward-compatible source taxonomy (`38727de`) — pose wired, acoustic/watch/calibrated/profile/placeholder reserved, sources[] slot for fusion. Confidence labels + ranges on every metric (`31156de`) — killed the silent clamp, retired the fake-precision flag. Acoustic re-tiered as estimate not truth-grade (`ae58836`). Acoustic ball speed for SmartMotion in-app captures via parallel recorder (`516aab9`, Option C).
- **BUG #1 — Frame extraction regression diagnosed + fixed.** Diagnosis (`3bb96ee`, read-only) ruled OUT extraction collapse: 5 frames still ship through `/api/swing-analysis`. Fix (`45dfe0e`) rewrote the Sonnet prompt to read full motion + stopped frame-1 anchoring + logged image-count. Owner debug card (`3ef0c67`) makes frames-sent vs server-saw visible in-app.
- **Layman translation layer (`dedba52`).** `layman_explanation` field added to swing-analysis response; rendered as progressive disclosure on PrimaryIssueCard. **Gap:** NOT yet ported to `/api/putting-analysis`.
- **Fault-frame persistence (`c974779`).** Diagnostic frame saved as JPEG (`fault_frame_index` + `visual_reference_path`) — annotation + share prerequisite, opp #4 from the roadmap.
- **Coach Mode player scan + calibration profile (`c777743`).** Player calibration store, scan-student route, beta-tagged for Tank. **Critical gap:** profile is written but NOT yet consumed by `swingMetricsService` — flagged for 1.0 in the audit.
- **GPS-verify three-flow build.** Discovery (`fd7ad07`, read-only). Flow A — raw yardage to pin (`a347e0b`). Flow B — confidence-gated proactive hole ask (`98511a6`, gpsConfidenceAsk orchestrator + gpsHealthStore). Flow C — declared-position cross-check + silent Mark on divergence + UndoMarkBanner (`406ab3a`).
- **Hands-free spine batch (`291a207`, `ecf57d9`, `56a769c`, `bebe100`, `5f08032`).** "watch this" + putt_watch classifier reachability. media_capture swing falls back to /swinglab/quick-record when Cage not mounted (one-phrase-one-path). ES/ZH localization — text-path (`TTS_STRINGS`) AND TTS voice model threading (`eleven_multilingual_v2` swap). iOS/Android-specific permissions copy coaching "Allow all the time". CourseTruth dev tool (`app/dev/CourseTruth.tsx` + `services/courseTruth.ts`, AsyncStorage-backed survey workflow). `resolveGreenCoords` extended to TRUTH > override > courseHoles > geometryCache, sync via boot-hydrated cache. Meta glasses voice-ingest v1 (`metaGlassesIngest.ts` + `externalContext` on roundStore + `what_did_meta_say` voice intent). Tee box geofence (`currentLocationType` on roundStore — fed by gpsManager on every fix, does NOT touch currentHole). `ask_golf_father` intent with location × distance cascade + Tier-1 hardcoded TANK_RULES for 6 questions. `cage_mode` voice route + `watchAndSpeakNextSwingAnalysis()` Cage swing auto-coach. `practiceStore` persisting cage tendencies (overTheTopCount / fatShotCount / typicalMiss / avgCarry) fed from `perShotAnalysis` adapter. AsyncStorage dump panel on `/cage-debug` for on-device persistence verification (no Flipper needed).
- **BUILD-STATE-AUDIT.md (`d97c22e`)** — full read-only reconciliation of sprint log vs code. Authoritative source for "what's actually built vs claimed" going forward.

**NOT on main — pending native EAS Build cut:**
- **Worktree `feat/bt-media-button` @ `7504099`.** Bluetooth headset media-button native bridge (Kotlin Android + Swift iOS) + plugin + JS voiceTriggers + app/_layout integration. Mirrors AirPods/Bose play-pause → `notifyEarbudTap()` → `listeningSession.toggle()`. Not OTA-eligible (native deps). Awaits `eas build --platform all --profile preview`.

**Headline observation from the audit:** ~40 items shipped to `main`, only 2 verified. The dominant 1.0 gap is **verification on real hardware** — a Menifee cart round, a real swing capture, a real Spanish utterance — not more code. See BUILD-STATE-AUDIT.md §B for the per-item verification gate.

---

### Earlier day-by-day fixes (Day 1-2 history — preserved for context)

- **Fix P shipped — voice score-telling intent (OTA-able).** Same silent-contract bug-class as Fix O: `services/intents/logScoreHandler.ts` was fully implemented + registered with the canonical `round.logScore` write path, but `log_score` was completely absent from `api/voice-intent.ts`'s classifier prompt (not in the numbered intent list, not in the JSON schema union). Haiku classifier can't emit an intent it hasn't been told exists, so "I got a 4 on hole 1" classified as `unknown` → triggered the "are you asking or telling?" clarifier. Fix: added the full `log_score` intent definition (#21) with examples covering numeric phrasings ("I got a 4", "took a 5", "carded a 6") AND par-relative names ("made par", "bogey", "birdie", "eagle", "double bogey"); added explicit number-vs-hole disambiguation rules ("4 on hole 1" → strokes 4 hole 1; "I bogeyed 7" → bogey on hole 7); added `"log_score"` to the schema union. Handler extended with `parseScoreName(raw, par)` to resolve par-relative names against the current hole's par; par lookup reordered to happen before strokes parsing. Caddie confirms with "Got it — 4 (par)" via existing listeningSession TTS (persona voice). Strategy questions still route to the brain — log_score only matches past-tense reports.
- **Fix O shipped — hole nav + scoring resilience (OTA-able).** The cockpit's SHOTS / PUTTS steppers were silently no-op'ing on device — `CockpitCaddieScreen.tsx` was calling `setScore` / `setPutts` via `(s as unknown as {...}).setScore?.(...)`, but the store exposes those actions as `logScore` / `logPutts`. Optional chaining swallowed every tap with no error. Replaced with the canonical `logScore` / `logPutts` (same write path the scorecard, voice intents, and harness use). Added manual hole ◀/▶ nav arrows to `CaddieDataStrip` in both layouts (horizontal portrait + grid Fold-open) — calls `setCurrentHole`, which already fires `holeDetection.noteManualOverride()` so a correction holds for 20s against auto-detection. Scorecard already had manual nav via row tap. One canonical write path everywhere: `setCurrentHole` for hole, `logScore` for score, `logPutts` for putts. No parallel logic. GPS / holeDetection untouched (Fix L territory). OTA-able.
- **Fix N (THE GATE) shipped — Start Round crash-proofed (EAS-build-required, not OTA).** Tim's Z Fold (One UI 6 / Android 14 / targetSdk 35) crashed hard on every Start Round; round persisted via Zustand+AsyncStorage but the post-persist GPS orchestration died. Strongest cause: foreground location service posts a persistent notification, but `POST_NOTIFICATIONS` was missing from the manifest → Android 13+ SecurityException → native process kill (JS try/catch can't catch). **Defensive fix shipped without waiting for a stack trace:** (1) added `POST_NOTIFICATIONS` to app.json Android permissions; (2) `services/backgroundLocationTask.ts` now probes the runtime permission via `PermissionsAndroid.check`/`request` BEFORE calling `Location.startLocationUpdatesAsync` — when denied (or the probe itself throws), skips the foreground service entirely and lets foreground `watchPositionAsync` carry the round (loses Doze coverage, NOT the round); the native call is also wrapped in an inner try/catch as a third defense layer; (3) `app/(tabs)/caddie.tsx` no longer double-fires `startGpsManager` — collapsed to a single call site in `roundStore.startRound`, with caddie.tsx only running the post-GPS `refreshFix`+`forceMarkPosition` initial-fix sync after a brief wait; (4) `eas.json` gets an `EXPO_PUBLIC_SENTRY_DSN: ""` slot so Tim can wire runtime crash capture via EAS secrets without further code changes (kept `SENTRY_DISABLE_AUTO_UPLOAD: true` since source-map upload requires the full SENTRY_AUTH_TOKEN/ORG/PROJECT trio — runtime capture works without it). EAS rebuild required for the manifest change; hole-jumping (Fix L) re-evaluation deferred until a clean Start Round runs on device.
- **Day 2 closed (2026-05-21):** three honest-degradation fixes shipped + two no-code diagnoses (analysis is real, timeline is display-only). Fix G — Cage Mode now runs on real capabilities only (dropped the unbuilt CV bullseye + analyze 404 endpoints; CV deferred to post-launch backend build). Fix H — pose-analysis 503 alert killed (200-with-null when env-gated off; trivially reversible if RapidAPI subscription is added later). Fix I — caddie failure path no longer goes silent: localized fallbacks in three languages + `maxDuration: 30` on five Sonnet endpoints (Vercel Pro confirmed) addresses root cause of intermittent + Spanish silent failures. Fix J + K — no code: SmartMotion analysis verified real and swing-specific; timeline "only 2 points" is `Math.floor()` display collapse on short clips, not extraction failure. **Next:** on-device verify of Fix I (force a failure, confirm caddie speaks not silent) + grep V6-DIAG STAGE 2 to confirm 5-frame extraction → close J/K → kick EAS tester build. Tonight: Menifee real round + daughter capturing 5-angle hole photos.
- **Current day:** Day 2 — 2026-05-21. Fix 9B shipped: SmartMotion (quick) and Cage Mode (practice/lessons) are now two clean features with zero overlap. `app/smartmotion-quick.tsx` deleted. `app/swinglab/cage-drill.tsx` renamed to `app/swinglab/cage-mode.tsx` with batch-count ported in. Voice intent + Tools menu + cockpit MOTION skip the NoClipHero (Option D speed). Sprint Map P0-3 closed.
- **Fix A shipped:** new `components/caddie/CaddieMicBadge.tsx` (shared tap-to-talk badge with ring + halo + mic-icon overlay). `BrandHeaderRow` refactored to use it (no API change). Added to SmartMotion + Cage Mode headers; SwingLab gets it via BrandHeaderRow. Auto-voice (continuous wake-word) on these screens remains deferred — manual badge is the manual fallback.
- **Fix C shipped:** SmartMotion skeleton + shot-tracer overlays now map to the displayed-video subrect (COVER scale + crop), not the container box. Stays aligned across Z Fold open/close because `onLayout` on the videoFrame recomputes the rect on container resize. STUB_SKELETON is still a placeholder until real MoveNet keypoints land — Fix C makes the mapping correct so real keypoints will land on the body.
- **Fix D shipped:** new `CaddieIntroSheet` (3 lines + skip + speak with active persona's tone) wired into SmartMotion (pre-record only) and Cage Mode (SETUP phase only). Auto-suppresses after 3 opens per slug via persisted `introOpens` counter on settingsStore. Voice "how does this work" re-trigger deferred.
- **Fix I (A+B+C) shipped:** honest caddie failure handling + 30s Vercel headroom (Pro confirmed). The earbud-tap / mic-badge caddie flow in `services/listeningSession.ts` was swallowing every failure (non-2xx, empty reply, fetch throw, handler throw) silently — the pill went idle with no spoken/haptic feedback, indistinguishable from "Kevin didn't hear me." Wired honest localized fallbacks (English/Spanish/Chinese) into all four silent-drop branches via a new `speakHonestFailure()` helper that vibrates + stops in-flight TTS + speaks "I'm having trouble connecting — try that again" in the user's language. `api/kevin.ts` outer catch was returning HTTP 500 (which the client dropped) — now returns HTTP 200 with the same localized fallback string in `text`, so the client's existing OK-branch picks it up and speaks it. Spanish wasn't a separate bug, just more likely to tip over Vercel's old default cap thanks to heavier `eleven_multilingual_v2` TTS. Added `maxDuration: 30` to `api/kevin.ts`, `api/brain.ts`, `api/voice-intent.ts`, `api/swing-analysis.ts`, `api/cage-coach.ts` in vercel.json so the 25s Anthropic SDK timeout + 5s TTS headroom completes naturally. NOT fabrication — only honest error strings reach the user, never fake answers. `useVoiceCaddie` (cockpit/full-mode round flow) was already correct; left as the reference pattern.
- **Fix H (Option B) shipped:** kill false 503 alert on `/api/pose-analysis`. The endpoint was returning HTTP 503 by design when `POSE_API_KEY + POSE_API_HOST` env vars aren't set — file header documented it as a "graceful 503 — clients fall through silently." Functionally correct but the wrong status code: Vercel couldn't tell "intentionally off" from "broken" and fired false alerts. Blast radius confirmed zero: SmartMotion's primary analysis (`/api/swing-analysis`) is independent, both pose-analysis callers were already fire-and-forget with explicit "failures silent" comments, and [services/poseAnalysisApi.ts:145](../services/poseAnalysisApi.ts#L145) already collapsed `!res.ok → null`. Fix: server now returns `200 OK` with `{ data: null, configured: false, reason }` when env-gated off; client checks `data.configured === false || data.data == null` and returns `null`. UX identical (no biomechanics card when unconfigured), no fabrication, trivially reversible when a real RapidAPI subscription + env vars land (Option A). `tsc --noEmit` clean.
- **Fix G (Option A) shipped:** honest Cage Mode + screen-aware voice "record". Diagnosed three separate problems (not 9B regressions): (a) `/api/cage/check-bullseye` and `/api/cage/analyze` 404 because the endpoints were never built — `services/cageApi.ts` header said *"backend lands in Prompt 2"* and Prompt 2 never landed; (b) `services/intents/mediaHandlers.ts` `normalizeKind()` defaulted to `'shot'` so voice "record" on Cage Mode hit `canCapture('shot')` and was refused for "not in a round"; (c) camera preview was always fine. Fix: deleted `checkBullseye` + `analyzeCageVideo` from `services/cageApi.ts` (kept `coachReview` → `/api/kevin/coach` which is deployed); collapsed Cage Mode phase machine to `SETUP → RECORDING → UPLOADING → RESULT | ERROR` (no fake CV gate); `stopRecordingAndUpload` now awaits the local acoustic-impact detector + `/api/acoustic-detect` ball-speed inline and builds the `coachReview` features payload locally from real signals (`bullseye_offsets: []` because we don't have CV scoring and won't fake one); CameraView pinned to `mode="video"` always (kills the picture/video race); `subscribeCapture(['swing'])` phase guard loosened from `READY` to `SETUP` (the only pre-record phase that exists post-G); `normalizeKind()` is now screen-aware — `getActiveSurface() === 'drill_session'` forces `'swing'`. No mock-mode fabrication in production. OTA-able, no APK rebuild.
- **Consolidation 5 Part 2 shipped:** surfaced the Mark Green capture loop on no-geometry surfaces. The full-screen SmartFinder's `MapView` fallback now renders a green "Mark this green for live yardages" pill below the geometry message; the embedded `SmartFinderCard` on Caddie home shows the same CTA inline (with stop-propagation so the outer card-tap still routes to `/smartfinder`). Both route to `/mark-green`. Pre-change architectural verification confirmed all three correctness invariants Tim required already held: live yardage after marking is `haversineYards(fix.location, …)` against the resolved override (NOT step-subtraction from tee — dogleg-safe; [smartFinderService.ts:336-338, 377-379](../services/smartFinderService.ts#L336-L338)), overrides persist across rounds via AsyncStorage `smartplay.courseGreenOverrides.v1`, and re-mark overwrites with a fresh `getOneShotFix({ maxAgeMs: 0 })` ([mark-green.tsx:106](../app/mark-green.tsx#L106)). Zero changes to the service layer — only UI surfacing. Trip-ready for Maplewood + Pembroke Pines next weekend.
- **Consolidation 5 Part 1 shipped:** SmartFinder honest fallback labeling. `staticYardages()` now returns `reason: 'no_geometry'` (was `'ok'`); DistanceCard + SmartFinderCard render a "SCORECARD" pill + `~` prefix + downgraded GPS dot + "CARD TOTAL" label when the middle value is the scorecard tee→green total instead of a live GPS read. SmartFinder full-screen message differentiates "Scorecard distance — no live GPS green for this course" vs "Green coordinates unavailable." Zero change on courses with real green geometry. Caddie's `fmb` memo threads `reason` through. Same no-fake-precision principle as Phase 418.
- **Consolidation 4 shipped:** `console.log` noise audit. 432 actual calls (audit said 355); ~95% were tagged diagnostics or catch-block error surfaces (Tim's KEEP categories). Created `services/devLog.ts` and gated 18 routine flow traces (filler lifecycle, bgLocation lifecycle, transcript dump, etc.) through it — silent in production via `__DEV__` DCE. 414 intentional diagnostics retained.
- **Consolidation 3 verdict:** the Phase 420 routes-audit "14 orphan routes" claim was wrong — re-grepped with broader patterns (template literals, `pathname:` object form, cold-install redirects), found ALL 14 are reached. Zero deletes. Tightened the central `DEBUG_ROUTES` gate by adding three owner-only surfaces (`/author/reference-assets`, `/landmark-curate`, `/owner-logs`) for defense-in-depth.
- **Consolidation 2b shipped:** deleted `services/modeSelector.ts` + `services/roles/*` (4 files, orphan-island Trust-Spectrum scaffold with no consumers; resurrect from git when register-shifting is actually spec'd). Cleaned dangling `trustLevelStore.ts` header comment. Kept `services/watchService.ts` as the documented native-SDK hook site for the post-sprint EAS watch build. Logged SmartMotion skeleton-stub honesty note: live overlay renders fixed placeholder positions, NOT real MoveNet tracking — do not present as tracked swing until the post-sprint TFJS/MoveNet native build lands.
- **Consolidation 2 shipped:** dead-code removal pass — **2,313 LOC deleted across 29 files**. Batch 1: 12 Expo-starter leftovers (closed-graph). Batch 2: 8 orphan scaffolds incl. the pose pair (verified the live `StubSkeletonOverlay` in smartmotion.tsx uses local constants, NOT the deleted `poseInference.ts`). Batch 3: 8 deprecated components (Phase AT/111/405 consumers removed). Batch 4 deferred for Tim's decision: `services/modeSelector.ts` + `services/roles/*` is a closed orphan island Trust Spectrum doesn't currently consume — delete or keep? `services/watchService.ts` also zero consumers (the only reference was a comment from Fix F) — kept as the documented SDK hook site, but delete-now-resurrect-from-git is on the table. `expo-image` dropped from package.json + lockfile.
- **Consolidation 1 shipped:** three single-source-of-truth merges. Haversine — 5 impls → 1 canonical in `utils/geoDistance.ts` (all 4 re-impls were mathematically identical; cleanly replaced with imports). Voice tuning — `ELEVEN_VOICES_BY_PERSONA` + `ELEVEN_SETTINGS_BY_PERSONA` extracted to new `api/_voiceTuning.ts`; both `api/voice.ts` and `api/kevin.ts` import. Watch state — `watchConnected` removed from `settingsStore`; all four consumers (cage/index, settings, cage-mode, cage/summary) now read from `watchStore.isConnected`. Sprint Map P1-4 / P1-5 / P1-6 closed.
- **Fix F diagnosis:** Galaxy Watch IMU in Cage Mode is unbuilt, not broken. `services/watchService.ts` is scaffold + math + `simulateSwing()` test helper; zero production writers to `useWatchStore`. Cage Mode UI is correctly defensive (Watch Metrics card hidden when `watchSwing` null) so no fake-data UI exists today. Real Watch IMU needs native-module wiring via EAS Build using the beta wearables SDK Tim now has access to — pending the next APK, not OTA-able. Honest header comment updated in `cage-mode.tsx`; no runtime UI change.
- **Skeleton topology rewrite shipped:** stub skeleton now renders an explicit bone-edge list (12 bones + 13 joints in MoveNet-17 order), head as a scaled circle node on a neck line, wrists as visible joint dots. Kills the previous shared-apex topology (kite legs + triangle head). All sizes scale from `videoRect` — no hardcoded pixels. When real MoveNet keypoints land, the same edge list and joint indices apply.
- **Fix E shipped:** Spanish/Chinese now actually applied to caddie TTS. `/api/kevin` was hardcoding `eleven_turbo_v2` (English-only ElevenLabs model) regardless of language — text came back Spanish, audio came back English-pronunciation. Now mirrors /api/voice's `language === 'en' ? 'eleven_turbo_v2' : 'eleven_multilingual_v2'`. Also threaded language into `/api/swing-analysis` so SmartMotion's observation text comes back in Spanish too. Cage-coach endpoint deferred — same fix later, lower priority.
- **Fix B shipped:** SmartMotion angle (down-the-line / face-on) is chosen BEFORE recording. Pre-record picker in `NoClipHero`; quick-record carries the choice forward + back via URL param; `analyzeSwing` passes it to the server; the analyst's prompt uses it to read the right biomechanical patterns. Voice "record me down the line" / "record me face on" sets the angle AND auto-starts recording in one command. Default flipped from face-on to down-the-line.
- **Current focus:** Audit-and-infrastructure day. Phase 420 audit and Phase 421 save-point system landed. No app code changes today beyond the morning's persona TTS + Tools FAB + Phase 418 validation gate.
- **Full prioritized plan:** [docs/audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md)
- **Daily running log:** [docs/SPRINT-LOG.md](SPRINT-LOG.md)
- **Audit evidence (12 docs):** `docs/audit-420-*.md`

---

## What's done and verified

> As of Day 5 (2026-05-24): **[BUILD-STATE-AUDIT.md](../BUILD-STATE-AUDIT.md) is the canonical inventory.** Section A = verified, Section B = shipped-unverified (each with explicit gates), Section C = 1.0 blockers, Section D = future. The lists below are kept for historical continuity but the audit doc has the strict bar.

**Code on `main`, server-side will deploy via Vercel automatically:**
- Phase 416 SmartMotion two-card system + cleanup
- Persona-aware Kevin TTS — `/api/kevin.ts` no longer hardcodes Kevin's voice for every persona
- Tools FAB layout — small right-side chevron expanding left
- Phase 418 SmartMotion validation gate — `services/swingValidity.ts` + server `valid_swing` field + UI gating
- Phase 420 audit (12 docs)
- Phase 421 sprint infrastructure (this set)
- **Day 1 / Fix 1 — End Round crash fixed** ([app/recap/[round_id].tsx:172](../app/recap/[round_id].tsx#L172)) — Zustand selector `roundPhotos` returned a fresh `[]` per render via inline `?? []` fallback. Stabilized via module-level `EMPTY_PHOTOS` constant.

**Verified clean by audits (do not touch — see Sprint Map "VERIFIED CLEAN"):**
- TypeScript strict, zero errors, zero suppressions
- `expo-doctor` 17/17 checks pass
- `BrandHeaderRow` + ••• Tools-pill pattern consistent across all 5 tabs
- Persona definition single-sourced in `lib/persona.ts`
- App entry hydration gate in `app/index.tsx`

**Not verified on device:** ALL of the above. The recurring problem across the audit is that every recent phase ("Phase 410 / 415 / 416 / 418 / persona TTS fix") is "git-diff verified" only. Empirical Z Fold verification is the sprint-end gate.

---

## What's actively in progress

**Day 5 close (2026-05-24):**
- ~40 OTA-eligible items shipped + verified TS-clean + bundled OTA. Update group history: `ac5045ea` (voice spine extensions) → `ab644d16` (voice→cage + auto-coach) → `dcf96941` (Tank rules + practice store) → `23197688` (AsyncStorage dump panel). All on preview channel.
- BUILD-STATE-AUDIT.md committed and pushed (`d97c22e`). Surfaces the verification debt as the dominant 1.0 gap.
- BT media-button native module sitting on worktree `feat/bt-media-button` @ `7504099`. Awaits an EAS Build cut.

**What Day 6+ should do — verification, not more code:**
1. **Cart round at Menifee** covering H12–H17 (the H14→H15 regression case from `holeDetection.ts:36-46`). Verifies the hardened gates + tee geofence + truth resolver + GPS Flow C in one pass. Per memory rule: cart is the default, walker-only / harness-only verification is insufficient.
2. **Real swing capture** in Cage Mode → confirm BUG #1 fix (full motion described, not just setup) + acoustic ball speed + metric ranges + auto-speak observation.
3. **Spanish utterance test** ("¿cuántas yardas?") → confirm Spanish text emitted AND spoken via `eleven_multilingual_v2` (not English-accented monolingual).
4. **AsyncStorage dump panel** verification at `/cage-debug` → confirms practice-store accumulates from real swings.
5. **CourseTruth survey** on Menifee Lakes → walk-to-green + "I'm Here" snap on each hole → confirm truth wins over courseHoles via `side_effects: green_source:truth`.

**1.0 blockers from the audit (not yet addressed):**
- Stripe / RevenueCat real billing wiring (only paywallGuard stub today)
- TestFlight + Play Store submission
- Putt-analysis prompt parity + layman_explanation (parallel of BUG #1 fix not yet ported)
- Calibration profile consumer wiring (`playerCalibrationStore` writes, nothing reads)
- Cloud backup of swing library + videos (data-loss-on-uninstall protection)
- EAS Build cut to ship the BT worktree

---

## What's next (P0 queue from the Sprint Map)

In dependency order — see [audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md) for evidence and file paths:

1. ~~**P0-1** — Fix `/arena/practice` 404.~~ **DONE Day 1 / Fix 2.** Card removed from SwingLab launcher; verified no remaining `/arena` references.
2. ~~**P0-2** — Verify `/swinglab/range` exists.~~ **CONFIRMED — file present at `app/swinglab/range.tsx`.** Earlier audit "likely missing" claim was wrong. Range Mode's Start Session was also rewired (Day 1 / Fix 2) to route only to the Swing Library (was going to `/cage/session`, one of the legacy capture surfaces).
3. **P0-3** — Collapse two SmartMotion UIs. `app/smartmotion-quick.tsx` (954 LOC, OLD) is still reachable from voice-intent (`services/intents/openToolHandler.ts:28-29`), Tools menu (`components/tools/GlobalToolsMenu.tsx:325`), and Library (`app/swinglab/library.tsx:256`). Repoint to canonical `app/swinglab/smartmotion.tsx` and delete. Effort: M.
4. ~~**P0-4** — Reproduce End-Round "Maximum update depth" crash on current bundle.~~ **DONE Day 1 / Fix 1.** Root cause: Zustand selector returning fresh `[]` per render. Fix on `main` in this session's commit. Empirical verification on Z Fold still required.
5. **P0-5** — Write `speaker_id: 'self'` default in 4 paths so multi-player migration doesn't need a data fixup later. Effort: M.
6. ~~**P0-7** — Gate debug routes for non-owners.~~ **DONE Day 1 / Fix 3.** Single central `usePathname()` watcher in `app/_layout.tsx` redirects non-owners away from 11 gated routes.
7. ~~**P1-3** — Collapse 3 GPS-fix caches to one.~~ **DONE Day 1 / Fix 4.** `gpsManager` is the single owner; smartFinderService and shotLocationService became thin readers. Sim, mark, and round-end write paths all flow through gpsManager. Stops the yardage-drift / 629,441y class of bugs at the source.
8. ~~**Day 1 / Fix 5** — Cockpit-mode SHOTS cell now ticks during the hole.~~ Was only watching `scores` (final hole map); harness shots never wrote that until completion. Now derives a running stroke count from `shots` mirroring the data-bar's STROKE calc.
9. ~~**Day 1 / Fix 7** — Hole-transition GPS refresh seam.~~ On `currentHole` change, force `gpsManager.getOneShotFix()` + `markTick++` so the `fmb` memo recomputes against the freshest fix instead of an up-to-one-sim-tick-old cache. Eliminates the 2-5y upward yardage bump Tim saw on transitions around holes 13/16/17. Symptoms 2 (caddie hole announcement on harness) and 3 (stroke ≤2 on synthetic round) confirmed expected harness behavior — left as-is.

Then P1 consolidation (5 swing-capture surfaces → 2; 5 haversines → 1; 3 GPS-fix caches → 1; etc.) and P2 polish.

---

## Hard constraints / standing decisions a new chat must know

- **(RETRACTED 2026-06-14 — was stale)** ~~Feature-complete. Nothing new gets added this sprint.~~ The 2026-06-08→14 session was overwhelmingly new-feature work (CNS, Smart Motion rebuild, Practice Engine, course book, points, offline caddie, on-device pose). Current mode: build new features in gated OTA increments + keep the audit/honesty/perf bar. See the 2026-06-08→14 reconciliation section in SPRINT-LOG.md and docs/TEST-MANUAL.md.
- **SwingLab and Practice are ONE feature.** Never duplicate components, routes, or services across them. Per audit they appear clean today — keep it that way.
- **Empirical verification on Z Fold is the bar.** Code on `main` is not "done." Every P0 / P1 item closes only after on-device confirmation.
- **The Pro app lives at `~/Documents/smartplay`.** `~/smartplaycaddie` (this working dir for Claude Code) is a different/sandbox repo — do NOT edit it. All sprint work is in `/Users/timothyg/Documents/smartplay`.
- **Push to main on completion.** Standing rule from `~/.claude/projects/.../memory/standing-rules.md`. Never `--no-verify`, never `--force` to main.
- **Beta wearables SDK is unblocked** (Galaxy Watch / Health Connect / Meta glasses). Native module changes require an EAS Build, not just OTA.
- **No Grok.** Hard rule. Reference memory entry `no-grok.md`.
- **`speak()` / `playLocalFile()` triggered at launch or by user tap MUST pass `{ userInitiated: true }`** or they go silent at L1.
- **Trust slider order:** use `TRUST_LEVEL_SLIDER_ORDER` (= `[1,5,2,3,4]`), never modulo on numeric value.

---

## End-of-sprint verification gate

Sprint isn't done until ALL of these are confirmed on a real Z Fold (from the Sprint Map):

- [ ] Cold launch → welcome → caddie tab — no flashes, no double-redirects
- [ ] SwingLab tab: every card reaches a real screen (no 404)
- [ ] SmartMotion validation gate suppresses fabrication on floor footage; real swing produces honest read
- [ ] Tools FAB expands left to icons; no fake giant pill
- [ ] Each of the 4 personas speaks in their own voice
- [ ] Round start → 18 holes simulated → End Round → recap — no "Maximum update depth" crash
- [ ] Debug routes return 404 / redirect for non-owner accounts
- [ ] APK build size unchanged or smaller than pre-sprint baseline (5.2 MB Hermes)
- [ ] SmartFinder camera-mode overlay lands the "your phone is your rangefinder" wow moment on Z Fold (pinch-zoom verified); GPS-quality indicator visibly downgrades on weak signal so the user never reads fake precision (same honesty principle as the SmartMotion 418 gate). Full positioning + accuracy framing in [SPRINT-LOG.md → Verification + Polish Backlog](SPRINT-LOG.md).

---

**Last refreshed:** 2026-05-24 (Day 5 end — voice spine + Meta integration + metric honesty + GPS-verify flows + Tank rules + CourseTruth all shipped OTA. BUILD-STATE-AUDIT.md is now the canonical inventory. BT media-button native module on worktree, awaits EAS Build. Verification debt is the dominant 1.0 gap — Day 6+ should be hardware testing on a real cart round, not more code). Update this doc at the end of every session.
