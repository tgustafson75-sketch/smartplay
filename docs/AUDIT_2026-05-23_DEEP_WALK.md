# Deep Code Walk Audit — 2026-05-23

Conducted at the close of the Day 5 sprint after the MediaPipe activation + EAS Android build finished. Walks the pipeline `GPS → Pose → Analysis → Comparison → Persona KB → Vision → Voice → Meta Bridge` and surfaces real risks. Edits proposed are description-only — implementation is a separate pass.

## Executive summary

- **Riskiest current behavior:** swing metric placeholders that LOOK measured but aren't (just fixed in this commit — `services/swingMetricsService.ts`). Tour-pro values in 12px text feel authoritative; bad UX trust over time.
- **Biggest tech-debt hotspot:** `app/swinglab/smartmotion.tsx` (now ~1700 lines after persistence + metrics threading) — large composite screen that hosts video player + pose overlay + analysis fetch + library persistence + metrics. Splitting `VisualCard` into its own module would unblock future testing.
- **Most fragile boundary:** the `ingestUploadedSwing` + `setSessionAnalysis` + `setSessionAnalysisStatus` sequence is now called from THREE places (videoUpload pipeline, SmartMotion, Cage Mode) with three slightly different `PrimaryIssue` shapes. Future API drift in cageStore would silently break two of three call sites.
- **Surprise win:** `services/poseEstimator.ts`'s pose-source telemetry channel turned out to be the cleanest abstraction this sprint. `useLatestPoseTelemetry()` could host more dimensions (e.g. inference confidence drift over a session) without protocol changes.
- **Biggest deferred-but-not-blocked:** Apple Developer enrollment. The iOS DAT + MediaPipe modules are ready and will build once enrollment lands; no engineering work blocked.

## Per-stage findings

### 1. GPS foundation
**P2 — `services/gpsManager.ts` / `services/holeDetection.ts`**: cart-default thresholds (Fix L territory, per sprint log) are still tuned for walker paths. Real-cart verification round (per `cart-is-default` memory) still pending; harness reproduces the false-transition pattern but a real-course confirmation is the test bar.
**P3 — `services/shotLocationService.ts`**: returns null silently on permission denial. UI should branch on null to show a "GPS off" hint instead of just dimming features.
**Solid:** `roundStore`'s state machine is clean; `getCurrentLocation()` is properly async-safe.

### 2. Pose
**P2 — `services/poseEstimator.ts:236-258`**: the MediaPipe-frames path tags frames with position by index (`['P1_address', 'P2_takeaway', ...]`) assuming the caller fed the canonical 5 keyframes. If a future caller passes 4 or 6 frames the tags shift and biomechanics gets wrong positions. Fix: explicit per-frame position from caller, fall back to current index-based.
**P3 — `services/mediaPipePoseService.ts:postProcessForGlassesPOV`**: the POV_TORSO_THRESHOLD is hard-coded at 0.30. With real-world Meta-glasses POV data we'll likely want to tune this. Surface as exported constant for easier tuning.
**P3 — `services/poseAnalysisApi.ts`**: `extractPoseFramesFromVideo` runs sequentially to be "polite" to RapidAPI rate limits. Now that MediaPipe is primary, this is dead-weight — the cloud path is the fallback and the politeness is over-engineering.
**Solid:** poseEstimator.ts's hybrid backend selection is clean; `hedgeBiomechanics` does the right thing on low confidence.

### 3. Analysis
**P1 — `app/swinglab/smartmotion.tsx`**: SmartMotion's `PrimaryIssue` synthesis (line ~178) hard-codes `category: 'other'` regardless of the detected_issue. videoUpload's pipeline maps `detected_issue` to the right category via `issueClassifier`. Fix: extract that mapping into a small helper both call sites use.
**P2 — `services/smartAnalysisEngine.ts:runShotStrategy`**: the unified context wiring (just shipped) reads `geometry.yardagesFromPlayer.middle` for target. When `middle` is null but `front` or `back` are populated (uncommon but possible on courses with curated geometry), shot_strategy falls back to null. Fix: prefer middle → front → back rather than middle-or-bust.
**P3 — `services/lieAnalysisService.ts`**: `enrichedLieAnalysis` auto-folds the acoustic prior + meta strategy but doesn't surface the unified context. Could enrich the LLM input prompt with the unified prompt_block for tighter on-course strategy.

### 4. Comparison
**P2 — `services/swingComparisonEngine.ts:compareSwings`**: optional `shoulderTiltDeg` + `sequencingScore` are now in the metrics array. Reference banks (`TOUR_MEDIAN`, `AMATEUR_GOOD`) have values, but the `SEED_ARCHETYPES` in `services/swingDatabase.ts` don't yet — comparisons against archetypes show "—" for the new metrics. Fix: populate those two fields in the three SEED_ARCHETYPES.
**P3 — `services/swingDatabase.ts:previewYouTubeReference`**: just shipped; the alreadyExists check parses every reference's youtubeUrl on every preview. O(n) — fine at <100 references, will need a hash-index when the library grows.
**Solid:** `swingComparisonEngine.compareSwings` is clean — every metric is independently defensive, and the hotspot rendering is honest.

### 5. Persona Knowledge Base
**P2 — `services/personaKnowledgeBase.ts`**: 112 entries with Tank-coverage on all, multi-persona variants on ~70%. The matcher uses pure keyword scoring (no LLM); for the SAME question phrased slightly differently we may match different entries OR none. Fix: surface a one-line "no match" log when score < 40 so we can tune the questionPatterns from real misses.
**P3 — KB voice integrity**: I authored most of the persona variants this sprint based on the character specs. They read consistent BUT haven't been validated by Tim (or Marc Ward for Tank specifically). Flag for review before App Store submission.
**Solid:** the schema is forward-compatible — additional personas drop in as optional fields without consumer changes.

### 6. Vision
**P2 — `services/glassesVisionInput.ts`**: rolling queue is in-memory only. Frames get JPEG-written by the native module to `cache/mwdat_frames/latest.jpg` (overwritable). On app force-quit + relaunch, the queue resets but the cache file lingers (harmless). Should add a cache cleanup on app boot.
**P2 — `services/unifiedVisionContext.ts:yardsBetween`**: uses Haversine. `services/smartFinderService.ts:getGreenYardagesSync` uses its own distance math. Cross-stage check needed: do they agree within 1-2 yards across realistic course coordinates? If they drift, the brain prompt and the SmartFinder card will quote different numbers. Recommend a unit test comparing the two on a known reference (Menifee Lakes hole 1, e.g.).
**P3 — `services/metaWearablesBridge.ts`**: AppState=background auto-downshift uses `quality=low + fps=7`. Thermal-state hooks would be more honest than backgrounding-as-proxy. expo-thermal isn't in the deps; flag as a future module add.

### 7. Voice
**P1 — `api/kevin.ts` system prompt size**: with persona KB block + unified context block + golfer model + recent analyses + practice context + course context + smart finder context, the prompt is now ~5-8K tokens routinely. Anthropic prompt caching kicks in for the static parts (system + character spec), but the dynamic blocks miss every call. Long-term cost will scale linearly with this size. Fix: consolidate redundant context (e.g. unified_context_block includes yardages, but smartFinderContext also includes yardages — pick one source).
**P2 — `hooks/useKevin.ts`**: each Kevin call serially fetches glassesVisionFrameBase64 + unifiedContext + persona KB block + golfer model. Could parallelize via Promise.all for ~100ms latency improvement on the typical brain call.
**P3 — `services/voiceService.ts`**: userInitiated rule (per memory) is well-enforced now; no regressions observed.
**Solid:** the multimodal Sonnet upgrade path (when image_base64 present) is clean and well-bounded.

### 8. Meta Bridge (DAT + MediaPipe)
**P2 — `plugins/withMetaWearablesDAT.js`**: `MainApplication.kt` injection uses regex `val\s+packages\s*=\s*PackageList\(this\)\.packages`. If Expo SDK 55+ changes the template shape, this fails silently (logs a warning, but the package doesn't register and `NativeModules.MetaWearablesFrame` returns null). Fix: add a smoke-test step that confirms the native module is registered at app boot, surface a dev-only banner if missing.
**P2 — `plugins/withMediaPipePose.js`**: same MainApplication regex pattern. Both plugins would break together on a template change — single point of failure across both critical native paths.
**P3 — `android-native/MetaWearablesFrameModule.kt`**: reflection-based bitmap resolution (`.bitmap` → `.makeBitmap()` fallback) is defensive but logs nothing when both fail. If a future SDK rev changes the shape entirely, frames silently drop. Add a one-time warning log on the first failure.
**Solid:** the GITHUB_TOKEN resolution path (env → app.json extra → missing) is well-structured and produces actionable error messages.

## Cross-stage issues

1. **`PrimaryIssue` shape drift across three call sites** (videoUpload, SmartMotion, Cage Mode). Each synthesizes the issue slightly differently — particularly the `category` field which only videoUpload maps correctly via issueClassifier. **Fix priority: P1.** Extract `synthesizePrimaryIssueFromSwingAnalysis` to a service all three call.

2. **Yardage math duplication** (unifiedVisionContext.yardsBetween vs smartFinderService.getGreenYardagesSync vs metaCourseIntelligence's internal Haversine). Three implementations, three potential drift points. **Fix priority: P2.** Pick one canonical helper; the other two delegate.

3. **Pose-source telemetry isn't piped into the brain prompt.** The PoseSourceBadge UI sees "ON-DEVICE • 47ms"; the brain doesn't know whether the pose data it received was on-device or cloud. For coaching tone this doesn't matter, but for diagnostic logging when a user reports a bad analysis, knowing the source would help triage. **Fix priority: P3.** Add `pose_backend` field to the brain-prompt context block.

4. **Persona KB enrichment happens at TWO seams** (api/kevin.ts injects the block; smartAnalysisEngine.enrichWithPersonaWisdom appends a Tank's-take tail). The two can produce overlapping content — both might quote the same entry. **Fix priority: P3.** Confirm by inspection that one suppresses the other, or accept the redundancy as voice reinforcement.

## Backward-compat regression risks

1. **`SwingBiomechanics` optional fields** (shoulderTiltDeg, sequencingScore, metric_confidence) — additive, persisted records read fine. Low risk.

2. **`PuttingAnalysis.partialCapture`** — additive optional. Low risk.

3. **`PoseEstimate.pose_backend` + `mediapipe_inference_ms`** — additive optional. Low risk.

4. **`PersonaKBEntry.serenaAnswer` / `harryAnswer` / `kevinAnswer`** — additive optional, helper falls back to `genericAnswer`. Low risk.

5. **CageSession with no `analysis_status`** — pre-Phase-V records didn't have this field. Audit confirms downstream code (`STATUS_COPY[analysisStatus]`) uses `?? 'pending'` everywhere. Low risk.

6. **`LearningContext.unifiedContext`** — new optional field. All dispatchers branch on null. Low risk.

7. **Library row biomechanics gate** — `app/swinglab/library.tsx:378` only renders the compare button when `entry.session.biomechanics` is truthy. Older cage sessions without biomechanics show no compare button. Acceptable; consistent with the comparison engine's requirement.

## Suggested fix order (top 12)

| # | Severity | Surface | Description |
|---|---|---|---|
| 1 | P1 | analysis | Extract `synthesizePrimaryIssue` helper used by videoUpload + SmartMotion + Cage Mode (fixes shape drift) |
| 2 | P1 | voice | Audit api/kevin.ts system prompt size; identify + remove duplicated yardage context |
| 3 | P2 | pose | `poseEstimator.ts` MediaPipe-frames path: accept explicit position per frame, fall back to index |
| 4 | P2 | vision | Pick canonical `yardsBetween` helper; smartFinder + meta + unified delegate to it |
| 5 | P2 | compare | Populate `shoulderTiltDeg` + `sequencingScore` on the 3 SEED_ARCHETYPES |
| 6 | P2 | bridge | Add boot-time smoke check confirming `NativeModules.MetaWearablesFrame` + `MediaPipePose` are non-null; dev-only banner when missing |
| 7 | P2 | gps | Real cart-round verification of holeDetection (per `cart-is-default` memory) |
| 8 | P3 | analysis | Surface unified_context promptBlock into lie_enriched LLM call |
| 9 | P3 | voice | Parallelize hooks/useKevin context fetches via Promise.all |
| 10 | P3 | KB | Add "no match" telemetry log when score <40 for tuning |
| 11 | P3 | metrics | Surface club from URL param in SmartMotion's metric synthesis |
| 12 | P3 | misc | Cache cleanup on app boot for mwdat_frames/ stale JPEGs |

## What looks solid (don't touch)

- **`hooks/useKevin.ts`** — clean assembly of the brain call. Backend is the right level of abstraction.
- **`services/swingComparisonEngine.ts`** — every metric independent + defensive. New metrics dropped in without regression.
- **`store/cageStore.ts`** — Zustand persist + selector patterns are the right shape. `EMPTY_PHOTOS` constant trick (per sprint log Day 1) prevents re-render storms.
- **`services/poseTelemetry.ts`** — tiny pub/sub abstraction with the right interface. Could host more dimensions without protocol change.
- **`plugins/withMetaWearablesDAT.js` + `plugins/withMediaPipePose.js`** — well-structured Expo config plugins with idempotent mods. The MainApplication regex is the one fragile point (cross-cutting issue #1 above).
- **`constants/{kevin,serena,harry,tank}Character.ts`** — voice specs are well-defined and have proven useful as the source of truth for KB entry voices.

## Performance concerns

| Surface | Concern | Severity |
|---|---|---|
| Persona KB matcher | Linear scan of 112 entries per question. Fine at this size. P3 |
| `unifiedVisionContext.getUnifiedVisionContext` | Composed per Kevin call (~6 store reads + 1 vision queue read + 1 geometry lookup). ~10-20ms cold; cheap. P3 |
| MediaPipe inference | 30-80ms on-device per frame. 5 frames per swing = 150-400ms total. Acceptable. P3 |
| Pose telemetry pub/sub | <1ms — non-issue |
| Brain prompt assembly | 5-8K tokens. Anthropic input cost ≈ $0.005/call at this size on Sonnet. Caching helps. P2 (cost scales with rounds) |

## Conclusion

The codebase is in good shape after the Day 5 sprint. **No P1 issues block production**; the P1 items are about consistency + maintainability (duplicate logic, prompt size) rather than correctness. Tim's pattern of additive optional fields + defensive try/catch everywhere has paid off — backward-compatibility risk is consistently low across the audit.

**Recommended next sprint focus**: items 1, 2, and 7 from the fix order — eliminate the `PrimaryIssue` synthesis drift, trim the brain prompt to a sustainable size, and complete the real-cart verification round so cart-default tuning lands with real-world signal instead of harness data.
