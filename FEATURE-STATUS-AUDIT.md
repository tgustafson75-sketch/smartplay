# FEATURE-CLUSTER STATUS AUDIT — Smart Play / TightLie / SmartMotion / SmartVision / Sprint Log Next-Up

**Date:** 2026-05-24
**Mode:** Read-only. No source files modified. Only this doc is written.
**Bar:** brutally honest. WORKING vs STUBBED vs MISSING. Flag every simulate*/mock/placeholder/TODO.
**Authoritative cross-reference:** [BUILD-STATE-AUDIT.md](BUILD-STATE-AUDIT.md) (the v0 verified-vs-shipped split).

---

## SECTION 1 — "SMART PLAY"

### (a) Feature/route/component literally named SmartPlay (distinct from brand)

**Result: NONE.** Every "SmartPlay" hit outside the brand is one of:
- App-name string in user-facing copy (e.g. "SmartPlay gives you four AI caddies" in `app/quick-start.tsx:49`)
- A banner / UI label in the play tab and recap (`app/(tabs)/play.tsx:5`, `app/recap/[round_id].tsx:276`)
- Internal storage key prefix `@smartplay/...` in `services/paywallGuard.ts:19` / `services/courseGreenOverrides.ts:24`
- Comment / persona docstring references in `services/glassesVisionInput.ts`, `services/metaGlassesBridge.ts`
- Permission descriptions ("SmartPlay needs mic access…" etc.)

**No feature route at `/smart-play`, no `<SmartPlay>` component, no `smartPlayMode` flag.** Brand-only.

### (b) PLAY pillar status

**File:** [app/(tabs)/play.tsx](app/(tabs)/play.tsx) — exists.
**What it does today:**
- SmartPlay banner header
- "Course Discovery" reticle (placeholder UI; not yet wired into SmartFinder)
- "Closest local courses" recent + curated nearby list (real)
- "Golfcourseapi search" with filter toggle (Courses / Range + Practice) (real — calls `golfCourseApi.searchCourses`)
- Selected-course card with thumbnail + stats + 3 buttons: **Start Round** (wired), **Hole Map** (wired), **Range Book** (likely placeholder per file header — not verified mid-audit)

**Verdict: SCAFFOLDED + PARTIALLY WORKING.** Course discovery + start-round flow works. Range-booking + deals/booking layer = roadmap (per commit `2e9ff62`, BUILD-STATE-AUDIT.md §D 1.1).

### (c) "make the smart play" — fully gone from user-facing copy?

**Result: ✓ ZERO user-facing hits.** Grep over `app/ services/ components/ lib/ api/ docs/` returns zero matches today. The single prior instance (`services/personaKnowledgeBase.ts:230`, Tank's tankAnswer for tight-pin scenario) was replaced with "Take the percentage shot" in v1.2 commit `3931004`.

**Edge case — classifier hint string (NOT user-facing output):**
[app/api/voice-intent+api.ts:55](app/api/voice-intent+api.ts#L55) — `"smart play"` appears as one of MANY example phrases the Haiku classifier uses to recognize a strategy intent:
```
- "what's the play" / "what's the play here" / "what should I hit" / "give me the play" / "smart play" / "tell me the play" -> { query_topic: "shot_strategy" }
```
This is a **recognizer hint** (matches if user says "smart play"); it never produces user-facing output. **Not a brand violation per the rule** ("NEVER use phrase 'make the smart play' in app, copy, or marketing"), but worth flagging for awareness — keeps voice intent recognition intact for users who say it.

---

## SECTION 2 — TIGHT LIES / TIGHTLIE

### (1) Exists? Where?

✓ **Yes.** Branded **"TightLie"** (the user-facing label). Internal identifier `lie_analysis` (legacy name kept to avoid file/route renames per [services/intents/openToolHandler.ts:11-21](services/intents/openToolHandler.ts#L11) comment).

**Files / routes:**
- [app/lie-analysis.tsx](app/lie-analysis.tsx) — primary screen + camera capture + analysis UI
- [services/lieAnalysisService.ts](services/lieAnalysisService.ts) — analyzer pipeline
- [services/lieAnalysisContext.ts](services/lieAnalysisContext.ts) — pending-analysis state for the caddie brain to consume
- [store/roundStore.ts](store/roundStore.ts) `pendingLieAnalysis` field — slot for the latest analysis the caddie reads on the next "what's the play"

### (2) What it does today

- User taps "TightLie" affordance on the Caddie tab (footer button row, [app/(tabs)/caddie.tsx:2397-2412](app/(tabs)/caddie.tsx#L2397))
- Screen opens with camera permission flow ("TightLie needs the camera to look at your shot")
- Captures a photo of the lie
- Photo posted to a vision endpoint → returns lie classification (rough / fairway / bunker / waste / divot / cart-path) + advice
- Sets `roundStore.pendingLieAnalysis` so the caddie brain reads lie context on the next "what's the play"
- Voice triggers: "open TightLie", "check my lie", "tight lie", "analyze my lie", "what's the play" (when on the lie-analysis screen)

### (3) WORKING vs STUBBED

**WORKING — end-to-end production path.** Real camera capture, real vision-API call, real persistence, real caddie-brain consumption. No simulate*/mock/placeholder in the lie path. Voice routes wired through [api/voice-intent.ts](api/voice-intent.ts) (intent `open_tool` / `tool_name: "lie_analysis"` or alias `"tightlie"`) → `openToolHandler` → `router.push('/lie-analysis?intent=aggressive|conservative')`.

### (4) Honesty caveats

- **`play_intent` parameter** (aggressive / conservative) is honored — pre-fills the analysis bias.
- **`bullseye_offsets: []`** in cage-coach payloads is **intentionally empty** because CV scoring isn't built (`services/cageApi.ts` per Fix G — "we don't have CV scoring and won't fake one"). This is the cage path, NOT TightLie itself, but the same honesty principle applies.
- The vision endpoint is shared by other vision features (SmartVision, glasses POV). If the endpoint is overloaded or unconfigured, the screen returns a graceful failure (no fabricated lie). Localized fallbacks per Fix I.

---

## SECTION 3 — SMARTMOTION

### Files audited

- [app/swinglab/smartmotion.tsx](app/swinglab/smartmotion.tsx) (1900+ lines)
- [services/swingMetricsService.ts](services/swingMetricsService.ts)
- [services/poseDetection.ts](services/poseDetection.ts)
- [app/swinglab/quick-record.tsx](app/swinglab/quick-record.tsx)
- [api/swing-analysis.ts](api/swing-analysis.ts) (Vercel route) + [app/api/junior-swing-analysis+api.ts](app/api/junior-swing-analysis+api.ts) for the family-coaching variant

### Metrics rendered (SmartMotion two-card system, Phase 416)

| Metric | Source today | Confidence tier | Honest label rendered? |
|---|---|---|---|
| Club Speed (mph) | Pose-estimated via heuristic constant | low–med (0.20–0.70) | ✓ tier + range shown (per AUDIT-metric-provenance.md) |
| Ball Speed (mph) | `club_speed × typicalSmash[club]` synthesized OR acoustic when present | low for synth; med for acoustic | ✓ `~` prefix + range when acoustic (Option C1) |
| Smash Factor | Derived (tautological when both inputs synthesized) | low (0.36–0.56) | ✓ |
| Carry (yds) | `ball_speed × 1.4` (irons) / `× 1.65` (woods) synthesized OR from profile dict | low–med | ✓ |
| Detected fault / severity / observation | **MEASURED** — Sonnet vision read of 5 keyframes | model-stated high/med/low | ✓ |
| Fault frame index + visual reference path | **MEASURED** — Sonnet picks fault frame, persisted as JPEG | n/a | ✓ |
| Layman explanation | **MEASURED** — Sonnet synthesizes plain-language gloss | n/a | ✓ (rendered on PrimaryIssueCard) |

**Source taxonomy** (commit `38727de`): pose wired, acoustic/watch/calibrated/profile/placeholder reserved, `sources[]` slot for fusion. `isTruthGrade` predicate gates the high-confidence presentation path.

### Acoustic ball-speed wiring

✓ **WIRED for in-app captures** (Option C, commit `516aab9`). Parallel `Audio.Recording` chain runs alongside the video capture; on stop, the audio clip goes through `acousticImpactDetector` → `/api/acoustic-detect` → returns peak-dB-derived ball speed. Synthesizer emits `source: 'acoustic'` for ball speed when present (estimate tier, NOT truth-grade per C1, commit `ae58836`). Rendered with `~` prefix and range.

**Coverage gap:** Camera-roll uploads (non-in-app captures) do NOT get acoustic — no audio chain attached. Ball speed falls back to the synthesized `club_speed × typicalSmash` estimate.

### BUG #1 anti-frame-1-anchoring prompt state

✓ **ACTIVE in production** ([api/swing-analysis.ts:145-150](api/swing-analysis.ts#L145)). Commit `45dfe0e`. The TEMPORAL ANALYSIS block explicitly instructs the model:
> "Frame 1 is frequently the LEAST informative frame… NEVER base your diagnosis on frame 1 alone. If frame 1 is uninformative (ground, feet, empty scenery, address-only with no other reads available from it), say so briefly in the observation and base your read on the frames that actually show the swing."

[SHIPPED-UNVERIFIED] per BUILD-STATE-AUDIT.md — code is live; on-device verification with a real swing video pending. **Parallel gap:** the same prompt fix is NOT yet ported to [app/api/putting-analysis+api.ts](app/api/putting-analysis+api.ts).

### CRITICAL — Pose skeleton: REAL or PLACEHOLDER?

**🚨 The rendered skeleton is overwhelmingly a PLACEHOLDER, with a real-pose branch that rarely activates today.**

**Two overlays exist:**

1. **`StubSkeletonOverlay`** ([app/swinglab/smartmotion.tsx:1680-1745](app/swinglab/smartmotion.tsx#L1680)) — **HARDCODED normalized joint positions**:
   ```ts
   const STUB_SKELETON_JOINTS: { x: number; y: number; label: string }[] = [
     { x: 50, y: 10, label: 'nose' },
     { x: 40, y: 24, label: 'left_shoulder' },
     { x: 60, y: 24, label: 'right_shoulder' },
     { x: 32, y: 37, label: 'left_elbow' },
     { x: 68, y: 37, label: 'right_elbow' },
     { x: 42, y: 52, label: 'left_wrist' },
     { x: 58, y: 52, label: 'right_wrist' },
     { x: 44, y: 53, label: 'left_hip' },
     { x: 56, y: 53, label: 'right_hip' },
     { x: 42, y: 70, label: 'left_knee' },
     { x: 58, y: 70, label: 'right_knee' },
     { x: 38, y: 88, label: 'left_ankle' },
     { x: 62, y: 88, label: 'right_ankle' },
   ];
   ```
   Origin: [app/swinglab/smartmotion.tsx:1808-1822](app/swinglab/smartmotion.tsx#L1808). These are **literal constants** representing a face-on golfer in setup pose. They do NOT move with the player's actual body. The skeleton renders the SAME 13 fixed coordinates on every swing.

2. **`RealSkeletonOverlay`** ([app/swinglab/smartmotion.tsx:1530+](app/swinglab/smartmotion.tsx#L1530)) — renders real keypoints from `/api/pose-analysis` (RapidAPI MoveNet proxy) for the most diagnostic frame (P6_impact → P4_top → fallback).

**Why the real overlay rarely activates today:**
- `/api/pose-analysis` is **env-gated off** when `POSE_API_KEY` + `POSE_API_HOST` env vars are not configured (Fix H, commit not on-record — file header says "graceful 503 → 200-with-null when unconfigured"). The current production deployment has these env vars unset; endpoint returns `{ data: null, configured: false }`.
- When `data: null`, the smartmotion view falls back to `StubSkeletonOverlay`.
- Source: [app/swinglab/smartmotion.tsx:283-284](app/swinglab/smartmotion.tsx#L283) — "RealSkeletonOverlay falls through to StubSkeletonOverlay so the skeleton renders even without pose data."

**Definitive verdict: PLACEHOLDER.** Until a RapidAPI subscription + env vars land — OR — TFJS / MoveNet native module is shipped via EAS Build (post-sprint per [docs/SPRINT-RESUME.md](docs/SPRINT-RESUME.md): "live overlay renders fixed placeholder positions, NOT real MoveNet tracking"), the on-screen skeleton bones move with the videoRect scale but the joints stay at fixed 0-100% normalized positions. **The 5-keyframe Sonnet vision read still produces a real diagnostic observation** (BUG #1 fix above) — that's the actual analysis. The skeleton overlay is decorative.

**Suppression caveat:** Phase 418 validation gate ([services/swingValidity.ts](services/swingValidity.ts)) prevents the skeleton from rendering against floor footage / non-swing video so the user never sees the stub overlaid on irrelevant footage with fake confidence. ✓ Honest.

---

## SECTION 4 — SMARTVISION

### Status: SUPERSEDED in rendering layer; CONTEXT preserved as a state container

**The name "SmartVision" persists** in the codebase but the rendering pipeline moved through 3 phases:

1. **Phase S (legacy)** — satellite/imagery-based SmartVision hole view (Mapbox + Google Static Maps).
2. **Phase AN** — `VectorHoleView` ([components/smartvision/VectorHoleView.tsx](components/smartvision/VectorHoleView.tsx)): stylized SVG vector renderer using real tee+green coords from golfcourseapi or override stores. Renders instantly, no network. Used when coords are present.
3. **Phase 2026-05-22 (Golfshot UX)** — `GolfshotHoleView` ([components/smartvision/GolfshotHoleView.tsx](components/smartvision/GolfshotHoleView.tsx)): the current canonical hole renderer. Uses `holeImageMapper` priority chain: local bundled screenshot → Mapbox satellite → Google satellite. Adds draggable Y (layup) + P (pin) markers with per-(course, hole) calibration persisted across rounds.

### What renders today

**Hole view path** ([app/hole-view.tsx](app/hole-view.tsx) `displayType` switch, lines ~390-400):
1. `bundledImage` present → `'bundled'` → **GolfshotHoleView with local screenshot**
2. `canGolfshotRemote` (tee+green coords + Mapbox/Google configured) → `'bundled'` → **GolfshotHoleView with remote tile**
3. `hasVectorCoords` only → `'vector'` → **VectorHoleView SVG**
4. `satelliteUrl` only → `'satellite'` → **legacy satellite Image** (measure-mode UI)
5. nothing → `'none'` → empty state with hole/par text

**v1.2 addition:** `CourseHole.backgroundImageUri` override + `imageOverrideUri` prop on GolfshotHoleView (commit `eceeaeb`) — Tim's hand-curated screenshot wins over Mapbox/local chain when set.

### Data source

- **Local bundled images**: `data/localCourseImages.ts` + `data/palmsImages.ts` (Palms alias). Bundled assets shipped with the app for home-courses Tim photographed.
- **Mapbox tiles**: `services/mapboxImagery.ts` `getHoleImageryUrl()` — composes a fit-to-hole satellite URL from tee+green coords + container size.
- **Google Static Maps**: legacy fallback when Mapbox token not configured.
- **Vector**: tee+green coords only (golfcourseapi or `useCourseGeometryOverrideStore` or Mark Tee/Green overrides or new TRUTH coords).
- **Marker calibration**: `useHoleMarkerCalibrationStore` — per-(course, hole) drag-saved Y/P positions persisted across rounds.

### Working vs STUBBED

✓ **WORKING.** Every branch of the priority chain produces a real rendered hole view from real data. No simulate/mock fallbacks. Honest fallback label (`reason: 'no_geometry'`) on the SmartFinder card when no live green coord exists (Consolidation 5 Part 1) — surfaces a "SCORECARD" pill + `~` prefix so the user reads card-distance as estimate.

### Honesty caveats

- **`SmartVisionContext`** ([contexts/SmartVisionContext.tsx](contexts/SmartVisionContext.tsx)) is still a live state container — used by `app/hole-view.tsx` to publish `centerYards` / `measureYards` / `analysisText` to other surfaces (the caddie tab subscribes for the "Kevin's read" overlay). It IS a working pipe. Just the name persists despite the rendering shift.
- **`runSmartVision()` callback** at [app/hole-view.tsx:658](app/hole-view.tsx#L658) is the satellite-analysis branch. Active ONLY when `displayType === 'satellite'`. Not the default path on modern courses with coords.
- **iOS Mapbox token configurable** via app.json plugin; if absent, Google Static Maps fallback fires; if both absent, vector-only path renders.

---

## SECTION 5 — SPRINT LOG NEXT-UP (verbatim, not summarized)

Read [docs/SPRINT-LOG.md](docs/SPRINT-LOG.md), [docs/SPRINT-RESUME.md](docs/SPRINT-RESUME.md), root audit/diagnosis docs ([BUILD-STATE-AUDIT.md](BUILD-STATE-AUDIT.md), [ES-ZH-VOICE-DIAGNOSIS.md](ES-ZH-VOICE-DIAGNOSIS.md), [AUDIT-metric-provenance.md](AUDIT-metric-provenance.md), [SPRINT-DIAGNOSIS-frame-extraction.md](SPRINT-DIAGNOSIS-frame-extraction.md), [GPS-VERIFY-DISCOVERY.md](GPS-VERIFY-DISCOVERY.md), [OVERNIGHT_AUDIT_2026-05-19.md](OVERNIGHT_AUDIT_2026-05-19.md)).

### Top unchecked / pending items — verbatim from the docs

**From [docs/SPRINT-RESUME.md](docs/SPRINT-RESUME.md) (Day 5 close):**

> **What Day 6+ should do — verification, not more code:**
> 1. **Cart round at Menifee** covering H12–H17 (the H14→H15 regression case from `holeDetection.ts:36-46`). Verifies the hardened gates + tee geofence + truth resolver + GPS Flow C in one pass. Per memory rule: cart is the default, walker-only / harness-only verification is insufficient.
> 2. **Real swing capture** in Cage Mode → confirm BUG #1 fix (full motion described, not just setup) + acoustic ball speed + metric ranges + auto-speak observation.
> 3. **Spanish utterance test** ("¿cuántas yardas?") → confirm Spanish text emitted AND spoken via `eleven_multilingual_v2` (not English-accented monolingual).
> 4. **AsyncStorage dump panel** verification at `/cage-debug` → confirms practice-store accumulates from real swings.
> 5. **CourseTruth survey** on Menifee Lakes → walk-to-green + "I'm Here" snap on each hole → confirm truth wins over courseHoles via `side_effects: green_source:truth`.
>
> **1.0 blockers from the audit (not yet addressed):**
> - Stripe / RevenueCat real billing wiring (only paywallGuard stub today)
> - TestFlight + Play Store submission
> - Putt-analysis prompt parity + layman_explanation (parallel of BUG #1 fix not yet ported)
> - Calibration profile consumer wiring (`playerCalibrationStore` writes, nothing reads)
> - Cloud backup of swing library + videos (data-loss-on-uninstall protection)
> - EAS Build cut to ship the BT worktree

**From [BUILD-STATE-AUDIT.md](BUILD-STATE-AUDIT.md) §C — LEFT FOR 1.0:**

> **Blockers**
> - **Stripe / subscription paywall — STUB ONLY** [PLANNED] (INFRA). `services/paywallGuard.ts` exists with deferred-paywall plumbing + Sentry breadcrumbs, but **no actual Stripe SDK / RevenueCat integration visible**. `SUBSCRIPTIONS_ENABLED` flag in `featureAccess.ts` not yet wired to real billing. Launch-blocker per Wrap 2B.
> - **TestFlight submission** [PLANNED] (INFRA). iOS `buildNumber: 3` in app.json suggests prior internal builds; no record of App Store Connect submission. Launch-blocker Wrap 3.
> - **Play Store submission** [PLANNED] (INFRA). Android keystore + Play Console submission not visible. Launch-blocker Wrap 3.
> - **Real cart-round verification of holeDetection** [PLANNED-VERIFICATION] (ROUND).
> - **EAS Build for native modules pending** [PLANNED] (INFRA). Worktree `feat/bt-media-button` (commit `7504099`) contains BT media-button native code — NOT yet `eas build`'d.
>
> **Launch-critical gaps the code reveals**
> - **Putt-analysis prompt fix parallel** [PLANNED] (PRACTICE). BUG #1 anti-frame-1-anchoring is in `/api/swing-analysis` only; `/api/putting-analysis` still has the old prompt shape.
> - **Putt-analysis layman_explanation** [PLANNED] (PRACTICE). Shipped on swing-analysis only; putting still missing the synthesis.
> - **Calibration profile consumed by metrics** [PLANNED] (PRACTICE). `playerCalibrationStore` writes profiles but `swingMetricsService` doesn't read them yet — profile is dead data until wired.
> - **Cloud backup for swing library + videos** [PLANNED] (PRACTICE). Roadmap-logged after the uninstall-loses-everything incident (commit `313e416`). No code yet. Memory rule "never uninstall the app" is the only protection today.
> - **Real Watch IMU writer** [PLANNED] (PRACTICE). `services/watchService.ts` is scaffold + math + `simulateSwing()` test helper; zero production writers. Needs native-module wiring via EAS Build with the beta wearables SDK.
> - **Real MoveNet keypoints** [PLANNED] (PRACTICE). SmartMotion skeleton renders fixed placeholder positions, NOT real pose tracking. Needs the post-sprint TFJS/MoveNet native build.

**From [ES-ZH-VOICE-DIAGNOSIS.md](ES-ZH-VOICE-DIAGNOSIS.md):** ✓ Resolved by commit `85e1ef8`. Whisper now auto-detects when settings.language is the default 'en'.

**From [SPRINT-DIAGNOSIS-frame-extraction.md](SPRINT-DIAGNOSIS-frame-extraction.md):** ✓ Resolved by commit `45dfe0e` (TEMPORAL ANALYSIS prompt).

---

## TL;DR honest verdict per feature

| Feature | Verdict |
|---|---|
| **"Smart Play"** | Brand only; no separate feature. PLAY pillar is scaffolded course discovery, partially working. "make the smart play" copy is purged. |
| **TightLie** | ✅ WORKING end-to-end. Real camera + real vision + real caddie-brain consumption. Voice + button routes both wired. |
| **SmartMotion** | Hybrid: 5-frame Sonnet vision read (BUG #1 fix active) + acoustic ball speed (in-app captures only) are REAL. Skeleton overlay is **PLACEHOLDER** (hardcoded 13 normalized joints) until TFJS/MoveNet native build OR pose-API env vars land. Metric source taxonomy + honest confidence/range labels rendered correctly. |
| **SmartVision** | The name is historical; the rendering pipeline is now GolfshotHoleView → VectorHoleView → Mapbox/Google fallback. WORKING. `SmartVisionContext` is still a live state pipe. |
| **Sprint next-up** | Day 6+ = **verification on hardware** (cart round, real swing capture, Spanish utterance test, CourseTruth survey). 1.0 blockers = Stripe wiring, store submissions, putt-analysis parity, calibration consumer, cloud backup, EAS native build for BT module + real pose. |

---

**End of audit. Repo is source of truth. Change no source.**
