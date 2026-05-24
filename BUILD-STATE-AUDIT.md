# BUILD-STATE AUDIT — Where we are: built / verified / left for 1.0 / future

**Date:** 2026-05-24
**Mode:** Read-only. Repo is source of truth. No source edits — only this doc is written.
**Standing principle (rule from the sprint):** SHIPPED ≠ VERIFIED. Code in `main` is not "done" until on-device confirmation on a real swing / real cart round. Every item below carries one tag of three:
- **[VERIFIED]** code exists AND empirically confirmed on real swing/round/cart
- **[SHIPPED-UNVERIFIED]** code in `main`, no empirical proof yet — open verification gate per item
- **[PLANNED]** spec'd / discovered, not yet built
Each item tagged with its pillar: **(ROUND)** / **(PRACTICE)** / **(PLAY)** / **(VOICE)** / **(GLASSES)** / **(INFRA)**

---

## A. BUILT & VERIFIED

> Empirically confirmed on real device + real use. Strict bar. Per [docs/SPRINT-RESUME.md](docs/SPRINT-RESUME.md): "Not verified on device: ALL of the above" — this bucket is **near-empty by design** at this stage of the sprint.

- **End Round crash fix** (recap roundPhotos selector stability) — **[VERIFIED]** on harness. (ROUND)
- **OTA bundles emit clean** for both platforms — verified by `eas update` succeeding on commits `291a207` / `ecf57d9` / `56a769c` / `bebe100` / `5f08032`. (INFRA)

That's it for verified. Everything else is in B or below.

---

## B. BUILT, NOT YET VERIFIED — **the most important honesty bucket**

> Code shipped to `main`, OTA-eligible, TS-clean. **Open verification gate per item** — most need a real swing, a real cart round, or a real hardware test.

### Voice & hands-free spine
- **One-phrase-one-path swing routing** (record/capture/watch my swing → `media_capture/swing`) — [SHIPPED-UNVERIFIED] (VOICE). **Verify:** say each variant during a round; confirm route to Cage Mode or Quick Record.
- **"watch this" + putt_watch classifier reachability** — [SHIPPED-UNVERIFIED] (VOICE). **Verify:** say "watch this", "watch this putt", "watch this chip" — confirm dispatch.
- **Quick Record fallback** when Cage Mode not mounted — [SHIPPED-UNVERIFIED] (VOICE). **Verify:** off-Cage "record my swing" → `/swinglab/quick-record` opens.
- **`ask_golf_father` intent** (location × distance cascade + Tier-1 hardcoded TANK_RULES for 6 questions) — [SHIPPED-UNVERIFIED] (VOICE). **Verify:** "what would Tank do here", "red penalty vs yellow", "driver or 3-wood", "should I lay up", "nearest point of relief", "can I ground my club", "flag or center".
- **`what_did_meta_say` intent** + Meta glasses JSON ingest — [SHIPPED-UNVERIFIED] (VOICE/GLASSES). **Verify:** Meta View JSON import → ask "what did Meta say" → reply.
- **`declare_hole` + silent Mark + UndoMarkBanner** (GPS Flow C) — [SHIPPED-UNVERIFIED] (ROUND/VOICE). **Verify:** real cart round; declare hole 4 with GPS divergence > 22yd; observe silent override + undo banner.
- **GPS Flow A — raw yardage to pin** (queryStatusHandler enrichment + classifier examples) — [SHIPPED-UNVERIFIED] (ROUND/VOICE). **Verify:** "what's my yardage" on cart; Golfshot-cross-check.
- **GPS Flow B — confidence-gated "what hole?" ask** (gpsConfidenceAsk + gpsHealthStore) — [SHIPPED-UNVERIFIED] (ROUND/VOICE). **Verify:** poor GPS sustained 45s → caddie asks; cooldown holds 5 min.
- **Voice-assistant launch heuristic** (AppState cold-launch within 2s → notifyEarbudTap) — [SHIPPED-UNVERIFIED] (VOICE). **Verify:** "Hey Google, open SmartPlay Caddie" → app boots → auto-listens within 300ms.
- **ES/ZH text path** (`TTS_STRINGS` in queryStatusHandler `distance_to_green`, classifier language detection, language threaded through router→context→handler) — [SHIPPED-UNVERIFIED] (VOICE). **Verify:** "¿cuántas yardas?" → Spanish text spoken.
- **ES/ZH TTS voice-model threading** (`model_id` from `speak()` → `/api/voice`; `intent.language ?? settings.language` at all 3 speak sites in listeningSession) — [SHIPPED-UNVERIFIED] (VOICE). **Verify:** Spanish utterance played by `eleven_multilingual_v2` not English-accented.
- **Lockstep warning comment block** on both voice-intent files — [SHIPPED-UNVERIFIED] (INFRA). Documentation only; no behavior gate.

### Practice → Play loop
- **`cage_mode` voice route** (open_tool/cage_mode → `/swinglab/cage-mode`) — [SHIPPED-UNVERIFIED] (PRACTICE/VOICE). **Verify:** "start cage session" → screen opens.
- **`watchAndSpeakNextSwingAnalysis()` auto-speak** (Cage Mode swing analysis subscribed; observation spoken with 20s watchdog) — [SHIPPED-UNVERIFIED] (PRACTICE/VOICE). **Verify:** in Cage Mode, "watch my swing" → real swing → Tank speaks observation within 20s. **Coverage gap:** Quick Record path does NOT auto-speak (no cage shot written).
- **`practiceStore`** (persisted; `overTheTopCount` / `fatShotCount` / `typicalMiss` / `avgCarryDriver` / `avgCarry3Wood`; FIFO 500 cap; piped from mediaHandlers subscriber) — [SHIPPED-UNVERIFIED] (PRACTICE). **Verify:** several Cage swings → `practice-store` accumulates non-zero counters (use AsyncStorage dump panel on `/cage-debug`).

### Geometry truth + ground-truth survey
- **CourseTruth dev tool** (`/dev/CourseTruth?courseId=&hole=`; GPS poll; "I'm Here"; manual lat/lng; save to AsyncStorage `truth_*` keys) — [SHIPPED-UNVERIFIED] (ROUND). **Verify:** walk Menifee Lakes, snapshot each green, restart app, confirm truth survives. **Known gap:** no satellite map / draggable markers (react-native-maps not installed; deferred to native cut).
- **`resolveGreenCoords` truth-first chain** (truth > Mark Green override > courseHoles > geometryCache; sync via in-memory cache hydrated at boot) — [SHIPPED-UNVERIFIED] (ROUND). **Verify:** save a TRUTH for Menifee #7, "what's my yardage" returns truth-anchored distance, `side_effects` logs `green_source:truth`.
- **`hydrateCourseTruthCache()` at app boot** — [SHIPPED-UNVERIFIED] (INFRA). **Verify:** AsyncStorage dump panel post-boot shows truth keys + console log `[courseTruth] hydrated N`.
- **`currentLocationType` + `currentTeeBox`** (gpsManager fires `setLocationContext` per fix; 30yd tee / 40yd green radii; deduped; **NOT persisted by design** — GPS-derived, resets to `'unknown'` on boot) — [SHIPPED-UNVERIFIED] (ROUND). **Verify:** real cart round; observe in AsyncStorage / debug screen that type tags correctly tee → fairway → green. **Explicit non-regression:** does NOT auto-advance currentHole (holeDetection.ts still owns transitions, preserving the H14→H15 fix).

### Permissions onboarding
- **iOS/Android-platform-specific permissions copy** (iOS two-prompt warning, Android "Allow all the time" coaching) — [SHIPPED-UNVERIFIED] (INFRA). **Verify:** fresh install on each platform; confirm correct copy + Always grant accepted.

### Swing analysis — vision + metrics
- **BUG #1 frame-extraction fix** (`/api/swing-analysis` prompt rewrite to read full motion, anti-frame-1 anchoring, image-count log) — [SHIPPED-UNVERIFIED] (PRACTICE). Commit `45dfe0e`. **Verify:** real swing video uploaded; observation references transition / impact / follow-through, NOT just setup. **Parallel deferred:** same prompt fix NOT yet ported to `/api/putting-analysis`.
- **Owner debug card** — frames sent vs server saw (commit `3ef0c67`) — [SHIPPED-UNVERIFIED] (INFRA). **Verify:** swing upload → debug card shows `frames_sent: 5 / frames_received: 5`.
- **Fault frame persisted as JPEG** (commit `c974779`; threaded through `videoUpload.ts:379-399` → `perShotAnalysis.visual_reference_path`) — [SHIPPED-UNVERIFIED] (PRACTICE). **Verify:** real swing → fault frame thumbnail in swing library row + per-issue card.
- **Layman translation for swing diagnoses** (commit `dedba52`; `layman_explanation` field on poseDetection + swingIssueClassifier + api/swing-analysis prompt) — [SHIPPED-UNVERIFIED] (PRACTICE). **Verify:** non-zero `layman_explanation` returned and rendered. **Parallel deferred:** NOT yet on `/api/putting-analysis`.
- **Honest metric framework — confidence + ranges, source taxonomy** (commits `31156de` + `38727de`; pose wired, acoustic/watch/calibrated/profile/placeholder reserved; `sources[]` slot for fusion; `isTruthGrade` predicate) — [SHIPPED-UNVERIFIED] (PRACTICE). **Verify:** SmartMotion metrics strip shows confidence labels (high/med/low) + ranges, no silent clamp.
- **Acoustic = estimate tier** (commit `ae58836`; `~` + range + med, not truth-grade) — [SHIPPED-UNVERIFIED] (PRACTICE). **Verify:** acoustic ball speed renders with prefix + range.
- **Acoustic ball speed for SmartMotion (Option C)** (commit `516aab9`; parallel recorder on in-app capture) — [SHIPPED-UNVERIFIED] (PRACTICE). **Verify:** SmartMotion capture → acoustic ball speed populates alongside vision metrics.

### Coach Mode + family
- **Coach Mode** (player pick, quick-add, glasses/phone capture, swing analysis, coach notes, skippable spoken tutorial — commit `0ed1fa9`) — [SHIPPED-UNVERIFIED] (PRACTICE). **Verify:** Tank-side flow with a real student capture.
- **Voice "open coach mode" + coaching phrasings** (commit `77b7bee`; sets active player from name) — [SHIPPED-UNVERIFIED] (VOICE). **Verify:** "coach Mike" → player picked + screen opens.
- **Family + perspective threaded through SmartMotion/Cage** (commit `9087ec5`) — [SHIPPED-UNVERIFIED] (PRACTICE). **Verify:** non-self capture attributes to correct family member with correct analyzer routing.
- **Player calibration profile store** (`playerCalibrationStore`, scan-student route) — [SHIPPED-UNVERIFIED] (PRACTICE). **Verify:** scan-student completes; profile saved with valid metric ranges. **Critical gap:** profile is **NOT consumed** by swingMetricsService yet (file comment line 19: "calibration profile is consumed by it in a follow-up").
- **Tank as authorized owner email** (commit `e7933e4`) — [SHIPPED-UNVERIFIED] (INFRA). **Verify:** Tank's Google account opens Owner Tools.

### GPS + hole detection
- **Hardened holeDetection** (10s sustained + 60yd green gate + 30yd transition margin + cart bonus + sequence-aware — landed prior) — [SHIPPED-UNVERIFIED] (ROUND). **Critical verify:** real cart round at Menifee Palms (H12→H13, H14→H15, H16→H17 regression case). Memory says "Real cart round required for verification, not walker or harness alone."
- **Mark Tee** (commit `a375db6`; mirrors Mark Green; player-marked = source of truth) — [SHIPPED-UNVERIFIED] (ROUND). **Verify:** mark tee → tee→green hole length sane → first shot distance reads honestly.
- **subscribePoorSignal** (>15m accuracy sustained 45s) — [SHIPPED-UNVERIFIED] (ROUND). **Verify:** weak-GPS canopy / building → poor-signal toast fires.

### Honesty + telemetry
- **Voice coverage audit + unrecognized command capture** (commit `fe606a5`; `voiceMissStore`; honest spoken fallback) — [SHIPPED-UNVERIFIED] (VOICE). **Verify:** intentional bad command → captured + honest fallback spoken.
- **Glasses perspective routing** (commit `c9fbcd4`; POV self → putting, watching → full swing) — [SHIPPED-UNVERIFIED] (GLASSES). **Verify:** both perspectives upload correctly.
- **Layman feature + persona KB +43 entries** (commit `471c5f5`; bunker / putting / mental / rules-etiquette / improvement-mindset) — [SHIPPED-UNVERIFIED] (VOICE). **Verify:** entries surface in caddie replies.

### Infra / dev tooling
- **AsyncStorage dump panel on /cage-debug** (commit `5f08032`) — [SHIPPED-UNVERIFIED] (INFRA). **Verify:** route to `/cage-debug`, tap "Dump AsyncStorage", confirm all stores visible.
- **Lockstep voice-intent twin comment block** — [SHIPPED-UNVERIFIED] (INFRA).

---

## C. LEFT FOR 1.0 / LAUNCH

> Must ship before launch. Known blockers + launch-critical gaps.

### Blockers
- **Stripe / subscription paywall — STUB ONLY** [PLANNED] (INFRA). `services/paywallGuard.ts` exists with deferred-paywall plumbing + Sentry breadcrumbs, but **no actual Stripe SDK / RevenueCat integration visible**. `SUBSCRIPTIONS_ENABLED` flag in `featureAccess.ts` not yet wired to real billing. Launch-blocker per Wrap 2B.
- **TestFlight submission** [PLANNED] (INFRA). iOS `buildNumber: 3` in app.json suggests prior internal builds; no record of App Store Connect submission. Launch-blocker Wrap 3.
- **Play Store submission** [PLANNED] (INFRA). Android keystore + Play Console submission not visible. Launch-blocker Wrap 3.
- **Real cart-round verification of holeDetection** [PLANNED-VERIFICATION] (ROUND). The H14→H15 fix is in code (`MIN_DISTANCE_FROM_GREEN_YD=60`, `TRANSITION_MARGIN_YD=30`, cart bonus) but has NOT been re-validated on a real Menifee Palms cart round per the standing rule.
- **EAS Build for native modules pending** [PLANNED] (INFRA). Worktree `feat/bt-media-button` (commit `7504099`) contains BT media-button native code (Kotlin + Swift + plugin) — NOT yet `eas build`'d. Same applies if Meta DAT glasses ship a new native rev.

### Launch-critical gaps the code reveals
- **Putt-analysis prompt fix parallel** [PLANNED] (PRACTICE). BUG #1 anti-frame-1-anchoring is in `/api/swing-analysis` only; `/api/putting-analysis` still has the old prompt shape.
- **Putt-analysis layman_explanation** [PLANNED] (PRACTICE). Shipped on swing-analysis only; putting still missing the synthesis.
- **Calibration profile consumed by metrics** [PLANNED] (PRACTICE). `playerCalibrationStore` writes profiles but `swingMetricsService` doesn't read them yet — profile is dead data until wired.
- **Cloud backup for swing library + videos** [PLANNED] (PRACTICE). Roadmap-logged after the uninstall-loses-everything incident (commit `313e416`). No code yet. Memory rule "never uninstall the app" is the only protection today.
- **Real Watch IMU writer** [PLANNED] (PRACTICE). `services/watchService.ts` is scaffold + math + `simulateSwing()` test helper; zero production writers. Needs native-module wiring via EAS Build with the beta wearables SDK.
- **Real MoveNet keypoints** [PLANNED] (PRACTICE). SmartMotion skeleton renders fixed placeholder positions, NOT real pose tracking. Needs the post-sprint TFJS/MoveNet native build.

### Pre-launch verification list (end-of-sprint gate per SPRINT-RESUME)
- [ ] Cold launch → welcome → caddie tab on Z Fold — no flashes, no double-redirects
- [ ] Every SwingLab card reaches a real screen (no 404)
- [ ] SmartMotion validation gate suppresses fabrication on floor footage; real swing produces honest read
- [ ] All 4 personas speak in their own ElevenLabs voice
- [ ] Round start → 18 holes → End Round → recap — no "Maximum update depth" crash (regression test of `5f08032` ancestors)
- [ ] Debug routes return 404/redirect for non-owners
- [ ] APK size ≤ pre-sprint baseline (5.2 MB Hermes)
- [ ] SmartFinder camera-mode overlay + GPS-quality downgrade on weak signal
- [ ] All six voice commands from the last verification pass still work after each commit
- [ ] AsyncStorage dump panel confirms practice-store accumulates from real swings

---

## D. FUTURE — by horizon + pillar

### 1.x — first post-launch wave
- **Putt-analysis prompt parity + layman** (PRACTICE) — port BUG #1 + layman_explanation to `/api/putting-analysis`. Direct parallels.
- **Real-time Meta glasses voice bridge** (GLASSES) — beyond v1's JSON-import path; live transcript stream. Architecturally `externalContext` is already shaped source-agnostic.
- **Acoustic-on-uploads via ffmpeg** (PRACTICE) — extract audio track from uploaded swing videos for acoustic ball speed on non-cage captures.
- **Voice-assistant launch — proper detection** (VOICE) — replace cold-launch-time heuristic with intent-extra (Android `EXTRA_ASSISTANT_INVOCATION_TYPE`) + Siri App Intents (iOS).
- **Quick Record auto-speak coverage** (VOICE/PRACTICE) — the swing analysis auto-speak only fires in Cage Mode today; wire same listener against Quick Record's persist path.
- **Visual swing annotation + Coach Mode markup/audio notes** (PRACTICE) — logged in SPRINT-LOG roadmap (commits `0377062`, `fc969bb`). Pairs with fault-frame persist (already shipped) and competitive differentiator.

### 1.1 — Play tab / multi-player / Serena
- **PLAY tab build-out** (PLAY) — deals/booking + tee-time flow (commit `2e9ff62` roadmap log).
- **Multi-player rounds** (ROUND/PLAY) — `speaker_id: 'self'` default already in 4 paths (P0-5 from Sprint Map). Migration prerequisite.
- **Serena persona — full conversational depth** (VOICE). Persona definitions live in `lib/persona.ts`; per-persona tuning in `api/_voiceTuning.ts`.

### v2+
- **Per-player calibration metric integration** (PRACTICE) — `playerCalibrationStore` writes profiles today; consumer wiring deferred. Foundation already laid.
- **Watch/IMU swing capture** (PRACTICE) — `watchStore` + `watchService` scaffolded; Galaxy Watch beta SDK access unblocked. Native EAS Build required.
- **Social-share flywheel** (PLAY) — roadmap commit `2e9ff62`. Fault-frame persist (`c974779`) is the annotation prerequisite — done.
- **Deals/booking** (PLAY) — paired with social-share, post-launch direction.
- **Cloud backup of library + videos** (PRACTICE/INFRA) — was listed under 1.0 above as launch-critical; v2 is the broader sync architecture (cross-device, share-to-coach).

---

## DRIFT REPORT — where SPRINT-LOG and code disagree

> Repo wins. Flag the doc to fix.

| # | Doc claim | Repo reality | Action |
|---|---|---|---|
| 1 | SPRINT-LOG header mentions "BUG #1 fix" needs verification | Code shipped at commit `45dfe0e`; tagged [SHIPPED-UNVERIFIED] above. No verification log. | Add verification result to SPRINT-LOG when tested. |
| 2 | Calibration profile commit (`c777743`) framed as "foundation for per-player metrics" | Profile **written** by scan-student but **not consumed** by `swingMetricsService`. Comment in `playerCalibrationStore.ts:19` explicitly says "consumed by it in a follow-up". | Log calls out foundation status; OK. Flag for 1.x. |
| 3 | "Fix N — Start Round crash-proofed" needs EAS rebuild | EAS rebuild status not visible from repo. POST_NOTIFICATIONS manifest entry is in app.json. | Verify next EAS Build cuts include the manifest delta on-device. |
| 4 | Voice-intent files claim lockstep | Lockstep warning header added in commit (`58c7a8d` rough — the prompt batch) — twins now self-document divergence risk. | Resolved. |
| 5 | Meta glasses fault summary (Fix #5, commit `c7688e9`) "Option B render both grip + primary issue" | Code matches; PuttingAnalysisCard composes both. | OK. |
| 6 | "Layman feature" generally available | Only on `/api/swing-analysis`. `/api/putting-analysis` lacks the synthesis. | Already flagged in C. |
| 7 | "Mark Tee" closes the yardage loop | Wired (`a375db6`). Tee→green hole-length math exists via haversine on resolved tee + resolved green. | OK; verify on real round. |
| 8 | SPRINT-RESUME says "Day 2 — 2026-05-21" | Last refresh date in SPRINT-RESUME is `2026-05-21`. Sprint has continued through 2026-05-24 (today). | Refresh SPRINT-RESUME. |
| 9 | "Stripe / subscriptions" implied as wired | Only paywallGuard scaffold; no billing SDK calls. | C blocker. |
| 10 | "Hardware verification on cart" repeatedly cited | No cart-round logs in repo since the hardening. | C-block + standing rule per memory. |
| 11 | "BT module shipped" | In worktree (`feat/bt-media-button`), NOT on main, NOT EAS-built. | C blocker. |
| 12 | "Cloud backup planned" | Zero code matches for `cloudBackup` / `sync.*library`. | C / D placement honest. |

---

## E. GLASSES STATE (in-repo only)

> External Meta-app settings tuned outside the repo are out of scope.

- **`MetaWearablesFrameModule.kt`** — DAT camera-stream bridge, Android only — [SHIPPED-UNVERIFIED]. Real-frames-on-device verification pending.
- **`MetaCaddyVoiceHandler.kt`** + manifest + shortcuts.xml — Hey-Google → SmartPlay query handoff path — [SHIPPED-UNVERIFIED]. Requires Google App Actions registration.
- **`withMetaWearablesDAT.js`** Expo plugin — Maven repo + manifestPlaceholders + bluetooth perms + iOS Info.plist + Podfile — [SHIPPED-UNVERIFIED]. Plugin runs at prebuild.
- **Perspective routing** (commit `c9fbcd4`) — POV self → putting; watching someone → full swing — [SHIPPED-UNVERIFIED]. Verify both paths.
- **Glasses POV fault summary** (Fix #5, commit `c7688e9`) — synthesized overall issue + grip detail — [SHIPPED-UNVERIFIED].
- **`metaGlassesIngest.ts`** (commit `ecf57d9`) — JSON-import path; ExternalContext type; `appendExternalContext` FIFO 500; `what_did_meta_say` voice handler — [SHIPPED-UNVERIFIED]. Verify with a real Meta View export.
- **iOS Swift counterpart** — NOT in repo. Meta Wearables DAT is Android-only per `MetaWearablesFrameModule.kt:27-28`.
- **Real-time bridge** — NOT in repo. v1 is JSON-import only. Roadmap 1.x.
- **Audio output routing** — `voiceService.ts` uses `expo-av` with `staysActiveInBackground` + DuckOthers; pairs cleanly with glasses Bluetooth HFP per the README. [SHIPPED-UNVERIFIED].

---

## Summary numbers (rough)

- **VERIFIED:** 2 items
- **SHIPPED-UNVERIFIED:** ~40 items across 6 pillars
- **PLANNED — 1.0 blockers:** ~6 items (Stripe, store submissions, cart-round verify, EAS for natives, putting-analysis parity, calibration consumer)
- **PLANNED — 1.x / 2.0:** ~12 items mapped to pillars

The dominant gap **isn't code — it's verification**. The sprint shipped a large volume of OTA-safe changes. The path from "OTA'd" → "1.0 launched" runs through:
1. A real cart round at Menifee Palms covering H12-H17 (cart-default rule).
2. A real swing capture confirming BUG #1 fix + acoustic + metric ranges.
3. Stripe wired or RevenueCat chosen.
4. TestFlight + Play Store submissions.
5. EAS Build cutting the BT module + any Meta updates.

That is the 1.0 critical path — not more code.

---

**End of audit. Repo is source of truth.**
