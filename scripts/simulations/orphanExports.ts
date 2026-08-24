/**
 * ORPHANED EXPORTS — the half-build detector.
 *
 * 2026-08-24. Tim: *"an absolutely consistent theme of half built processes… I'm stuck in a 2-month
 * cycle of fixing loops that only partially work, and finding later that things were built and not
 * connected."*
 *
 * The 08-23/08-24 sessions found NINE half-builds by tripping over them — a session each. A
 * mechanical sweep the next morning found ELEVEN more of the identical shape in under an hour, and a
 * fuller one found a hundred. That asymmetry is the whole problem: **a half-build is silent by
 * construction.** Nothing fails, nothing logs, no screen goes blank. It surfaces months later, on a
 * golf course, as a caddie that doesn't know something the app has known since July.
 *
 * So it stops being a discovery and becomes a gate. This module finds every exported symbol that
 * nothing outside its own file ever names, and run-sim asserts two things:
 *
 *   1. Nothing orphaned that is not in the baseline below  → a NEW half-build fails on the day it
 *      is written, by the person who wrote it, while the intent is still in their head.
 *   2. Nothing in the baseline that is no longer orphaned  → wiring something forces you to delete
 *      its line, so the list can only shrink. A baseline that may not rot is a ratchet; one that may
 *      is a graveyard. [[guard-the-shape-not-the-file-list]]
 *
 * WHAT "ORPHANED" MEANS HERE, precisely: the symbol name appears in NO other file in the corpus
 * (app, components, lib, services, hooks, utils, store, contexts, api, scripts, data) AND appears at
 * most once in its own file — i.e. only at its definition. That second condition matters. Without it
 * `courseCloud.isCommunitySharingEnabled` reads as orphaned when it is enforced one line down at its
 * only call site, and a guard that cries wolf gets ignored, which is worse than no guard.
 *
 * WHAT IT CANNOT SEE: a symbol that is imported and never called, a payload field spelled three ways
 * ([[my-measurement-is-the-least-reliable-part]]), or code that is reachable but dead. It catches one
 * shape — the built-and-never-wired one — and that shape accounts for most of the losses this month.
 *
 * THE QUESTION TO ASK when this fails, from CLAUDE.md: **"no callers" means UNCONNECTED, not dead.**
 * Ask where it SHOULD be called from first. Deleting is the second answer, not the first.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../');

/** Directories whose exports must be connected. `app/` is excluded: expo-router consumes route files
 *  by filesystem convention, not by import, so every screen would read as orphaned. */
const SCAN_DIRS = ['services', 'lib', 'utils', 'hooks', 'store', 'contexts', 'components'];

/** Everything that could legitimately name a symbol. Wider than SCAN_DIRS on purpose — `api/` and
 *  `data/` and `scripts/` are real consumers, and leaving one out invents orphans. */
const CORPUS_DIRS = ['app', 'components', 'lib', 'services', 'hooks', 'utils', 'store', 'contexts', 'api', 'scripts', 'data'];

/**
 * THIS FILE MUST NOT BE PART OF ITS OWN CORPUS.
 *
 * Found the moment the baseline was first written: `scripts/` is in CORPUS_DIRS, and ORPHAN_BASELINE
 * below names all 115 symbols as string keys. The token scan cannot tell a string literal from a
 * call, so every symbol read as "named elsewhere" and the detector returned **zero orphans**. A
 * green guard that had quietly stopped looking — the exact shape of
 * [[grep-guards-cant-see-dead-code]], produced by the guard against that shape, within an hour of
 * writing it.
 *
 * Anything else that enumerates these names (a triage doc, a second allowlist) has to be excluded
 * here too, or it will silently switch the guard off again.
 */
const SELF = 'scripts/simulations/orphanExports.ts';

/**
 * Naming conventions that mark a deliberate seam rather than a half-build. Narrow on purpose — each
 * one is a promise that the name itself declares the intent:
 *   _x / __x   an internal or test-only hatch (`_clearWeatherCache`, `__resetOfflineVoiceCache`)
 *   xForTest   the same, spelled out
 *   debugX     a developer hatch, called from a console or a debug screen
 *   teardownX  lifecycle symmetry with a setup function; uncalled is a mild leak, not a missing feature
 * Anything else must earn its place in the baseline by name, with a reason.
 */
const CONVENTIONAL_SEAM = /^_{1,2}[A-Za-z]|ForTests?$|^debug[A-Z]|^teardown[A-Z]/;

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;

/** Names short enough that a substring/token collision is likely; excluded to keep the signal clean. */
const MIN_NAME_LEN = 5;

/**
 * COMMENTS ARE NOT REFERENCES.
 *
 * Found on the first reconcile: `shotLocationService.closeHoleAtTransition` read as connected because
 * its own file header says *"`closeHoleAtTransition(holeNumber)` — called when the player advances
 * past a hole."* It is called by nobody. The docstring describing the intended wiring was itself
 * hiding the fact that the wiring was never done — which is this codebase's signature failure
 * ([[zero-setup-needs-a-native-build]]: a file's description of itself is not evidence of runtime
 * behaviour). Strip comments before counting, in the symbol's own file AND in every other, so a
 * module named only in prose never counts as a consumer.
 *
 * The `(?<![:\w])` guard keeps `https://` and `file://` out of the line-comment match.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = fs.readdirSync(path.join(ROOT, dir)); } catch { return out; }
  for (const name of entries) {
    const rel = `${dir}/${name}`;
    let st: fs.Stats;
    try { st = fs.statSync(path.join(ROOT, rel)); } catch { continue; }
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__' || name === '__mocks__') continue;
      walk(rel, out);
    } else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(rel);
    }
  }
  return out;
}

/** Every "path :: symbol" that nothing outside its own file names. Sorted, so diffs are readable. */
export function findOrphanExports(): string[] {
  const corpus = new Map<string, { src: string; tokens: Set<string> }>();
  for (const f of CORPUS_DIRS.flatMap((d) => walk(d))) {
    if (f === SELF) continue;
    let src = '';
    try { src = fs.readFileSync(path.join(ROOT, f), 'utf-8'); } catch { continue; }
    const code = stripComments(src);
    corpus.set(f, { src: code, tokens: new Set(code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []) });
  }

  const orphans: string[] = [];
  for (const f of SCAN_DIRS.flatMap((d) => walk(d))) {
    const entry = corpus.get(f);
    if (!entry) continue;
    const seen = new Set<string>();
    for (const m of entry.src.matchAll(EXPORT_RE)) {
      const sym = m[1];
      if (seen.has(sym)) continue;
      seen.add(sym);
      if (sym.length < MIN_NAME_LEN) continue;
      if (CONVENTIONAL_SEAM.test(sym)) continue;

      let namedElsewhere = false;
      for (const [other, o] of corpus) {
        if (other !== f && o.tokens.has(sym)) { namedElsewhere = true; break; }
      }
      if (namedElsewhere) continue;

      // Only-at-its-definition. An internally-used export is connected, just not exported-for-others.
      const own = (entry.src.match(new RegExp(`\\b${sym.replace(/\$/g, '\\$')}\\b`, 'g')) ?? []).length;
      if (own <= 1) orphans.push(`${f} :: ${sym}`);
    }
  }
  return orphans.sort();
}

/**
 * THE BASELINE — every orphan that exists as of 2026-08-24, with a reason.
 *
 * Tags, and what each obliges you to do:
 *   WIRE    verified half-build. The app already computes this and nothing consumes it. Connect it,
 *           then DELETE the line — that deletion is the definition of done.
 *   PARKED  deliberately waiting on something NAMED here (a native build, a surface not yet built).
 *           Legitimate, but the name must be real; "later" is not a reason.
 *   SURFACE a deliberate read/lifecycle/debug API whose lack of callers is expected and harmless.
 *   DUPE    a redundant sibling of a function that IS used. Delete candidate, not a missing feature.
 *   TRIAGE  not yet assessed. This is the DEBT, and it is meant to be embarrassing enough to shrink.
 *
 * Adding a line here is a deliberate act. If you are adding one because the guard went red on code
 * you just wrote, the honest tag is almost always WIRE, and the honest fix is to wire it now while
 * you still remember what it was for — which is the entire point of this file.
 */
export const ORPHAN_BASELINE: Record<string, string> = {
  // ── WIRE — built, computed, and consumed by nothing ───────────────────────────
  'services/caddieHistoryContext.ts :: historyPromptBlock':
    'WIRE — recent rounds + courses played + practice focus, built 07-04 and given a sim-contamination fix 07-30, wired to no brain. The payload carries priorRoundsHere, which is THIS COURSE only, so "how was my last round" / "what have I been working on" are unanswerable. docs/OPEN-ITEMS.md §5 lists this as an unbuilt gap; it is built.',
  'services/smartVisionOverlay.ts :: computeYardageRings':
    'WIRE — the strategic overlay its own header calls "the actual differentiator" and "proprietary IP". unprojectTilePixel and canPlayerCarry from this module ARE used; the five strategy layers are not.',
  'services/smartVisionOverlay.ts :: computeLandingZone': 'WIRE — see computeYardageRings.',
  'services/smartVisionOverlay.ts :: computeDangerCarries': 'WIRE — see computeYardageRings.',
  'services/smartVisionOverlay.ts :: computeLayupSuggestion': 'WIRE — see computeYardageRings.',
  'services/smartVisionOverlay.ts :: distanceToTarget': 'WIRE — see computeYardageRings (tap-to-target).',
  'services/walkingDetector.ts :: cartModeSuggestion':
    'WIRE — detects that the cart-mode setting disagrees with measured activity and offers the flip. Computed, never offered.',
  'services/patternEngine.ts :: getKevinShotResponse':
    'WIRE — caddie-facing language for a logged shot. The engine runs; this half of it speaks to nobody.',
  'services/patternEngine.ts :: getDominantMissLabel':
    'WIRE — dominantMiss reaches the brain as a raw value; this is the human label for it.',
  'services/puttingAnalysisService.ts :: speakPuttingAnalysis':
    'WIRE — the analysis is rendered but never spoken, on a caddie whose whole premise is that it talks.',
  'services/coachLesson.ts :: planById':
    'WIRE — three lesson plans exist and nothing can select one by id.',

  // ── WIRE — the club seam, all of it feeding docs/NEXT-CLUB-LOGIC-SWEEP.md ──────
  'services/standardBag.ts :: personalCarryFor':
    'WIRE (club sweep) — per-player carry lookup, unused. Step 2 of the club sweep is one owner for club identity; this is a piece of it that already exists.',
  'services/clubBagReconcile.ts :: CLUB_SNAP_ORDER':
    'WIRE (club sweep) — a canonical club ordering that nothing reads, in a repo where 33 files touch club identity and nobody owns "a club".',

  // ── WIRE — the learn-loop seam ────────────────────────────────────────────────
  'services/shotLocationService.ts :: closeHoleAtTransition':
    'WIRE — sets the finished hole\'s last shot end_location to the green centroid. No caller, so every hole\'s final shot has no end location, and shot distance is the data the player model learns carries from.',
  'services/poseTelemetry.ts :: getLatestPoseTelemetry':
    'WIRE — recordPoseTelemetry IS called; nothing ever reads the bus it writes to.',
  'services/mediaCapture.ts :: getRecentCaptures':
    'WIRE — the in-flight capture buffer, never read for playback.',
  'services/courseTruth.ts :: getCourseTruth':
    'DUPE — getCourseTruthSync IS used (smartFinderService.ts:31). This async sibling is redundant, not missing.',

  // ── PARKED — waiting on something named ───────────────────────────────────────
  'services/glassesVisionInput.ts :: attachUtteranceToFrame': 'PARKED — Meta glasses profile needs a native build (docs/NEEDS-A-NATIVE-BUILD.md).',
  'services/glassesVisionInput.ts :: clearVisionContext': 'PARKED — see attachUtteranceToFrame.',
  'services/glassesVisionInput.ts :: getAggregateMode': 'PARKED — see attachUtteranceToFrame.',
  'services/glassesVisionInput.ts :: getGlassesTransport': 'PARKED — see attachUtteranceToFrame.',
  'services/connectionClass.ts :: mayPullCourseNow':
    'PARKED — the throughput gate for SPECULATIVE pre-downloads. measureConnection IS used (play.tsx:1016, log-only and deliberately non-gating for arrival downloads). This gate has no caller because the pre-download queue does not exist yet (docs/OPEN-ITEMS.md §6). NOTE: §6 states the gate is active — it is not.',
  'services/getCaddieClip.ts :: hasCaddieClip':
    'PARKED/DELETE — the module calls itself "a standalone draft you can wire… when ready" (2026-05-25) and ships 10 MB of D-ID clips that never play. Decide before submission: wire the 11 round-arc slots, or delete module + assets.',
  'store/tournamentStore.ts :: getPlayerScore': 'PARKED — tournament scoring selectors ahead of the tournament surface.',
  'store/tournamentStore.ts :: getTeamScore': 'PARKED — see getPlayerScore.',

  // ── SURFACE — deliberate read/lifecycle/debug APIs ────────────────────────────
  'services/apiBase.ts :: API_BASE_URL': 'SURFACE — spine constant, kept as the documented name of the value.',
  'services/apiBase.ts :: PROD_API_BASE_URL': 'SURFACE — see API_BASE_URL.',
  'services/voiceCircuitBreaker.ts :: getCircuitBreakerSnapshot': 'SURFACE — diagnostic read for owner tools.',
  'services/voiceCircuitBreaker.ts :: degradedReason': 'SURFACE — diagnostic read.',
  'services/voiceCircuitBreaker.ts :: resetCircuitBreaker': 'SURFACE — recovery hatch.',
  'services/nativeModuleHealth.ts :: getNativeModuleHealth': 'SURFACE — boot diagnostic read.',
  'services/bootTrace.ts :: bootElapsedMs': 'SURFACE — boot diagnostic read.',
  'services/batteryMonitor.ts :: getBatteryState': 'SURFACE — diagnostic read.',
  'services/lastGpsRefresh.ts :: getLastGpsRefreshAt': 'SURFACE — diagnostic read.',
  'services/connectionClass.ts :: lastConnectionReading': 'SURFACE — cached diagnostic read.',
  'services/courseDataOrchestrator.ts :: getSustainedFixes': 'SURFACE — diagnostic read.',
  'services/harness/mocks.ts :: injectPerShotAnalysis': 'SURFACE — test harness injection point.',
  'services/simulatedGPS.ts :: getActiveWalk': 'SURFACE — GPS simulator control, dev-only.',
  'services/simulatedGPS.ts :: getSimulatorPaceOverride': 'SURFACE — GPS simulator control, dev-only.',
  'services/simulatedGPS.ts :: isSimulatorPaused': 'SURFACE — GPS simulator control, dev-only.',
  'services/simulatedGPS.ts :: isSimulatorStepMode': 'SURFACE — GPS simulator control, dev-only.',
  'services/simulatedGPS.ts :: setSimulatorStepMode': 'SURFACE — GPS simulator control, dev-only.',
  'services/simulatedGPS.ts :: simulatorStepOnce': 'SURFACE — GPS simulator control, dev-only.',
  'services/voiceTriggers.ts :: triggerVoiceCapture': 'SURFACE — documented manual trigger for a debug button. The earbud tap path itself IS wired (initVoiceTriggers → notifyEarbudTap).',
  'services/permissionsManager.ts :: resetCorePermissionsRequested': 'SURFACE — recovery hatch.',
  'services/voiceErrorLog.ts :: resetVoiceTurnCounter': 'SURFACE — recovery hatch.',
  'services/smartFinderService.ts :: clearYardageCalcLog': 'SURFACE — diagnostic buffer control.',
  'services/mediaCapture.ts :: clearRecentCaptures': 'SURFACE — buffer control paired with getRecentCaptures.',
  'services/conversationState.ts :: clearConversation': 'SURFACE — lifecycle hatch.',
  'services/conversationalBrain.ts :: clearConversationalHistory': 'SURFACE — lifecycle hatch.',
  'services/acousticImpactDetector.ts :: clearLastImpactReading': 'SURFACE — lifecycle hatch.',
  'services/handsFreeOrchestrator.ts :: stopHandsFreeOrchestrator': 'SURFACE — lifecycle symmetry with start.',
  'services/spaceAssessment.ts :: deleteSpaceConfiguration': 'SURFACE — user-data deletion API.',
  'services/swingDatabase.ts :: removeReferenceSwing': 'SURFACE — user-data deletion API.',

  // ── TRIAGE — the debt. Not yet assessed; each is WIRE, SURFACE or DELETE. ──────
  'components/smartmotion/SmartMotionHud.tsx :: MetricRail': 'TRIAGE',
  'lib/persona.ts :: getCaddieNameFor': 'TRIAGE',
  'lib/persona.ts :: getCaddieObject': 'TRIAGE',
  'lib/persona.ts :: getCharacterSpecFor': 'TRIAGE',
  'lib/persona.ts :: isActivePersona': 'TRIAGE',
  'services/acousticImpactDetector.ts :: onStrike': 'TRIAGE',
  'services/audioRoutingService.ts :: setRouteForOverride': 'TRIAGE',
  'services/caddieRequestBody.ts :: CADDIE_REQUEST_KEYS': 'TRIAGE',
  'services/cage/targetRig.ts :: moveTargetEnd': 'TRIAGE',
  'services/capture/captureFlags.ts :: MIN_TRACE_FPS': 'TRIAGE',
  'services/cloudSync/snapshot.ts :: NOT_BACKED_UP_STORE_KEYS': 'TRIAGE',
  'services/conversationState.ts :: isInActiveConversation': 'TRIAGE',
  'services/dialogEngine.ts :: listSituations': 'TRIAGE',
  'services/earbudControl.ts :: setSuppressed': 'TRIAGE',
  'services/featureAccess.ts :: featuresIn': 'TRIAGE — edition matrix; check against docs/edition-matrix.md before launch.',
  'services/fillerLibrary.ts :: getFallbackTextForCategory': 'TRIAGE',
  'services/fillerLibrary.ts :: isLibraryGenerated': 'TRIAGE',
  'services/golfbertApi.ts :: getGolfbertHole': 'TRIAGE',
  'services/golfbertApi.ts :: getGolfbertHoleImageryUrl': 'TRIAGE',
  'services/golfbertApi.ts :: golfbertHealth': 'TRIAGE',
  'services/golferModel.ts :: readPersistedGolferModel': 'TRIAGE',
  'services/healthData.ts :: getGrantedHealthPermissions': 'TRIAGE',
  'services/kevinGreeting.ts :: isKevinSpecificAudio': 'TRIAGE',
  'services/knowledgeBase/causalEngine.ts :: entryForFault': 'TRIAGE',
  'services/lieAnalysisService.ts :: isVisionActive': 'TRIAGE',
  'services/lieAnalysisService.ts :: subscribeVisionActive': 'TRIAGE',
  'services/listeningSession.ts :: isActiveListeningEnabled': 'TRIAGE',
  'services/mediaPipePoseService.ts :: setPreferredQuality': 'TRIAGE',
  'services/personaKnowledgeBase.ts :: findPersonaKBEntriesByKeywords': 'TRIAGE',
  'services/personaKnowledgeBase.ts :: getPersonaKBCategories': 'TRIAGE',
  'services/personaKnowledgeBase.ts :: getPersonaKBSize': 'TRIAGE',
  'services/planStorage.ts :: listArchivedRecaps': 'TRIAGE',
  'services/positionMarkBus.ts :: getLastMark': 'TRIAGE',
  'services/rangefinder.ts :: REFERENCE_HEIGHTS': 'TRIAGE — SmartFinder is the screen Tim flagged as never swept.',
  'services/rangefinder.ts :: buildLock': 'TRIAGE — SmartFinder, see REFERENCE_HEIGHTS.',
  'services/smartFinderService.ts :: getAnchoredHoleLengthYards': 'TRIAGE — SmartFinder, see above.',
  'services/responseRouter.ts :: fillerForSonnetVision': 'TRIAGE',
  'services/smartTempo.ts :: tempoTargetFrames': 'TRIAGE',
  'services/swing/poseMotion.ts :: wristCentroid': 'TRIAGE — do NOT wire into the trace; trace is clubhead-or-nothing.',
  'services/swingComparisonEngine.ts :: annotateWithGolferModel': 'TRIAGE',
  'services/swingDatabase.ts :: listReferences': 'TRIAGE',
  'services/swingReferences.ts :: listRegisteredReferences': 'TRIAGE',
  'services/teeTimeLink.ts :: openCourseInMaps': 'TRIAGE',
  'services/trustLevelService.ts :: defaultWakeWordOn': 'TRIAGE',
  'services/trustLevelService.ts :: proactiveEnabled': 'TRIAGE',
  'services/trustLevelService.ts :: psychologistEnabled': 'TRIAGE',
  'services/tutorialContext.ts :: buildCompressedPracticeContext': 'TRIAGE',
  'services/vocabularyProfileService.ts :: getTotalShotsParsed': 'TRIAGE',
  'services/voiceLogService.ts :: peekOfflineNotesBlock': 'TRIAGE',
  'services/voiceLogService.ts :: pendingOfflineNoteCount': 'TRIAGE',
  'services/voicePermissionService.ts :: PERMISSION_EXPLAINER_TEXT': 'TRIAGE',
  'services/voicePermissionService.ts :: checkMicPermission': 'TRIAGE',
  'services/watchBridge.ts :: isSenderRegistered': 'TRIAGE',
  'services/watchWristInterpretation.ts :: estimateClubSpeedMph': 'TRIAGE',
  'services/youtubeLinks.ts :: openYouTubeSearch': 'TRIAGE',
  'store/caddieMemoryStore.ts :: caddieMemorySnapshot': 'TRIAGE',
  'store/geometryStatusStore.ts :: isBuildingSnapshot': 'TRIAGE',
  'store/guestProfileStore.ts :: findGuestByName': 'TRIAGE',

  // ── ADDED 2026-08-24 (second pass): surfaced once COMMENTS stopped counting as references ──
  'store/practicePlanStore.ts :: practicePlanPromptBlock':
    'WIRE — a second prompt block for the caddie, same shape as historyPromptBlock. Its own file says \"practicePlanPromptBlock (below) feeds this into the caddie\". It does not.',
  'services/watchBridge.ts :: sendLiveScore':
    'WIRE — Wear OS is RUNNING on Tim\u2019s Galaxy Watch, and four of the pushes to it are wired to nothing.',
  'services/watchBridge.ts :: sendNotification':
    'WIRE — see sendLiveScore.',
  'services/watchBridge.ts :: sendRoundState':
    'WIRE — see sendLiveScore.',
  'services/watchBridge.ts :: sendVoicePrompt':
    'WIRE — see sendLiveScore.',
  'services/courseDataOrchestrator.ts :: getCourseHeroImagery':
    'WIRE — course hero imagery, computed and shown nowhere.',
  'services/personaKnowledgeBase.ts :: getPersonaAnswer':
    'WIRE — the persona KB answer function. Its header describes adding entries and says \"getPersonaAnswer picks it up automatically\"; nothing calls it, so Tank\u2019s doctrine layer answers nobody.',
  'services/gpsManager.ts :: getGpsHealth':
    'WIRE/TRIAGE — GPS health read; gpsLost reaches the brain, this richer read does not.',
  'services/glassesVisionInput.ts :: registerGlassesTransport':
    'PARKED — Meta glasses profile needs a native build.',
  'services/metaWearablesBridge.ts :: getMetaWearablesStatus':
    'PARKED — Meta glasses profile needs a native build.',
  'services/courseDownloadEngine.ts :: isCourseDownloaded':
    'PARKED — the offline-availability check behind the \"ready offline\" state (docs/OPEN-ITEMS.md \u00a76). run-sim.ts:8270 already notes it has zero callers and treats downloadCourse\u2019s idempotence as sufficient. Revisit when the visible ready-offline state is built.',
  'services/activeSurfaceRegistry.ts :: subscribeActiveSurface': 'TRIAGE',
  'services/analytics.ts :: captureError': 'TRIAGE',
  'services/cloudSync/snapshot.ts :: unionSnapshots': 'TRIAGE',
  'services/courseDataOrchestrator.ts :: attachVisionContextToHole': 'TRIAGE',
  'services/earbudControl.ts :: notifyEarbudLongPress': 'TRIAGE',
  'services/harness/dispatch.ts :: simulateAnalysisCompletion': 'TRIAGE',
  'services/localStatusResponder.ts :: AI_LED_QUERY_TYPES': 'TRIAGE',
  'services/mediaPipePoseService.ts :: smoothPoseFrames': 'TRIAGE',
  'services/poseTelemetry.ts :: useLatestPoseTelemetry': 'TRIAGE',
  'services/smartFinderService.ts :: getYardageCalcLog': 'TRIAGE',
  'services/smartVisionOverlay.ts :: projectToTilePixels': 'TRIAGE',
  'services/swingBenchmarks.ts :: setBenchmarkOverride': 'TRIAGE',
  'services/swingComparisonEngine.ts :: compareSwingsMulti': 'TRIAGE',
  'services/swingDatabase.ts :: getArchetypeMatches': 'TRIAGE',
  'services/voicePermissionService.ts :: clearMicDenial': 'TRIAGE',
  'services/walkingDetector.ts :: getCachedReading': 'TRIAGE',
  'services/watchWristInterpretation.ts :: calibrateFromMeasured': 'TRIAGE',
};
