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
  'services/smartVisionOverlay.ts :: distanceToTarget':
    'DUPE — a three-line Math.round(haversineYards(from, target)) with a null guard. The other four ' +
    'strategy layers in this module were wired on 08-24; this one was not, because SmartVision ' +
    'already owns tap-to-target distance (app/smartvision.tsx measureYards, which also applies the ' +
    'plays-like adjustment this helper does not). Wiring it would create a SECOND answer to "how far ' +
    'to the point I tapped" — the exact defect class fixed five times today. Delete candidate.',
  'services/puttingAnalysisService.ts :: speakPuttingAnalysis':
    'PARKED — the RENDERED-BUT-NEVER-SPOKEN defect is FIXED (2026-08-25): the camera putt path now calls the shared speakPuttRead, so the caddie says the read out loud. What remains orphaned is this SPOKEN-READ entry point — analyzePutt({ spoken_read }) for a player who says their own read aloud ("downhill, left to right"). That flow has no surface yet. Wire it when the green-side voice ask exists; do not delete, it is the other half of the same feature.',
  'services/coachLesson.ts :: planById':
    'PARKED (2.0) — was tagged WIRE, which reads as a live defect, and it is not one. The screen '
    + 'picks a plan by tapping a card and passes the OBJECT, so nothing needs an id lookup today. '
    + 'Selecting a plan BY NAME is what a voice-driven Coach Caddie needs, and Coach Caddie is '
    + 'explicitly 2.0: releaseSurface.SHELVED_ROUTES already holds /swinglab/coach-lesson, and Tim '
    + 'named it as THE 2.0 feature on 09-01. Named blocker, not "later".',

  // ── WIRE — the club seam, all of it feeding docs/NEXT-CLUB-LOGIC-SWEEP.md ──────

  // ── WIRE — the learn-loop seam ────────────────────────────────────────────────
  'services/mediaCapture.ts :: getRecentCaptures':
    'WIRE — the in-flight capture buffer, never read for playback.',
  'services/courseTruth.ts :: getCourseTruth':
    'DUPE — getCourseTruthSync IS used (smartFinderService.ts:31). This async sibling is redundant, not missing.',

  // ── PARKED — waiting on something named ───────────────────────────────────────
  'services/glassesVisionInput.ts :: attachUtteranceToFrame': 'PARKED — Meta glasses profile needs a native build (docs/NEEDS-A-NATIVE-BUILD.md).',
  'services/glassesVisionInput.ts :: clearVisionContext': 'PARKED — see attachUtteranceToFrame.',
  'services/glassesVisionInput.ts :: getAggregateMode': 'PARKED — see attachUtteranceToFrame.',
  'services/glassesVisionInput.ts :: getGlassesTransport': 'PARKED — see attachUtteranceToFrame.',
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

  // ── ASSESSED 2026-08-30 — this block was 70 unassessed TRIAGE lines. ──────────
  //
  // Tim: "I don't want any orphans left that we need to deal with." Every line below now carries a
  // verdict and a reason, so what remains is a set of DECISIONS rather than a pile of unknowns.
  // Four of them turned out to be live defects and were fixed rather than tagged: the persona lists,
  // the L1 interruption clock, the offline-notes read, and the only handled-error path to Sentry.
  // Where a tag says PARKED it names the blocker; "later" is still not a reason.
  'components/smartmotion/SmartMotionHud.tsx :: MetricRail':
    'SURFACE — a presentational sibling of MetricCard, exported so the HUD can be composed differently. Rendering it nowhere costs nothing.',
  'lib/persona.ts :: getCaddieObject':
    'SURFACE — the object pronoun in the same set as getCaddieSubject/getCaddiePossessive, which ARE used. A pronoun set with a hole in it is worse than an unused export.',
  'services/acousticImpactDetector.ts :: onStrike':
    'SURFACE — a subscribe/unsubscribe API for React effects. No subscriber today; the detector is driven by its own polling path.',
  'services/caddieRequestBody.ts :: CADDIE_REQUEST_KEYS':
    'SURFACE — exported so the brain-parity suite can assert the key set rather than assume it. Its consumer is a test, which the sweep does not count as a reference. Deleting it would blind the parity check.',
  'services/cage/targetRig.ts :: moveTargetEnd':
    'SURFACE — the free-end half of the rig manipulation pair; the anchored-end mover is used. Same reasoning as the pronoun set.',
  'services/cloudSync/snapshot.ts :: NOT_BACKED_UP_STORE_KEYS':
    'SURFACE — the deliberate exclusion list. Its whole job is to be READ BY A TEST asserting every persisted store appears in exactly one of the two lists, so that forgetting a key cannot look like deciding against one. Consumed 2026-08-30 by the change that stopped backing up other players data.',
  'services/conversationState.ts :: isInActiveConversation':
    'SURFACE — a synchronous read of the turn buffer for callers outside React.',
  'services/dialogEngine.ts :: listSituations':
    'SURFACE — introspection over the template registry; its own docstring says tests and help-discovery.',
  'services/featureAccess.ts :: featuresIn':
    'PARKED — the edition comparison table for the paywall. The paywall ships a written feature list instead, and changing paywall copy is layout-frozen. Revisit when subscriptions turn on; the check against docs/edition-matrix.md belongs to that same pass.',
  'services/fillerLibrary.ts :: getFallbackTextForCategory':
    'SURFACE — text fallback when no generated clip exists; the audio path is the one in use.',
  'services/fillerLibrary.ts :: isLibraryGenerated':
    'SURFACE — a readiness read for diagnostics.',
  'services/golfbertApi.ts :: getGolfbertHole':
    'PARKED — Golfbert per-hole detail. The shipped geometry path is AI-vision hole scan plus the course book; Golfbert is the fallback provider and only its course-level call is wired.',
  'services/golfbertApi.ts :: getGolfbertHoleImageryUrl':
    'PARKED — see getGolfbertHole. Imagery ships from the bundled/prefetched set.',
  'services/golfbertApi.ts :: golfbertHealth':
    'SURFACE — a /tools health probe.',
  'services/golferModel.ts :: readPersistedGolferModel':
    'SURFACE — reads the last snapshot from disk so a prompt has something before the first computed model lands. The live path computes synchronously and does not need the cold read.',
  'services/healthData.ts :: getGrantedHealthPermissions':
    'SURFACE — a permission-state read for a settings/diagnostic surface.',
  'services/knowledgeBase/causalEngine.ts :: entryForFault':
    'SURFACE — id-to-entry convenience over a corpus the callers already hold.',
  'services/lieAnalysisService.ts :: isVisionActive':
    'SURFACE — synchronous read of the vision controller for non-React callers.',
  'services/lieAnalysisService.ts :: subscribeVisionActive':
    'SURFACE — the subscription half of the same controller.',
  'services/listeningSession.ts :: isActiveListeningEnabled':
    'SURFACE — a one-line settings read for callers outside React.',
  'services/mediaPipePoseService.ts :: setPreferredQuality':
    'SURFACE — a quality override for profiling. The service picks quality from device class on its own.',
  'services/personaKnowledgeBase.ts :: findPersonaKBEntriesByKeywords':
    'SURFACE — keyword variant of the retrieval used by buildPersonaKBPromptBlock (which IS wired). Useful for a future context-aware match; not a missing feature.',
  'services/personaKnowledgeBase.ts :: getPersonaKBCategories':
    'SURFACE — KB category list, a diagnostic read.',
  'services/personaKnowledgeBase.ts :: getPersonaKBSize':
    'SURFACE — KB size, a diagnostic read for owner tools.',
  'services/planStorage.ts :: listArchivedRecaps':
    'PARKED — the archive browser surface does not exist; recaps are read by id.',
  'services/positionMarkBus.ts :: getLastMark':
    'SURFACE — a sync read of the mark bus for non-React consumers.',
  'services/rangefinder.ts :: REFERENCE_HEIGHTS':
    'PARKED — a picker of known object heights (flagstick, person, range flag) so the player chooses a '
    + 'target instead of typing a number. It is one of the two live options for the SmartFinder tilt '
    + 'cap: at 150y a target subtends 0.67 degrees, under the 2-degree unmeasurable floor, so the '
    + 'read needs a known height or ray-intersected hole geometry. Named blocker: Tim picks which. '
    + 'The self-calibrating eye height (fc00882d) fixed the bug; this is the product call.',
  'services/rangefinder.ts :: buildLock':
    'PARKED — packages a computed distance into a durable lock record. Belongs with the same '
    + 'SmartFinder decision as REFERENCE_HEIGHTS: there is nothing to persist a lock FOR until the '
    + 'high-confidence read exists.',
  'services/responseRouter.ts :: fillerForSonnetVision':
    'DO NOT WIRE — Tim approved wiring this on 2026-08-30, on my description of it, and my '
    + 'description was wrong. I said each vision bridge picks its own filler; they pick NONE. '
    + 'Pre-response conversational filler was REMOVED from the response path on 2026-06-10: a clip '
    + 'firing at 400ms finished about 2s into a 4-6s brain reply, left dead air, and '
    + 'double-acknowledged the brain own natural opening. A sim guard asserts it stays gone. Wiring '
    + 'this reintroduces a fixed defect — the same reason wristCentroid is marked DO NOT WIRE.',
  'services/smartTempo.ts :: tempoTargetFrames':
    'PARKED — frame counts for a replay-at-tempo overlay that has no surface yet.',
  'services/swingComparisonEngine.ts :: annotateWithGolferModel':
    'PARKED — folds the learned miss into a comparison; the comparison surface renders the raw read today.',
  'services/swingDatabase.ts :: listReferences':
    'SURFACE — a filtered listing for an admin/coverage view.',
  'services/swingReferences.ts :: listRegisteredReferences':
    'SURFACE — its own docstring says test/debug, NOT called from production paths.',
  'services/teeTimeLink.ts :: openCourseInMaps':
    'PARKED — the tee-time surface links out to booking; a maps link is a second button nobody has designed.',
  'services/trustLevelService.ts :: defaultWakeWordOn':
    'PARKED — Phase G ships wake-word detection; this stages the per-level default and there is no detector to default yet.',
  'services/trustLevelService.ts :: psychologistEnabled':
    'DUPE — Tim asked on 2026-08-30 to gate the walking conversation to Active. The premise was '
    + 'mine and it was wrong: there IS no unprompted walking conversation. Psychologist is a ROLE '
    + 'applied to replies the player asked for — listeningSession.pickOpener infers arena to '
    + 'psychologist, in-round to caddie, else coach — and it ALREADY gates on trust level there, '
    + 'giving L1 a terse acknowledgement instead of chat. Gating this would degrade answers the '
    + 'player REQUESTED rather than reduce interruptions, and unprompted speech is already handled '
    + 'by proactiveDebounceMs, which returns null at L1. Its sibling proactiveEnabled WAS a real '
    + 'defect and was fixed the same day.',
  'services/tutorialContext.ts :: buildCompressedPracticeContext':
    'SURFACE — a compressed variant for the tactical prompt; the full builder is the one wired.',
  'services/vocabularyProfileService.ts :: getTotalShotsParsed':
    'SURFACE — a maturity counter for diagnostics.',
  'services/voiceLogService.ts :: pendingOfflineNoteCount':
    'SURFACE — a peek-without-consuming count for a UI badge. The READ half of this feature is now wired (peekOfflineNotesBlock reaches the caddie via unified_context_block); this is the optional badge on top of it, and a badge showing a count the player cannot act on is not worth a surface during a freeze. Delete if no badge exists by 1.1.',
  'services/voicePermissionService.ts :: PERMISSION_EXPLAINER_TEXT':
    'SURFACE — the explainer copy, exported for a surface that renders its own.',
  'services/voicePermissionService.ts :: checkMicPermission':
    'DUPE — voiceService.ts:455 requests microphone permission on the live path. This is a second owner that also persists denial state. Not a gap: the mic IS requested. Consolidating owners touches the voice path and needs Tim per-item.',
  'services/watchBridge.ts :: isSenderRegistered':
    'SURFACE — a registration read for diagnostics.',
  'services/watchWristInterpretation.ts :: estimateClubSpeedMph':
    'PARKED — wrist-peak to clubhead speed. Shipping the number needs the calibration surface; the watch reports tempo and impact today.',
  'services/youtubeLinks.ts :: openYouTubeSearch':
    'PARKED — the YouTube portal needs an API key that is not provisioned.',
  'store/caddieMemoryStore.ts :: caddieMemorySnapshot':
    'SURFACE — a whole-store read for diagnostics and export.',
  'store/geometryStatusStore.ts :: isBuildingSnapshot':
    'SURFACE — a sync progress read for non-React callers.',
  'store/guestProfileStore.ts :: findGuestByName':
    'SURFACE — a lookup helper; the shipped paths resolve guests by id.',

  // ── ADDED 2026-08-24 (second pass): surfaced once COMMENTS stopped counting as references ──
  'services/courseDataOrchestrator.ts :: getCourseHeroImagery':
    'WIRE — course hero imagery, computed and shown nowhere.',
  'services/personaKnowledgeBase.ts :: getPersonaAnswer':
    'DO NOT WIRE — superseded by design, and wiring it would be a regression. It returns a CANNED ' +
    'stored answer (entry.tankAnswer / serenaAnswer / ...) for the app to speak directly. The ' +
    'architecture deliberately moved the other way: api/kevin.ts:577 calls buildPersonaKBPromptBlock, ' +
    'which injects the top entries into the prompt so the BRAIN riffs across them in its own voice. ' +
    'A local responder answering instead of the brain is the exact defect class from 08-23 ' +
    '(three surfaces answered the player without calling the brain) and from the canned-line audit. ' +
    'Its header even reads "the brain riffs off the entry rather than freestyling". Keep it dead, or ' +
    'delete it; do not connect it. [[learning-layer-must-not-intercept]] [[feels-like-a-real-caddie]]',
  'services/gpsManager.ts :: getGpsHealth':
    'WIRE/TRIAGE — GPS health read; gpsLost reaches the brain, this richer read does not.',
  'services/glassesVisionInput.ts :: registerGlassesTransport':
    'PARKED — Meta glasses profile needs a native build.',
  'services/metaWearablesBridge.ts :: getMetaWearablesStatus':
    'PARKED — Meta glasses profile needs a native build.',
  'services/activeSurfaceRegistry.ts :: subscribeActiveSurface':
    'SURFACE — the subscription half of a registry read via its getter.',
  'services/cloudSync/snapshot.ts :: unionSnapshots':
    'PARKED — merges two devices snapshots. The shipped restore is last-writer-wins; a real merge needs a conflict UI.',
  'services/courseDataOrchestrator.ts :: attachVisionContextToHole':
    'PARKED — Meta glasses vision context; needs the glasses profile native build.',
  'services/earbudControl.ts :: notifyEarbudLongPress':
    'PARKED — long-press is a distinct gesture from the tap that ships; no surface assigns it a meaning yet.',
  'services/harness/dispatch.ts :: simulateAnalysisCompletion':
    'SURFACE — a harness affordance, by definition not called by the app.',
  'services/localStatusResponder.ts :: AI_LED_QUERY_TYPES':
    'SURFACE — the classification set, exported so the split is inspectable rather than buried.',
  'services/mediaPipePoseService.ts :: smoothPoseFrames':
    'SURFACE — an exported pure helper the analyzer applies internally.',
  'services/poseTelemetry.ts :: useLatestPoseTelemetry':
    'WIRE — the React half of the telemetry bus whose plain getter is also orphaned. Nothing reads what recordPoseTelemetry writes; see getLatestPoseTelemetry in the WIRE block above.',
  'services/smartFinderService.ts :: getYardageCalcLog':
    'SURFACE — the calculation trace for the SmartFinder debug view.',
  'services/smartVisionOverlay.ts :: projectToTilePixels':
    'SURFACE — a pure projection helper; the overlay projects through its own owner.',
  'services/swingBenchmarks.ts :: setBenchmarkOverride':
    'SURFACE — a testing override for benchmark values.',
  'services/swingComparisonEngine.ts :: compareSwingsMulti':
    'PARKED — n-way comparison ahead of a multi-swing surface; the shipped review compares two.',
  'services/swingDatabase.ts :: getArchetypeMatches':
    'PARKED — archetype matching ahead of the surface that would show it.',
  'services/voicePermissionService.ts :: clearMicDenial':
    'SURFACE — the reset half of the denial state its sibling persists.',
  'services/walkingDetector.ts :: getCachedReading':
    'WIRE — the SYNC cache of the walking/cart reading, for a caller that cannot await. Its former pair cartModeSuggestion is NO LONGER orphaned: cart auto-detect (2026-08-30, 5f9928fb) consumes it at walkingDetector.ts:229, so the detector IS consumed now and the old "both orphaned together, nothing consumes it" verdict here was stale — as was its named blocker ("where the suggestion is shown"), since the correction is silent and shows nothing. What is still unwired is only this SYNC accessor: every live reader (conversationalLoggingOrchestrator) goes through isEffectiveCartMode instead. Delete it or give it the sync caller it was written for; it is no longer waiting on a product call.',
  'services/watchWristInterpretation.ts :: calibrateFromMeasured':
    'PARKED — see estimateClubSpeedMph; this is the calibration half.',
};
