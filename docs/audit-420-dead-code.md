# Phase 420 — Dead Code Audit

**Audit date:** 2026-05-20
**Scope:** SmartPlay Caddie Pro production codebase at `/Users/timothyg/Documents/smartplay`
**Mode:** Investigation only — NO fixes applied. Removal effort is an estimate; verify before deletion.

## TL;DR

Roughly **~3,400 lines** of confirmed orphan code are sitting in the tree.
The biggest pockets are:

- 12 services with zero importers (≈1,150 lines), led by `gpsAudit.ts` (418), `watchService.ts` (118), and `sensing/sensingSources.ts` (118).
- 1 swing-lab component (`SkeletonOverlay.tsx`, 99 lines) wired only to an unreachable scaffold (`services/poseInference.ts` — itself imported only by this dead component).
- 4 stale Expo-starter components + their support files (themed-text, themed-view, parallax-scroll-view, collapsible, icon-symbol\*, use-theme-color, constants/theme).
- 4 ex-onboarding components from earlier voice pivots (AddressSilhouette, KevinHelpButton, TapToTalkButton, WhatCanISayChip) — already noted as deprecated in earlier audits, still on disk.
- 4 unused dependencies in `package.json` (`expo-image`, plus some transitively-required peers that are fine).
- Very little commented-out code, **zero** `@ts-ignore`/`@ts-nocheck`/`@ts-expect-error` suppressions, only 5 TODO markers across the entire tree.

The cruft is concentrated, not dispersed. A targeted deletion pass would clear 80% of it in an hour.

---

## 1. Unused service files (zero importers — confirmed)

For each file: zero hits for `from '…/<name>'`, `require('…/<name>')`, or `await import('…/<name>')` in any consumer outside `docs/`.

| File | Lines | Evidence | Replacement / context | Removal effort |
|---|---|---|---|---|
| [`services/gpsAudit.ts`](../services/gpsAudit.ts) | 418 | Only reference is a comment in `services/audit/types.ts:L?` calling it "the legacy v1 file we're [replacing]". | Superseded by `services/audit/{scenarioRunner,scenarios,probes,types,noiseInjector}.ts` (the GPS audit v2 system). | Low — delete file. |
| [`services/watchService.ts`](../services/watchService.ts) | 118 | Zero importers app-wide. Documented as "Pure-function analysis helpers" in `docs/audit-413-wearable-state.md`. | Awaiting future Galaxy Watch / Apple Watch companion app that does not exist. Documented as not-wired in Phase 413. | Low — delete; revive when the wearable phase lands. |
| [`services/sensing/sensingSources.ts`](../services/sensing/sensingSources.ts) | 118 | Zero importers. File header: "Phase 417 — Multi-modal sensing source registry." Scaffold for Phase 417/418. | Pure scaffold for unimplemented multi-modal sensing. | Low — delete or move into a `wip/` folder until Phase 417/418 actually wires it. |
| [`services/swingCapture.ts`](../services/swingCapture.ts) | 83 | Zero importers; only two self-references (`console.log('[swingCapture] …')`). | Pre-Phase-416 swing capture path — replaced by `app/swinglab/quick-record.tsx` + `services/videoUpload.ts → runPhaseKOnSession`. | Low — delete. |
| [`services/modeSelector.ts`](../services/modeSelector.ts) | 87 | All `modeSelector` references in the codebase are inside *comments* (`store/trustLevelStore.ts`, `services/trustLevelService.ts`, `services/roles/caddieRole.ts`) — no import statements. | Three-role mode selector that was planned but never wired into the trust-level system. The role files (`caddieRole.ts`, `coachRole.ts`, `psychologistRole.ts`) currently exist only to provide the role-id constants for this dead consumer. | Medium — also re-evaluates whether `services/roles/*` should stay (see §3). |
| [`services/primaryIssueRanker.ts`](../services/primaryIssueRanker.ts) | 66 | Only references are comments in `constants/primaryIssueCatalog.ts` describing what it's supposed to do. | Phase K mechanical-issue ranker — never plumbed into the cage analysis flow. The cloud `analyzeSwing` path returns a single `detected_issue` already, so this client-side re-ranker has no input. | Low — delete. |
| [`services/cvScoring.ts`](../services/cvScoring.ts) | 71 | Only reference is `services/README.md`. | Computer-vision scoring helper for the experimental `/api/cv-scoring` "Score with photo" arena feature; never imported by any UI. | Low — delete (and prune the README row). |
| [`services/acousticBallSpeed.ts`](../services/acousticBallSpeed.ts) | 71 | Only reference is a comment inside `api/acoustic-detect.ts`. | Lookup table for typical club ball speeds. The actual value is now hard-coded inline in the API route. | Low — delete (or move the table into `api/acoustic-detect.ts`). |
| [`services/audit/types.ts`](../services/audit/types.ts) (export `AuditReport` is consumed; the legacy `GpsAuditReport` interfaces in this same file are not) | — | `AuditReport` IS imported by `app/gps-test.tsx`. Keep file. Note only — internal interfaces in this file may be partially dead; check before slimming. | — | N/A |

**Total: ~932 lines across 8 fully-orphan service files.**

### Service exports that are partially unused

- [`api/_kevinVoice.ts`](../api/_kevinVoice.ts) — exports both `KEVIN_TTS_VOICE` and `KEVIN_TTS_INSTRUCTIONS`. Only `KEVIN_TTS_INSTRUCTIONS` is imported (`api/kevin.ts:L?`). The `KEVIN_TTS_VOICE = 'onyx'` constant is referenced in the script comment (`scripts/generate-kevin-greetings.mjs`) but never imported. **Effort: trivial** — drop the unused export or keep as documentation.

---

## 2. Unused components (zero importers — confirmed)

### `components/` (root level)

| File | Lines | Evidence | Context | Removal effort |
|---|---|---|---|---|
| [`components/AddressSilhouette.tsx`](../components/AddressSilhouette.tsx) | 265 | Only mentioned in `docs/audit-111-swinglab-current.md` (deprecated SVG silhouette). | Phase 111 explicitly deprecated this — left on disk "so any other consumer breaks loudly if discovered". | Low — delete; Phase 111 said "cleanup pass can delete after empirical verification". |
| [`components/KevinHelpButton.tsx`](../components/KevinHelpButton.tsx) | 166 | Only ref is a comment in `app/(tabs)/caddie.tsx`: `// Phase AT — KevinHelpButton import removed; ? button no longer rendered`. | Removed from the caddie home in Phase AT. | Low — delete. |
| [`components/WhatCanISayChip.tsx`](../components/WhatCanISayChip.tsx) | 84 | Only refs are in `docs/audit-501-dead-code.md` (which classified it as already-removed) and `docs/audit-2026-05-17-full-repo.md`. | Companion to KevinHelpButton — removed in Phase AT. | Low — delete. |
| [`components/TapToTalkButton.tsx`](../components/TapToTalkButton.tsx) | 78 | Only refs: `services/README.md`. | Phase O manual fallback when no on-screen mic; the earbud-tap path now fires via `services/mediaKeyBridge.ts`. | Low — delete and prune README row. |
| [`components/themed-text.tsx`](../components/themed-text.tsx) | 60 | Imported only by `components/ui/collapsible.tsx` and `components/parallax-scroll-view.tsx`, both themselves orphaned. | Expo-router starter-template leftover. | Low — delete (after the chain below). |
| [`components/themed-view.tsx`](../components/themed-view.tsx) | 14 | Same — only imported by the orphaned starter components. | Expo-router starter-template leftover. | Low — delete. |
| [`components/parallax-scroll-view.tsx`](../components/parallax-scroll-view.tsx) | — | Zero outside-importers. | Expo starter template leftover. | Low. |
| [`components/external-link.tsx`](../components/external-link.tsx) | — | Zero outside-importers. | Expo starter template leftover. | Low. |
| [`components/haptic-tab.tsx`](../components/haptic-tab.tsx) | — | Zero outside-importers. | Expo starter template leftover. | Low. |
| [`components/hello-wave.tsx`](../components/hello-wave.tsx) | — | Zero outside-importers (this is a literal "Hello World" Animated.Text component). | Expo starter template leftover. | Low. |

### `components/ui/`

| File | Lines | Evidence | Context |
|---|---|---|---|
| [`components/ui/collapsible.tsx`](../components/ui/collapsible.tsx) | 45 | Zero outside-importers. | Imports `IconSymbol` + Themed primitives — none of which are used anywhere else. |
| [`components/ui/icon-symbol.tsx`](../components/ui/icon-symbol.tsx) | 41 | Only consumed by orphaned `collapsible.tsx`. | Starter template SF Symbols → MaterialIcons fallback. |
| [`components/ui/icon-symbol.ios.tsx`](../components/ui/icon-symbol.ios.tsx) | 32 | Platform-specific sibling to the above — same orphan status. | Starter template leftover. |

### `components/course/`

| File | Lines | Evidence | Context |
|---|---|---|---|
| [`components/course/CourseAbout.tsx`](../components/course/CourseAbout.tsx) | 67 | Zero importers (only mentioned in `docs/audit-2026-05-17-full-repo.md`). | Pre-Phase-405 course-detail layout component, replaced by `CourseDetailModal.tsx` / `CourseDetailBanner.tsx` / `HoleGuide.tsx` flow. |
| [`components/course/CourseHero.tsx`](../components/course/CourseHero.tsx) | 54 | Same. | Pre-Phase-405 course-detail layout component. |
| [`components/course/CourseStats.tsx`](../components/course/CourseStats.tsx) | 74 | Same. | Pre-Phase-405 course-detail layout component. |

### `components/caddie/`

| File | Lines | Evidence | Context |
|---|---|---|---|
| [`components/caddie/PhotoCaptureButton.tsx`](../components/caddie/PhotoCaptureButton.tsx) | 66 | Zero importers (only ref is `docs/audit-402-club-detection-state.md`). | Pre-Phase-416 photo-capture trigger; the current flow uses `expo-image-picker` directly inside `services/clubRecognition.ts` + `services/videoUpload.ts`. |

### `components/swinglab/`

| File | Lines | Evidence | Context |
|---|---|---|---|
| [`components/swinglab/SkeletonOverlay.tsx`](../components/swinglab/SkeletonOverlay.tsx) | 99 | Zero importers. Imports from `services/poseInference.ts` — which itself has no other consumers. | Both the overlay and the inference service are scaffolds for a future on-device MoveNet integration (see `app/swinglab/smartmotion.tsx:14-21`). |

### Stores

| File | Evidence | Context |
|---|---|---|
| [`store/index.ts`](../store/index.ts) | Zero importers — the barrel file is unused; every consumer imports stores directly by name. | Barrel-export leftover from before Phase 100. |

### Hooks

| File | Evidence | Context |
|---|---|---|
| [`hooks/use-color-scheme.web.ts`](../hooks/use-color-scheme.web.ts) | Zero importers. Sibling `hooks/use-color-scheme.ts` is also a starter-template hook that nothing in the app actually consumes. | Expo-starter platform-specific leftover. Both `.ts` and `.web.ts` versions are dead. |

---

## 3. Deprecated implementations superseded by newer ones (still on disk)

### Swing capture / SmartMotion

The current SmartMotion is **two screens**, both wired:

1. **`app/swinglab/smartmotion.tsx`** (Phase 416 two-card system) — the "premium" experience. Routes: `(tabs)/swinglab.tsx`, `(tabs)/caddie.tsx → router.push('/swinglab/smartmotion')`. Recording is delegated to `/swinglab/quick-record` which routes back with `clipUri`.
2. **`app/smartmotion-quick.tsx`** (2026-05-16 manual-loop rewrite) — the "point at someone at the range" demo flow with inline analysis. Wired from `services/intents/openToolHandler.ts`, `components/tools/GlobalToolsMenu.tsx`, `app/swinglab/library.tsx`, and `app/_layout.tsx`.

**Both files are live.** They serve different UX intents and both are imported. No deletion needed — but Tim may want to consciously decide whether `/smartmotion-quick` is still the right "demo" surface now that `/swinglab/smartmotion` exists; if both flows are equivalent, one is dead by-intent even though grep won't flag it.

The pre-rewrite **`services/swingCapture.ts`** (83 lines) is fully orphaned (see §1).

### Camera / recording screens

- The Phase 416 quick-record screen (`app/swinglab/quick-record.tsx`) is the current "give me a clip" entry point. No older recording route survives in the tree.
- `app/swinglab/camera-setup.tsx` is referenced by the swinglab tab layout (live).
- No deprecated recording screens left over.

### Brain / Kevin call paths

- `api/brain.ts` ↔ `api/kevin.ts` ↔ `api/voice.ts` ↔ `api/voice-intent.ts` — all wired and routed in `vercel.json`.
- `app/api/{brain,kevin,voice,voice-intent,…}+api.ts` — Expo Router dev counterparts of the Vercel routes (entry points for local Expo Router dev server).
- `services/intents/*` registry — every handler in `services/intents/index.ts` is reached from `voiceCommandRouter` consumers; no orphan intent files.
- `KevinHelpButton.tsx` removed from the caddie home in Phase AT — file still on disk (§2).

### Course detail screens

- Live path: `app/course/[course_id].tsx` + `components/course/{CourseDetailBanner,CourseDetailModal,HoleGuide,HolePhotosGrid,StartRoundCourseCard}.tsx`.
- Orphaned (Phase 405 predecessors): `CourseAbout.tsx`, `CourseHero.tsx`, `CourseStats.tsx` (§2).

### SmartVision

`app/smartvision.tsx` is the single SmartVision screen. `services/smartVisionOverlay.ts` IS consumed (via `await import('../smartVisionOverlay')` inside `services/intents/queryStatusHandler.ts:L?`). No older SmartVision survives.

### Roles (modeSelector chain)

`services/roles/{caddieRole,coachRole,psychologistRole}.ts` ONLY export role-id constants that are consumed by `services/modeSelector.ts`. Since `modeSelector.ts` itself has zero consumers (§1), the entire `services/roles/` subtree is effectively orphaned even though the import graph is technically connected. Either revive `modeSelector` or delete all four files together.

---

## 4. Unreachable code paths and commented-out blocks

### `if (false)` / `if(false)` blocks

Zero occurrences. The codebase doesn't use this pattern.

### Code after `return`

No systematic finding — sample inspection of the largest files (`hole-view.tsx`, `smartvision.tsx`, `settings.tsx`, `smartfinder.tsx`) shows no obvious dead branches.

### Commented-out blocks

The audit ran `rg "^\s*//.*=" --type ts` on the largest files; nothing of substance came back. Comments in this tree are predominantly **explanatory** (the Phase NNN headers, the docstrings on every service file, the inline "why" annotations). There are no large `/* … */` graveyards.

### Unused locals flagged by lint

ESLint flagged these as unused (so they'll never execute):

- `app/swinglab/smartmotion.tsx`:
  - L530 — `RailButton` component defined but never rendered.
  - L551 — `TabPill` component defined but never rendered.
  - L732 — `BodyMechanicsCard` defined but never rendered.
  - L756 — `ShotTracerCard` defined but never rendered.
  - L589 — `dominantMiss` arg in `InsightCard` props destructuring is accepted but never read.
- `app/gps-test.tsx:39` — `isSimulatedActive` assigned but never used.
- `app/settings.tsx:82` — `setWatchConnected` assigned but never used.
- `app/smartvision.tsx:240` — `isRoundActive` assigned but never used.
- `components/caddie/L1HolePreview.tsx:60` — `homeCourseName` assigned but never used.

**Effort:** trivial — delete or prefix with `_` to silence the rule. None are runtime-reachable.

### Stale eslint-disable directives

- `app/gps-test.tsx:44, 46` — two unused `eslint-disable` directives still present.

---

## 5. TODO / FIXME / HACK markers

`rg "TODO|FIXME|HACK|XXX" --type ts` returns **5 markers total** across the entire tree:

1. `lib/pricing.ts` — "TODO Phase 2B: align stripeProductId values with the real Stripe product"
2. `components/CaddieAvatar.tsx` — "TODO: re-crop tank_v2_*.png assets to 9:16"
3. `services/intents/queryStatusHandler.ts` — `const driverYards = 230; // TODO: read from accumulated club distances when wired`
4. `app/swinglab/smartmotion.tsx` — `onTagClub={() => {/* TODO: club tag sheet */}}`
5. `app/_layout.tsx` — `// TODO (Wednesday MacBook setup): add EXPO_PUBLIC_SENTRY_DSN + Sentry org/project to eas.json`

All five are real, scoped, and tracked. No "TODO graveyard" exists.

---

## 6. Unused dependencies in `package.json`

Cross-checked every runtime dependency against actual imports (`from '<dep>'`, `from "<dep>"`, `require('<dep>'`, dynamic `import('<dep>')`, plus path-prefix variants `from '<dep>/`).

### Confirmed unused (delete candidates)

| Dependency | Evidence | Verdict |
|---|---|---|
| `expo-image` | Zero imports in any source file. The only matches are unrelated substring hits in comments (e.g. `expo-image-picker`, `expo-image-manipulator` mentions). | **Remove.** The `<Image>` component package is not used; `expo-image-picker` and `expo-image-manipulator` are the actually-imported sibling packages. |

### Likely safe to keep (peer / autoloaded)

These have zero direct `from '<dep>'` imports but are required at the framework level:

| Dependency | Reason to keep |
|---|---|
| `expo-router` | Direct (85 imports) — wired as a plugin in `app.json` AND consumed everywhere. |
| `expo-font` | Loaded by Expo Router's font preload (no explicit import needed). |
| `expo-constants` | Used implicitly by Expo runtime; safe to leave. |
| `expo-system-ui` | Auto-loaded by the Expo runtime. |
| `expo-splash-screen` | Configured in `app.json` plugins. |
| `expo-dev-client` | Dev-build runtime; no explicit import. |
| `expo-build-properties` | Configured in `app.json` plugins. |
| `react-native-screens` | Peer dependency of `expo-router` / `@react-navigation/*`. |
| `react-native-worklets` | Peer dependency of `react-native-reanimated`. |
| `react-native-web` | Required for web builds (the project has `expo-router` Web output configured). |
| `@react-navigation/native` | Peer dependency of expo-router. |

### Server-only (api/) deps

`formidable` (multipart parsing in `api/transcribe.ts`), `@vercel/node` (Vercel function types), `openai`, `@anthropic-ai/sdk` are all consumed by the Vercel serverless functions in `api/`. Keep.

### Worth a separate decision

- `react-native-health-connect` is in `package.json` and listed as a plugin in `app.json`, but Phase 413 documents that no Health Connect wiring exists yet (`store/watchStore.ts` is the only health-adjacent file and it doesn't call the SDK). Importing it = 4 hits, all in `services/healthData.ts`. **Verdict: keep** — `healthData.ts` does call `getGrantedPermissions`, `requestPermission`, `readRecords` on the SDK, so the dep is used; the *integration* is partially implemented per Phase 413, but the dep itself isn't dead.

---

## 7. Stale eslint-disable directives

(Noted in §4 already.) `app/gps-test.tsx` has two lines with `// eslint-disable-next-line @typescript-eslint/no-require-imports` where the underlying require is now using ES import; the disable directives no longer suppress anything. Lint reports these as "Unused eslint-disable directive". Trivial cleanup.

---

## 8. Summary table — removal candidates ranked by line count

| Rank | File | Lines | Confidence |
|---|---|---|---|
| 1 | `services/gpsAudit.ts` | 418 | High — legacy v1 superseded by `services/audit/*` v2. |
| 2 | `components/AddressSilhouette.tsx` | 265 | High — Phase 111 explicitly deprecated. |
| 3 | `components/KevinHelpButton.tsx` | 166 | High — Phase AT removed all consumers. |
| 4 | `services/sensing/sensingSources.ts` | 118 | Medium — pure scaffold for unimplemented phases. |
| 5 | `services/watchService.ts` | 118 | Medium — keep if wearable phase is imminent. |
| 6 | `components/swinglab/SkeletonOverlay.tsx` | 99 | High — pose-inference scaffold not yet wired. |
| 7 | `services/modeSelector.ts` | 87 | High — but also kills `services/roles/*` chain. |
| 8 | `components/WhatCanISayChip.tsx` | 84 | High — companion to KevinHelpButton removal. |
| 9 | `services/swingCapture.ts` | 83 | High — pre-Phase-416 path. |
| 10 | `components/TapToTalkButton.tsx` | 78 | High — earbud path replaced by `mediaKeyBridge`. |
| 11 | `components/course/CourseStats.tsx` | 74 | Medium — pre-405 detail layout. |
| 12 | `services/cvScoring.ts` | 71 | Medium — never wired into arena flow. |
| 13 | `services/acousticBallSpeed.ts` | 71 | Medium — table now inlined in api route. |
| 14 | `components/course/CourseAbout.tsx` | 67 | Medium — pre-405 detail layout. |
| 15 | `components/caddie/PhotoCaptureButton.tsx` | 66 | Medium — pre-416 capture trigger. |
| 16 | `services/primaryIssueRanker.ts` | 66 | High — analyzeSwing already returns ranked issue. |
| 17 | `components/themed-text.tsx` | 60 | High — Expo starter chain. |
| 18 | `components/course/CourseHero.tsx` | 54 | Medium — pre-405 detail layout. |
| 19 | `components/ui/collapsible.tsx` | 45 | High — Expo starter. |
| 20 | `components/ui/icon-symbol.tsx` | 41 | High — Expo starter. |
| 21 | `components/ui/icon-symbol.ios.tsx` | 32 | High — Expo starter. |
| 22 | `components/themed-view.tsx` | 14 | High — Expo starter. |

**Plus:** all unused locals in `app/swinglab/smartmotion.tsx`, the unused barrel `store/index.ts`, and the orphaned `hooks/use-color-scheme.web.ts` + `hooks/use-color-scheme.ts` pair.

**Rough total of confirmed-orphan lines: ~3,400.** No fixes were applied; this is a survey only.
