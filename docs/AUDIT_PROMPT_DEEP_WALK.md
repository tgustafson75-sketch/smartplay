# Deep Code Walk Audit Prompt

Paste the prompt below into a fresh Claude Code session to get a systematic interconnected-system audit. The prompt is intentionally long — it specifies exactly which files to read in what order, what to compare across them, and what kind of output to produce. Running it on a fresh session keeps context clean for the audit.

---

## The prompt to use (verbatim)

> You are the lead architect for SmartPlay (Expo + React Native golf app). Follow CLAUDE.md strictly. **Do not write or edit any code in this session — your job is to produce a written audit only.**
>
> **Goal:** systematically walk the interconnected pipeline `GPS foundation → Pose → Analysis → Comparison → Knowledge Base → Vision → Voice → Meta Bridge` and surface remaining risks, inconsistencies, technical debt, and stability improvements.
>
> ## Read order (don't skip — each section depends on the previous)
>
> **Stage 1 — GPS foundation**
> - `services/gpsManager.ts`
> - `services/holeDetection.ts`
> - `services/walkingDetector.ts`
> - `services/shotLocationService.ts`
> - `store/roundStore.ts` (search for: hole transition + shot logging + state machine)
> - Sprint log entries for Fix L (hole-jumping) and the cart-default standing rule
>
> **Stage 2 — Pose**
> - `services/poseEstimator.ts` (the facade)
> - `services/poseAnalysisApi.ts` (cloud + biomechanics math)
> - `services/poseDetection.ts` (vision-LLM swing analysis)
> - `services/mediaPipePoseService.ts` (on-device, ships in Day 5)
> - `api/swing-analysis.ts` (server prompt for the LLM path)
>
> **Stage 3 — Analysis**
> - `services/smartAnalysisEngine.ts` (dispatch + envelope)
> - `services/puttingAnalysisService.ts`
> - `services/lieAnalysisService.ts`
> - `services/acousticImpactDetector.ts` + `services/acousticsAnalyzer.ts`
> - `services/juniorSwingAnalyzer.ts`
>
> **Stage 4 — Comparison**
> - `services/swingComparisonEngine.ts` (single + multi)
> - `services/swingDatabase.ts` (reference library + YouTube ingestion)
> - `components/swinglab/CompareReferencePickerSheet.tsx`
> - `app/swinglab/swing/[swing_id].tsx` (auto-suggest card + onCompareToSelect)
>
> **Stage 5 — Knowledge Base**
> - `services/personaKnowledgeBase.ts` (entries + matcher + prompt-block builder)
> - `constants/{kevin,serena,harry,tank}Character.ts` (voice specs)
> - `services/smartAnalysisEngine.ts:enrichWithPersonaWisdom`
>
> **Stage 6 — Vision**
> - `services/glassesVisionInput.ts` (rolling queue, auto-mode detection, base64 extractor)
> - `services/unifiedVisionContext.ts` (composed GPS + geometry + vision)
> - `services/metaWearablesBridge.ts` (DAT JS bridge)
> - `services/metaGlassesBridge.ts` (legacy voice-bridge — verify still works as fallback)
>
> **Stage 7 — Voice**
> - `hooks/useKevin.ts` (brain call assembly)
> - `api/kevin.ts` (system prompt composition + multimodal path + persona block)
> - `services/voiceService.ts` (TTS + userInitiated gate)
> - `services/listeningSession.ts`
> - `lib/persona.ts`
>
> **Stage 8 — Meta Bridge (DAT + Voice Handler)**
> - `plugins/withMetaWearablesDAT.js`
> - `plugins/withMediaPipePose.js`
> - `android-native/MetaWearablesFrameModule.kt`
> - `android-native/MediaPipePoseModule.kt`
> - `ios-native/MetaWearablesFrameModule.swift`
> - `ios-native/MediaPipePoseModule.swift`
> - `android-native/MetaCaddyVoiceHandler.kt`
> - `api/meta-voice.ts`
>
> ## What to compare across the pipeline
>
> For each pair below, identify any drift, shape mismatch, or unstated assumption:
>
> 1. **Pose output → Comparison input**. Do `poseEstimator.PoseEstimate.biomechanics` (with new `shoulderTiltDeg` + `sequencingScore` + `metric_confidence`) and `swingComparisonEngine.compareSwings.input.current.biomechanics` agree on field presence and units? Are the new optional fields handled defensively everywhere downstream (cageStore persistence, swingDatabase reference comparison, SmartMotion card render)?
>
> 2. **Glasses frame → consumer fan-out**. A single `submitVisionFrame` call must produce a coherent state across: (a) Kevin multimodal upload, (b) puttingAnalysisService auto-fold, (c) lieAnalysisService acoustic+vision composite, (d) MediaPipe pose detection trigger, (e) GlassesStatusBadge UI state. Trace one frame through all five consumers and flag any race condition (e.g. Kevin reads the frame before the queue's auto-detect has classified mode).
>
> 3. **Persona variants vs character spec**. For each of the 90 entries in `personaKnowledgeBase.PERSONA_KB` that has a `tankAnswer`, confirm the answer satisfies the BOUNDARIES + NEVER + ALWAYS sections of `constants/tankCharacter.ts`. Flag any entry that drifts (signature phrase overload, mid-paragraph capital "ONE"-style emphasis used reflexively rather than once, anything reading as critique of the player vs the work).
>
> 4. **GPS distance vs unified context yardage**. `services/unifiedVisionContext.ts:yardsBetween` computes Haversine yards. Does this match `services/smartFinderService.ts:getGreenYardagesSync`'s math? If they diverge by more than 2-3 yards, the brain prompt and SmartFinder card will quote different numbers and confuse the user.
>
> 5. **Concurrency**: DAT enforces one-session-per-device. MetaCaddyVoiceHandler routes TTS via HFP to the same Bluetooth radio. When TTS is active, does `metaWearablesBridge.startMetaWearablesStreaming` cleanly reject + log, or does it silently swallow? Same question reversed.
>
> 6. **Backward compatibility**: The `SwingBiomechanics` interface gained `shoulderTiltDeg`, `sequencingScore`, `metric_confidence`, all optional. The `PuttingAnalysis` interface gained `partialCapture`. The `PersonaKBEntry` gained `serenaAnswer`/`harryAnswer`/`kevinAnswer`. Confirm that cageStore-persisted records from BEFORE these additions still deserialize without warnings, and that the cage review surface + swing detail card both render the legacy shape correctly.
>
> 7. **EAS Build readiness**: Walk `plugins/withMetaWearablesDAT.js` and `plugins/withMediaPipePose.js`. Are there any mods that depend on a file existing in `android-native/` or `ios-native/` that isn't actually committed? If the prebuild's source-copy step silently misses a file, the next EAS build will compile fine but the native module will be missing classes — flag any such risk.
>
> ## What to NOT do
>
> - Don't write code. Edits go in a follow-up session, not this one.
> - Don't propose huge refactors. Aim for surgical fixes that close real risks.
> - Don't recommend adding more features. The codebase has plenty; the audit is about whether what's there is stable.
> - Don't praise the codebase. Tim already wrote it. Look for what's wrong.
>
> ## Output format
>
> Produce a **single Markdown report** with these sections:
>
> 1. **Executive summary** — 5 bullets max. What's the riskiest thing in the pipeline? What's the biggest tech-debt hotspot? What's the most fragile integration boundary?
>
> 2. **Per-stage findings** (8 sections matching the read order). For each: 2-4 specific issues with file path + line range, severity (P1 / P2 / P3), and a 1-2 sentence proposed fix. No fix code — fix DESCRIPTION.
>
> 3. **Cross-stage issues** — anything that surfaced only when you compared two stages side-by-side (e.g. units drift, race condition, shape mismatch).
>
> 4. **Backward-compat regression risks** — anything where a new field or refactor might silently break a previously-persisted record on a user's device.
>
> 5. **Suggested fix order** — 10-15 items, ranked. Each item: severity, surface, 1-line description. This is the punch list Tim runs next.
>
> 6. **What looks solid** (brief — to anchor the report). 3-5 areas that are well-architected and shouldn't be touched.
>
> Keep the total report under ~3000 words. Specificity over comprehensiveness — a P1 with the exact file path is worth ten generic "review the error handling" notes.

---

## When to run this prompt

- Before a major release where stability matters more than features.
- After a high-velocity sprint (like the Day 5 batch) where many integration points landed in quick succession.
- When the system starts feeling "complicated" — the audit surfaces whether complexity is essential or accidental.

## What the audit won't find

- Bugs that only manifest on real hardware (Bluetooth handshake races, GPS drift in real-world cart paths, thermal throttling on a specific Z Fold). Those need on-device verification rounds.
- Issues with the EAS Build pipeline itself (the audit reads code, not build logs).
- UX issues that need a designer's eye — the audit is engineering-focused.

For those, run the audit prompt to clean the engineering layer first, then return to on-device verification with a stable codebase.
