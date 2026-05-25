# 05 — File map

Where the key things live. Paths are relative to repo root `/Users/timothyg/Documents/smartplay`.

## Top-level directories

| Dir | What |
|---|---|
| `app/` | Expo Router screens. 51 route files. Tabs in `app/(tabs)/`. Owner-gated screens (cage-debug, owner-logs, harness, field-manual). |
| `api/` | Vercel serverless routes (36 files). Anthropic / OpenAI / ElevenLabs backed. |
| `app/api/` | Expo Router API handlers (`*+api.ts`). Mirrors `api/` for routes that benefit from Expo's bundling. |
| `services/` | 141 files. Business logic, store coordinators, intents, harness, audio, GPS, vision pipelines. |
| `services/intents/` | 20 voice-intent handler files + registry. |
| `services/harness/` | Scenario harness (assert, mocks, dispatch, scenarios). |
| `store/` | 30 Zustand stores with persist middleware. |
| `components/` | 45 top-level components + sub-dirs (caddie, cage, swinglab, smartfinder, smartvision, brand, dev, tools, recap). |
| `constants/` | Character specs, persona catalog, illustrator catalogs, instructor videos. |
| `hooks/` | Custom hooks (useDeviceLayout, useCurrentWeather, useKevin, etc.). |
| `data/` | Static data (courses, drillCatalog, instructorVideos, palmsImages). |
| `i18n/` | `index.ts` + locales (`en.json`, `es.json`, `zh.json`). |
| `lib/` | Stable utilities (persona.ts, pricing.ts). |
| `theme/` | Token system. |
| `utils/` | Pure functions (geoDistance, playsLike, ballFlightPhysics). |
| `assets/` | Bundled assets. |
| `plugins/` | Expo config plugins (Meta Wearables DAT). |
| `docs/` | This manual + audits + research notes. |

## Stores ([store/](../../store/))

The 30 Zustand stores; bold = highest-traffic.

| Store | What |
|---|---|
| **[roundStore.ts](../../store/roundStore.ts)** | The big one. Active round state — courseId, currentHole, shots[], scores, putts, currentLocationType, currentTeeBox. |
| **[cageStore.ts](../../store/cageStore.ts)** | Cage session state — activeSession.shots[] (CageShot), perShotAnalysis, primary_issue (PrimaryIssue with primary_fault). |
| **[settingsStore.ts](../../store/settingsStore.ts)** | User settings — language, voiceGender, voiceEnabled, caddiePersonality, trust level mirror, tutorialsSeen, feelCaptureEnabled, etc. |
| [trustLevelStore.ts](../../store/trustLevelStore.ts) | L1–L5 trust spectrum source of truth. |
| [practiceStore.ts](../../store/practiceStore.ts) | Cross-session swing stats — overTheTopCount, swingCount, avgCarryDriver, typicalMiss. Fed by `updateFromSwing`. |
| [playerProfileStore.ts](../../store/playerProfileStore.ts) | Identity — email, firstName, handicap, dominantMiss. Owner gate via `isOwnerEmail`. |
| [gpsHealthStore.ts](../../store/gpsHealthStore.ts) | GPS accuracy + ask-cooldown gating for Flow B (confidence ask). |
| [ghostStore.ts](../../store/ghostStore.ts) | Past-round comparison opponent state. |
| [watchStore.ts](../../store/watchStore.ts) | Galaxy Watch IMU state (reserved — wiring deferred to native build). |
| [familyStore.ts](../../store/familyStore.ts) | Junior swing analyzer family setup. |
| [relationshipStore.ts](../../store/relationshipStore.ts) | Multi-player relationships (coach/student, Coach Mode pairings). |
| [toastStore.ts](../../store/toastStore.ts) | Global toast bus. |
| [toolsMenuStore.ts](../../store/toolsMenuStore.ts) | ••• menu open/closed + active tool tracking. |
| [pointsStore.ts](../../store/pointsStore.ts) | Gamification points (deferred wiring). |
| [issueLogStore.ts](../../store/issueLogStore.ts) | Owner issue-log entries (`log_issue` voice intent). |
| [vocabularyProfileStore.ts](../../store/vocabularyProfileStore.ts) | Player vocabulary (terms they've heard the caddie use). |
| [voiceHintsStore.ts](../../store/voiceHintsStore.ts) | First-time-user voice hint tracking. |
| [voiceMissStore.ts](../../store/voiceMissStore.ts) | Voice-miss log for classifier improvement. |
| [listeningSessionStore.ts](../../store/listeningSessionStore.ts) | Open-mic listening session state. |
| [referenceAuthoringStore.ts](../../store/referenceAuthoringStore.ts) | Owner-only authoring tools. |
| [smartFinderStore.ts](../../store/smartFinderStore.ts) | SmartFinder reticle + mark state. |
| [teamIntelligenceStore.ts](../../store/teamIntelligenceStore.ts) | Per-pillar caddie team intelligence. |
| [tutorialStore.ts](../../store/tutorialStore.ts) | Tutorial-extraction authoring state. |
| [undoMarkStore.ts](../../store/undoMarkStore.ts) | Silent-mark undo banner state. |
| [swingAnalysisDebugStore.ts](../../store/swingAnalysisDebugStore.ts) | Owner debug capture of last analysis payload. |
| [courseGeometryOverrideStore.ts](../../store/courseGeometryOverrideStore.ts) | Mark Green / Mark Tee overrides. |
| [cageCalibrationStore.ts](../../store/cageCalibrationStore.ts) | Cage-distance calibration. |
| [cageOverlayCalibrationStore.ts](../../store/cageOverlayCalibrationStore.ts) | Cage overlay calibration. |
| [holeMarkerCalibrationStore.ts](../../store/holeMarkerCalibrationStore.ts) | Hole-marker calibration. |
| [playerCalibrationStore.ts](../../store/playerCalibrationStore.ts) | Per-player skeleton calibration. |

## Voice intent handlers ([services/intents/](../../services/intents/))

| Handler | Intent |
|---|---|
| [askGolfFatherHandler.ts](../../services/intents/askGolfFatherHandler.ts) | `ask_golf_father` (Tank rules + course-management). |
| [queryStatusHandler.ts](../../services/intents/queryStatusHandler.ts) | `query_status` (score, distance_to_green, carry_check, etc.). |
| [logShotHandler.ts](../../services/intents/logShotHandler.ts) | `log_shot`. |
| [logScoreHandler.ts](../../services/intents/logScoreHandler.ts) | `log_score`. |
| [logIssueHandler.ts](../../services/intents/logIssueHandler.ts) | `log_issue` (owner only). |
| [navigateHandler.ts](../../services/intents/navigateHandler.ts) | `navigate`. |
| [openToolHandler.ts](../../services/intents/openToolHandler.ts) | `open_tool` (SmartFinder, TightLie, Cage, etc.). |
| [changeSettingHandler.ts](../../services/intents/changeSettingHandler.ts) | `change_setting`. |
| [acknowledgeHandler.ts](../../services/intents/acknowledgeHandler.ts) | `acknowledge`. |
| [helpHandler.ts](../../services/intents/helpHandler.ts) | `help`. |
| [rulesQueryHandler.ts](../../services/intents/rulesQueryHandler.ts) | `rules_query` (full Rules of Golf reference). |
| [handicapQueryHandler.ts](../../services/intents/handicapQueryHandler.ts) | `handicap_query`. |
| [clubHandler.ts](../../services/intents/clubHandler.ts) | `set_club` / `change_club`. |
| [atBallHandler.ts](../../services/intents/atBallHandler.ts) | `at_ball` (player has arrived at their ball). |
| [declareHoleHandler.ts](../../services/intents/declareHoleHandler.ts) | `declare_hole` (Flow C cross-check). |
| [mediaHandlers.ts](../../services/intents/mediaHandlers.ts) | `record_this_shot`, `watch_this`, Meta ingest triggers. |
| [setTrustQuietHandler.ts](../../services/intents/setTrustQuietHandler.ts) | `set_trust_quiet`. |
| [sequenceHandler.ts](../../services/intents/sequenceHandler.ts) | Multi-intent sequencing. |
| [intentAck.ts](../../services/intents/intentAck.ts) | Shared acknowledgement helpers. |
| [index.ts](../../services/intents/index.ts) | Router singleton + handler registry. |

## Notable services

| File | What |
|---|---|
| [services/voiceCommandRouter.ts](../../services/voiceCommandRouter.ts) | Intent dispatcher. |
| [services/voiceService.ts](../../services/voiceService.ts) | TTS `speak()` + audio session config. |
| [services/gpsManager.ts](../../services/gpsManager.ts) | Adaptive GPS subscription (active/walking/stationary). |
| [services/holeDetection.ts](../../services/holeDetection.ts) | Hole-transition detection from GPS proximity. |
| [services/smartFinderService.ts](../../services/smartFinderService.ts) | `resolveGreenCoords` cascade + Mark Green helpers. |
| [services/courseGeometryService.ts](../../services/courseGeometryService.ts) | golfbert / fetchCourseGeometry + cache. |
| [services/courseTruth.ts](../../services/courseTruth.ts) | Surveyed ground-truth coords. |
| [services/swingMetricsService.ts](../../services/swingMetricsService.ts) | Metric composer + source taxonomy + confidence buckets. |
| [services/acousticImpactDetector.ts](../../services/acousticImpactDetector.ts) | Parallel mic recorder + impact peak detection. |
| [services/clubRecognition.ts](../../services/clubRecognition.ts) | Sole-photo CV club ID. |
| [services/feelCaptureService.ts](../../services/feelCaptureService.ts) | Owner-only feel-capture Whisper pipeline. |
| [services/caddieRewards.ts](../../services/caddieRewards.ts) | 250+ drive + 1-putt persona-aware celebration. |
| [services/proactiveKevin.ts](../../services/proactiveKevin.ts) | Proactive trigger logic (round_start_handoff, miss_streak, etc.). |
| [services/gpsConfidenceAsk.ts](../../services/gpsConfidenceAsk.ts) | GPS-soft proactive "what hole?" ask. |
| [services/conversationalLoggingOrchestrator.ts](../../services/conversationalLoggingOrchestrator.ts) | Sustained-position auto-fire orchestrator. |
| [services/shotDetectionService.ts](../../services/shotDetectionService.ts) | GPS-based shot detection. |
| [services/metaGlassesIngest.ts](../../services/metaGlassesIngest.ts) | Meta Glasses photo/video watcher. |
| [services/handsFreeOrchestrator.ts](../../services/handsFreeOrchestrator.ts) | Hands-free tap-pattern dispatcher. |
| [services/listeningSession.ts](../../services/listeningSession.ts) | Open-mic listening with classifier loop. |

## Key components

| File | What |
|---|---|
| [components/CaddieAvatar.tsx](../../components/CaddieAvatar.tsx) | Canonical persona portrait (LOCKED). |
| [components/CaddieDataStrip.tsx](../../components/CaddieDataStrip.tsx) | Persistent round data strip. |
| [components/PrimaryIssueCard.tsx](../../components/PrimaryIssueCard.tsx) | Phase 111 issue card (PrimaryIssueEntry from catalog). |
| [components/swinglab/PrimaryIssueCard.tsx](../../components/swinglab/PrimaryIssueCard.tsx) | The GolfFix-shape card (PrimaryIssue with primary_fault from cageStore). |
| [components/swinglab/SwingBodyOverlay.tsx](../../components/swinglab/SwingBodyOverlay.tsx) | Pose overlay + swing-arc trace. |
| [components/swinglab/KevinCoachBox.tsx](../../components/swinglab/KevinCoachBox.tsx) | Coach commentary box (rename to CaddieCoachBox deferred to P2). |
| [components/QuickTutorial.tsx](../../components/QuickTutorial.tsx) | 3-line first-run tutorial pattern. |
| [components/SmartVisionLiveStrategy.tsx](../../components/SmartVisionLiveStrategy.tsx) | Golfshot vs Vector render strategies. |
| [components/CaptureOverlay.tsx](../../components/CaptureOverlay.tsx) | Voice-driven capture overlay. |
| [components/tools/GlobalToolsMenu.tsx](../../components/tools/GlobalToolsMenu.tsx) | ••• menu. |
| [components/ErrorBoundary.tsx](../../components/ErrorBoundary.tsx) | App-level error boundary. |

## API routes ([api/](../../api/) + [app/api/](../../app/api/))

| Route | What |
|---|---|
| `/api/voice-intent` | Classifier (text → VoiceIntent). |
| `/api/voice` | TTS (ElevenLabs). |
| `/api/transcribe` | Whisper. |
| `/api/brain` + `/api/kevin` | Conversational + tool-use. |
| `/api/swing-analysis` | Sonnet vision swing read → PrimaryIssue. |
| `/api/junior-swing-analysis` | Junior variant. |
| `/api/cage-coach` | Cage session post-analysis. |
| `/api/cage-review` | Cage review session. |
| `/api/club-recognition` | Sole-photo club ID. |
| `/api/acoustic-detect` | Server-side WAV decode + impact / echo math. |
| `/api/pose-analysis` | RapidAPI pose-detection bridge (200-with-null when unconfigured). |
| `/api/swing-tempo` | Backend tempo analysis (501 stub — deferred). |
| `/api/lie-analysis` | TightLie vision read. |
| `/api/course-geometry` | golfbert geometry fetch. |
| `/api/course-content` | Course content (descriptions, hole notes). |
| `/api/course-proxy` | golfcourseapi proxy. |
| `/api/preround` | Pre-round briefing generator. |
| `/api/recap` | Round recap. |
| `/api/briefing` | Per-hole briefing. |
| `/api/context-synthesis` | Cross-round context synthesis. |
| `/api/owner-triage` | Owner-only triage on logged issues (Sonnet). |
| `/api/parse-shot` | Shot phrase parser. |
| `/api/weather` | Weather snapshot. |
| `/api/meta-voice` | Meta Glasses voice exchange ingest. |
| `/api/cv-scoring` | CV scoring (reserved). |
| `/api/golfbert-proxy` | golfbert API proxy. |
| `/api/health` | Health check. |
| `/api/image-edit` | Image manipulation. |
| `/api/space-scan` | Cage space scan. |
| `/api/vision` | General vision dispatch. |
| `/api/tutorial-analysis` | Tutorial extraction pipeline. |
| `/api/putting-analysis` | Putting analysis. |
