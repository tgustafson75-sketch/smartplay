/**
 * Phase 201 — Comprehensive function simulation harness (in-process).
 *
 * Pure-TS exercise of the modules that don't depend on React Native /
 * native modules. Catches integration-class bugs (missing exports,
 * wrong shapes, persona routing errors) before empirical Z Fold testing.
 *
 * Run: `npx tsx scripts/simulations/run-sim.ts`
 *
 * What this harness exercises:
 *   - lib/persona.ts: getCaddieName, getCharacterSpec across 4 personas
 *     + 4 input shapes (Persona / VoiceGender / null / unknown string)
 *   - constants/{kevin,serena,harry,tank}Character.ts: spec presence,
 *     length, character-specific markers
 *   - api/voice-intent.ts: system prompt construction per persona
 *   - Migration logic: settings store v2 → v3 caddieAssignments seed
 *   - Trigger threshold sanity: TRIGGER_THRESHOLDS + DETECTION_THRESHOLDS
 *
 * What this harness does NOT exercise (requires RN runtime / device):
 *   - Zustand stores (depend on AsyncStorage / browser globals)
 *   - voice service speak() / TTS (network + audio)
 *   - GPS / camera (native modules)
 *   - Anthropic / OpenAI API calls (network)
 *   - Component rendering (React Native)
 *
 * Output: prints a structured pass/fail per scenario to stdout. The
 * audit docs (docs/sim-201-*.md) reference both this harness's output
 * AND the static-walkthrough findings for the device-only paths.
 */

import {
  getCaddieName,
  getCharacterSpec,
  getCaddieSubject,
  getCaddiePossessive,
  ALL_PERSONAS,
  type Persona,
} from '../../lib/persona';
import { detectStrikes, type MeterSample } from '../../services/swing/strikeDetector';
import { classifyStroke } from '../../utils/geometryFitting';
import { mergeSwingDetections, correlateStrikesWithVideo, filterReboundStrikes } from '../../services/swing/swingSegmentation';
import { evaluateFraming } from '../../services/swing/framingCheck';
import { computeTraceDirection, traceColor } from '../../services/swing/ballTrace';
import { frameToContainerNorm, containerToFrameNorm } from '../../services/swing/overlayCoords';
import { IndoorRepDetector, summarizeIndoorReps, type IndoorRep } from '../../services/indoorSwing';
import { estimateCarryYards, fullCarryYards } from '../../services/swing/carryEstimate';
import { normalizeImportedList, buildListPersistInput, type ListedRoundRow } from '../../services/roundImportRules';
import { rebuildDifferentialsFromHistory, estimateNewIndex, expectedNineDifferential } from '../../services/handicapCalculator';
import { hasMobilityFlag } from '../../services/coachingAdaptation';
import { planAimLines, layupFraction, LAYUP_THRESHOLD_YARDS } from '../../utils/layupPlan';
import { composeBagRecommendation } from '../../services/bagRecommendation';
import { composeSmartTrace } from '../../services/swing/smartTrace';
import { deriveDrillVerdict } from '../../services/drillVerdict';
import { summarizeOpenRange } from '../../services/practice/openRangeStats';
import { usePracticeSessionStore, recordPracticeSwingIfActive } from '../../store/practiceSessionStore';
import { getFocus, buildInterleavedPlan, isInterleaved, PRACTICE_FOCUSES } from '../../services/practice/sessionPlan';
import { buildGoalPlan, PRACTICE_GOALS } from '../../services/practice/goalPlan';
import { composePreroundPlan, preroundReadiness } from '../../services/practice/preroundPlan';
import { SHOT_SHAPES, getShotShape, readActualLaunch, compareShotShape } from '../../services/practice/shotShapes';
import { estimateSessionPoints, computePointsPerformance } from '../../services/practice/pointsPerformance';
import { composeFitProfile, recommendFlex, recommendBallCategory } from '../../services/practice/fitProfile';
import { useRestModeStore } from '../../store/restModeStore';
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { composeShotRead } from '../../services/cnsShotRead';
import { composeBallFit } from '../../services/cnsBallFitting';
import { analyzePuttRoll } from '../../services/putting/puttRoll';
import { evaluateTeeGoal, describeTeeGoal } from '../../services/goals/teeScoreGoal';
import { defaultDtlRig, translateRig } from '../../services/cage/targetRig';
import { distillConversation } from '../../services/conversationDistill';
import { synthesizeRecapFromRecord } from '../../services/recapSynth';
import { detectSingRequest, buildSingMessage } from '../../services/singAttempt';
import { detectPlaySongRequest } from '../../services/musicIntent';
import { SCREEN_HELP, detectHelpRequest as detectScreenHelp } from '../../services/screenHelp';
import { detectPlainSpeakRequest } from '../../services/plainSpeak';

interface ScenarioResult {
  scenario: string;
  passed: boolean;
  details: string;
}

const results: ScenarioResult[] = [];

function check(scenario: string, condition: boolean, details: string): void {
  results.push({ scenario, passed: condition, details });
  const tag = condition ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${scenario} :: ${details}`);
}

// ─── Scenario 1: persona resolution returns the right name for each input shape ─

console.log('\n=== Scenario 1: persona resolution ===');

for (const p of ALL_PERSONAS) {
  const name = getCaddieName(p);
  // 2026-06-06 — 'custom' resolves to the static "My Caddie"
  // fallback (user-chosen names live in the runtime profile store,
  // not in lib/persona). All other personas capitalize from key.
  const expected = p === 'custom' ? 'My Caddie' : p.charAt(0).toUpperCase() + p.slice(1);
  check(`getCaddieName('${p}')`, name === expected, `expected '${expected}', got '${name}'`);
}

// VoiceGender inputs (legacy back-compat path)
check("getCaddieName('male')", getCaddieName('male') === 'Kevin', `expected 'Kevin', got '${getCaddieName('male')}'`);
check("getCaddieName('female')", getCaddieName('female') === 'Serena', `expected 'Serena', got '${getCaddieName('female')}'`);

// null / undefined / unknown string → 'Kevin' default
check('getCaddieName(null)', getCaddieName(null) === 'Kevin', `expected 'Kevin', got '${getCaddieName(null)}'`);
check('getCaddieName(undefined)', getCaddieName(undefined) === 'Kevin', `expected 'Kevin', got '${getCaddieName(undefined)}'`);
check('getCaddieName("garbage")', getCaddieName('garbage') === 'Kevin', `expected 'Kevin', got '${getCaddieName('garbage')}'`);

// Pronoun helpers — Tank/Harry/Kevin male, Serena female, Custom they/them
// (gender-neutral so any user-chosen identity works).
for (const p of ALL_PERSONAS) {
  const expectedSubj = p === 'serena' ? 'she' : p === 'custom' ? 'they' : 'he';
  const expectedPos = p === 'serena' ? 'her' : p === 'custom' ? 'their' : 'his';
  check(`getCaddieSubject('${p}')`, getCaddieSubject(p) === expectedSubj, `expected '${expectedSubj}', got '${getCaddieSubject(p)}'`);
  check(`getCaddiePossessive('${p}')`, getCaddiePossessive(p) === expectedPos, `expected '${expectedPos}', got '${getCaddiePossessive(p)}'`);
}

// ─── Scenario 2: character specs exist and are persona-distinct ─────────────────

console.log('\n=== Scenario 2: character specs ===');

const SPECS_MIN_LENGTH = 1500; // each spec is multi-paragraph, well over 1500 chars
const PERSONA_DISTINCTIVE_MARKERS: Record<Persona, string[]> = {
  kevin:  ['steady hand', 'friend in the cart'],
  serena: ['Trust your number', 'Smooth swing', 'composed'],
  harry:  ['Take a breath', 'partnership', 'Army medic'],
  tank:   ['Lock it in', 'Send it', 'Marine'],
  // Custom inherits Kevin's spec — share its markers so the sim
  // passes without false negatives.
  custom: ['steady hand', 'friend in the cart'],
};

for (const p of ALL_PERSONAS) {
  const spec = getCharacterSpec(p);
  const specLower = spec.toLowerCase();
  check(`spec('${p}') has content`, spec.length >= SPECS_MIN_LENGTH, `length=${spec.length}, min=${SPECS_MIN_LENGTH}`);
  for (const marker of PERSONA_DISTINCTIVE_MARKERS[p]) {
    // Case-insensitive — markers may appear capitalized at sentence-start
    // (e.g. "Steady hand" in Kevin's archetype label).
    const found = specLower.includes(marker.toLowerCase());
    check(`spec('${p}') contains '${marker}'`, found, found ? 'found' : 'missing distinctive marker');
  }
}

// Cross-check: each persona's spec should NOT contain the OTHER personas' uniquely-distinctive markers
const CROSS_CHECK_NEGATIVE: Record<Persona, string[]> = {
  kevin:  ['Send it', 'Lock it in'],         // Tank's commands shouldn't be in Kevin's spec
  serena: ['Take a breath', 'Send it'],      // Harry's + Tank's
  harry:  ['Send it', 'Marine cadence'],     // Tank's
  tank:   ['friend in the cart', 'partnership'],  // Kevin's + Harry's distinctive
  // Custom = Kevin's spec, so the same negative markers apply.
  custom: ['Send it', 'Lock it in'],
};

for (const p of ALL_PERSONAS) {
  const spec = getCharacterSpec(p);
  for (const negMarker of CROSS_CHECK_NEGATIVE[p]) {
    // Allow the marker to appear in TEAM AWARENESS sections (Phase 106) where
    // the persona references teammates by their phrases. We accept up to ONE
    // mention (the team awareness reference), more than one suggests bleed.
    const occurrences = spec.split(negMarker).length - 1;
    check(
      `spec('${p}') doesn't bleed '${negMarker}'`,
      occurrences <= 1,
      `expected ≤1 mention (team awareness reference allowed), got ${occurrences}`,
    );
  }
}

// ─── Scenario 3: settings store v2 → v3 migration logic ─────────────────────────

console.log('\n=== Scenario 3: settings persist migration ===');

// Simulate the migrate fn directly (it's a pure function inside the persist
// config; we replicate it here to exercise the same logic).
type Assignments = Record<'round' | 'cage' | 'drills' | 'play', Persona>;
const DEFAULT_CADDIE_ASSIGNMENTS: Assignments = {
  round: 'kevin', cage: 'tank', drills: 'serena', play: 'kevin',
};

type MigrateInput = { caddiePersonality?: Persona; caddieAssignments?: Assignments };

function simulateMigrate(persisted: Partial<MigrateInput>, version: number): MigrateInput {
  const p = (persisted ?? {}) as Partial<MigrateInput>;
  if (version < 3 && !p.caddieAssignments) {
    const prior: Persona = p.caddiePersonality ?? 'kevin';
    p.caddieAssignments = {
      round: prior, cage: prior, drills: prior, play: prior,
    };
  }
  return p as MigrateInput;
}

// Case A: v2 user with caddiePersonality = 'serena' migrates to all-Serena assignments
const a = simulateMigrate({ caddiePersonality: 'serena' }, 2);
check(
  'migration v2→v3 seeds all 4 pillars to prior persona',
  a.caddieAssignments?.round === 'serena' && a.caddieAssignments?.cage === 'serena' &&
  a.caddieAssignments?.drills === 'serena' && a.caddieAssignments?.play === 'serena',
  JSON.stringify(a.caddieAssignments),
);

// Case B: v2 user with no caddiePersonality (fresh install seeded as default) → all Kevin
const b = simulateMigrate({}, 2);
check(
  'migration v2→v3 with no prior persona defaults to Kevin everywhere',
  b.caddieAssignments?.round === 'kevin',
  JSON.stringify(b.caddieAssignments),
);

// Case C: v3 user with assignments already set → no change
const c = simulateMigrate({ caddiePersonality: 'kevin', caddieAssignments: { round: 'tank', cage: 'kevin', drills: 'harry', play: 'serena' } }, 3);
check(
  'migration is no-op when version >= 3',
  c.caddieAssignments?.round === 'tank',
  JSON.stringify(c.caddieAssignments),
);

// ─── Scenario 4: pillar resolver — surface to pillar mapping ──────────────────

console.log('\n=== Scenario 4: surface → pillar mapping ===');

// Replicate caddieResolver.mapSurfaceToPillar logic for in-process check.
function mapSurfaceToPillar(surface: string | null): 'round' | 'cage' | 'drills' | 'play' {
  switch (surface) {
    case 'cage':
    case 'swing_library':
    case 'swing_detail':
      return 'cage';
    case 'arena':
      return 'play';
    case 'drill_detail':
    case 'drill_session':
      return 'drills';
    case 'caddie':
    case 'recap':
    case null:
    default:
      return 'round';
  }
}

const surfaceCases: Array<[string | null, ReturnType<typeof mapSurfaceToPillar>]> = [
  ['caddie', 'round'],
  ['recap', 'round'],
  [null, 'round'],
  ['cage', 'cage'],
  ['swing_library', 'cage'],
  ['swing_detail', 'cage'],
  ['drill_detail', 'drills'],
  ['drill_session', 'drills'],
  ['arena', 'play'],
];

for (const [surface, expected] of surfaceCases) {
  const got = mapSurfaceToPillar(surface);
  check(`surface(${surface}) → ${expected}`, got === expected, `got '${got}'`);
}

// ─── Scenario 5: voice intent classifier system prompt completeness ─────────────

console.log('\n=== Scenario 5: voice intent classifier ===');

import * as fs from 'fs';
import * as path from 'path';
const voiceIntentPath = path.resolve(__dirname, '../../api/voice-intent.ts');
const voiceIntentSrc = fs.readFileSync(voiceIntentPath, 'utf-8');

// All 18 intent types should be enumerated in the union type at the bottom.
const expectedIntents = [
  'open_tool', 'query_status', 'change_setting', 'navigate', 'help', 'acknowledge',
  'rules_query', 'handicap_query', 'set_trust_quiet', 'set_trust_companion',
  'in_round_diagnostic', 'club_change', 'club_query', 'club_menu',
  'log_shot', 'media_capture', 'media_playback', 'unknown',
];

for (const intent of expectedIntents) {
  const inUnion = voiceIntentSrc.includes(`"${intent}"`);
  check(`voice-intent type union has '${intent}'`, inUnion, inUnion ? 'present' : 'MISSING from intent_type union');
}

// Each intent should also have an example block (with at least 'Examples:' label nearby).
for (const intent of expectedIntents.filter((i) => i !== 'unknown')) {
  // Look for the intent name at the start of a numbered item.
  const present = new RegExp(`\\d+\\. ${intent}`).test(voiceIntentSrc);
  check(`voice-intent prompt documents '${intent}'`, present, present ? 'documented' : 'NO prompt section');
}

// ─── Scenario 6: trigger threshold sanity ──────────────────────────────────────

console.log('\n=== Scenario 6: trigger thresholds ===');

const teamIntelPath = path.resolve(__dirname, '../../store/teamIntelligenceStore.ts');
const teamIntelSrc = fs.readFileSync(teamIntelPath, 'utf-8');

// All five triggers should appear in the SuggestionTrigger union.
const expectedTriggers = ['drill_plateau', 'cage_frustration', 'mental_struggle', 'tactical_to_mental', 'user_explicit_stuck'];
for (const t of expectedTriggers) {
  check(`teamIntel has trigger '${t}'`, teamIntelSrc.includes(t), teamIntelSrc.includes(t) ? 'present' : 'MISSING');
}

// Frequency cap: maxSuggestionsPerSession = 1 (conservative)
const maxSuggMatch = teamIntelSrc.match(/maxSuggestionsPerSession:\s*(\d+)/);
check(
  'maxSuggestionsPerSession is conservative (≤2)',
  maxSuggMatch != null && Number(maxSuggMatch[1]) <= 2,
  `value: ${maxSuggMatch?.[1] ?? 'NOT FOUND'}`,
);

// ─── Scenario 7: media capture wiring ──────────────────────────────────────────

console.log('\n=== Scenario 7: media capture surface wiring ===');

const mediaCapturePath = path.resolve(__dirname, '../../services/mediaCapture.ts');
const mediaCaptureSrc = fs.readFileSync(mediaCapturePath, 'utf-8');

// The orchestration boundary should expose the kind-aware subscribe API.
check('subscribeCapture takes kinds[]', /subscribeCapture\(.*kinds:\s*readonly CaptureKind\[\]/.test(mediaCaptureSrc), 'kinds[] arg present');
check('isCaptureWired iterates registrations', mediaCaptureSrc.includes('for (const reg of captureSubscribers)'), 'kind-aware iteration present');

const captureOverlayPath = path.resolve(__dirname, '../../components/CaptureOverlay.tsx');
const captureOverlaySrc = fs.readFileSync(captureOverlayPath, 'utf-8');
// 2026-05-17 — 'highlight' (hero shot) kind removed. CaptureOverlay
// now subscribes for 'shot' only; cage flow owns 'swing' separately.
check('CaptureOverlay subscribes for shot', captureOverlaySrc.includes("subscribeCapture(['shot']"), 'subscribed kinds correct');

// ─── Scenario 8: AbortSignal polyfill is Hermes-safe ───────────────────────────

console.log('\n=== Scenario 8: AbortSignal polyfill ===');

const polyfillPath = path.resolve(__dirname, '../../services/polyfills.ts');
const polyfillSrc = fs.readFileSync(polyfillPath, 'utf-8');
check('polyfill guards DOMException with typeof', polyfillSrc.includes("typeof DOMException !== 'undefined'"), 'typeof guard present');
check('polyfill has Error fallback', polyfillSrc.includes("name = 'TimeoutError'"), 'Error fallback present');

// ─── Scenario 9: server-side persona handling sweep ────────────────────────────

console.log('\n=== Scenario 9: server-side persona sweep ===');

const apiDir = path.resolve(__dirname, '../../api');
const apiFiles = fs.readdirSync(apiDir).filter((f) => f.endsWith('.ts') && !f.startsWith('_'));
let serverPersonaOk = 0;
let serverPersonaTotal = 0;
for (const f of apiFiles) {
  const src = fs.readFileSync(path.join(apiDir, f), 'utf-8');
  if (!src.includes('getCaddieName')) continue;
  serverPersonaTotal++;
  // The Phase 100 / B4 sweep made every getCaddieName call site accept
  // either persona or voiceGender. Recognize BOTH canonical styles:
  //   (a) typeof body.persona === 'string'         (most routes)
  //   (b) body.persona ?? body.voiceGender ?? ...   (junior/putting)
  // 2026-06-08 — added (b): the regex was stale and flagged two
  // already-persona-aware routes as failing (harness-vs-reality drift).
  const ok =
    /typeof\s+(?:body\??\.)?persona\s*===\s*['"]string['"]/.test(src) ||
    /body\??\.persona\s*\?\?/.test(src);
  if (ok) serverPersonaOk++;
  check(`api/${f} accepts both persona+voiceGender`, ok, ok ? 'persona-aware' : 'still voiceGender-only');
}
check(`server-side persona sweep: ${serverPersonaOk}/${serverPersonaTotal}`, serverPersonaOk === serverPersonaTotal, `${serverPersonaOk} of ${serverPersonaTotal} api/* routes persona-aware`);

// ─── Scenario 10: shot logging schema alignment ────────────────────────────────

console.log('\n=== Scenario 10: shot logging schema ===');

const logShotPath = path.resolve(__dirname, '../../services/intents/logShotHandler.ts');
const logShotSrc = fs.readFileSync(logShotPath, 'utf-8');
check('logShotHandler outcome enum aligns with ShotOutcome',
  logShotSrc.includes("'water'") && logShotSrc.includes("'hazard_drop'") && logShotSrc.includes("'unplayable'"),
  'water + hazard_drop + unplayable present');

const quickLogPath = path.resolve(__dirname, '../../components/QuickLogShotSheet.tsx');
const quickLogSrc = fs.readFileSync(quickLogPath, 'utf-8');
check('QuickLogShotSheet outcome enum aligns', quickLogSrc.includes("'hazard_drop'"), 'hazard_drop present');

// ─── Scenario 11: PGA HOPE follow-up — settings store + helpers ────────────────

console.log('\n=== Scenario 11: PGA HOPE accessibility + intensity wiring ===');

const settingsStorePath = path.resolve(__dirname, '../../store/settingsStore.ts');
const settingsSrc = fs.readFileSync(settingsStorePath, 'utf-8');

check('settingsStore exports getEffectiveSimpleBriefing helper',
  settingsSrc.includes('export function getEffectiveSimpleBriefing'),
  'helper exported for callers');

check('settingsStore migrates v3 -> v4 (a11y defaults)',
  settingsSrc.includes('version < 4') && settingsSrc.includes('largeText'),
  'v4 migrate present');

check('settingsStore migrates v4 -> v5 (Harry default + bluetooth prompt)',
  settingsSrc.includes('version < 5') && settingsSrc.includes('ttsCaptionsBluetoothPrompt'),
  'v5 migrate present');

check('settingsStore Harry default lowered to 90',
  /personaIntensity:\s*\{\s*kevin:\s*100,\s*serena:\s*100,\s*harry:\s*90,\s*tank:\s*70/.test(settingsSrc),
  'Harry default 90, Tank default 70');

check('settingsStore tracks simpleBriefingUserTouched',
  settingsSrc.includes('simpleBriefingUserTouched'),
  'auto-on heuristic gate present');

const captionStripPath = path.resolve(__dirname, '../../components/CaptionStrip.tsx');
const captionSrc = fs.readFileSync(captionStripPath, 'utf-8');

check('CaptionStrip subscribes to caption + route + speaking events',
  captionSrc.includes('subscribeToCaption') && captionSrc.includes('subscribeRouteChanges') && captionSrc.includes('subscribeToSpeaking'),
  'all three subscriptions wired');

check('CaptionStrip prompts (not silently flips) ttsCaptions on Bluetooth',
  captionSrc.includes('ttsCaptionsBluetoothPrompt') && captionSrc.includes("Alert.alert"),
  'first-time bluetooth prompt present');

check('CaptionStrip honors "never" prompt response',
  captionSrc.includes("'never'"),
  'don\'t-ask-again branch present');

const voicePath = path.resolve(__dirname, '../../services/voiceService.ts');
const voiceSrc = fs.readFileSync(voicePath, 'utf-8');

check('voiceService exports caption + speaking subscriptions',
  voiceSrc.includes('export const subscribeToCaption') && voiceSrc.includes('export const subscribeToSpeaking'),
  'subscription surface present');

check('voiceService volume reads currentPlaybackVolume() (per-persona dial)',
  /volume:\s*currentPlaybackVolume\(\)/.test(voiceSrc),
  'volume threaded from intensity dial');

const tankSpecPath = path.resolve(__dirname, '../../constants/tankCharacter.ts');
const tankSpec = fs.readFileSync(tankSpecPath, 'utf-8');
check('Tank character spec has DISASTER DISCIPLINE block',
  tankSpec.includes('DISASTER DISCIPLINE'),
  'disaster discipline guard present');
check('Tank character spec has SOFT-INTRO MODE block',
  tankSpec.includes('SOFT-INTRO MODE'),
  'soft-intro mode present');

const kevinApiPath = path.resolve(__dirname, '../../api/kevin.ts');
const kevinSrc = fs.readFileSync(kevinApiPath, 'utf-8');
check('api/kevin.ts threads INTENSITY DIAL into prompt',
  kevinSrc.includes('INTENSITY DIAL'),
  'intensity dial present in system prompt');
check('api/kevin.ts has PACE CHECK section',
  kevinSrc.includes('PACE CHECK'),
  'pace check present in system prompt');

const profilePath = path.resolve(__dirname, '../../store/playerProfileStore.ts');
const profileSrc = fs.readFileSync(profilePath, 'utf-8');
check('SubscriptionStatus includes lifetime',
  /SubscriptionStatus\s*=\s*[^;]*'lifetime'/.test(profileSrc),
  'lifetime tier defined');
check('isOwnerEmail honors Tim\'s email and env-var fallback',
  profileSrc.includes('isOwnerEmail') && profileSrc.includes('EXPO_PUBLIC_OWNER_EMAIL'),
  'owner allow-list + env fallback wired');
check('grantLifetime action exists',
  profileSrc.includes('grantLifetime'),
  'lifetime grant action present');

const featurePath = path.resolve(__dirname, '../../services/featureAccess.ts');
const featureSrc = fs.readFileSync(featurePath, 'utf-8');
check('featureAccess.canAccess treats lifetime as paid',
  featureSrc.includes("'lifetime'"),
  'lifetime accepted by feature gate');

// ─── Scenario 12: 2026-06-08 session surfaces (keep harness == reality) ─────────
// Static source checks for the features added/changed this session, so the
// harness reflects how the app ACTUALLY works now and guards against
// regression. (Pure file-content checks — no RN runtime needed.)

console.log('\n=== Scenario 12: 2026-06-08 session surfaces ===');

const exists = (rel: string) => fs.existsSync(path.resolve(__dirname, '../../', rel));
// Crash-safe: a MISSING file returns '' so the check FAILS gracefully instead of
// aborting the whole suite (a single missing/renamed file used to halt the run and
// silently skip every check after it). 2026-06-27.
const read = (rel: string) => { try { return fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8'); } catch { return ''; } };

// Tempo / transition (vision-derived, acoustic-verified)
check('poseAnalysisApi exports deriveSwingTempo',
  /export\s+async\s+function\s+deriveSwingTempo/.test(read('services/poseAnalysisApi.ts')),
  'tempo/transition derivation present');

// Shot strategy — bagDistances kept; dead recommendStrategy/bagMaxCarry removed
const strategySrc = read('services/shotStrategy.ts');
check('shotStrategy exports bagDistances (used by caddie)',
  /export\s+function\s+bagDistances/.test(strategySrc), 'bag distances surface present');
check('shotStrategy dead exports removed',
  !/export\s+function\s+recommendStrategy/.test(strategySrc) && !/export\s+function\s+bagMaxCarry/.test(strategySrc),
  'recommendStrategy + bagMaxCarry removed pre-OTA');

// Caddie brain consumes the real bag + the two-shot strategy rule
const kevinApiSrc = read('api/kevin.ts');
check('kevin.ts consumes clubDistances + strategy rule',
  kevinApiSrc.includes('clubDistances') && /CLUB\s*&\s*STRATEGY/i.test(kevinApiSrc),
  'bag context + strategy prompt wired');

// Coach notes flow into swing analysis
check('poseDetection swing context carries coach_note',
  read('services/poseDetection.ts').includes('coach_note'), 'coach_note in analyze context');
check('swing-analysis prompt uses coach_note',
  read('api/swing-analysis.ts').includes('coach_note'), 'coach note threaded to prompt');

// Putt ball/target into vision analysis
check('putting-analysis accepts ball_area_norm + target_norm',
  /ball_area_norm/.test(read('api/putting-analysis.ts')) && /target_norm/.test(read('api/putting-analysis.ts')),
  'ball/target anchors in putt prompt');

// Handedness: unknown-safe junior cues
check('junior-swing handles unknown handedness',
  /handedness === 'unknown'/.test(read('api/junior-swing-analysis.ts')),
  'no silent RH default for unknown handedness');

// Coach report export + role + credentials
check('coachReport exports exportCoachReport',
  /export\s+async\s+function\s+exportCoachReport/.test(read('services/coachReport.ts')),
  'coach report generator present');
const profileSrc2 = read('store/playerProfileStore.ts');
check('playerProfile has role + coachCredentials + GHIN excluded from persist',
  /role:\s*'golfer'\s*\|\s*'instructor'\s*\|\s*'student'/.test(profileSrc2) &&
  profileSrc2.includes('coachCredentials') &&
  /const\s*\{\s*ghin_number\b/.test(profileSrc2),
  'role + credentials + GHIN-at-rest privacy');

// Golfer avatars (initials default → selfie → AI-stylized)
check('GolferAvatar component + capture service exist',
  exists('components/GolferAvatar.tsx') &&
  /export\s+async\s+function\s+captureGolferSelfie/.test(read('services/golferAvatar.ts')) &&
  /export\s+async\s+function\s+stylizeGolferSelfie/.test(read('services/golferAvatar.ts')),
  'avatar + selfie/AI-stylize wired');
check('FamilyMember carries avatar_photo_uri',
  /avatar_photo_uri\??:/.test(read('store/familyStore.ts')),
  'member photo field present');

// Removed dead feature stays removed
check('scan-golfer / playerCalibration removed',
  !exists('app/swinglab/scan-student.tsx') && !exists('store/playerCalibrationStore.ts') && !exists('services/playerCalibration.ts'),
  'dead calibration feature gone');

// ─── 2026-06-08 session: GPS issue-log, acoustic meter, skeleton alignment,
//     course↔API linking ───────────────────────────────────────────────────
const issueLogSrc = read('store/issueLogStore.ts');
check('GPS failures route to issue log',
  /gps_error/.test(issueLogSrc) && /addGpsEvent/.test(issueLogSrc),
  'gps_error kind + addGpsEvent present');

check('owner-logs handles gps_error kind',
  /case 'gps_error'/.test(read('app/owner-logs.tsx')),
  'gps_error labeled + colored in log viewer');

check('Acoustic Test Bench card + screen removed',
  !exists('app/acoustic-test.tsx') && !/acoustic-test/.test(read('app/(tabs)/swinglab.tsx')),
  'dead acoustic test bench gone (acoustic lives in SmartMotion calibration)');

check('Acoustic pickup is a meter, not equalizer bars',
  /meterTrack/.test(read('components/smartmotion/SmartMotionHud.tsx')) &&
    !/const bars = \[/.test(read('components/smartmotion/SmartMotionHud.tsx')),
  'level meter replaces bar graph');

const overlaySrc = read('components/swinglab/SwingBodyOverlay.tsx');
check('Skeleton overlay aligns via true frame dims + resizeMode',
  /resizeMode/.test(overlaySrc) && /aligned/.test(overlaySrc) &&
    /frameW/.test(read('services/poseAnalysisApi.ts')),
  'frame-space viewBox + meet/slice match the video');

const geomSrc = read('services/courseGeometryService.ts');
check('All stored local courses link to golfcourseapi',
  /lakes:\s*\{/.test(geomSrc) && /palms:\s*\{/.test(geomSrc),
  'Menifee Lakes (lakes+palms) hints close the last linking gap');

// ─── 2026-06-09: SmartMotion acoustic false-positive fix (TV/ambient) ──────
// Functional test of detectStrikes — verifies the decay-isolation filter.
{
  const STEP = 50; // ms (matches audioMetering METERING_INTERVAL_MS)
  const N = 60;    // 3000ms recording
  // A: clean isolated strike — flat floor with one sharp spike that decays.
  const isolated: MeterSample[] = [];
  for (let i = 0; i < N; i++) {
    const t = i * STEP;
    let dB = -60;
    if (t === 1500) dB = -18;        // sharp spike (42 dB over floor)
    else if (t === 1550) dB = -45;   // immediate decay back toward floor
    else if (t === 1600) dB = -58;
    isolated.push({ timeMs: t, dB });
  }
  const isoRes = detectStrikes(isolated);
  check('Acoustic: clean isolated strike is detected',
    isoRes.kind === 'ok' && isoRes.strikes.length >= 1,
    `expected >=1 strike, got ${isoRes.kind === 'ok' ? isoRes.strikes.length : isoRes.kind}`);

  // B: LOW floor (quiet room, median stays low → kind 'ok') with a short,
  // sustained loud TV burst that's a minority of the clip. This is the real
  // garage case: the burst's leading edge has a sharp attack from the floor
  // (passes the attack filter) but does NOT decay — the decay-isolation
  // filter must reject it. Interior/trailing peaks fail the attack filter
  // (their rise traces back through the sustained loud region). Net: 0
  // strikes, specifically via decay-isolation (not the noisy-floor gate).
  const burst: MeterSample[] = [];
  for (let i = 0; i < N; i++) {
    const t = i * STEP;
    let dB = -60;
    if (t >= 1000 && t <= 1600) dB = (i % 2 === 0) ? -20 : -23; // ~22% of clip
    burst.push({ timeMs: t, dB });
  }
  const burstRes = detectStrikes(burst);
  check('Acoustic: sustained TV burst rejected by decay-isolation',
    burstRes.kind === 'ok' && burstRes.strikes.length === 0,
    `expected ok/0 strikes, got ${burstRes.kind === 'ok' ? burstRes.strikes.length : burstRes.kind}`);

  // C: 2026-06-15 (Tim — AC hum) — ADAPTIVE rolling floor. The first 2s are a
  // loud ambient stretch (AC near the mic, ~-34dB), then it goes quiet (-60dB);
  // a CLEAN strike (-25dB) lands in the quiet tail. A single GLOBAL-median floor
  // is dragged up to ~-34 by the loud majority, so floor+30 = -4 and the -25
  // strike is SUPPRESSED (missed). The rolling LOCAL floor near the strike is
  // ~-60 (the quiet neighborhood), so it clears and is detected. This is exactly
  // the AC-cycling case the global floor failed on.
  const drift: MeterSample[] = [];
  for (let i = 0; i < N; i++) {
    const t = i * STEP;
    let dB = -60;
    if (t < 2000) dB = (i % 2 === 0) ? -33 : -36; // loud ambient first 2s
    if (t === 2600) dB = -25;                       // clean strike in the quiet tail
    else if (t === 2650) dB = -58;                  // sharp decay
    drift.push({ timeMs: t, dB });
  }
  const driftRes = detectStrikes(drift);
  check('Acoustic: rolling local floor catches a strike a global floor would suppress',
    driftRes.kind === 'ok' && driftRes.strikes.length >= 1,
    `expected >=1 strike (rolling floor), got ${driftRes.kind === 'ok' ? driftRes.strikes.length : driftRes.kind}`);
}

check('SmartMotion review video muted (no clip-audio feedback loop)',
  /isMuted/.test(read('app/swinglab/smartmotion.tsx')),
  'looping replay no longer plays captured room audio');

check('strikeDetector has decay-isolation filter',
  /MIN_DECAY_DB/.test(read('services/swing/strikeDetector.ts')) &&
    /DECAY_WINDOW_MS/.test(read('services/swing/strikeDetector.ts')),
  'sustained-audio rejection (peak must fall after the spike)');

// ─── 2026-06-09: SmartMotion honesty pass (club tag, ball speed, meter) ────
check('Ball speed no longer silently assumes a 7-iron',
  /club: args\.club \?\? 'unknown'/.test(read('services/acousticDetectApi.ts')),
  "detectBallSpeed defaults club to 'unknown' (→ null), not '7I'");

check('Pose ball speed suppressed for untagged club',
  /clubSpeed\.value != null && clubKey !== 'unknown'/.test(read('services/swingMetricsService.ts')),
  'unknown club → ball speed —, not club×generic-smash');

const smSrc = read('app/swinglab/smartmotion.tsx');
check('SmartMotion has a club selector wired',
  /ClubPickerModal/.test(smSrc) && /clubIdToServerKey/.test(smSrc) && /clubSelectionStore/.test(smSrc),
  'club picker + server-key map + persisted last club');

check('SmartMotion passes real club into metrics + acoustic',
  /club: clubIdToSmashKey\(club\)/.test(smSrc) && /club: clubIdToServerKey\(clubRef\.current\)/.test(smSrc),
  'synthesize + detectBallSpeed receive the tagged club');

check('clubIdToServerKey maps to acoustic-detect keys',
  /export function clubIdToServerKey/.test(read('components/cage/ClubPickerModal.tsx')),
  'ClubId → server CLUB_TYPICAL key mapper present');

check('Acoustic meter is driven by live dB, not hardcoded steps',
  /levelDb/.test(read('components/smartmotion/SmartMotionHud.tsx')) &&
    !/active \? 0\.74 : detected \? 0\.55/.test(read('components/smartmotion/SmartMotionHud.tsx')),
  'real live level replaces the 0.12/0.74/0.55/0.3 placeholder');

check('DIST chip labels its estimate; confidence no longer defaults to medium',
  /distanceEst/.test(smSrc) && /analysis\.confidence \?\? '—'/.test(smSrc) &&
    !/analysis\.confidence \?\? 'medium'/.test(smSrc),
  'DIST · est + honest confidence fallback');

const swingApiSrc = read('api/swing-analysis.ts');
check('Hard-to-see issues (path/face/attack) gated behind a cited cue',
  /HARD_TO_SEE_2D/.test(swingApiSrc) && /OBSERVABILITY LIMIT/.test(swingApiSrc),
  'detected_issue path/face/attack → none without evidence; prompt warns on 2D limits');

// ─── 2026-06-09: deferred-wiring tripwire ──────────────────────────────────
// Root cause of the acoustic-meter miss: a UI element shipped reading
// hardcoded constants with a comment promising to wire the real signal
// "later" — and a normal audit didn't catch it because the component
// EXISTED. This guard fails the build if any "wire it later" marker ships
// in the SmartMotion flagship, so a placeholder can't quietly reach users.
{
  const FLAGSHIP = [
    'app/swinglab/smartmotion.tsx',
    'components/smartmotion/SmartMotionHud.tsx',
    'app/(tabs)/caddie.tsx',
    'components/CaddieDataStrip.tsx',
    'components/swinglab/CageTargetingCard.tsx',
  ];
  // Narrow, intent-revealing markers — NOT generic words like "fake"/"placeholder"
  // that appear in honest comments or RN props.
  const DEFER_MARKERS = /(until\s+\w+\s+(?:is\s+)?wired|reflects state until|not yet wired|wired when|hardcoded\s+(?:level|value|fill|step))/i;
  const offenders = FLAGSHIP.filter((f) => DEFER_MARKERS.test(read(f)));
  check('No deferred-wiring placeholders in SmartMotion flagship',
    offenders.length === 0,
    offenders.length === 0 ? 'no "wire it later" markers feeding the UI' : `offending files: ${offenders.join(', ')}`);
}

// ─── 2026-06-09: ball-departure strike verifier + ball/target design ───────
check('Ball-departure verifier endpoint + client wired',
  exists('api/ball-departure.ts') &&
    /export async function detectBallDeparture/.test(read('services/swing/ballDeparture.ts')),
  'server endpoint + client service present');

check('SmartMotion runs + surfaces the ball-departure cross-check',
  /detectBallDeparture/.test(smSrc) && /ballDeparture/.test(smSrc) &&
    /Sound only/.test(smSrc) && /Ball strike confirmed/.test(smSrc),
  'verifier called on stop + honest confirmed/sound-only/unseen UI');

check('Ball-departure verdict is honest (departed = before && !after)',
  /departed = before && !after/.test(read('api/ball-departure.ts')),
  'no departure claimed unless a ball was visible then gone');

const targetOverlaySrc = read('components/swinglab/CageTargetingCard.tsx');
check('Ball/target overlay matches the design reference',
  // 2026-06-16 — the BALL/TARGET/LAUNCH text pills were intentionally removed
  // (commit 4c9dabb "remove BALL/TARGET/LAUNCH pills"); the green perspective
  // ball-area trapezoid (SvgPolygon) + white target line (SvgLine) / ring
  // (SvgEllipse) remain as the clean visual markers.
  /SvgPolygon/.test(targetOverlaySrc) && /SvgEllipse/.test(targetOverlaySrc) &&
    /SvgLine/.test(targetOverlaySrc),
  'green perspective ball-area trapezoid + white target line/ring (text pills removed by design)');

check('Pre-record ball box: default box + verifier gated to Motion step + acoustic anchor',
  /draftBall/.test(smSrc) && /placeBallMode/.test(smSrc) &&
    // 2026-06-13 — ball box now lives as a labeled row in the collapsible setup
    // tools CARD (single tools icon → card), not the old right-edge rail button.
    /title=\{placeBallMode \? 'Tap your ball' : 'Ball box'\}/.test(smSrc) &&
    // 2026-06-14 — departure effect is now per-swing (cached by index, recomputed off
    // the SELECTED swing's strike); deps dropped `ballDeparture` (the old run-once guard).
    /\[showSkeleton, clipUri, ballArea, segments, selectedSwing\]/.test(smSrc) &&
    // 2026-06-15 (Tim) — video-located segments (peakDb EXACTLY 0, ~±1s) no longer go
    // DARK; they ATTEMPT departure and accept ONLY a high-confidence, clearly-departed
    // read (degrade+flag), so a clearly-departed daytime ball still traces while a
    // loose anchor never draws a wrong direction. Acoustic anchors keep frame-accuracy.
    /const videoLocated = \(seg\?\.peakDb \?\? 0\) === 0;/.test(smSrc) &&
    // 2026-07-04 (drift reconcile) — acceptance deliberately LOOSENED from
    // confidence==='high' to !== 'low' (high-only threw away good medium reads).
    /videoLocated[\s\S]{0,200}r\.departed && r\.confidence !== 'low' && r\.ball_present_before/.test(smSrc),
  'default reference box + verifier runs under Motion (fast default), per-swing; video-located swings degrade to a not-low-confidence trace instead of going dark');

// ─── Deploy guard: every /api/* the client calls must be ROUTED in
//     vercel.json. Root cause of the ball-departure 404: the function built
//     (api/*.ts glob) but had no route, so it fell through to the SPA. This
//     scans client services for /api/<name> and asserts each is routed. ────
{
  const vercelJson = read('vercel.json');
  const routedApis = new Set<string>();
  for (const m of vercelJson.matchAll(/"dest":\s*"\/api\/([a-z0-9-]+)\.ts"/g)) routedApis.add(m[1]);
  // Endpoints reached via the generic api/*.ts build without an explicit
  // route entry would 404 under the routes allowlist; none should rely on that.
  const SERVICE_DIRS = ['services'];
  const calledApis = new Set<string>();
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    let entries: string[] = [];
    try { entries = require('fs').readdirSync(dir); } catch { return out; }
    for (const e of entries) {
      const p = `${dir}/${e}`;
      let stat;
      try { stat = require('fs').statSync(p); } catch { continue; }
      if (stat.isDirectory()) out.push(...walk(p));
      else if (/\.(ts|tsx)$/.test(e)) out.push(p);
    }
    return out;
  };
  // Endpoints NOT served by Vercel routes (and therefore exempt): Google
  // Maps staticmap (external). (2026-07-06 audit: the Meta-glasses swing-tempo
  // placeholder route was deleted — zero client callers.)
  const EXEMPT = new Set(['staticmap']);
  for (const f of walk('services')) {
    let src = '';
    try { src = require('fs').readFileSync(f, 'utf8'); } catch { continue; }
    for (const rawLine of src.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) continue; // skip comments
      if (line.includes('googleapis') || line.includes('maps/api')) continue;               // skip external
      for (const m of line.matchAll(/\/api\/([a-z0-9-]+)\b/g)) calledApis.add(m[1]);
    }
  }
  const missing = [...calledApis].filter((a) => !routedApis.has(a) && !EXEMPT.has(a));
  check('Every client /api/* endpoint is routed in vercel.json',
    missing.length === 0,
    missing.length === 0 ? `${calledApis.size} api calls all routed` : `UNROUTED (will 404): ${missing.join(', ')}`);
}

// ─── 2026-06-09 audit fixes (honesty + wiring) ─────────────────────────────
check('Caddie bag distances only include real (logged) clubs',
  /if \(!stats\.hasSamples\(c\)\) continue/.test(read('services/shotStrategy.ts')),
  "bagDistances gates on hasSamples — no STANDARD_YARDS leak into 'real distances'");

check('Caddie TARGET no longer a hardcoded CENTER',
  !/const targetDirection = 'CENTER'/.test(read('app/(tabs)/caddie.tsx')),
  'frozen CENTER placeholder removed (honest — until a real aim engine)');

check('SmartMotion camera audio muted (no iOS dual-recorder conflict)',
  /mode="video"\s+mute/.test(read('app/swinglab/smartmotion.tsx')),
  'camera mute prevents audio-session collision with the metering recorder');

check('practiceStore averages carry per-club, not by total swing count',
  /driverCarryCount/.test(read('store/practiceStore.ts')) &&
    /woodCarryCount/.test(read('store/practiceStore.ts')),
  'per-club sample counts fix deflated driver/3W carry averages');

check('Ghost match rebuilds running delta after a restart',
  /rehydrateProgress/.test(read('store/ghostStore.ts')) &&
    /rehydrateProgress/.test(read('app/(tabs)/caddie.tsx')),
  'ghost delta recomputed from persisted scores (no reset-to-zero on relaunch)');

// 2026-07-04 (clean-audit) — 'AR shot tracer labels carry/apex as estimates' check
// REMOVED: the entire unmounted AR shot-trace vertical (ArShotTrace* components,
// shotTrace.ts, arShotTracer.ts, arRenderCapability*) was deleted as confirmed dead
// code. Shot tracing remains a roadmap feature — rebuild the check when it returns.

check('Dashboard fairway % excludes untracked tee shots',
  /trackedTeeShots/.test(read('app/(tabs)/dashboard.tsx')),
  'untracked (null outcome) tee shots no longer counted as fairway hits');

check('Recap does not fabricate par for unknown holes',
  /typeof holeParsMap\[hc\.hole_number\] === 'number'/.test(read('services/recapGenerator.ts')) &&
    !/holeParsMap\[hc\.hole_number\] \?\? 4/.test(read('services/recapGenerator.ts')),
  'holes with unknown par are not narrated with a fake par-4');

check('Dev/owner-only routes centrally gated',
  /\/dev\/CourseTruth/.test(read('app/_layout.tsx')) &&
    /'\/harness'/.test(read('app/_layout.tsx')),
  'CourseTruth + harness in DEBUG_ROUTES');

check('Orphaned retired routes removed',
  !exists('app/swinglab/camera-setup.tsx') && !exists('app/swinglab/quick-record.tsx') && !exists('app/demo.tsx'),
  'dead screens deleted');

check('SmartMotion bottom panel is a translucent fade, not an opaque block',
  /LinearGradient/.test(smSrc) &&
    /backgroundColor: 'transparent', \/\/ translucent gradient/.test(smSrc) &&
    /placeBallMode \? \(/.test(smSrc) && /glassCard/.test(smSrc),
  'gradient fade + glass cards + panel hidden while placing the ball box');

// ─── 2026-06-09: SmartMotion unstack + workflow fixes ──────────────────────
check('Motion OFF by default (lag fix) — toggle still gates compute/render',
  // 2026-06-15 — Tim: body-trace/skeleton OFF by default (it interpolates a sparse
  // 5-frame pose onto the moving video → laggy). The ball-departure compute is gated
  // on showSkeleton too, so default-off keeps BOTH overlays + their compute off; the
  // Motion chip toggles it ON to process on demand. Toggle-gates still hold.
  /const \[showSkeleton, setShowSkeleton\] = useState\(false\)/.test(smSrc) &&
    /Motion overlay/.test(smSrc) &&
    // 2026-07-04 (drift reconcile) — the compute gate grew clipUri/ballArea guards.
    /if \(!showSkeleton \|\| !clipUri \|\| !ballArea\) return;/.test(smSrc) && /\{showSkeleton \? \(/.test(smSrc),
  'skeleton/body-trace overlay defaults OFF (no lag) but is fully toggle-gated — process on demand');

check('Smart Motion icons feel tapped — haptic + spring wobble (TactilePressable)',
  // 2026-06-13 — Tim: every Smart Motion icon should buzz + wobble on tap. A single
  // TactilePressable (light/medium haptic + scale 1→0.9→overshoot spring) backs the
  // setup tools card rows, the record/stop + review toolbar, the Motion chip,
  // the position-scrub chips and the cycling mode badge. Haptic fails silently if off.
  /import \* as Haptics from 'expo-haptics'/.test(smSrc) &&
    /function TactilePressable\(/.test(smSrc) &&
    /Haptics\.impactAsync\(/.test(smSrc) &&
    /Animated\.spring\(scale,.*toValue: 0\.9/.test(smSrc) &&
    /bounciness: 14/.test(smSrc) && // the release overshoot = the "wobble"
    // The setup tools card rows route through it (ToolCardRow), not a bare Pressable.
    /function ToolCardRow\([\s\S]*?<TactilePressable\b[\s\S]*?onPress=\{onPress\}/.test(smSrc),
  'one shared tactile wrapper gives every icon a light buzz + clean press-bounce, OS-safe');

check('Caddie report-read lag: warmVoice prewarm + speakChunked fast-first-word',
  // 2026-06-13 — Tim: "delay between getting a report and the caddie reading it."
  // gpt-4o-mini-tts emits nothing until the whole clip renders, so a cold function
  // + long text = seconds of silence. Two fixes in voiceService: warmVoice() spins
  // the endpoint the moment a read is imminent (throttled, breaker-guarded, audio
  // discarded), and speakChunked() speaks the first sentence on its own so the read
  // STARTS fast, with short text delegated straight to speak() unchanged.
  /export const warmVoice = \(apiUrl: string\): void =>/.test(voiceSrc) &&
    /lastVoiceWarmAt < 45_000/.test(voiceSrc) &&
    /export const speakChunked = async/.test(voiceSrc) &&
    /trimmed\.length <= CHUNK_MIN_CHARS/.test(voiceSrc) && // short text → single shot
    /speakGeneration !== startGen\) break/.test(voiceSrc) && // barge-in cancels the rest
    // Wired at the report-read flows: swing detail + scorecard recap + cage summary.
    /warmVoice\(apiUrl\)/.test(read('app/swinglab/swing/[swing_id].tsx')) &&
    /speakChunked\(/.test(read('app/swinglab/swing/[swing_id].tsx')) &&
    /warmVoice\(apiUrl\)/.test(read('app/(tabs)/scorecard.tsx')) &&
    /speakChunked\(recap\.overall_kevin_summary/.test(read('app/(tabs)/scorecard.tsx')) &&
    /speakChunked\(/.test(read('app/cage/summary.tsx')) &&
    /warmVoice\(getApiBaseUrl\(\)\)/.test(smSrc), // smartmotion warms at analysis start
  'report reads start near-instantly: hot endpoint + first sentence plays without waiting for the whole clip');

check('Phase 2: library detail wears a capture-kind badge (Smart Motion / Coach / Upload)',
  // 2026-06-13 — Every library entry identifies its own source so the detail view
  // reads as the matching interface, not one generic screen. getCaptureKind drives
  // a badge under the title; the multi-swing label keys off carved shots.
  (() => {
    const s = read('app/swinglab/swing/[swing_id].tsx');
    return /import \{[^}]*\bgetCaptureKind\b[^}]*\} from '\.\.\/\.\.\/\.\.\/services\/swingLibrary'/.test(s) &&
      /const captureKind = getCaptureKind\(session\)/.test(s) &&
      /smart_motion:\s*\{ label:/.test(s) && /coach:\s*\{ label: 'Coach Lesson'/.test(s) &&
      /upload:\s*\{ label: 'Upload'/.test(s) &&
      /isMultiSwing \? 'Smart Motion · Session' : 'Smart Motion'/.test(s) &&
      /styles\.kindBadge/.test(s) && /name=\{KIND_BADGE\.icon\}/.test(s);
  })(),
  'the detail header names what each entry IS — live session vs coach lesson vs plain upload');

check('Bottom-strip hole nav is finger-sized (Tim: arrows too small on course)',
  // 2026-06-13 — bigger ◀/▶ glyphs (24 grid / 22 horizontal), ~36px touch targets,
  // and a larger hole value, so changing holes mid-round is an easy tap.
  (() => {
    const s = read('components/CaddieDataStrip.tsx');
    return /size=\{24\}/.test(s) && /size=\{22\}/.test(s) &&
      /hitSlop=\{14\}/.test(s) &&
      /paddingHorizontal: 8,\s*\n\s*paddingVertical: 7/.test(s) && // holeNavBtn target
      !/size=\{16\}/.test(s) && !/size=\{14\}/.test(s);            // old tiny glyphs gone
  })(),
  'hole back/forward arrows are now comfortably tappable, not pinpoint');

check('Layup planning: planAimLines is direct <200y, layup at 200y+ (#6)',
  // 2026-06-13 — pure planner unit test. Under 200y = one direct line; 200y+ =
  // a layup plan that leaves a sane approach and never asks for an unreal carry.
  (() => {
    const short = planAimLines(150);
    const edge = planAimLines(LAYUP_THRESHOLD_YARDS - 1);
    const at = planAimLines(LAYUP_THRESHOLD_YARDS);
    const mid = planAimLines(230);   // reachable-ish → leave a wedge
    const long = planAimLines(500);  // par-5 from the tee → cap the layup carry
    const none = planAimLines(null);
    return short.mode === 'direct' && short.leaveYards === null &&
      edge.mode === 'direct' &&
      at.mode === 'layup' && at.leaveYards != null &&
      mid.mode === 'layup' && mid.leaveYards === 100 && mid.layupCarryYards === 130 &&
      long.mode === 'layup' && long.layupCarryYards === 250 && long.leaveYards === 250 &&
      none.mode === 'direct' && // unknown distance → safe non-committal default
      // fraction is 0..1 along player→green, null in direct mode
      layupFraction(mid, 230) === Math.max(0, Math.min(1, 130 / 230)) &&
      layupFraction(short, 150) === null;
  })(),
  'distance-driven aim lines: par-5s lay up, short approaches go direct, junk inputs stay safe');

check('Layup planning wired into the hole view (smartvision) (#6)',
  // The planner drives an additive layup waypoint + leave label, and the T
  // marker clears once the player captures (places the Y target). Existing
  // tee→target→pin lines + projection math are untouched.
  (() => {
    const s = read('app/smartvision.tsx');
    return /import \{ planAimLines, layupFraction \} from '\.\.\/utils\/layupPlan'/.test(s) &&
      /const aimPlan = useMemo\(\(\) => planAimLines\(approachYards\)/.test(s) &&
      /const layupCanvas = useMemo/.test(s) &&
      /layupCanvas && aimPlan\.mode === 'layup'/.test(s) &&
      /cx=\{layupCanvas\.x\}/.test(s) && // layup waypoint marker (the "LAY UP · Ny in" SvgText was removed 2026-06-23; marker + panel carry it)
      /\{!targetOverride && \(\s*\n\s*<Marker\s*\n\s*kind="T"/.test(s); // T clears on capture
  })(),
  'hole view shows the two-line layup plan at 200y+ and drops the T once you capture');

check('Round Rest mode: store toggles + OLED-black overlay wired globally (#8)',
  // 2026-06-13 — Tim keeps auto-lock off so GPS never sleeps, leaving the OLED at
  // full brightness all round (the real drain). Rest mode paints near-black after
  // 1 min idle in a round — GPS/voice keep running, tap to wake.
  (() => {
    // Behavioral: enterRest activates; a touch (noteActivity) wakes + stamps time.
    const st = useRestModeStore.getState();
    st.enterRest();
    const resting = useRestModeStore.getState().active === true;
    st.noteActivity();
    const woke = useRestModeStore.getState().active === false &&
      typeof useRestModeStore.getState().lastActivityAt === 'number';
    st.exitRest();
    const ov = read('components/round/RestModeOverlay.tsx');
    const lay = read('app/_layout.tsx');
    return resting && woke &&
      /IDLE_MS = 60_000/.test(ov) &&
      /backgroundColor: '#000'/.test(ov) &&
      /useKeepAwake\('round-rest'\)/.test(ov) &&
      /if \(!active \|\| !isRoundActive\) return null/.test(ov) && // only dims in a round
      /onStartShouldSetResponderCapture=\{\(\) => \{ useRestModeStore\.getState\(\)\.noteActivity\(\); return false; \}\}/.test(lay) &&
      /<RestModeOverlay \/>/.test(lay);
  })(),
  'idle-in-round → near-black rest screen that keeps GPS alive; any touch wakes it, OTA-safe (no native dep)');

check('Drill engine: drill card → Smart Motion drill session (#5)',
  // 2026-06-13 — Tim's reframe: a link + an engine, not an overlay rebuild. A drill
  // with a practice descriptor opens Smart Motion in DRILL mode (3-5 shots, labeled,
  // captureKind 'drill'). Flagship = Tempo × Swing %.
  (() => {
    const cat = read('data/drillCatalog.ts');
    const detail = read('app/drills/[issue].tsx');
    const sm = read('app/swinglab/smartmotion.tsx');
    const store = read('store/cageStore.ts');
    const lib = read('app/swinglab/swing/[swing_id].tsx');
    const idx = read('app/drills/index.tsx');
    return (
      // descriptor (entry-level) + flagship tempo drill with view angle
      /export type DrillPractice = \{/.test(cat) &&
      /angle: 'face_on' \| 'down_the_line'/.test(cat) &&
      /id: 'tempo_consistency'/.test(cat) &&
      /practice: \{ shotCount: 5, shotType: 'full', focus: 'tempo', angle: 'face_on', swingPercents: \[50, 75, 100\] \}/.test(cat) &&
      // EVERY mechanic fault card now has a practice action (Tim: connection was
      // only visible on Tempo). Spot-check the honest per-focus views:
      /id: 'over_the_top',\s*\n\s*practice: \{ shotCount: 5, shotType: 'full', focus: 'path', angle: 'down_the_line' \}/.test(cat) &&
      /id: 'club_face_open',\s*\n\s*practice: \{ shotCount: 3, shotType: 'full', focus: 'grip', angle: 'face_on' \}/.test(cat) &&
      /id: 'early_extension',\s*\n\s*practice: \{ shotCount: 5, shotType: 'full', focus: 'posture', angle: 'down_the_line' \}/.test(cat) &&
      /id: 'chicken_wing',\s*\n\s*practice: \{ shotCount: 5, shotType: 'full', focus: 'connection', angle: 'face_on' \}/.test(cat) &&
      /id: 'chipping_inconsistent',\s*\n\s*practice: \{ shotCount: 5, shotType: 'chip', focus: 'contact', angle: 'face_on' \}/.test(cat) &&
      // 'drill' is a real capture kind, threaded through ingest
      /export type CaptureKind = 'smart_motion' \| 'coach' \| 'upload' \| 'drill'/.test(store) &&
      /captureKind: captureKind \?\? 'smart_motion'/.test(store) &&
      // drill card launches Smart Motion with the drill params + the view angle
      /entry\.practice &&/.test(detail) && /pathname: '\/swinglab\/smartmotion'/.test(detail) &&
      /drillShots: String\(entry\.practice!\.shotCount\)/.test(detail) &&
      /angle: entry\.practice!\.angle/.test(detail) &&
      // Smart Motion reads the drill, caps 3-5, tags the session
      /const isDrill = typeof drillId === 'string'/.test(sm) &&
      /Math\.max\(1, Math\.min\(5, Number\(drillShots\)/.test(sm) &&
      /captureKind: isDrill \? 'drill' : 'smart_motion'/.test(sm) &&
      /`the \$\{drillName\.trim\(\)\} drill`/.test(sm) && // drill-mode session label (refactored from "DRILL · … · N shots")
      // shot cap: a drill keeps only its 3-5 swings (post-hoc carve cap, safe)
      /const segs = isDrill && drillShotCount \? allSegs\.slice\(0, drillShotCount\) : allSegs/.test(sm) &&
      // library badge knows 'drill'; Tank is the full-width hero
      /drill:\s*\{ label: 'Drill'/.test(lib) &&
      /const tankEntry = orderedEntries\.find/.test(idx) && /const oneCol = width < 380/.test(idx) // Tank hero + responsive one-col (was literal oneCol={true})
    );
  })(),
  'drill card → Smart Motion 3-5 shot drill session, tagged + badged "Drill"; Tank is the hero, grid stays in twos');

check('Offline voice: device-TTS fallback when /api/voice unreachable (OTA, not APK)',
  // 2026-06-13 — Tim's Lakes round went MUTE (~18 speak_catch "Network request
  // failed"). expo-speech is already in the binary, so the fallback ships OTA. The
  // old crash was a dynamic require + a catch-path timer — both avoided here.
  (() => {
    const v = read('services/voiceService.ts');
    const pkg = read('package.json');
    return (
      /"expo-speech":/.test(pkg) &&                               // already bundled → OTA
      /import \* as Speech from 'expo-speech'/.test(v) &&         // STATIC import (not require)
      /function deviceSpeakFallback\(/.test(v) &&
      /Speech\.speak\(text, \{/.test(v) &&
      !/=\s*require\('expo-speech'\)/.test(v) &&                  // no crashy DYNAMIC require (static import only)
      // wired into every failure path that used to go silent (now gender-aware):
      (v.match(/deviceSpeakFallback\(text, language, myId, effectiveGender\)/g) || []).length >= 4 &&
      // breaker-open (offline) path no longer just returns silent
      /Breaker open = we're offline\. Don't go mute/.test(v) &&
      // stopSpeaking cancels the device voice too
      /if \(usingDeviceFallback\) \{\s*\n\s*try \{ Speech\.stop\(\); \}/.test(v)
    );
  })(),
  'a failed/timed-out/offline TTS fetch now speaks on the device instead of leaving the caddie silent');

// 2026-06-14 (Tim) — the device-TTS fallback used the OS DEFAULT voice (often female),
// so a male caddie (Kevin/Harry/Tank) read a finding in a jarring "robotic female"
// voice. The fallback is now GENDER-AWARE: it derives gender from the LIVE persona
// (above the outer try so the catch agrees too), tries to pick a matching device voice,
// and deepens the pitch when a male voice is wanted but unmatchable.
check('Device-TTS fallback respects caddie gender (no more "robotic female" Kevin)',
  (() => {
    const v = read('services/voiceService.ts');
    return (
      // signature carries gender, defaulted male so an old caller can't go female-by-default
      /function deviceSpeakFallback\(text: string, language: 'en' \| 'es' \| 'zh', myId: number, gender: 'male' \| 'female' = 'male'\)/.test(v) &&
      // tries a gender+language-matched device voice, then falls back to pitch deepening
      /function pickDeviceVoice\(gender:/.test(v) &&
      /const voiceId = pickDeviceVoice\(gender, language\)/.test(v) &&
      /gender === 'male' \? 0\.85 : 1\.0/.test(v) &&
      /Speech\.getAvailableVoicesAsync\(\)/.test(v) &&
      // persona-derived gender is computed ABOVE the outer try so the network-fail
      // catch speaks the right gender, not the stale caller param.
      /Declared\s*\n\s*\/\/ ABOVE the outer try so the catch's device-TTS fallback/.test(v)
    );
  })(),
  'when the server voice fails, the device fallback matches the caddie persona\'s gender (voice match or pitch-deepen) instead of defaulting to a robotic female OS voice');

check('Intent fix: "on the center of the green" marks it — offline + routed (Lakes log)',
  // 2026-06-13 — Tim's flow: "I'm on the center of the green on hole 6, Lakes" must
  // logically MARK the green at GPS, even with NO signal. (a) localIntentPrecheck
  // matches it deterministically/offline → open_tool/mark_green; (b) the router
  // aliases a tool-name intent_type to open_tool so the cloud path also fires.
  (() => {
    // (a) behavioral: the offline precheck classifies the mark phrasings...
    const onGreen = precheckLocalIntent("I'm on the center of the green on hole 6 lakes");
    const markPin = precheckLocalIntent('mark the pin');
    const atPin = precheckLocalIntent("I'm at the pin");
    // ...but NOT plain position ("I'm on the green") or a yardage query.
    const plain = precheckLocalIntent("I'm on the green");
    const yards = precheckLocalIntent('how far to the middle of the green');
    const okPrecheck =
      onGreen?.intent_type === 'open_tool' && onGreen?.parameters?.tool_name === 'mark_green' &&
      markPin?.intent_type === 'open_tool' && markPin?.parameters?.tool_name === 'mark_green' &&
      atPin?.intent_type === 'open_tool' &&
      !(plain?.intent_type === 'open_tool') &&            // plain "on the green" stays position_declaration
      yards?.parameters?.query_topic === 'green_middle';  // yardage query unaffected
    // (b) source: the router alias for a tool-name intent_type
    const r = read('services/voiceCommandRouter.ts');
    const okRouter = /const OPEN_TOOL_ALIAS_INTENTS = new Set<string>\(\[/.test(r) &&
      /if \(!handler && OPEN_TOOL_ALIAS_INTENTS\.has\(intent\.intent_type\)\)/.test(r) &&
      /tool_name: intent\.intent_type/.test(r);
    return okPrecheck && okRouter;
  })(),
  '"on the center of the green" / "mark the pin" marks the green offline; the cloud path is aliased too; plain position + yardage queries untouched');

check('SmartFinder MOAT: brain composes one answer-first shot read (offline-safe)',
  // 2026-06-13 — "this is what the caddie brain is for." composeShotRead fuses
  // distance + wind/elevation (plays-like) + the player's real bag + tendency +
  // hazard into ONE read. Pure + offline-safe; past-perf gated to competitive.
  (() => {
    const calm = { wind_speed_mph: 0, wind_direction_deg: null, temp_f: 70 } as never;
    // headwind from the south (180°) on a shot aimed north (0°) → plays longer
    const headwind = { wind_speed_mph: 15, wind_direction_deg: 0, temp_f: 70 } as never;
    // 1) real bag picks the closest club + a learned-carry "why" line
    const a = composeShotRead({
      rawYards: 165, weather: calm, shotBearingDeg: 0,
      bag: { '7 Iron': 165, '8 Iron': 150 }, dominantMiss: 'right',
      nearestHazard: { label: 'Bunker', yards: 150 }, isCompetition: false,
    });
    // 2) headwind into the face → plays-like LONGER than raw; a "wind" why line
    const b = composeShotRead({
      rawYards: 150, weather: headwind, shotBearingDeg: 0, bag: {},
    });
    // 3) elevation works with NO weather (offline) — uphill plays longer
    const c = composeShotRead({ rawYards: 150, weather: null, shotBearingDeg: null, elevationDeltaFeet: 30, bag: {} });
    // 4) past-perf only when competitive
    const casual = composeShotRead({ rawYards: 150, weather: calm, shotBearingDeg: 0, bag: {}, isCompetition: false, pastScoreNote: 'bogey last 2' });
    const comp = composeShotRead({ rawYards: 150, weather: calm, shotBearingDeg: 0, bag: {}, isCompetition: true, pastScoreNote: 'bogey last 2' });
    const nul = composeShotRead({ rawYards: null, weather: calm, shotBearingDeg: 0, bag: {} });
    return (
      a?.club === '7 Iron' && a?.why.some(w => /carries ~165/.test(w)) &&
        a?.tendencyNote === 'you miss right — favor the safe side' && a?.hazardNote === 'Bunker 150y' &&
      b != null && b.playsLikeYards != null && b.rawYards != null && b.playsLikeYards > b.rawYards && b.why.some(w => /into the wind/.test(w)) &&
      c != null && c.playsLikeYards === 160 && c.why.some(w => /uphill/.test(w)) && // 30ft/3 = +10y
      casual?.pastPerfNote === null && comp?.pastPerfNote === 'bogey last 2' &&
      nul === null
    );
  })(),
  'one composed read: real-bag club + plays-like + wind/slope why + tendency + hazard; offline-safe; competitive-gated past-perf');

check('Ball Fit MOAT: brain matches a ball to the game from CNS signals (offline-safe)',
  // 2026-06-13 — "we are the answer." composeBallFit fuses handicap + driver-carry
  // speed band + miss + wedge use + stated goal into ONE answer-first profile +
  // representative balls. Pure + offline-safe; why-lines built only from real signals;
  // honest caveat (game-data match, not a launch-monitor fit) always present.
  (() => {
    // 1) low handicap + fast carry + wedge work → tour
    const tour = composeBallFit({ handicap: 4, driverCarryYards: 265, shortGameWedgeSamples: 12, missType: null });
    // 2) slower swing + mid handicap → soft, low-compression
    const soft = composeBallFit({ handicap: 15, driverCarryYards: 190 });
    // 3) slice + higher handicap → distance (lower-spin reduces curve, honestly)
    const slicer = composeBallFit({ handicap: 22, missType: 'slice', driverCarryYards: 210 });
    // 4) budget goal → value
    const value = composeBallFit({ handicap: 26, goal: 'just want to stop losing balls and save money', experience: 'starting' });
    // 5) zero signal → never throws, low confidence, still a complete read + caveat
    const empty = composeBallFit({});
    return (
      tour.profile === 'tour' && tour.examples.length >= 2 && tour.why.length >= 1 &&
        tour.why.some(w => /spin|control|wedge|compress/i.test(w)) && tour.confidence === 'high' &&
      soft.profile === 'soft-feel' && soft.why.some(w => /compression|easier|feel|forgiv/i.test(w)) &&
      slicer.profile === 'distance' && slicer.why.some(w => /slice/i.test(w) && /won't fix|reduces/i.test(w)) &&
      value.profile === 'value' &&
      // honesty: every result carries the not-a-monitor-fit caveat
      [tour, soft, slicer, value, empty].every(r => /not a launch-monitor/i.test(r.caveat)) &&
      // offline-safe: empty input still returns a complete, low-confidence read
      empty.confidence === 'low' && empty.examples.length >= 2 && empty.why.length >= 1
    );
  })(),
  'one composed read: profile + measured why + real example balls; offline-safe; honest no-spin-measured caveat always present');

check('Putt roll: decomposes start-line vs green vs speed from a measured path (relative, honest)',
  // 2026-06-13 — the tripod watch-the-roll core. analyzePuttRoll takes the ball's
  // tracked path + aim + hole and reports start direction, break (curvature after a
  // straight start), pace (from decel), and attribution (start% vs slope%). RELATIVE
  // not metric (no fabricated inches); returns null when the path is too short.
  (() => {
    // A right-to-left breaking putt aimed STRAIGHT at the hole (hole directly above
    // the ball): the ball leaves on the aim line, then the green curves it left, so
    // it misses left. Frame coords: x right, y DOWN, so "up the line" is -y.
    const hole = { x: 0.50, y: 0.25 };
    const breakingLeft: { x: number; y: number; t: number }[] = [
      { x: 0.500, y: 0.90, t: 0 },
      { x: 0.500, y: 0.78, t: 1 },  // straight start
      { x: 0.498, y: 0.66, t: 2 },
      { x: 0.492, y: 0.55, t: 3 },
      { x: 0.480, y: 0.45, t: 4 },
      { x: 0.462, y: 0.37, t: 5 },
      { x: 0.440, y: 0.31, t: 6 },
      { x: 0.420, y: 0.27, t: 7 },  // decelerating + ends LEFT of the hole
    ];
    const a = analyzePuttRoll({ path: breakingLeft, aim: hole, hole, trackedFraction: 0.9 });
    // A dead-straight, holed putt.
    const straight = analyzePuttRoll({
      path: [
        { x: 0.5, y: 0.9, t: 0 }, { x: 0.5, y: 0.7, t: 1 },
        { x: 0.5, y: 0.5, t: 2 }, { x: 0.5, y: 0.31, t: 3 }, { x: 0.5, y: 0.26, t: 4 },
      ],
      aim: { x: 0.5, y: 0.25 }, hole: { x: 0.5, y: 0.25 }, trackedFraction: 0.85,
    });
    // Too short to read → null, never a guess.
    const tooShort = analyzePuttRoll({ path: [{ x: 0.5, y: 0.5, t: 0 }, { x: 0.5, y: 0.49, t: 1 }] });
    if (a == null) return false;
    return (
      a.startDirection.side === 'straight' &&            // left ON the aim line
      a.break.side === 'left' && a.break.magnitude !== 'flat' &&  // curved left = the green acting
      a.outcome.result === 'missed' && a.outcome.missSide === 'left' &&
      a.attribution.startPct + a.attribution.slopePct === 100 &&
      a.attribution.slopePct >= 90 &&                    // straight start → the miss was the green
      /broke/.test(a.relativeRead) && /the green/.test(a.relativeRead) &&
      straight != null && straight.break.side === 'straight' && straight.outcome.result === 'made' &&
      tooShort === null
    );
  })(),
  'measured path → start dir + break side + pace + start%/slope% attribution; null when unreadable; relative not metric');

check('Green heat-map log: rolls accumulate per green into an honest summary (data moat)',
  // 2026-06-13 — every measured roll logs per course+hole; over time it summarizes
  // into dominant break / pace / make-rate — the data behind a future heat map.
  // Honest: dominant only when it's a real majority, else 'mixed'.
  (() => {
    const store = read('store/greenRollStore.ts');
    return (
      /export const useGreenRollStore = create/.test(store) &&
      /logRoll:/.test(store) && /summarizeGreen:/.test(store) &&
      /dominantBreak/.test(store) && /makeRate/.test(store) &&
      /slice\(-MAX_PER_GREEN\)/.test(store) &&            // bounded per green
      /bestN > values\.length \/ 2 \? best : mixedLabel/.test(store) && // honest majority
      /persist\(/.test(store) && /green-rolls-v1/.test(store)
    );
  })(),
  'measured rolls persist per course+hole; summary reports dominant break/pace/make-rate, honest mixed when no majority, bounded');

check('Tee Goals: "break X from the Y tees" evaluated honestly vs round history',
  // 2026-06-13 — round-side sibling of SmartPlan. evaluateTeeGoal counts ONLY
  // rounds matching the tee + holes (+ optional course), reports best/attempts/
  // gap/achieved, and surfaces rounds skipped for a missing tee (the nudge). A
  // tee-specific goal does NOT silently count untagged rounds.
  (() => {
    const mk = (over: Partial<any>): any => ({
      id: String(Math.random()), roundNumber: 1, courseName: 'X', courseId: 'c1',
      startedAt: 1, endedAt: 1, holesPlayed: 18, totalScore: 95, scoreVsPar: 23,
      isCompetition: false, nineHoleMode: false, mode: 'free_play', scores: {}, putts: {}, shots: [],
      selectedTee: 'red', ...over,
    });
    const history = [
      mk({ totalScore: 95, endedAt: 10, selectedTee: 'red' }),
      mk({ totalScore: 88, endedAt: 20, selectedTee: 'red' }),   // best red, breaks 90
      mk({ totalScore: 84, endedAt: 30, selectedTee: 'white' }), // different tee — excluded from a red goal
      mk({ totalScore: 91, endedAt: 40, selectedTee: 'unspecified' }), // untagged — skipped for a red goal
      mk({ totalScore: 47, endedAt: 50, selectedTee: 'red', nineHoleMode: true, holesPlayed: 9, scoreVsPar: 11 }),
    ];
    const break90Red = evaluateTeeGoal(
      { id: 'g1', tee: 'red', targetScore: 90, beatPar: false, nine: false, createdAt: 0 }, history);
    const break80Red = evaluateTeeGoal(
      { id: 'g2', tee: 'red', targetScore: 80, beatPar: false, nine: false, createdAt: 0 }, history);
    const anyTee = evaluateTeeGoal(
      { id: 'g3', tee: 'unspecified', targetScore: 90, beatPar: false, nine: false, createdAt: 0 }, history);
    const nineRed = evaluateTeeGoal(
      { id: 'g4', tee: 'red', targetScore: 50, beatPar: false, nine: true, createdAt: 0 }, history);
    return (
      // break 90 from reds: 2 red 18h rounds (95, 88); best 88 < 90 = achieved; white + untagged excluded
      break90Red.attempts === 2 && break90Red.best === 88 && break90Red.achieved === true &&
        break90Red.skippedNoTee === 1 && /not counted/.test(break90Red.note) &&
      // break 80 from reds: same 2 attempts, best 88, NOT achieved, gap reported
      break80Red.achieved === false && break80Red.gap != null && break80Red.gap > 0 &&
      // any-tee 18h goal counts all 18-hole rounds (red+white+untagged = 4), best 84
      anyTee.attempts === 4 && anyTee.best === 84 && anyTee.skippedNoTee === 0 &&
      // 9-hole red goal isolates the single nine (47 < 50 = achieved)
      nineRed.attempts === 1 && nineRed.best === 47 && nineRed.achieved === true &&
      /from the reds/.test(describeTeeGoal(break90Red.goal))
    );
  })(),
  'tee+holes filter; achieved/best/gap; honest skipped-no-tee count; any-tee counts all; 9-hole isolates the nine');

check('Cage rig: handedness default framing + ball/line move as one element (Tim)',
  // 2026-06-13 — DTL setup is ONE element: player fills ~2/3, ball + target line in
  // the outer 1/3 (RH right, LH left). Dragging the ball moves the WHOLE rig (ball +
  // target) rigidly; the target END moves on its own (free-float). Pure geometry.
  (() => {
    const rh = defaultDtlRig('right');
    const lh = defaultDtlRig('left');
    // RH ball in the right third, LH mirrored to the left third; target straight above.
    const framing = rh.ball.x > 0.6 && lh.ball.x < 0.4 &&
      Math.abs(rh.ball.x - (1 - lh.ball.x)) < 1e-9 &&   // mirrored
      rh.target.x === rh.ball.x && rh.target.y < rh.ball.y; // line runs straight up
    // Rigid move: ball + target shift by the SAME delta (offset preserved).
    const moved = translateRig(rh.ball, rh.target, -0.1, 0.05);
    const offsetBefore = { dx: rh.target.x - rh.ball.x, dy: rh.target.y - rh.ball.y };
    const offsetAfter = { dx: moved.target.x - moved.ball.x, dy: moved.target.y - moved.ball.y };
    const rigid = Math.abs(offsetAfter.dx - offsetBefore.dx) < 1e-9 &&
      Math.abs(offsetAfter.dy - offsetBefore.dy) < 1e-9 &&
      Math.abs(moved.ball.x - (rh.ball.x - 0.1)) < 1e-9;
    // Delta clamped so neither point leaves the frame (huge drag → offset still kept).
    const clamped = translateRig({ x: 0.9, y: 0.9, r: 0.08 }, { x: 0.9, y: 0.2 }, 0.5, 0.5);
    const inBounds = clamped.ball.x <= 1 && clamped.target.x <= 1 &&
      Math.abs((clamped.target.x - clamped.ball.x) - 0) < 1e-9; // offset (0) preserved at the edge
    return framing && rigid && inBounds;
  })(),
  'handedness default puts player 2/3 + ball/line in outer 1/3 (mirrored); ball drag moves the rig rigidly; clamped on-frame');

check('Offline caddie: the MOAT read (plays-like + club) answers LOCALLY, no network',
  // 2026-06-13 — the Lakes "caddie goes mute on network loss" fix extends to the
  // composed read: "how far does it play / plays like" now composes locally via
  // composeShotRead (GPS distance + cached weather wind + bag), so the plays-like
  // answer survives offline. Routed BEFORE plain yardage; honest when GPS/green missing.
  (() => {
    const src = read('services/localStatusResponder.ts');
    return (
      /import \{ composeShotRead \} from '\.\/cnsShotRead'/.test(src) &&
      /getCachedWeatherEvenIfStale/.test(src) &&            // cached weather feeds wind offline
      /playsLike:\s*\/\\b\(plays\?/.test(src) &&            // the plays-like matcher exists
      /if \(RX\.playsLike\.test\(t\)\) \{\s*\n\s*return composedReadReply\(lang\);/.test(src) &&
      /\bcomposedReadReply\(t?lang?\)?/.test(src) &&
      /function composedReadReply/.test(src) &&
      /queryType: 'plays_like'/.test(src) &&
      // routed BEFORE plain yardage (so "how far does it play" doesn't fall to raw distance)
      src.indexOf('RX.playsLike.test(t)') < src.indexOf('RX.yardage.test(t)') &&
      // honest: drops the learned-carry "why" line so it isn't redundant with the club
      /filter\(\(w\) => !\/\^your\\s\/i\.test\(w\)\)/.test(src)
    );
  })(),
  'plays-like composes the club + wind-adjusted distance locally (composeShotRead + cached weather); routed before raw yardage; offline-safe');

check('Offline caddie: wind status answers locally (head/tail/cross from cached weather)',
  // 2026-06-13 — another offline-mute fix: "what's the wind / how's the wind / windy"
  // answers locally from cached weather, described relative to the shot (into your
  // face / at your back / cross) via the playsLike wind decomposition. Routed AFTER
  // plays-like so "with the wind" still goes to the distance read. Honest no-reading.
  (() => {
    const src = read('services/localStatusResponder.ts');
    return (
      /import \{ playsLikeDistance \} from '\.\.\/utils\/playsLike'/.test(src) &&
      /wind:\s*\/\\b\(wind\|windy/.test(src) &&                 // the wind matcher
      /if \(RX\.wind\.test\(t\)\) \{\s*\n\s*return windReply\(lang\);/.test(src) &&
      /function windReply/.test(src) &&
      /along_wind_mph/.test(src) && /cross_wind_mph/.test(src) && // relative components
      /queryType: 'wind'/.test(src) &&
      // plays-like routed BEFORE wind (so "with the wind" → distance, not wind status)
      src.indexOf('RX.playsLike.test(t)') < src.indexOf('RX.wind.test(t)') &&
      /mph < 3/.test(src)                                       // calm path
    );
  })(),
  'wind status composes locally from cached weather + shot bearing (head/tail/cross); routed after plays-like; offline-safe');

check('Offline caddie: "can I reach it" answers locally vs the longest real club',
  // 2026-06-13 — feasibility offline: plays-like distance to the green vs the player's
  // LONGEST logged club. Yes / tight / lay-up. Honest — only real bag carries.
  (() => {
    const src = read('services/localStatusResponder.ts');
    return (
      /reach:\s*\/\\b\(can\\s\+i\\s\+\(\?:reach/.test(src) &&        // the reach matcher
      /if \(RX\.reach\.test\(t\)\) \{\s*\n\s*return reachReply\(lang\);/.test(src) &&
      /function reachReply/.test(src) &&
      /const margin = longest\[1\] - plays/.test(src) &&            // vs longest real club
      /reachYes|reachTight|reachNo/.test(src) &&
      /queryType: 'reach'/.test(src) &&
      /bagDistances\(\)/.test(src) &&                               // real logged clubs only
      // reach routed before plain yardage (so "can I reach the green" isn't a raw distance)
      src.indexOf('RX.reach.test(t)') < src.indexOf('RX.yardage.test(t)')
    );
  })(),
  'reach feasibility: plays-like vs longest real club (yes/tight/lay-up); honest; offline-safe');

check('CNS ingestion: conversation distilled into durable memory notes (honest, narrow)',
  // 2026-06-13 — audit G1 fix: the dialogue was captured but never read back into
  // the CNS. distillConversation mines HIGH-CONFIDENCE stated signals from the
  // player's words (miss tendency, focus, stated carry) → reflection takeaways at
  // round end. Honest: nothing inferred; [] when no confident match.
  (() => {
    const turns = [
      { role: 'user' as const, text: 'man I keep slicing my driver', at: 1 },
      { role: 'caddie' as const, text: 'Let us tee it lower.', at: 2 },
      { role: 'user' as const, text: "I'm working on my tempo today", at: 3 },
      { role: 'user' as const, text: 'my 7 iron goes 150', at: 4 },
      { role: 'user' as const, text: 'what time is it', at: 5 }, // no golf signal → ignored
    ];
    const notes = distillConversation(turns);
    const blob = notes.join(' | ').toLowerCase();
    // caddie line never mined; nonsense user line yields nothing; the 3 real signals land.
    const slice = /fighting a slice/.test(blob);
    const tempo = /working on:\s*tempo/.test(blob);
    const carry = /7 iron carries about 150/.test(blob);
    // empty in → empty out (no fabrication)
    const emptySafe = distillConversation([]).length === 0 &&
      distillConversation([{ role: 'user', text: 'nice weather huh', at: 1 }]).length === 0;
    return slice && tempo && carry && emptySafe && notes.length <= 3;
  })(),
  'distillConversation mines only stated high-confidence signals (miss/focus/carry) → memory notes; empty-safe, capped, no fabrication');

check('Self-growing agent: local hit-rate counts memory-backed local answers (G4)',
  // 2026-06-13 — audit G4: the metric only counted the static regex precheck; a
  // memory-backed tryLocalReply answer (which gets richer as the CNS grows) was
  // miscounted as cloud. reclassifyCloudToLocal moves it cloud→local at the router.
  (() => {
    const stats = read('store/agentBrainStats.ts');
    const router = read('services/voiceCommandRouter.ts');
    return /reclassifyCloudToLocal:/.test(stats) &&
      /cloudEscalated: Math\.max\(0, s\.cloudEscalated - 1\)/.test(stats) &&
      /localAnswered: s\.localAnswered \+ 1/.test(stats) &&
      /reclassifyCloudToLocal\(\)/.test(router); // called in the tryLocalReply success branch
  })(),
  'memory-backed local answers reclassify cloud→local so localHitRate reflects CNS growth, not just the regex precheck');

check('Smart Finder Scene Read: meta scene + measured wind → caddie brain (OTA-safe, honest)',
  // 2026-06-13 — Tim's "mind-blown" moment: snap the view, the multimodal brain reads
  // the scene meta (water/trees/sky/leaves) GROUNDED in the measured wind/temp/distance,
  // and ties it to how to play + think. v1 reuses /api/kevin (no server deploy). Honest:
  // camera = qualitative scene; weather service = the wind number (brain told NOT to
  // estimate wind from pixels).
  (() => {
    const svc = read('services/sceneReadService.ts');
    const ctx = read('services/sceneReadContext.ts');
    const sf = read('app/smartfinder.tsx');
    return (
      // service reuses the existing multimodal brain pipe via the spine
      /getApiBaseUrl\(\)\}\/api\/kevin/.test(svc) && /image_base64: input\.imageBase64/.test(svc) &&
      /image_media_type/.test(svc) && /unified_context_block: ctx\.block/.test(svc) &&
      /use that wind number/i.test(svc) &&                      // honesty in the instruction
      // sensor truth uses MEASURED weather, hands the brain the number, never fabricates
      /getCachedWeatherEvenIfStale/.test(ctx) && /use THIS number — do not estimate wind from the image/.test(ctx) &&
      /SENSOR TRUTH \(measured/.test(ctx) &&
      // wired into Smart Finder: capture → resize → readScene → result card
      /import\('\.\.\/services\/sceneReadService'\)/.test(sf) && /readScene\(\{ imageBase64/.test(sf) &&
      /Read the scene/i.test(sf) && /SCENE READ/.test(sf)
    );
  })(),
  'scene read snaps the view, grounds it in measured wind/temp via /api/kevin multimodal, renders + speaks the mental approach; no fabricated wind; OTA-safe');

check('Recap speed: stored round renders INSTANTLY from the record (no 30s spin)',
  // 2026-06-13 — Tim hit a stored round that spun (recap screen polled the archive
  // 30x/1s; an un-generated recap = endless spinner). synthesizeRecapFromRecord builds
  // a complete recap synchronously from the stored RoundRecord, and the recap screen
  // shows it immediately (archived rich recap still wins; only just-ended rounds poll).
  (() => {
    const gen = read('services/recapSynth.ts');
    const screen = read('app/recap/[round_id].tsx');
    const synthExists = /export function synthesizeRecapFromRecord\(record: RoundRecord\): RoundRecap/.test(gen) &&
      /hole_comparisons/.test(gen) && /overall_kevin_summary: record\.summary/.test(gen);
    const wired = /synthesizeRecapFromRecord\(rec\)/.test(screen) &&
      /roundHistory\.find\(\(r\) => r\.id === round_id\)/.test(screen) &&
      /justEnded/.test(screen) &&            // old rounds don't background-poll
      // 2026-07-04 (drift reconcile) — mergeRecap refactor renamed rec2 → rec.
      /Date\.now\(\) - rec\.endedAt\) < 90_000/.test(screen);
    // runtime: a record with scores → a renderable recap with matching holes + score.
    const rec: any = {
      id: 'r1', roundNumber: 1, courseName: 'Pebble', courseId: 'c1', startedAt: 1, endedAt: 2,
      holesPlayed: 2, totalScore: 9, scoreVsPar: 1, isCompetition: false, nineHoleMode: false,
      mode: 'free_play', scores: { 1: 4, 2: 5 }, putts: {}, shots: [{ hole: 1 }, { hole: 2 }] as any,
      summary: 'Solid front two.',
    };
    const out = synthesizeRecapFromRecord(rec);
    const runtime = out.total_score === 9 && out.hole_comparisons.length === 2 &&
      out.hole_comparisons[0].actual_score === 4 && out.overall_kevin_summary === 'Solid front two.';
    return synthExists && wired && runtime;
  })(),
  'synthesizeRecapFromRecord builds a renderable recap from the stored round; screen shows it instantly, no 30s poll for stored rounds');

check('Play tab: walking vs cart setting persisted on the round (Tim)',
  // 2026-06-13 — transportMode (walking/cart) set on the Play tab, stored on roundStore
  // + persisted onto the round record (mirrors selectedTee). Honest data capture; the
  // hook for future cart-GPS / fatigue-aware caddie / honest step interpretation.
  (() => {
    const rs = read('store/roundStore.ts');
    const play = read('app/(tabs)/play.tsx');
    return (
      /export type TransportMode = 'walking' \| 'cart'/.test(rs) &&
      /transportMode: TransportMode;/.test(rs) &&             // state field
      /setTransportMode: \(m: TransportMode\) => void;/.test(rs) &&
      /setTransportMode: \(m\) => set\(\{ transportMode: m \}\)/.test(rs) &&
      /transportMode: s\.transportMode,/.test(rs) &&          // persisted on the record
      /const resolvedTransport = options\.transportMode \?\? prev\.transportMode \?\? 'walking'/.test(rs) && // default (refactored to a named var)
      // Play tab chips wired to the store
      /useRoundStore\(s => s\.transportMode\)/.test(play) &&
      /setSetupTransport\('walking'\)/.test(play) && /setSetupTransport\('cart'\)/.test(play)
    );
  })(),
  'walking/cart set on Play tab → roundStore.transportMode → persisted on the round record (like selectedTee)');

check('CNS re-audit fixes: course-less reflection (G1 bug) + real approach/trouble (G3) + voice context merge (G5)',
  // 2026-06-13 — re-audit pass. G1 bug: the reflection/distill was nested under
  // if(activeCourseId), so local/manual rounds never learned. G3: course memory got
  // approachClub:null / trouble:[]. G5: the voice brain path sent only the CNS slice,
  // not the merged live context (chat path already merged).
  (() => {
    const rs = read('store/roundStore.ts');
    const voice = read('hooks/useVoiceCaddie.ts');
    // G1: reflection persists course-less (nullable course_id) and isn't gated on activeCourseId
    const g1 = /course_id: s\.activeCourseId \?\? null,/.test(rs) &&
      /Player-level REFLECTION/.test(rs) &&
      /runs REGARDLESS of/.test(rs);
    // G3: real approach club (last clubbed non-tee shot) + trouble (2+ over) fed to memory
    const g3 = /const approachShot = \[\.\.\.holeShots\]\.reverse\(\)\.find/.test(rs) &&
      /approachClub = approachShot\?\.club \?\? null/.test(rs) &&
      /score - par >= 2 \? \['played 2\+ over'\] : \[\]/.test(rs);
    // G5: voice path fetches the live block and MERGES it with the CNS block; the
    // reasoning-heavy diagnostic handler (was sending NO context) now sends it too.
    const diag = read('services/intents/inRoundDiagnosticHandler.ts');
    const g5 = /import \{ getCaddieContext, mergeMemoryIntoContext \}/.test(voice) &&
      /getUnifiedVisionContext\(\)\)\.promptBlock/.test(voice) &&
      /unified_context_block: mergeMemoryIntoContext\(\s*\n\s*liveBlock,/.test(voice) &&
      /unified_context_block = retr\.mergeMemoryIntoContext\(/.test(diag) &&
      /unified_context_block,/.test(diag); // added to the diagnostic payload
    return g1 && g3 && g5;
  })(),
  'reflection learns course-less rounds; course memory gets real approach/trouble; voice brain sends merged live+CNS context');

check('CNS G2: brain bag falls back to the shot-tracking bag when CNS is thin (conservative)',
  // 2026-06-13 — the brain reads the CNS bag; ball-fit/scorecard/strategy read
  // clubStatsStore. getCaddieContext now falls back to getLearnedClubDistances where
  // the CNS bag lacks a club / is empty, so the brain isn't blind / divergent. CNS
  // carry always wins where it exists (conservative — no override of real CNS data).
  (() => {
    const r = read('services/caddieMemoryRetrieval.ts');
    return (
      /getLearnedClubDistances\(\)/.test(r) &&
      /statsBag\[input\.club\]/.test(r) &&                    // per-club fallback
      /CNS carry always WINS where it exists/.test(r) &&      // conservative intent documented
      /} else \{[\s\S]*?CNS bag empty[\s\S]*?Learned bag:/.test(r) // bag-line fallback only when CNS empty
    );
  })(),
  'brain bag fills from clubStatsStore only where the CNS bag is thin/empty; CNS wins where present (conservative reconcile)');

check('Voice: persona switch never leaks the old voice for a turn (live-persona gender)',
  // 2026-06-13 — wrong-voice-for-a-turn fix. speak() read persona LIVE but defaulted the
  // voice gender to the caller's param (a stale closure value after a mid-flight persona
  // switch), so the in-flight answer spoke the OLD voice once. Now gender is derived from
  // the LIVE persona too (serena=female; kevin/harry/tank=male; custom keeps its toggle).
  (() => {
    const v = read('services/voiceService.ts');
    return (
      /persona = require\('\.\.\/store\/settingsStore'\)\.useSettingsStore\.getState\(\)\.caddiePersonality/.test(v) &&
      /if \(persona === 'serena'\) effectiveGender = 'female'/.test(v) &&
      /else if \(persona === 'kevin' \|\| persona === 'harry' \|\| persona === 'tank'\) effectiveGender = 'male'/.test(v) &&
      /else if \(persona === 'custom'\)/.test(v) &&        // custom still uses its own toggle
      /gender: effectiveGender/.test(v)                     // the live-derived gender is what's sent
    );
  })(),
  'voice gender derives from the LIVE persona (not a stale param), so a mid-flight caddie switch never speaks the old voice for a turn');

check('Caddie sings: a "sing X" request becomes a playful attempt prompt (Cecily)',
  // 2026-06-13 — Cecily asked if the caddie can sing. TTS can't truly sing, but a sing
  // request is reshaped into a brain prompt that makes the caddie give a charming,
  // brief, kid-friendly ATTEMPT. Detection is narrow (no false positives on golf qs).
  (() => {
    const hit = detectSingRequest('can you sing let it go');
    const named = detectSingRequest('Sing Baby Shark please');
    const vague = detectSingRequest('sing a song');
    const golf = detectSingRequest('what club for 150');
    const praises = detectSingRequest('she was singing my praises');
    const msg = hit ? buildSingMessage(hit.song) : '';
    const wired = /detectSingRequest\(message\)/.test(read('hooks/useVoiceCaddie.ts')) &&
      /message = sa\.buildSingMessage\(sing\.song\)/.test(read('hooks/useVoiceCaddie.ts'));
    return (
      hit?.song === 'let it go' &&
      named?.song === 'Baby Shark' &&            // "please" stripped
      vague?.song === null &&                    // "sing a song" → caddie picks
      golf === null && praises === null &&       // no false positives
      /SING REQUEST/.test(msg) && /Do NOT refuse/.test(msg) && /playful/i.test(msg) &&
      wired
    );
  })(),
  'sing requests reshape into a playful "give it a go" brain prompt (kid-friendly, never refuse); narrow detection; wired into the voice brain path');

check('Music portal: "play [song]" → kid-safe search → clean in-app player (OTA-safe)',
  // 2026-06-13 (Tim/Cecily) — "play X" searches the SERVER endpoint (key server-side,
  // safeSearch=strict, embeddable only) and opens just that song in the clean player
  // (embedded WebView on the native build; in-app browser fallback on older builds).
  // Detection is narrow — golf "play" phrases never hijack it.
  (() => {
    const song = detectPlaySongRequest('can you play baby shark');
    const golf = detectPlaySongRequest('play a round');
    const safe = detectPlaySongRequest('play it safe');
    const api = read('api/youtube-search.ts');
    const svc = read('services/songPortal.ts');
    const screen = read('app/jukebox.tsx');
    const voice = read('hooks/useVoiceCaddie.ts');
    const vercel = read('vercel.json');
    return (
      song?.query === 'baby shark' && golf === null && safe === null &&
      // server: key stays server-side + kid-safe + embeddable
      /process\.env\.YOUTUBE_API_KEY/.test(api) && /safeSearch:\s*'strict'/.test(api) &&
      /videoEmbeddable:\s*'true'/.test(api) && /\/api\/youtube-search/.test(vercel) &&
      // client search via the spine
      /getApiBaseUrl\(\)\}\/api\/youtube-search\?q=/.test(svc) &&
      // player is OTA-safe: native webview when present, in-app browser fallback otherwise
      /UIManager\.getViewManagerConfig\?\.\('RNCWebView'\)/.test(screen) &&
      /WebBrowser\.openBrowserAsync/.test(screen) &&
      // wired into the voice path (short-circuits the brain with a spoken confirm)
      /tryPlaySong\(message\)/.test(voice)
    );
  })(),
  'play-song searches the kid-safe server endpoint and opens the clean player; OTA-safe webview fallback; golf "play" phrases excluded');

check('Quick how-to: first-time tutorials + on-demand "how do I use this?" share one source',
  // 2026-06-13 (Tim) — quick orientation (text + caddie narration) on the doing surfaces,
  // from ONE SCREEN_HELP source so the first-time overlay and the on-demand answer match.
  (() => {
    // runtime: the shared source + detectors
    const hasKeys = ['play', 'drills', 'scorecard', 'smartmotion', 'swinglab']
      .every((k) => SCREEN_HELP[k]?.lines?.length >= 1 && SCREEN_HELP[k].spoken.length > 0 && SCREEN_HELP[k].lines.length <= 4);
    const help = detectScreenHelp('how does the scorecard work')?.key === 'scorecard'
      && detectScreenHelp('how do you use drills')?.key === 'drills'
      && detectScreenHelp('how do I use this')?.key === 'swinglab'   // "this" → default overview
      && detectScreenHelp('what club for 150') === null;             // no false positive
    // wired: tutorials on Play/Drills/Scorecard pull from SCREEN_HELP; help in the voice path
    const play = read('app/(tabs)/play.tsx');
    const drills = read('app/drills/index.tsx');
    const score = read('app/(tabs)/scorecard.tsx');
    const voice = read('hooks/useVoiceCaddie.ts');
    const wired = /slug="play_intro"[\s\S]*?SCREEN_HELP\.play\.spoken/.test(play) &&
      /slug="drills_intro"[\s\S]*?SCREEN_HELP\.drills/.test(drills) &&
      /slug="scorecard_scoring"[\s\S]*?SCREEN_HELP\.scorecard/.test(score) &&
      /detectHelpRequest\(message\)/.test(voice) && /getScreenHelp\(help\.key\)/.test(voice);
    return hasKeys && help && wired;
  })(),
  'one SCREEN_HELP source powers the first-time QuickTutorials (Play/Drills/Scorecard, ≤4 lines + narration) AND the on-demand "how do I use X" voice answer');

check('Voice polish: in-app "play" stays in-app · plain-speak mode · tutorials default-on',
  // 2026-06-13 (Tim) — (a) the word "play" must not break things: in-app playback never
  // routes to YouTube. (b) plain-english signals → shorter conversational brain reply
  // (not a global dumb-down). (c) quick instructions stay ON + skippable during testing.
  (() => {
    // (a) in-app playback never becomes a YouTube song; real songs still do.
    const inAppSafe = ['play my last swing', 'play that back', 'replay my swing', 'play the clip', 'play my round']
      .every((q) => detectPlaySongRequest(q) === null) &&
      detectPlaySongRequest('play despacito')?.query === 'despacito';
    // (b) plain-speak detection + wiring (reshapes the brain message, doesn't dumb-down all)
    const plain = detectPlainSpeakRequest('explain that simply') && detectPlainSpeakRequest('how do I learn golf') &&
      !detectPlainSpeakRequest('what club for 150');
    const voice = read('hooks/useVoiceCaddie.ts');
    const wired = /detectPlainSpeakRequest\(message\)/.test(voice) && /buildPlainSpeakPrefix\(\) \+ message/.test(voice);
    // (c) 2026-07-04 (drift reconcile) — the testing-era FORCE_SHOW flag graduated to
    // real gating: show until seen, throttled to SHOW_LIMIT opens (Tim's throttle ask).
    const tut = read('components/QuickTutorial.tsx');
    const gated = /const SHOW_LIMIT = 2/.test(tut) &&
      /!tutorialsSeen\?\.\[slug\] && \(introOpens\?\.\[slug\] \?\? 0\) < SHOW_LIMIT/.test(tut);
    return inAppSafe && plain && wired && gated;
  })(),
  'in-app play never hits YouTube; plain-speak reshapes only on signal; quick instructions show until seen, throttled to 2 opens');

// 2026-06-27 — REMOVED: 'Gyro-parallax wow v1' asserted components/ParallaxTilt.tsx,
// an UNBUILT 3D-roadmap item — no component, no import anywhere (only a stray comment
// in L1HolePreview). The check could never pass and used to crash the whole suite.
// Dropped from the suite; rebuild the DeviceMotion parallax feature to restore it.

check('Quick instructions: silent by default, 🔊 plays narration on demand (Tim)',
  // 2026-06-14 (Tim) — quick instructions never AUTO-narrate (out of the caddie voice
  // path, no clash), but a speaker button plays them on demand (accessibility).
  (() => {
    const tut = read('components/QuickTutorial.tsx');
    return (
      // 2026-07-04 (drift reconcile) — a bookkeeping useEffect (open-count throttle)
      // now exists; the honest assertion is that NOTHING auto-fires narration:
      // playNarration is invoked ONLY from the 🔊 button's onPress.
      !/useEffect\([\s\S]{0,200}playNarration/.test(tut) &&  // no effect auto-narrates
      !/setTutorialNarrating/.test(tut) &&       // no audio-ownership hack
      /volume-high/.test(tut) &&                 // the 🔊 button
      /const playNarration = \(\) =>/.test(tut) && /onPress=\{playNarration\}/.test(tut) &&
      /userInitiated: true/.test(tut)            // on-demand = user-initiated
    );
  })(),
  'QuickTutorial silent by default (no auto-narration), 🔊 button plays it on demand — accessibility without clashing the caddie voice');

check('Course-data bootstrap: SmartFinder capture ingests → previews use your real shot',
  // 2026-06-14 (Tim) — every SmartFinder photo/video tags to course/hole/GPS and builds
  // that course's own imagery; the hole preview then prefers YOUR captured shot over the
  // generic Mapbox tile. The 3D/Google-Earth SmartVision substrate, self-built as you play.
  (() => {
    const store = read('store/courseCaptureStore.ts');
    const ingest = read('services/courseCaptureIngest.ts');
    const sf = read('app/smartfinder.tsx');
    const prev = read('components/caddie/L1HolePreview.tsx');
    return (
      /export const useCourseCaptureStore = create/.test(store) && /bestForward:/.test(store) &&
      /slice\(-MAX_PER_HOLE\)/.test(store) && /persist\(/.test(store) &&
      // ingest copies the file to a persistent dir + tags course/hole/GPS
      /FileSystem\.copyAsync/.test(ingest) && /addCapture\(courseId, input\.hole/.test(ingest) &&
      /activeCourseId \?\? r\.previewCourseId/.test(ingest) &&
      // wired into BOTH SmartFinder capture paths
      /ingestCapture\(\{ sourceUri: photo\.uri, kind: 'single'/.test(sf) &&
      /ingestCapture\(\{ sourceUri: result\.uri, kind: 'pano'/.test(sf) &&
      // preview prefers the captured shot
      /const capturedUri = captured\?\.kind === 'single'/.test(prev) &&
      /capturedUri \? \(\{ uri: capturedUri \}/.test(prev)
    );
  })(),
  'SmartFinder photo→single / video→pano ingest tagged to course/hole/GPS (bounded, persisted); hole preview prefers the captured shot');

// 2026-06-14 (Tim — close the capture gaps) — heading was captured live but dropped at
// ingest (always null), captures didn't feed the course book, and dropped/cleared files
// leaked on disk. Fixes: heading wired in, course-detail grid prefers the user capture,
// file GC on cap/clear.
check('Course capture: heading wired + feeds the course book + files GC\'d',
  (() => {
    const sf = read('app/smartfinder.tsx');
    const store = read('store/courseCaptureStore.ts');
    const courseScreen = read('app/course/[course_id].tsx');
    const headingWired =
      // CameraSmartFinder now tracks heading and passes it on BOTH captures
      /const headingRef = useRef<number \| null>\(null\);/.test(sf) &&
      (sf.match(/heading: headingRef\.current/g) || []).length >= 2;
    const gc =
      /function deleteCaptureFiles\(uris: string\[\]\)/.test(store) &&
      /deleteCaptureFiles\(merged\.slice\(0, merged\.length - kept\.length\)/.test(store) && // cap eviction GC
      /deleteCaptureFiles\(\(s\.captures\[k\] \?\? \[\]\)\.map/.test(store) &&                 // clearHole GC
      /deleteCaptureFiles\(Object\.values\(s\.captures\)\.flat\(\)/.test(store);               // clearAll GC
    // course book (course-detail grid) now consumes captures — your photo wins
    const feedsBook =
      /useCourseCaptureStore\.getState\(\)\.bestForward\(course\.id, h\.hole_number\)/.test(courseScreen) &&
      /if \(cap && cap\.kind === 'single' && cap\.uri\)/.test(courseScreen);
    return headingWired && gc && feedsBook;
  })(),
  'SmartFinder captures now carry the live compass heading (no longer dropped), the course-detail hole grid prefers the player\'s own captured photo (capture→course-book loop closed), and dropped/cleared capture files are deleted instead of leaking on disk');

check('Review video plays: shouldPlay/imperative desync fixed (Tim — frozen on address frame)',
  // 2026-06-14 — the review clip froze on frame 0 (the "bending to place the ball"
  // address frame) and the Play tap was a no-op. Cause: expo-av ignores shouldPlay on
  // first load + seeks called pause/play imperatively without updating videoPaused.
  // Fix: explicit playAsync on load + every imperative seek syncs videoPaused.
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      // explicit kick on load when not paused (now async so the swing-window seek awaits first)
      /onLoad=\{async \(s\) => \{[\s\S]*?if \(!videoPaused\) v\.playAsync\(\)/.test(sm) &&
      // moment-tap (phase scrub) pauses then syncs state
      /try \{ await v\?\.pauseAsync\(\); \} catch[\s\S]*?setVideoPaused\(true\)/.test(sm) &&
      // seg-select play syncs state
      /void v\.playAsync\(\)\.catch\(\(\) => undefined\);\s*\n\s*\}\s*\n\s*setVideoPaused\(false\)/.test(sm)
    );
  })(),
  'review video kicks playback on load + every imperative seek keeps videoPaused in sync — no more frozen-frame / dead Play tap');

check('Analysis speed: pre-warm the lambda on record entry (kills cold-start)',
  // 2026-06-14 (Tim) — the headline read already runs tier:quick (3 frames, Haiku, no
  // Sonnet); the remaining delay is a cold Vercel function. Warm it on setup/recording
  // entry. 2026-06-14 (audit dedup) — consolidated onto the established
  // prewarmSwingAnalysis ({mode:'warmup'}, server-supported, throttled + force option);
  // the duplicate analysisWarmup.ts (warmSwingAnalysis) was removed.
  (() => {
    const w = read('services/swingAnalysisWarmup.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      /export function prewarmSwingAnalysis/.test(w) && /\/api\/swing-analysis/.test(w) &&
      /mode: 'warmup'/.test(w) && /WARMUP_DEDUPE_MS/.test(w) &&
      /if \(phase === 'setup' \|\| phase === 'recording'\) prewarmSwingAnalysis\(\)/.test(sm)
    );
  })(),
  'swing-analysis lambda pre-warmed on record entry via the single consolidated prewarmSwingAnalysis (mode:warmup fast path, throttled) so the first real analysis lands hot');

// 2026-06-14 (Tim) — quick-tier payload: 3 frames at 512px (down from 640) shrinks the
// per-frame base64 ~36% so the UPLOAD leg lands faster on weak cellular, without losing
// the gross-fault read accuracy (golfer fills the frame; face-angle is parked). Full-tier
// (library/upload detail) stays 800px untouched. Guard against a regression back to 1024+.
check('Analysis speed: quick-tier payload is lean (3 frames @ 512px) without touching full-tier',
  (() => {
    const p = read('services/poseDetection.ts');
    return (
      /const QUICK_TIER_FRAME_TIME_FRACTIONS = \[0\.10, 0\.55, 0\.85\]/.test(p) &&  // 3 frames
      /const QUICK_TIER_RESIZE_WIDTH = 512/.test(p) &&                            // shrunk 640→512
      /const FULL_TIER_RESIZE_WIDTH = 800/.test(p) &&                             // full-tier untouched
      !/RESIZE_WIDTH = (?:1024|1280)/.test(p)                                     // no regression to huge frames
    );
  })(),
  'the speed-path (SmartMotion / Cage / library Quick) sends 3 frames at 512px — a ~36% lighter upload than 640 — while full-tier library reads keep 800px for detail; no regression to 1024px+ payloads');

check('Self-growing agent: local hit-rate is instrumented (local vs cloud)',
  // 2026-06-13 — Tim's standing rule: the brain answers more LOCALLY over time,
  // pinging the cloud less. A persisted counter tags every query local vs cloud at
  // the router fork; the local hit-rate (shown on the owner surface) should climb.
  (() => {
    const store = read('store/agentBrainStats.ts');
    const router = read('services/voiceCommandRouter.ts');
    const ui = read('app/voice-misses.tsx');
    return /export const useAgentBrainStats = create/.test(store) &&
      /localAnswered:/.test(store) && /cloudEscalated:/.test(store) &&
      /localHitRate: \(\) =>/.test(store) && /persist\(/.test(store) && // accumulates across rounds
      /if \(localIntent\) useAgentBrainStats\.getState\(\)\.noteLocal\(\)/.test(router) &&
      /else useAgentBrainStats\.getState\(\)\.noteCloud\(\)/.test(router) &&
      /BRAIN SELF-SUFFICIENCY/.test(ui);
  })(),
  'every voice query is tagged local-answered vs cloud-escalated, persisted + surfaced — the agent-growth health metric');

check('Smart Motion: re-analyze the kept clip + auto-update on cold start (Tim)',
  // 2026-06-13 — (a) a NO-READ no longer forces a re-record: a re-analyze action
  // re-runs analysis on the SAME saved clip (quick, never wastes the swing).
  // (b) OTA auto-applies on cold start (no "Update" tap); manual only mid-session.
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    const upd = read('components/UpdateAvailableBanner.tsx');
    return (
      // re-analyze the existing clip (not re-record)
      /const reanalyze = useCallback\(\(\) => \{/.test(sm) &&
      /void runAnalysis\(clipUri, segmentsRef\.current\[0\]\)/.test(sm) &&
      /onPress=\{reanalyze\}/.test(sm) &&
      /accessibilityLabel="Re-analyze this swing"/.test(sm) &&
      // auto-apply OTA on cold start, manual only later
      /autoAppliedRef\.current = true;\s*\n\s*void applyUpdate\(\)/.test(upd) &&
      /sinceLaunchMs < 20_000/.test(upd) &&
      /!inRound && !voiceActive/.test(upd)
    );
  })(),
  'failed read → re-analyze the saved clip; OTA auto-applies on launch (not mid-round), no manual tap');

check('Practice points: conservative, per-drill, awarded on drill save → dashboard',
  // 2026-06-13 — Tim: conservative points per completed drill, on the dashboard,
  // no socials. Each captureKind:'drill' save awards points; the data is the
  // practice side of the future practice→course-improvement ledger.
  (() => {
    const store = read('store/practicePointsStore.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    const dash = read('app/(tabs)/dashboard.tsx');
    return (
      /export const usePracticePointsStore = create/.test(store) &&
      // 2026-06-14 — awardDrill now delegates to the unified awardPracticePoints.
      /awardDrill: \(drillId, swings, now\) => get\(\)\.awardPracticePoints/.test(store) &&
      /const BASE_PER_DRILL = 5/.test(store) && /MAX_SWINGS_COUNTED = 5/.test(store) && // conservative + no farming
      /persist\(/.test(store) && // accumulates
      // awarded on a DRILL save (now via the unified award so it also feeds the tier)
      // 2026-07-04 (drift reconcile) — the guard dropped the sid check (award moved
      // out of the session-scoped branch; drill saves award regardless).
      /if \(isDrill && drillId\)/.test(sm) &&
      /usePracticePointsStore\.getState\(\)\.awardPracticePoints\(\{/.test(sm) &&
      // surfaced on the dashboard, per-drill, hidden until earned
      /practiceTotal > 0 &&/.test(dash) &&
      /PRACTICE POINTS/.test(dash) &&
      /getDrillEntry\(id\)\?\.title/.test(dash)
    );
  })(),
  'conservative per-drill points awarded on each drill save, shown on the dashboard, hidden until earned');

check('Speed pass: skip the pose reprobe on a trusted duration + on-device telemetry',
  // 2026-06-13 — speed without losing accuracy. (a) The Motion path passes the
  // video player's real onLoad duration, so the pose extractor skips the ~2-8s
  // reprobe (the probe only ever overrode the 3000ms upload default / >50% gap —
  // a trusted value triggers neither). (b) on-device pose latency is logged so we
  // can confirm the APK unlock (native ~100-300ms vs cloud 5-15s/frame).
  (() => {
    const pose = read('services/poseAnalysisApi.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      // 2026-06-15 — signature carries an optional swing window (uploads);
      // 2026-07-07 (biomech #2) — plus the acoustic impactMs anchor.
      /extractPoseFramesFromVideo\(\s*videoUri: string,\s*durationMs: number,\s*trustDuration = false,\s*window\?: \{ startMs: number; endMs: number \} \| null,\s*impactMs\?: number \| null,/.test(pose) &&
      // Strike-anchored sampling: phases placed at swing-physics offsets around the
      // REAL acoustic strike, not window fractions (impact was landing 100ms+ late).
      /strike-anchored sampling/.test(pose) &&
      // Windowed sampling: an explicit swing window samples densely across it
      // (uploads land on the swing instead of smearing 5 frames over a minute).
      /window && window\.endMs - window\.startMs >= 500/.test(pose) &&
      /const canTrust = trustDuration && durationMs >= 500/.test(pose) &&
      /if \(!canTrust\) \{/.test(pose) && // probe only runs when NOT trusted
      /analyzeSwingFromVideo\([\s\S]*?trustDuration = false/.test(pose) &&
      /\[pose\] on-device hit/.test(pose) && // latency telemetry
      // Motion path trusts the player's real duration AND windows to the selected
      // swing (2026-07-06 H3) — and 2026-07-07 (biomech #8): extracts ONCE, computes
      // biomech from the SAME frames (skeleton + numbers can't diverge, half the poses).
      /extractPoseFramesFromVideo\(clipUri, videoDurationMs, true, poseWindow, acousticImpactMs\)/.test(sm) &&
      /computeBiomechanicsFromFrames\(frames, angle/.test(sm)
    );
  })(),
  'trusted real duration skips the reprobe (2-8s saved on Motion); acoustic strike anchors the phase frames; one extraction feeds both skeleton and biomech; on-device pose latency is measurable');

// 2026-07-08 (timeliness audit RANK 1) — the swing vision read must be PRE-STARTED on
// the raw recorder file, IN PARALLEL with the durable-clip byte-copy + session ingest.
// The old order awaited persistClipToDocuments (a full copy) in front of every verdict.
check('Timeliness: swing read runs in parallel with the clip persist (not behind it)',
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      // The read is kicked off on rawUri before the persist await, guarded for putts.
      /const analysisP: Promise<Awaited<ReturnType<typeof analyzeSwing>>> \| null = isPutt \? null : Promise\.race\(\[\s*\n\s*analyzeSwing\(rawUri,/.test(sm) &&
      // The verdict awaits the PRE-STARTED promise (not a fresh analyzeSwing after persist).
      /const result: Awaited<ReturnType<typeof analyzeSwing>> = await analysisP!/.test(sm) &&
      // persist still runs (durability) — just no longer in front of the read.
      /uri = await persistClipToDocuments\(rawUri\)/.test(sm) &&
      // and it is NOT re-awaited before an analyzeSwing on the verdict path anymore.
      !/analyzeSwing\(uri, analyzeOpts, boundaries\)/.test(sm)
    );
  })(),
  'the first-verdict path pre-starts the vision read on the raw recorder file and awaits that promise, running the durable-clip copy + session ingest concurrently instead of blocking the verdict behind a full byte-copy');

check('Uploads: skeleton + 4-card read windowed on the pointed swing',
  // 2026-06-15 (Tim — "uploads aren't treated into the Smart Motion UI, can't see
  // the skeleton") — an uploaded clip is 30-60s with the swing buried inside, so the
  // default full-clip pose smeared 5 frames across the minute (no usable skeleton).
  // Fix: the upload's pending CTA is "point at your swing" (onAnalyzeAtPosition
  // windows the clip), and runPhaseKOnSession passes that window to the on-device
  // pose so the skeleton lands on the REAL swing — same cards + skeleton as a live
  // Smart Motion capture. Live captures keep the plain one-tap analyze.
  (() => {
    const up = read('services/videoUpload.ts');
    const detail = read('app/swinglab/swing/[swing_id].tsx');
    return (
      /firstClipSwing\.clipEndSeconds > firstClipSwing\.clipStartSeconds/.test(up) &&
      // 2026-07-07 (biomech #9) — the upload now passes its KNOWN camera angle.
      /analyzeSwingFromVideo\(firstClipSwing\.clipUri!, durationSec \* 1000, session\.upload\?\.angleOverride \?\? null, false, poseWindow\)/.test(up) &&
      /session\.source === 'uploaded_video' \? \(/.test(detail) &&
      /onPress=\{onAnalyzeAtPosition\}/.test(detail)
    );
  })(),
  'uploaded swing windows the cloud read AND the on-device pose on the pointed moment → cards + skeleton');

check('Smart Motion record by tap-to-talk is deterministic + local (no brain loop)',
  // 2026-06-15 (Tim — "active listening doesn't work; I tap the earbud/glasses and
  // speak") — when Smart Motion is OPEN, record/watch/stop must route LOCALLY to
  // media_capture, never the cloud classifier (which sometimes sent it to the Kevin
  // brain → "do you want me to watch your swing?" loop that never armed the
  // recorder). The earbud-tap path (listeningSession) now tries the local precheck
  // before the cloud classify; the brain's record_swing backstop emits the bus
  // 'start' instead of navigating to the wrong screen.
  (() => {
    const pre = read('services/localIntentPrecheck.ts');
    const listen = read('services/listeningSession.ts');
    const caddie = read('app/(tabs)/caddie.tsx');
    return (
      /isSmartMotionActive\(\)/.test(pre) &&
      /'media_capture', \{ capture_type: 'swing', raw_utterance: t \}/.test(pre) &&
      /precheckLocalIntent\(utterance\)/.test(listen) &&
      /if \(isSmartMotionActive\(\)\) \{\s*emitSmartMotionCommand\('start'\)/.test(caddie)
    );
  })(),
  'tap→"record"/"watch my swing" arms the recorder via the bus; no cloud coin-flip, no Kevin loop');

check('Smart Motion: pipelined per-swing narration with one-ahead head start',
  // 2026-06-15 (Tim — "by the time I stop the 3rd swing it's reading the first, then
  // tells me the second... consecutively") — multi-swing sessions narrate each swing
  // IN ORDER while the NEXT swing's read computes in the background (swing N+1 while
  // swing N is spoken). Reuses runWindowedAnalysis (explicit uri+seg so it can run at
  // stop-time before state settles) + swingNarrationLine (honest deriveVerdict copy).
  // Fired from the stop path for multi-swing, non-putt sessions only.
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      /const runWindowedAnalysis = useCallback/.test(sm) &&
      /const pipelineNarrate = useCallback/.test(sm) &&
      /function swingNarrationLine/.test(sm) &&
      /segsForAnalysis\.length > 1 && !puttModeRef\.current/.test(sm) &&
      /void pipelineNarrate\(recorded\.uri, segsForAnalysis\)/.test(sm)
    );
  })(),
  'multi-swing reads narrate in order with a background head start; single/putt sessions unaffected');

check('Smart Motion: pipeline narration has a per-run cancel token (no cross-session ghost)',
  // 2026-06-16 (deep walk) — a stale in-flight pipeline must bail even if a NEW
  // session flipped pipelineAbortRef back to false; the per-run token (myRun vs
  // pipelineRunRef) is the source of truth, closing the cache-collision race.
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      /const myRun = \+\+pipelineRunRef\.current/.test(sm) &&
      /const cancelled = \(\) => pipelineAbortRef\.current \|\| myRun !== pipelineRunRef\.current/.test(sm) &&
      /pipelineRunRef\.current\+\+/.test(sm)
    );
  })(),
  'a stale pipeline bails via its run token — no wrong-swing narration after a fast record-again');

check('Voice: explicit tap forces a warmup (bypasses dedupe) for the cold first tap',
  // 2026-06-16 (deep latency walk) — a tap to talk forces a fresh warm even if a
  // passive warmup ran recently, so a borderline-cold chain heats up during the
  // user's speech. Boot/foreground warms stay passive (deduped).
  (() => {
    const w = read('services/voiceWarmup.ts');
    const ls = read('services/listeningSession.ts');
    const vc = read('hooks/useVoiceCaddie.ts');
    return (
      /export function prewarmVoice\(force = false\)/.test(w) &&
      /if \(!force && now - lastWarmupAt < WARMUP_DEDUPE_MS\) return/.test(w) &&
      /prewarmVoice\(true\)/.test(ls) && /prewarmVoice\(true\)/.test(vc)
    );
  })(),
  'tap-to-talk forces a fresh warm; cold-first-tap chain heats during the speech window');

check('Smart Motion record cue is honest about camera startup',
  // 2026-06-16 — the camera takes ~a second after the cue; "swing when you're set"
  // (not "swing away") avoids swinging into a not-yet-recording window.
  (() => /Recording — swing when you/.test(read('services/intents/mediaHandlers.ts')))(),
  'record voice cue says swing-when-set, not swing-away');

check('Round record: holesPlayed/totalScore gate on score>0 (consistent with scoreVsPar)',
  // 2026-06-16 (whole-app audit) — a never-finalized 0-score hole used to inflate
  // holesPlayed while scoreVsPar skipped it, saving an inconsistent triplet and
  // skewing the incomplete-round handicap filter. All three now share one gate.
  (() => {
    const rs = read('store/roundStore.ts');
    return (
      /const scoredEntries = Object\.entries\(s\.scores\)\.filter\(\(\[, score\]\) => score > 0\)/.test(rs) &&
      /holesPlayed: scoredEntries\.length/.test(rs) &&
      /totalScore: scoredEntries\.reduce/.test(rs) &&
      /getHolesPlayed: \(\) =>[\s\S]*?\.filter\(\(score\) => score > 0\)\.length/.test(rs)
    );
  })(),
  'holesPlayed + totalScore + scoreVsPar all derive from the same score>0 gate');

check('Voice VAD: adaptive noise floor lifts the silence bar in noise, unchanged when quiet',
  // 2026-06-16 (Tim — first-tap-in-noise failures) — fixed -40/-30 thresholds let
  // any room louder than ~-40 ambient keep refreshing lastLoudAt, so the capture
  // never auto-stopped and Kevin got a long noisy clip. Thresholds now ride a live
  // ambient floor, clamped so a quiet room is byte-for-byte the old behavior.
  (() => {
    const vs = read('services/voiceService.ts');
    const hook = read('hooks/useVoiceActivityDetection.ts');
    const wired =
      /noiseFloorDb \+= \(m - noiseFloorDb\) \* alpha/.test(vs) &&
      /const effSilenceDb = Math\.max\(SILENCE_DB_THRESHOLD, noiseFloorDb \+ SILENCE_MARGIN_DB\)/.test(vs) &&
      /const effSpeechDb = Math\.max\(SPEECH_DETECT_DB, noiseFloorDb \+ SPEECH_MARGIN_DB\)/.test(vs) &&
      /noiseFloorRef\.current \+= \(m - noiseFloorRef\.current\) \* a/.test(hook) &&
      /const effThresholdDb = Math\.max\(SPEECH_THRESHOLD_DB, noiseFloorRef\.current \+ SPEECH_MARGIN_DB\)/.test(hook);
    // Behavioral: replicate the floor math (INIT -50, MIN -60, fall .15 / rise .02).
    const floorAfter = (db: number, n: number): number => {
      let f = -50;
      for (let i = 0; i < n; i++) { const m = Math.max(db, -60); const a = m < f ? 0.15 : 0.02; f += (m - f) * a; }
      return f;
    };
    const effSilence = (f: number): number => Math.max(-40, f + 12);
    const quiet = effSilence(floorAfter(-55, 40)); // quiet room (~-55 ambient)
    const noisy = effSilence(floorAfter(-38, 80)); // sustained ~-38 background
    const quietUnchanged = quiet === -40;          // identical to the prior fixed bar
    const noisyLifted = noisy > -40 && -38 <= noisy; // -38 background no longer counts as "loud"
    return wired && quietUnchanged && noisyLifted;
  })(),
  'noise lifts the VAD silence bar so auto-stop fires; a quiet room is unchanged');

check('GolfFix: in-flight session analysis lands on the LIVE activeSession (C3 fix)',
  // 2026-06-16 (Tim — harness C3 "GolfFix render — no_dominant_fault" failing) —
  // setSessionAnalysis/Status only patched sessionHistory, but GolfFix analysis
  // lands while the session is still IN-FLIGHT (activeSession), before it's saved.
  // seedCageSession produces an active-only session, so the old history-only map
  // missed it and activeSession.primary_issue (fix/drill) stayed null. Now both
  // setters dual-update activeSession + history, like the sibling shot setters.
  (() => {
    const cs = read('store/cageStore.ts');
    const dualWired =
      /setSessionAnalysis: \(sessionId, primary_issue, drill_recommendation\) =>[\s\S]*?apply\(s\.activeSession\)[\s\S]*?sessionHistory: s\.sessionHistory\.map\(apply\)/.test(cs) &&
      /setSessionAnalysisStatus: \(sessionId, status, error\) =>[\s\S]*?apply\(s\.activeSession\)[\s\S]*?sessionHistory: s\.sessionHistory\.map\(apply\)/.test(cs);
    // Behavioral: replicate the dual-update reducer against an ACTIVE-ONLY session.
    interface Sess { id: string; primary_issue: { drill?: string } | null }
    const apply = (sessionId: string, issue: { drill?: string }) => (sess: Sess): Sess =>
      sess.id !== sessionId ? sess : { ...sess, primary_issue: issue };
    const seeded: { activeSession: Sess | null; sessionHistory: Sess[] } =
      { activeSession: { id: 'sess1', primary_issue: null }, sessionHistory: [] };
    const fn = apply('sess1', { drill: 'Continue your current practice routine.' });
    const after = {
      activeSession: seeded.activeSession && seeded.activeSession.id === 'sess1'
        ? fn(seeded.activeSession) : seeded.activeSession,
      sessionHistory: seeded.sessionHistory.map(fn),
    };
    return dualWired && !!after.activeSession?.primary_issue?.drill;
  })(),
  'no_dominant_fault fix/drill populate on the live (active-only) GolfFix session, not just saved history');

check('Swing review: controls stay persistently visible (functional > clean-grab) + playAsync kick',
  // 2026-06-27 — refreshed to the INTENTIONAL current design. The clean-screenshot
  // controls-fade-on-pause was deliberately dropped 2026-06-23 ("with auto-play on,
  // the old fade hid every control … functional controls win"). This is NOT a
  // regression — so we assert the current design (controls persistent: controlsHidden
  // defaults false; the pointerEvents gate stays for the rare hidden case) + the
  // end-of-clip playAsync kick that keeps tap-to-play / autoplay working. If clean
  // screenshots are wanted again, re-add a fade gated to MANUAL pause only (never autoplay).
  (() => {
    const f = read('app/swinglab/swing/[swing_id].tsx');
    return (
      /Clean-grab fade dropped — functional controls win/.test(f) &&
      /const \[controlsHidden, setControlsHidden\] = useState\(false\)/.test(f) &&
      /pointerEvents=\{controlsHidden \? 'none' : 'box-none'\}/.test(f) &&
      /await v\.playAsync\(\)/.test(f)
    );
  })(),
  'controls stay visible by design (clean-grab fade intentionally dropped 2026-06-23); the end-of-clip playAsync kick keeps tap-to-play / autoplay working');

check('Voice flow: keep-warm heartbeat + caddie-focus warm + snappier endpoint',
  // 2026-06-16 (Tim — "first try always longer" + "listens too long" + "why go cold
  // at all") — Vercel functions idle out after ~5 min. A 240s heartbeat keeps the
  // chain hot while foregrounded so no session goes fully cold; the caddie tab warms
  // on focus (not just tap); silence endpoint snaps at 900ms.
  (() => {
    const vc = read('hooks/useVoiceCaddie.ts');
    const caddie = read('app/(tabs)/caddie.tsx');
    const vs = read('services/voiceService.ts');
    return (
      /heartbeat = setInterval\(warmIfVoice, 240_000\)/.test(vc) &&
      /if \(next === 'active'\) \{ warmIfVoice\(\); startHeartbeat\(\); \}/.test(vc) &&
      /else stopHeartbeat\(\)/.test(vc) &&
      /voiceEnabled\) \{[\s\S]*?prewarmVoice\(\);/.test(caddie) &&
      /const SILENCE_TIMEOUT_MS = 900;/.test(vs)
    );
  })(),
  'a 4-min heartbeat keeps endpoints warm (no cold session); caddie warms on focus; 900ms silence snap');

check('Voice: one-voice-at-a-time across cloud + device subsystems (no racing)',
  // 2026-06-16 (Tim — "two voices racing" + robotic backup at the same time) — the
  // cloud/mp3 path (Audio.Sound) and the device-TTS fallback (expo-speech) are
  // SEPARATE subsystems; neither cancelled the other, so the opener mp3 / a cloud
  // line could play over an in-flight robotic fallback. Now each side stops the
  // other on start, and the device fallback is awaited (not fire-and-forget).
  (() => {
    const vs = read('services/voiceService.ts');
    const cloudStopsDevice = (vs.match(/try \{ Speech\.stop\(\); \} catch \{\}/g) || []).length >= 3;
    const deviceStopsCloud = /re-check after the async stop, right before speaking/.test(vs);
    const awaited = !/void deviceSpeakFallback\(/.test(vs) && /await deviceSpeakFallback\(/.test(vs);
    return cloudStopsDevice && deviceStopsCloud && awaited;
  })(),
  'cloud/mp3 cancels device-TTS, device fallback cancels cloud/mp3 + is awaited — no overlap');

check('Voice: capture silences the caddie before opening the mic (no self-record)',
  // 2026-06-16 (Tim — "did the speech leak into its mouth") — captureUtterance must
  // stopSpeaking() (both subsystems) BEFORE configureAudioForRecording, so the mic
  // never records the caddie talking over the user. Centralized for ALL callers; also
  // gives clean barge-in (tap mid-response stops the caddie and listens).
  (() => {
    const vs = read('services/voiceService.ts');
    return /export const captureUtterance =[\s\S]*?try \{ await stopSpeaking\(\); \} catch[\s\S]*?await configureAudioForRecording\(\)/.test(vs);
  })(),
  'capture stops in-flight TTS (cloud + device) before recording — no echo/self-record, clean barge-in');

check('Voice latency: brain fired in parallel with the classifier on precheck-miss',
  // 2026-06-16 (Tim — "I speak but he waits 4-5s, then thinks") — the cloud classifier
  // sat serially in front of the brain even though the brain takes the raw utterance.
  // On precheck-miss we now fire a speculative /api/kevin in PARALLEL with the
  // classifier and consume it on the conversational branch (~1 round-trip saved).
  (() => {
    const ls = read('services/listeningSession.ts');
    return (
      /let speculativeBrainP: Promise<Response \| null> \| null = null;/.test(ls) &&
      /speculativeBrainP = fetchWithTimeout\(`\$\{apiUrl\}\/api\/kevin`/.test(ls) &&
      /const chatRes = \(speculativeBrainP && await speculativeBrainP\) \|\| await fetchWithTimeout/.test(ls)
    );
  })(),
  'conversational brain overlaps the classifier instead of stacking after it');

check('Voice: stale speech cleared on navigation (no carry-over), with speak-then-nav grace',
  // 2026-06-16 (Tim — "old voices leaking from prior steps") — route change stops
  // prior-screen speech (queue self-invalidates via speakGeneration + caption clears);
  // a 2s grace protects intentional speak-then-navigate + the launch greeting handoff.
  (() => {
    const vs = read('services/voiceService.ts');
    const layout = read('app/_layout.tsx');
    return (
      /export const getLastSpeakStartedAt = \(\): number => lastSpeakStartedAt;/.test(vs) &&
      /lastSpeakStartedAt = Date\.now\(\);/.test(vs) &&
      /Date\.now\(\) - getLastSpeakStartedAt\(\) > 2000/.test(layout) &&
      /void stopSpeaking\(\)\.catch/.test(layout)
    );
  })(),
  'route change stops stale prior-step speech; 2s grace protects speak-then-navigate');

check('Voice local-first: FACTUAL asks answer on-device; JUDGMENT asks lead with the AI',
  // 2026-06-16 (Tim — local-first, "on course no wifi" + speed) — the local responder
  // is tried BEFORE the cloud classify+brain on a precheck miss (offline + fast).
  // 2026-07-03 (Tim — "the AI needs to be front and center and the highlight") — the
  // JUDGMENT reads (club_recommend / plays_like / reach) were REMOVED from the instant
  // local-primary set so they lead with the caddie brain; they remain the OFFLINE
  // safety net via answerOffline→tryLocalReply. Pure FACTS (yardage/score/hole/par/…)
  // still answer instantly + local.
  (() => {
    const ls = read('services/listeningSession.ts');
    const setBlock = (ls.match(/LOCAL_PRIMARY_TYPES: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/) || [])[1] || '';
    const lsr = read('services/localStatusResponder.ts');
    const uvc = read('hooks/useVoiceCaddie.ts');
    return (
      /import \{ tryLocalReply \} from '\.\/localStatusResponder';/.test(ls) &&
      /localPrimary = tryLocalReply\(utterance, localLang\)/.test(ls) &&
      /LOCAL_PRIMARY_TYPES\.has\(localPrimary\.queryType\)/.test(ls) &&
      /local_primary type=/.test(ls) &&
      // FACTS stay local; JUDGMENT types are OUT of the instant set (→ brain).
      /score_round/.test(setBlock) && /yardage_middle/.test(setBlock) &&
      !/club_recommend/.test(setBlock) && !/plays_like/.test(setBlock) && !/\breach\b/.test(setBlock) &&
      !/hole_info/.test(setBlock) && !/no_round/.test(setBlock) &&
      // The AI-led set is declared + the caddie-tab path defers those to the brain.
      /export const AI_LED_QUERY_TYPES/.test(lsr) &&
      /club_recommend'.*'plays_like'.*'reach'/s.test(lsr) &&
      /!responder\.AI_LED_QUERY_TYPES\.has\(local\.queryType\)/.test(uvc)
    );
  })(),
  'factual asks answer instantly + offline; judgment asks (club/plays-like/reach) lead with the AI brain');

check('Voice local-first hit-rate metric: recorded at decision points + shown in Owner Tools',
  // 2026-06-16 (Tim — "I care about that stuff") — the self-growing-agent health metric:
  // share of spoken asks answered ON-DEVICE vs escalated to the cloud, recorded at the
  // precheck / local-primary / cloud decision points and surfaced (live %, tap-to-reset)
  // in Settings → Owner Tools. Pure observation — never gates the voice path.
  (() => {
    const store = read('store/voiceHitRateStore.ts');
    const ls = read('services/listeningSession.ts');
    const settings = read('app/settings.tsx');
    return (
      /export const useVoiceHitRateStore/.test(store) &&
      /recordLocal:/.test(store) && /recordCloud:/.test(store) &&
      /recordLocal\(`precheck:/.test(ls) &&
      /recordLocal\(`local_primary:/.test(ls) &&
      /recordCloud\(`cloud:/.test(ls) &&
      /function VoiceHitRateRow/.test(settings) && /<VoiceHitRateRow colors=\{colors\} \/>/.test(settings)
    );
  })(),
  'local-vs-cloud counter recorded at precheck/local-primary/cloud points; live % in Owner Tools');

check('Voice: first-ask failure exits leave a breadcrumb in the Issue Log (diagnosable)',
  // 2026-06-16 (Tim — "first ask is 90% a failure", "front-end path has a glitch") — the
  // tap-path failure exits were silent console.logs (gone in prod), so the glitch was
  // undiagnosable. Each now logs a distinct reason to the owner Issue Log so the next
  // failure names its exact stage: empty/clipped recording vs transcribe error vs silence.
  (() => {
    const vc = read('hooks/useVoiceCaddie.ts');
    return (
      /logVoiceSilentFail\('tap_no_uri'/.test(vc) &&
      /logVoiceSilentFail\('tap_capture_too_short'/.test(vc) &&
      /logVoiceSilentFail\('capture_file_too_small'/.test(vc) &&
      /logVoiceSilentFail\('empty_transcript'/.test(vc)
    );
  })(),
  'silent capture-failure exits now log a reason to the owner Issue Log (no more invisible first-ask misses)');

check('Voice: mic/capture pipeline primed once off-path (first-tap warm)',
  // 2026-06-16 (Tim — "fix that first-turn slowness") — the first Audio.Recording after
  // launch pays a cold OS audio-HAL/mic init. primeMicPipeline does a throwaway record
  // start+stop ONCE, off the user's path (after the opener / on focus), so the first real
  // tap is warm. Permission-gated (never prompts), never while speaking/capturing,
  // restores speaker mode. A true warm-up, not a sleep band-aid.
  (() => {
    const vs = read('services/voiceService.ts');
    const caddie = read('app/(tabs)/caddie.tsx');
    return (
      /export async function primeMicPipeline/.test(vs) &&
      /await Audio\.getPermissionsAsync\(\)/.test(vs) &&
      /if \(isSpeaking\(\) \|\| isCapturing\(\)\) return;/.test(vs) &&
      /micPipelinePrimed = true;/.test(vs) &&
      /void primeMicPipeline\(\);/.test(caddie)
    );
  })(),
  'first tap-to-talk hits a warm mic (one-time off-path prime, permission-gated, restores speaker mode)');

check('Voice: dead-zone failures SPEAK via device TTS (not just a silent text bubble)',
  // 2026-06-19 (Tim — driving in sporadic cellular: "doesn't respond or anything") — the
  // transcribe/network failure exits only DISPLAYED text. Now they also speak an honest
  // signal notice through device TTS (zero-signal capable), gated on voiceEnabled, so the
  // caddie audibly tells you it's a coverage issue instead of going silent.
  (() => {
    const vs = read('services/voiceService.ts');
    const vc = read('hooks/useVoiceCaddie.ts');
    return (
      /export async function speakDeviceNotice/.test(vs) &&
      /await deviceSpeakFallback\(text, language, currentSpeechId, gender\)/.test(vs) &&
      /if \(voiceEnabled\) void speakDeviceNotice\(/.test(vc) &&
      /(can't reach|not reaching|lost) the network/i.test(vc) // refreshed: message reworded (Phase A offline-degrade); feature intact
    );
  })(),
  'transcribe/network failures speak an honest signal notice via device TTS (offline), not a silent bubble');

check('Voice keep-warm deduped; Issue Log restored to Owner Tools',
  // 2026-06-16 (Tim) — removed the caddie-tab __ping__ keepWarm (redundant with the
  // app-wide prewarmVoice heartbeat) so there aren't two 4-min idle timers; Issue
  // Log + Scenario Harness both live in Owner Tools again.
  (() => {
    const caddie = read('app/(tabs)/caddie.tsx');
    const settings = read('app/settings.tsx');
    return (
      !/setInterval\(keepWarm/.test(caddie) &&
      !/message: '__ping__'/.test(caddie) &&
      /issue log \+ harness should be in owner/i.test(settings) &&
      /router\.push\('\/harness' as never\)/.test(settings)
    );
  })(),
  'single app-wide voice heartbeat (caddie __ping__ dup removed); Issue Log + Harness in Owner Tools');

check('Close a tool → HOME (no white screen), deterministic + local',
  // 2026-06-16 (Tim — "close Smart Motion" white-screened) — close/exit a tool goes
  // HOME to the caddie via router.replace (the old router.back() white-screened when
  // the tool wasn't over a resolvable stack entry). Routed LOCALLY so it never rides
  // the cloud classifier.
  (() => {
    const nav = read('services/intents/navigateHandler.ts');
    const pre = read('services/localIntentPrecheck.ts');
    return (
      /case 'close':\s*case 'exit': \{/.test(nav) &&
      /router\.replace\(HOME_PATH as never\)/.test(nav) &&
      /CLOSE \/ EXIT A TOOL/.test(pre) &&
      /direction: 'home'/.test(pre)
    );
  })(),
  'close/exit routes home (replace) deterministically — no fragile back(), no white screen');

check('No ghost reads: Smart Motion + library stop speech on exit / new session',
  // 2026-06-16 (Tim — a previous read's voice fired off later) — leaving a read
  // surface (or starting a new session) aborts the per-swing pipeline AND stops the
  // TTS queue; the library detail's async narrate can't fire after unmount.
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    const detail = read('app/swinglab/swing/[swing_id].tsx');
    return (
      /pipelineAbortRef\.current = true/.test(sm) && /void stopSpeaking\(\)/.test(sm) &&
      /if \(cancelled\(\)\) return;/.test(sm) &&
      /let cancelled = false;/.test(detail) &&
      /if \(cancelled\) return;/.test(detail) &&
      /return \(\) => \{ cancelled = true; \};/.test(detail)
    );
  })(),
  'narration is cancelled on exit/new-session + guarded against post-unmount fire — no late ghost read');

check('Shot-rest: swing-count selector (Open/1/3/5) caps the session',
  // 2026-06-16 (Tim) — OPEN = the free window; picking 1/3/5 caps the session to
  // exactly N swings (read + narration cover N). A drill's own count still wins.
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      /const \[targetSwings, setTargetSwings\] = useState<number \| null>\(null\)/.test(sm) &&
      /const swingCap = drillShotCount \?\? targetSwingsRef\.current/.test(sm) &&
      /segsForAnalysis = segsForAnalysis\.slice\(0, swingCap\)/.test(sm) &&
      /SWINGS/.test(sm) && /\[null, 1, 3, 5\]/.test(sm)
    );
  })(),
  'OPEN = free window; 1/3/5 caps segments so the read + narration cover exactly N');

check('Clean state at restart: practice session "active" is NOT persisted',
  // 2026-06-16 (Tim — clean state at restart) — persisting active re-spawned a stale
  // "still running" session on relaunch (stuck spinner / ghost swings). Persist
  // history only.
  (() => /partialize: \(s\) => \(\{ history: s\.history \}\)/.test(read('store/practiceSessionStore.ts')))(),
  'a crash mid-practice cannot resurrect a live session on cold launch');

check('Earbud/glasses tap STOPS Smart Motion recording (mic stays the camera\'s)',
  // 2026-06-16 (Tim) — during recording the camera owns the mic; a tap must STOP the
  // capture, never open a listen session (that races the camera audio = "Only one
  // Recording object" crash). Centralized in listeningSession.toggle (both tap paths
  // route through it); a short cooldown swallows the duplicate tap signal.
  (() => {
    const bus = read('services/smartMotionRecordBus.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    const ls = read('services/listeningSession.ts');
    return (
      /export function setSmartMotionRecording/.test(bus) && /export function isSmartMotionRecording/.test(bus) &&
      /setSmartMotionRecording\(true\)/.test(sm) && /setSmartMotionRecording\(false\)/.test(sm) &&
      /if \(isSmartMotionRecording\(\)\) \{\s*recordingStopTapAt = Date\.now\(\);\s*emitSmartMotionCommand\('stop'\)/.test(ls) &&
      /Date\.now\(\) - recordingStopTapAt < RECORDING_STOP_TAP_COOLDOWN_MS/.test(ls)
    );
  })(),
  'tap-while-recording emits stop (no listen-open → no crash); cooldown dedupes the double tap signal');

check('Round recap notes show the player\'s notes only, not the error log',
  // 2026-06-16 (Tim — recap was 3 pages of transcribe/voice errors) — "Notes from
  // this round" filters to kind==='user' (or legacy undefined), excluding the
  // auto-logged diagnostics.
  (() => /\(e\.kind === 'user' \|\| e\.kind == null\) &&/.test(read('app/recap/[round_id].tsx')))(),
  'transcribe_error / voice_error / gps_error no longer flood the recap notes');

check('Scorecard empty state taps through to the dashboard',
  // 2026-06-16 (Tim — tapping "Recent Rounds" did nothing) — the no-round scorecard
  // card now navigates to the dashboard with an explicit affordance.
  (() => {
    const sc = read('app/(tabs)/scorecard.tsx');
    return /onPress=\{\(\) => router\.push\('\/\(tabs\)\/dashboard' as never\)\}/.test(sc) && /View Recent Rounds/.test(sc);
  })(),
  'no-round scorecard navigates to the dashboard instead of a dead "Recent Rounds" link');

check('Recap Handicap Impact: no differential on an incomplete round (was -33 on 8 holes)',
  // 2026-06-16 (Tim) — a Score Differential is only valid for a complete 9/18; a
  // partial round compared the partial AGS to the full 18-hole rating → ~-33. Now
  // gated: partial rounds show an honest message, no bogus differential / post button.
  (() => {
    const card = read('components/recap/HandicapImpactCard.tsx');
    return (
      // 2026-07-04 — sim rounds are ALSO never postable (voice sim round).
      /const isPostable = \(holesPlayed === 9 \|\| holesPlayed === 18\) && !round\?\.simulated/.test(card) &&
      /handicapIndex == null \|\| !round \|\| !isPostable/.test(card) &&
      /finish 9 or 18 to post a Score Differential/.test(card)
    );
  })(),
  'a partial round shows an honest message, not a bogus negative differential');

check('Custom caddie: explicit apply pipeline + save-to-phone',
  // 2026-06-16 (Tim — "no way to apply it; it makes you email to save") — one button
  // applies voice + person + portrait (persona 'custom' + useCustomCaddie), so the
  // avatar stops showing a stock caddie; save writes to the photo library, not the
  // share sheet.
  (() => {
    const cc = read('app/profile/custom-caddie.tsx');
    return (
      /setUseCustomCaddie\(true\);\s*setCaddiePersonality\('custom'\)/.test(cc) &&
      /saveToLibraryAsync/.test(cc) &&
      /Use \$\{customCaddieName \?\? 'My Caddie'\} as my caddie/.test(cc)
    );
  })(),
  'apply sets persona custom + useCustomCaddie (portrait follows); save goes to Photos, not email');

check('Custom caddie portrait can be just the dashboard icon (separate from the caddie)',
  // 2026-06-16 (Tim) — apply a portrait as ONLY the dashboard profile picture, without
  // it becoming the active custom caddie (voice/persona untouched).
  (() => {
    const store = read('store/customCaddieMediaStore.ts');
    const dash = read('app/(tabs)/dashboard.tsx');
    const cc = read('app/profile/custom-caddie.tsx');
    return (
      /profilePortraitB64: string \| null/.test(store) && /setProfilePortraitB64:/.test(store) &&
      /profilePortraitB64 \?/.test(dash) && /avatarImg/.test(dash) &&
      /setProfilePortraitB64\(isProfilePic \? null : portraitForPic\)/.test(cc) &&
      /Use as profile picture/.test(cc)
    );
  })(),
  'a portrait can be the dashboard icon without activating the custom caddie persona/voice');

check('Dashboard SHOT STATS: 4 branded-icon tiles incl. honest score trend',
  // 2026-06-16 (Tim — dashboard mockup) — 4-up shot stats with branded green icons;
  // Score Trend is a real avg score-vs-par over recent rounds (— until history).
  (() => {
    const d = read('app/(tabs)/dashboard.tsx');
    return (
      /icon="golf-outline"/.test(d) && /icon="locate-outline"/.test(d) &&
      /icon="flag-outline"/.test(d) && /icon="trending-up-outline"/.test(d) &&
      /const scoreTrend = useMemo/.test(d)
    );
  })(),
  '4-up SHOT STATS with branded icons; score trend = real avg score-vs-par, dash until there is history');

check('Dashboard: real day-streak metric surfaced',
  // 2026-06-16 (Tim — "streaks as a metric in the app") — the player's own day streak
  // (consecutive days with a round OR practice session) shows as a flame pill.
  (() => {
    const d = read('app/(tabs)/dashboard.tsx');
    return /const dayStreak = useMemo/.test(d) && /streakPill/.test(d) && /day\{dayStreak === 1 \? '' : 's'\}/.test(d);
  })(),
  'dashboard shows a real consecutive-day streak (round or practice), honest from dates');

check('Coach Mode: selected-player hero + real day-streak metric (mockup)',
  // 2026-06-16 (Tim — Coach Mode mockup + "streaks as a metric") — header shows
  // players + total swings; the selected player gets a hero with real swings /
  // last-capture / day-streak (consecutive session days, honest — not fabricated).
  (() => {
    const cm = read('app/swinglab/coach-mode.tsx');
    return (
      /const dayStreak = useMemo/.test(cm) && /swings logged/.test(cm) &&
      /heroCard/.test(cm) && /Day streak/.test(cm) &&
      /streak broken if no session today\/yesterday/.test(cm)
    );
  })(),
  'Coach Mode hero shows real swing/last-capture/day-streak stats from session dates');

check('Settings: branded icons on every category section (mockup, layout unchanged)',
  // 2026-06-16 (Tim — "change the icons", layout already matches) — each collapsible
  // section header now carries a branded icon; no logic/layout change.
  (() => {
    const s = read('app/settings.tsx');
    return (
      /title="Caddie" icon="bag-outline"/.test(s) &&
      /title="Round Experience" icon="flag-outline"/.test(s) &&
      /title="Voice & Conversation" icon="mic-outline"/.test(s) &&
      /title="Owner Tools" icon="construct-outline"/.test(s) &&
      /title="Reset" icon="refresh-outline"/.test(s)
    );
  })(),
  'every settings section header has a branded icon; logic + toggles untouched');

check('SwingLab hub: mockup-driven sections + Smart Motion hero + branded feature rows',
  // 2026-06-16 (Tim — mockup) — sectioned hierarchy: Smart Motion hero with a branded
  // feature row + the three intent sections. NOTE: the old AdvancedTile 48% grid was
  // refactored away in the hero-cleanup commits (5281eb7 / 9ae8cb2), so this asserts
  // the stable structure (hero + sections + feature rows), not the grid internals.
  (() => {
    const sl = read('app/(tabs)/swinglab.tsx');
    return (
      /function SmartMotionHero/.test(sl) &&
      /ANALYZE & IMPROVE/.test(sl) && /PRACTICE BETTER/.test(sl) && /PLAY SMARTER/.test(sl) &&
      /feature-smartmotion\.png/.test(sl) &&
      /Swing Analysis/.test(sl) && /Acoustic Detection/.test(sl) && /Body Mechanics/.test(sl)
    );
  })(),
  'sectioned layout: Smart Motion hero (branded feature row) + the three intent sections');

check('Course detail: API enrichment keeps the curated town (no location flap)',
  // 2026-06-16 (Tim — town flapped Temecula→Aguanga) — a bundled course keeps its
  // curated location + name; the API enrichment only updates layout.
  (() => /setCourse\(prev => \(prev \? \{ \.\.\.c, location: prev\.location, club_name: prev\.club_name \} : c\)\)/.test(read('app/course/[course_id].tsx')))(),
  'bundled course town no longer changes under the user a couple seconds after load');

check('Recap view-hole shows the saved static hole image when no shots logged',
  // 2026-06-16 (Tim — "view hole" was blank) — a bundled course shows the saved hole
  // image instead of a bare "no shots" screen when tracking dropped that round.
  (() => {
    const h = read('app/recap/hole/[round_id]/[hole].tsx');
    return /getLocalHoleImageById\(courseId, hole\) \?\? getLocalHoleImage\(courseName, hole\)/.test(h) && /staticHoleImage \?/.test(h);
  })(),
  'the hole view shows the static image (bundled course) instead of blank when no shots tracked');

check('Practice reps credited per club (honest volume, not distance)',
  // 2026-06-16 (Tim — "I swung clubs in practice, got no credit") — Smart Motion
  // swings add per-club REPS (volume), surfaced as PRACTICE VOLUME. Never fed to the
  // distance ladder (honesty: reps are not a measured carry).
  (() => {
    const store = read('store/clubStatsStore.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    const screen = read('app/practice/fit-profile.tsx');
    return (
      /addReps:/.test(store) && /repsFor:/.test(store) &&
      /reps: Partial<Record<ClubName, number>>/.test(store) &&
      /useClubStatsStore\.getState\(\)\.addReps\(cn, segsForAnalysis\.length/.test(sm) &&
      /PRACTICE VOLUME/.test(screen)
    );
  })(),
  'Smart Motion swings credit per-club reps; surfaced as PRACTICE VOLUME; never a distance');

check('Conversation ingestion → CNS foundation + save-routine unblocked',
  // 2026-06-13 — Tim: "ingest what the caddie says and the back-and-forth to learn."
  // The conversation log captures every caddie + user turn (the learning input),
  // and its lastCaddieText() is exactly what unblocks "save those stretches as my
  // routine" (there was no history to capture from before).
  (() => {
    const log = read('store/conversationLogStore.ts');
    const voice = read('services/voiceService.ts');
    const resp = read('services/localStatusResponder.ts');
    const prof = read('store/playerProfileStore.ts');
    return (
      // capture store: bounded turns + the join-the-last-caddie-run recall
      /export const useConversationLog = create/.test(log) &&
      /logCaddie:/.test(log) && /logUser:/.test(log) && /lastCaddieText:/.test(log) &&
      /MAX_TURNS = 60/.test(log) && /run\.join\(' '\)/.test(log) &&
      // both capture points hooked, best-effort
      /useConversationLog\.getState\(\)\.logCaddie\(text, Date\.now\(\)\)/.test(voice) &&
      /useConversationLog\.getState\(\)\.logUser\(text, Date\.now\(\)\)/.test(voice) &&
      // save/recall routine: round-INDEPENDENT (before the round gate), local+offline
      /if \(RX\.saveRoutine\.test\(t\)\)/.test(resp) &&
      /useConversationLog\.getState\(\)\.lastCaddieText\(\)/.test(resp) &&
      /setPreRoundRoutine\(last\)/.test(resp) &&
      /if \(RX\.recallRoutine\.test\(t\)\)/.test(resp) &&
      // the routine handlers sit ABOVE the "!round.isRoundActive" gate
      /RX\.recallRoutine[\s\S]*?if \(!round\.isRoundActive\)/.test(resp) &&
      // store field + setter
      /preRoundRoutine: string \| null/.test(prof) && /setPreRoundRoutine:/.test(prof)
    );
  })(),
  'every caddie/user turn is logged (bounded); "save those stretches as my routine" stores the last caddie line + recalls it, on or off the course');

check('Round history surfaces on the dashboard (Tim: "it doesn\'t go anywhere")',
  // 2026-06-13 — endRound already persisted a full RoundRecord to roundHistory,
  // but nothing rendered it as a browsable list. Golfshot-style: date · course ·
  // score · vs-par, tap → recap. The data was sound; this is the missing UI.
  (() => {
    const dash = read('app/(tabs)/dashboard.tsx');
    return (
      /Recent Rounds/.test(dash) &&
      /\[\.\.\.roundHistory\]\.reverse\(\)\.slice\(0, 6\)/.test(dash) &&
      /router\.push\(`\/recap\/\$\{r\.id\}`/.test(dash) &&      // tap → recap
      /r\.scoreVsPar === 0 \? 'E'/.test(dash) &&                // vs-par display
      /r\.courseName \?\? 'Round'/.test(dash) && /r\.holesPlayed/.test(dash)
    );
  })(),
  'completed rounds now show on the dashboard by date (course/score/vs-par), tappable into the recap — the persisted history finally has a home');

check('Scorecard shows the just-finished round after save (Tim reversed the 2026-06-13 clear)',
  // 2026-06-30 (Tim — Greenhill: "you end the round and can't see your scorecard") —
  // REVERSED the 2026-06-13 no-linger rule. With no ACTIVE round the scorecard shows
  // the MOST RECENT completed round for review; an active round always takes precedence.
  // (History: the old check asserted lastCompletedRound was stubbed to null.)
  (() => {
    const sc = read('app/(tabs)/scorecard.tsx');
    return (
      // most-recent completed round shown when idle; active round wins
      /isRoundActive \? null : \(roundHistory\.length \? roundHistory\[roundHistory\.length - 1\] : null\)/.test(sc) &&
      /const viewingRoundId = isRoundActive \? currentRoundId : lastCompletedRound\?\.id \?\? null/.test(sc) &&
      // real par resolution for the completed round (holePars snapshot → bundled → 4)
      /lastCompletedRound\.holePars/.test(sc)
    );
  })(),
  'with no active round the scorecard shows the just-finished round (Tim\'s Greenhill reversal); active round takes precedence; par resolves from the round\'s own snapshot');

check('Club usage is COMPLETE — clubless shots inferred from distance (Tim)',
  // 2026-06-13 — a shot with no tagged club used to be skipped, so any shot where
  // the club wasn't changed/stated never showed. Now the usage view infers the
  // club from the shot distance (display-only; the real bag stays confirmed-only)
  // and flags those rows ~est. Shots with neither club nor distance are skipped.
  (() => {
    const sc = read('app/(tabs)/scorecard.tsx');
    return (
      /clubStats\.inferClub\(d\)/.test(sc) &&                       // infer from distance
      /else return; \/\/ no club \+ no distance/.test(sc) &&        // honest skip when no signal
      /estimated: v\.estCount > 0 && v\.estCount === v\.count/.test(sc) && // flag fully-inferred clubs
      /item\.estimated \?/.test(sc) &&                              // surfaced ~est in the row
      /useClubStatsStore/.test(sc) &&
      // does NOT write back to the shot/bag — purely the usage aggregation
      !/setClub\(|recordShot\(/.test(sc)
    );
  })(),
  'every shot with a distance now counts in club usage (inferred club, marked ~est); the real bag model is untouched');

check('Caddie round summary carries to the dashboard Recent Rounds (Tim)',
  // 2026-06-13 — the recap (overall_kevin_summary) is stored per-round in
  // planStorage; the dashboard loads it for the visible rounds so each row shows
  // the caddie's read, not just the score. Recap generation has no completion gate
  // (caddie endRound: just `if (roundId)`), so partial rounds get a summary too.
  (() => {
    const dash = read('app/(tabs)/dashboard.tsx');
    return (
      /import \{ loadRecap \} from '\.\.\/\.\.\/services\/planStorage'/.test(dash) &&
      /rec\?\.overall_kevin_summary/.test(dash) &&
      /setRecapSummaries/.test(dash) &&
      /\(recapSummaries\[r\.id\] \|\| r\.summary\)/.test(dash) // surfaced on the row (recap or record summary)
    );
  })(),
  'each Recent Rounds row shows the caddie summary (loaded from planStorage); partial rounds included (no completion gate)');

check('Highlight swings: star an on-course SM swing → shows on the round scorecard (Tim)',
  // 2026-06-13 — full chain. (1) cageStore stamps the active-round context onto a
  // capture + has a starred flag + toggle. (2) the swing detail has a star toggle.
  // (3) the scorecard surfaces starred swings stamped with THIS round → tap → review.
  (() => {
    const store = read('store/cageStore.ts');
    const detail = read('app/swinglab/swing/[swing_id].tsx');
    const sc = read('app/(tabs)/scorecard.tsx');
    return (
      // foundation: round context stamped at ingest + starred + toggle
      /function roundContextStamp\(\)/.test(store) &&
      /roundId: r\.currentRoundId/.test(store) &&
      (store.match(/\.\.\.roundContextStamp\(\)/g) || []).length >= 2 && // both ingest paths
      /starred\?: boolean/.test(store) &&
      /toggleSessionStarred: \(sessionId\) =>/.test(store) && /starred: !session\.starred/.test(store) &&
      // star toggle on the swing detail
      /toggleSessionStarred\(session\.id\)/.test(detail) &&
      /session\.starred \? 'star' : 'star-outline'/.test(detail) &&
      // scorecard surfaces starred swings for THIS round, tap → review
      /x\.starred && x\.roundId === viewingRoundId/.test(sc) &&
      /highlightSwings\.length > 0 &&/.test(sc) &&
      /router\.push\(`\/swinglab\/swing\/\$\{sw\.id\}`/.test(sc)
    );
  })(),
  'on-course swing → star it → it appears on that round\'s scorecard as a highlight, tap opens the full review');

check('Retro: backfill caddie summaries onto past IN-APP rounds (not Golfshot imports)',
  // 2026-06-13 — Tim: retro the caddie summary for rounds played in the app, not
  // the Golfshot imports. backfillRoundSummaries sets a deterministic baseline on
  // in-app rounds lacking one; imports (id 'imported_…') are skipped; idempotent.
  (() => {
    const rs = read('store/roundStore.ts');
    const dash = read('app/(tabs)/dashboard.tsx');
    return (
      /backfillRoundSummaries: \(\) =>/.test(rs) &&
      /r\.summary \|\| r\.id\.startsWith\('imported_'\)/.test(rs) && // skip done + imports
      /through \$\{r\.holesPlayed\} hole/.test(rs) &&                // deterministic from saved record
      /return changed \? \{ roundHistory: updated \} : \{\}/.test(rs) && // idempotent (no churn)
      /summary\?: string/.test(rs) &&                                // RoundRecord field
      // dashboard runs it once + shows record summary as the fallback
      /useRoundStore\.getState\(\)\.backfillRoundSummaries\(\)/.test(dash) &&
      /recapSummaries\[r\.id\] \|\| r\.summary/.test(dash)
    );
  })(),
  'past in-app rounds get a deterministic caddie summary on the dashboard; Golfshot imports excluded; idempotent');

check('Course bag optimizer Part A — per-course club usage (Tim)',
  // 2026-06-13 — which clubs you actually use AT THIS COURSE, across past in-app
  // rounds there (Golfshot imports excluded). The Menifee insight + the spine for
  // the future recommend-a-bag-for-this-course brain function. "Forming" until 2+.
  (() => {
    const sc = read('app/(tabs)/scorecard.tsx');
    return (
      /r\.courseId === activeCourseId && !r\.id\.startsWith\('imported_'\)/.test(sc) && // by course, no imports
      /const courseClubUsage: ClubAgg\[\] = useMemo/.test(sc) &&
      /YOUR BAG · \{activeCourse\.toUpperCase\(\)\}/.test(sc) &&
      /see action here/.test(sc) &&
      /pattern still forming/.test(sc) // honest until enough rounds
    );
  })(),
  'a "Your bag · <course>" section shows the clubs you actually use at the active course, forming until 2+ rounds — the spine for course-specific bag planning');

check('Course bag optimizer Part B1 — gap detection + idle clubs (Tim)',
  // 2026-06-13 — the brain read built ON Part A: for a course you've PLAYED,
  // flag clubs that sit idle (swap candidates) and the distance GAPS you keep
  // facing with no club that fits ("put your hybrid back in"). Pure/offline.
  (() => {
    // Two rounds at "Menifee": player uses Driver(250), 7I(150), PW(110) — leaving
    // a wide hole between the 7I and the Driver, and never touching the 4H they own.
    const shots = [
      { club: 'Driver', distance_yards: 250, hole: 1, timestamp: 1, feel: null, direction: null, shape: null, acousticContact: null },
      { club: '7I', distance_yards: 150, hole: 2, timestamp: 2, feel: null, direction: null, shape: null, acousticContact: null },
      { club: 'PW', distance_yards: 110, hole: 3, timestamp: 3, feel: null, direction: null, shape: null, acousticContact: null },
      { club: '7I', distance_yards: 152, hole: 4, timestamp: 4, feel: null, direction: null, shape: null, acousticContact: null },
    ] as any[];
    const rec = composeBagRecommendation({
      courseName: 'Menifee',
      shots,
      roundsPlayed: 2,                       // past the forming threshold
      clubDistances: { Driver: 250, '4H': 180, '7I': 150, PW: 110 },
      ownedClubs: ['Driver', '4H', '7I', 'PW', 'Putter'],
      inferClub: (y: number) => (y > 200 ? 'Driver' : y > 130 ? '7I' : 'PW'),
    });
    const gap100 = rec.gaps.find(g => g.lowClub === '7I' && g.highClub === 'Driver');
    return (
      rec.forming === false &&                                   // 2 rounds = confident
      rec.idle.includes('4H') &&                                 // owned but never used here
      !!gap100 && gap100.gapYards === 99 &&                      // 250 − 151 (7I avg of 150/152)
      /4H/.test(gap100.suggestion) &&                            // suggests the benched 4H (closest to ~200y centre)
      rec.headline.includes('Menifee')                          // answer-first, names the course
    );
  })(),
  'for a played course, the brain flags idle clubs and the carry gaps you keep facing, suggesting the benched club that fills each gap — Part B1 of the bag optimizer');

check('SmartTrace capture seam — vision-camera staged behind a default-off flag (Tim)',
  // 2026-06-13 — Stage 0 of the expo-camera → vision-camera swap that feeds
  // SmartTrace. Invariants that keep the swap SAFE: the flag is OFF by default (the
  // working expo-camera path stays the default until a vision build is proven), the
  // vision camera records VIDEO-ONLY so it never competes with the acoustic impact
  // recording for the mic, and it prefers a HIGH frame rate for the launch window.
  (() => {
    const flags = read('services/capture/captureFlags.ts');
    const cam = read('components/capture/SwingVisionCamera.tsx');
    const store = read('store/captureEngineStore.ts');
    return (
      /export const DEFAULT_USE_VISION_CAMERA = false/.test(flags) && // default off = no regression
      /useVisionCamera: DEFAULT_USE_VISION_CAMERA/.test(store) &&     // runtime toggle seeds from the off default
      /PREFERRED_CAPTURE_FPS = \d+/.test(flags) &&                    // a real high-fps target
      /audio=\{false\}/.test(cam) &&                                 // off the mic — protects the acoustic anchor
      /recordAsync\(/.test(cam) && /stopRecording\(\)/.test(cam) &&  // mimics CameraView's ref API (drop-in)
      /useCameraFormat/.test(cam)                                    // picks the device's high-fps format
    );
  })(),
  'the vision-camera capture path is added behind a default-off flag, records video-only to keep the acoustic mic clean, and mirrors CameraView so the swing-path swap is a safe drop-in (SmartTrace Stage 0)');

check('SmartTrace Stage 1 wiring — swing path gated on the flag, expo-camera preserved (Tim)',
  // The swing camera in smartmotion now branches on USE_VISION_CAMERA: flag ON →
  // SwingVisionCamera (same cameraRef), flag OFF → the unchanged expo-camera
  // CameraView. So one build tests both: default-off = zero regression, dev-on =
  // vision recording. The same cameraRef drives both (recordAsync/stopRecording).
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      /useCaptureEngineStore/.test(sm) &&                    // reads the runtime toggle
      /useVisionCamera && SwingVisionCamera \? \(/.test(sm) && // flag-gated branch (lazy, OTA-safe)
      /require\('\.\.\/\.\.\/components\/capture\/SwingVisionCamera'\)/.test(sm) && // lazy require, not static import
      /<SwingVisionCamera/.test(sm) &&                       // vision path mounted when on
      /<CameraView/.test(sm) &&                              // expo-camera path still present when off
      /ref=\{cameraRef/.test(sm)                             // one ref drives both engines
    );
  })(),
  'smartmotion mounts the vision camera only when the runtime capture-engine toggle is on and keeps the expo-camera CameraView as the default-off path, both driven by the same cameraRef — one build A/B-tests both engines (SmartTrace Stage 1)');

check('SmartTrace confidence-tiered read — degrades, never goes dark (Tim)',
  // 2026-06-13 — the trace was binary (no departure → nothing). composeSmartTrace
  // tiers it: ball seen → flight direction; no flight but a real strike → "STRUCK"
  // + an honest flag; neither → an honest "no read". For beginners, not tour pros.
  (() => {
    const flight = composeSmartTrace({ isPutt: false, isDownTheLine: true, direction: { side: 'left', divergenceDeg: 12 }, strikeDetected: true, tempoRatio: 3.1 });
    const contact = composeSmartTrace({ isPutt: false, isDownTheLine: true, direction: null, strikeDetected: true, tempoRatio: 3.0 });
    const none = composeSmartTrace({ isPutt: false, isDownTheLine: true, direction: null, strikeDetected: false, tempoRatio: null });
    const putt = composeSmartTrace({ isPutt: true, isDownTheLine: false, direction: null, strikeDetected: true, tempoRatio: null });
    return (
      flight.tier === 'flight' && flight.badge === '12° L' && flight.note === null &&   // full read, no false flag
      contact.tier === 'contact' && contact.badge === 'STRUCK' && !!contact.note &&     // never dark: strike surfaced + flagged
      contact.confidence < flight.confidence &&                                          // honestly less certain
      none.tier === 'none' && none.badge === null && !!none.note &&                      // honest no-read, still a nudge
      putt.tier === 'none' && putt.badge === null && putt.note === null                  // not this surface's job (no false flag)
    );
  })(),
  'composeSmartTrace returns a flight read when the ball is seen, a flagged "STRUCK" contact read when only a strike fired, and an honest no-read otherwise — degrading instead of going dark (SmartTrace confidence tiers)');

// 2026-07-07 (Tim — "shot tracing that actually lines up on the user") — the ball trace
// drifted off the ball because CV points are FRAME-normalized but were drawn in the
// COVER video's CONTAINER space with no aspect compensation, and the divergence angle
// was computed across the two spaces. frameToContainerNorm reconciles them; smartmotion
// maps every CV point (departure + ball-path) through it before the trace math.
check('Overlay registration: CV points mapped frame→container before the trace math',
  (() => {
    // Numeric truth — the audit's worked example (1080×1920 clip on a 1080×2400 screen,
    // COVER): a frame edge point x=1 must land at container x=1.125; center stays center.
    const fAR = 1080 / 1920, cAR = 1080 / 2400;
    const edge = frameToContainerNorm({ x: 1, y: 1 }, fAR, cAR, 'cover');
    const center = frameToContainerNorm({ x: 0.5, y: 0.5 }, fAR, cAR, 'cover');
    const rt = containerToFrameNorm(frameToContainerNorm({ x: 0.8, y: 0.3 }, fAR, cAR, 'cover'), fAR, cAR, 'cover');
    const identity = frameToContainerNorm({ x: 0.9, y: 0.2 }, 0.5625, 0.5625, 'cover'); // same aspect → no-op
    const mathOk =
      Math.abs(edge.x - 1.125) < 1e-9 && Math.abs(edge.y - 1) < 1e-9 &&
      Math.abs(center.x - 0.5) < 1e-9 && Math.abs(center.y - 0.5) < 1e-9 &&
      Math.abs(rt.x - 0.8) < 1e-9 && Math.abs(rt.y - 0.3) < 1e-9 &&
      Math.abs(identity.x - 0.9) < 1e-9 && Math.abs(identity.y - 0.2) < 1e-9;
    // Wiring — smartmotion converts CV points through cvToContainer before the trace math,
    // and both detectors surface the source frame dims.
    const sm = read('app/swinglab/smartmotion.tsx');
    const wired =
      /frameToContainerNorm/.test(sm) &&
      /cvToContainer\(ballDeparture\.departurePoint\)/.test(sm) &&
      /ballPathPoints\.map\(cvToContainer\)/.test(sm) &&
      /frameW/.test(read('services/swing/ballDeparture.ts')) &&
      /frameW/.test(read('services/swing/ballPath.ts'));
    return mathOk && wired;
  })(),
  'the frame→container transform is numerically correct (edge x=1 → 1.125, center fixed, round-trip exact, same-aspect no-op) and smartmotion maps every CV point through it before drawing/measuring — the trace lands on the ball and the divergence isn\'t computed across two coordinate spaces');

// 2026-07-07 (Tim — REAL clubhead swing arc, not the wrist) — a vision pass locates the
// CLUBHEAD across the swing frames (same honest pattern as ball-path: null where blurred,
// never guessed). The overlay draws through the DETECTED points (with a dot at each real
// detection) and only when there are enough of them; otherwise it keeps the honest
// hand/tempo trace. No fabricated club path.
check('Real clubhead arc: detected-only, honestly gated, wired end-to-end',
  (() => {
    const ep = read('api/club-path.ts');
    const svc = read('services/swing/clubPath.ts');
    const ov = read('components/swinglab/SwingBodyOverlay.tsx');
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      // Endpoint: locate the CLUBHEAD, return null per-frame it can't clearly see, never guess.
      /report_club_path/.test(ep) &&
      /CLUBHEAD/.test(ep) &&
      /return null for that frame/.test(ep) &&
      // Server not configured → honest not-configured (client keeps the hand trace).
      /configured: false/.test(ep) &&
      // Client service: swing-wide sampling, drops undetected frames, surfaces frame dims.
      /export async function detectClubPath/.test(svc) &&
      // Overlay: draws the club arc ONLY with enough real points, else the wrist proxy.
      /MIN_CLUB_POINTS/.test(ov) &&
      /clubArc && clubArc\.length >= MIN_CLUB_POINTS/.test(ov) &&
      /clubDots/.test(ov) &&
      // smartmotion runs it on the Motion step + passes it to the overlay.
      /detectClubPath\(/.test(sm) &&
      /clubArc=\{clubArcPoints\}/.test(sm) &&
      // Routed.
      /"\/api\/club-path"/.test(read('vercel.json'))
    );
  })(),
  'the clubhead arc is drawn through ACTUALLY-DETECTED clubhead positions (dotted at each real detection), gapped/absent when detection is thin, and falls back to the honest hand/tempo trace — a legitimate club path, never a fabricated one');

// 2026-07-07 (Tim — Hotel Mode) — phone-in-hand tempo from the gyroscope. The detector
// must (a) read a clean synthetic swing set with the right tempo shape, (b) read putts
// with the accel/decel through-stroke call, and (c) NEVER fabricate reps from hand
// jitter. Runs the REAL detector on synthetic 100Hz signals.
check('Hotel Mode: gyro rep detector reads swings + putts, never fabricates from jitter',
  (() => {
    const synth = (det: IndoorRepDetector, t0: number, backMs: number, downMs: number, peakBack: number, peakDown: number): { rep: IndoorRep | null; tEnd: number } => {
      let rep: IndoorRep | null = null;
      const dt = 10; let t = t0;
      for (let i = 0; i < 30; i++) { rep = det.onSample({ t, x: 0.02, y: 0.01, z: 0 }) ?? rep; t += dt; }
      const nb = Math.round(backMs / dt);
      for (let i = 0; i <= nb; i++) { rep = det.onSample({ t, x: Math.sin((i / nb) * Math.PI) * peakBack + 0.01, y: 0.02, z: 0 }) ?? rep; t += dt; }
      const nd = Math.round(downMs / dt);
      for (let i = 0; i <= nd; i++) { rep = det.onSample({ t, x: -Math.sin((i / nd) * (Math.PI / 2)) * peakDown, y: 0.02, z: 0 }) ?? rep; t += dt; }
      for (let i = 0; i < 60; i++) { rep = det.onSample({ t, x: -Math.max(0, peakDown * (1 - i / 25)), y: 0.01, z: 0 }) ?? rep; t += dt; }
      return { rep, tEnd: t };
    };
    // (a) 5 swings ~900/300ms → all detected, tempo in a sane band, high consistency.
    const det = new IndoorRepDetector('swing');
    let t = 0; const reps: IndoorRep[] = [];
    for (let k = 0; k < 5; k++) { const r = synth(det, t, 900 + k * 20, 300, 3, 8); if (r.rep) reps.push(r.rep); t = r.tEnd + 500; }
    const sum = summarizeIndoorReps(reps, 'swing');
    const swingsOk = reps.length === 5 && sum.avgTempo != null && sum.avgTempo > 2.2 && sum.avgTempo < 3.4 && (sum.consistency ?? 0) >= 80;
    // (b) putts detected with the through-stroke read present.
    const dp = new IndoorRepDetector('putt');
    t = 0; const preps: IndoorRep[] = [];
    for (let k = 0; k < 4; k++) { const r = synth(dp, t, 600, 300, 0.8, 1.2); if (r.rep) preps.push(r.rep); t = r.tEnd + 400; }
    const puttsOk = preps.length === 4 && preps.every((r) => r.throughStroke === 'accelerating' || r.throughStroke === 'decelerating');
    // (c) sub-threshold hand jitter must create ZERO reps.
    const dn = new IndoorRepDetector('swing');
    let noise = 0;
    for (let i = 0; i < 2000; i++) { if (dn.onSample({ t: i * 10, x: (((i * 7919) % 100) / 100 - 0.5) * 0.8, y: (((i * 104729) % 100) / 100 - 0.5) * 0.8, z: 0 })) noise++; }
    // Wiring: hub card + screen + CNS/points crediting present.
    const scr = read('app/swinglab/indoor.tsx');
    const wired = /route: '\/swinglab\/indoor'/.test(read('app/(tabs)/swinglab.tsx')) &&
      /recordSwingMetrics/.test(scr) && /awardPracticePoints/.test(scr) && /no ball flight is claimed indoors/i.test(scr);
    return swingsOk && puttsOk && noise === 0 && wired;
  })(),
  'the real IndoorRepDetector reads 5/5 synthetic swings (sane tempo, ≥80 consistency) and 4/4 putts with an accel/decel call, produces ZERO reps from hand jitter, and the screen is wired to the hub + points + CNS with the honest no-ball-flight label');

// 2026-07-08 (segmentation audit #1/#3/#4/#5/#8) — the 1/3/5 count bar. Runs the REAL
// filterReboundStrikes on synthetic strike sets + verifies the session-token/dedupe
// wiring, the cage fallback keeping acoustic anchors, and earliest-peak debounce.
check('Segmentation: rebounds filtered, sessions can\'t cross-poison, anchors kept',
  (() => {
    // (a) A real strike + a net thud 1.2s later = ONE swing (the real strike's time
    //     kept); three clean swings 6s apart = THREE.
    const mk = (timeMs: number, peakDb: number, confidence: 'high' | 'medium' | 'low') => ({ timeMs, peakDb, confidence, attackMs: 40 } as never);
    const withRebound = filterReboundStrikes([mk(1000, -8, 'high'), mk(2200, -12, 'low'), mk(8000, -9, 'high')]);
    const clean3 = filterReboundStrikes([mk(1000, -8, 'high'), mk(7000, -9, 'high'), mk(13000, -7, 'medium')]);
    const reboundsOk = withRebound.length === 2 && withRebound[0].timeMs === 1000 && clean3.length === 3;
    // (b) merge separation scales with the coarse frame interval on long clips.
    const scaled = /mergeSwingDetections\(raw, Math\.max\(2\.5, frameIntervalSec\)\)/.test(read('services/poseDetection.ts'));
    // (c) session token + in-flight dedupe on the per-swing analysis cache.
    const sm = read('app/swinglab/smartmotion.tsx');
    const tokenOk = /sessionRunRef\.current !== myRun\) return null/.test(sm) &&
      /analysisInflightRef\.current\[idx\] = job/.test(sm) &&
      (sm.match(/sessionRunRef\.current \+= 1/g) ?? []).length >= 2;
    // (d) cage fallback keeps acoustic anchors; cage strikes rebound-filtered.
    const anchorsOk = /acousticStrikes\.length > 0\s*\n\s*\? correlateStrikesWithVideo\(acousticStrikes, swings, durMs\)/.test(sm) &&
      /filterReboundStrikes\(res\.strikes\)/.test(sm);
    // (e) detector debounce keeps the EARLIEST peak (impact, not the louder net hit).
    const earliestOk = /same strike group — the earlier peak \(impact\) already kept/.test(read('services/swing/strikeDetector.ts'));
    return reboundsOk && scaled && tokenOk && anchorsOk && earliestOk;
  })(),
  'a net/floor rebound 0.5-2.5s after impact never becomes a phantom swing; long-clip locate merges at the real frame interval; an in-flight read can\'t poison the next session\'s cache (token + dedupe); the cage video fallback keeps the real acoustic strike; debounce keeps the earliest (impact) peak');

// 2026-07-08 (cage acoustic audit) — calibration must be able to make the cage MORE
// sensitive (not only stricter) and must NOT silently under-detect at a different venue.
check('Cage calibration: env-gated + can lower the bar, not just raise it',
  (() => {
    const cal = read('store/acousticCalibrationStore.ts');
    const calScreen = read('app/swinglab/calibrate.tsx');
    const det = read('services/acousticImpactDetector.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    const api = read('services/acousticDetectApi.ts');
    return (
      // #2 — calibrate detects at the LIVE 18dB basis (was default 30 → always ≥18);
      // applied offset clamped to a two-sided band so it CAN go below 18.
      /thresholdDb: TRANSIENT_THRESHOLD_DB/.test(calScreen) &&
      /Math\.max\(8, Math\.min\(30, Math\.round\(span \* 0\.6\)\)\)/.test(cal) &&
      // #1 — env stamped on the applied calibration + captured session, and BOTH the
      // native detector and the post-hoc path gate on the indoor/outdoor env class.
      /env: sess\.env \?\? null/.test(cal) &&
      /const envClass = /.test(det) && /envClass\(applied\.env\) === envClass\(curEnv\)/.test(det) &&
      /calOk \? appliedCalibration\?\.transientThresholdDb : undefined/.test(sm) &&
      // #3 — real floor stashed for honest telemetry (not threshold−18).
      /ts: Date\.now\(\), noiseFloor \}/.test(det) &&
      // #4 — client keeps the real payload when speed is null (honest server contract).
      /ball_speed_mph: number \| null/.test(api) &&
      /typeof data\.impact_ms !== 'number'\) return null/.test(api)
    );
  })(),
  'calibration derives at the live 18dB basis so a distant mic can LOWER the threshold (not only raise it), is trusted only when its indoor/outdoor env class matches where you are now (a quiet-room calibration never zeroes out detection at a loud venue), reports the real noise floor, and the ball-speed client keeps the real cage-distance payload when speed is null');

check('Open Range quantifier — makes the mash visible + flags blocked practice (Tim+Tank)',
  // 2026-06-13 — Tank's "5 of 60" made real. summarizeOpenRange judges line ONLY on
  // swings where flight was seen (honest), reports tempo REPEATABILITY (not a
  // fabricated grade), and flags the blocked-practice anti-pattern (one club
  // dominating a long session) — the differentiator a range bucket can't give.
  (() => {
    // 40-ball mash: 32 with the 7I (blocked), flight seen on 10 (5 on line), then a
    // varied session that must NOT trip the blocked-practice flag.
    const mash: any[] = [];
    for (let i = 0; i < 32; i++) mash.push({ club: '7I', tier: i < 10 ? 'flight' : 'contact', tempoRatio: 3.0, divergenceDeg: i < 10 ? (i % 2 ? 3 : 14) : null });
    for (let i = 0; i < 8; i++) mash.push({ club: 'PW', tier: 'contact', tempoRatio: 3.1, divergenceDeg: null });
    const m = summarizeOpenRange(mash);

    const varied = ['7I', 'PW', 'Driver', '9I', '5I'].flatMap((c) =>
      Array.from({ length: 3 }, () => ({ club: c, tier: 'flight' as const, tempoRatio: 3.0, divergenceDeg: 4 })));
    const v = summarizeOpenRange(varied);

    return (
      m.total === 40 && m.flightSeen === 10 && m.onLine === 5 &&        // line judged only among seen flights
      m.onLinePct === 0.5 &&
      !!m.blockedPractice && m.blockedPractice.club === '7I' && m.blockedPractice.pct === 80 && // anti-pattern flagged
      m.insights.some((x) => /transfers worst|switch clubs/.test(x)) && // Tank's nudge surfaces
      v.blockedPractice === null &&                                     // varied practice NOT flagged
      summarizeOpenRange([]).total === 0                                // empty-safe
    );
  })(),
  'summarizeOpenRange quantifies a range session honestly (line only where flight was seen, tempo repeatability) and flags one-club blocked practice with a switch-clubs nudge, while leaving varied practice unflagged (Open Range quantifier)');

check('Practice-session primitive — stamps Smart Motion swings, no-ops when inactive (Tim)',
  // 2026-06-13 — the container the Practice Engine rides on: swings carry a
  // practiceSessionId (roundContextStamp pattern). The stamp helper no-ops with no
  // active session, so Smart Motion calls it unconditionally; active → it tallies.
  (() => {
    const store = usePracticeSessionStore.getState();
    // No session → stamp is a safe no-op.
    recordPracticeSwingIfActive({ club: '7I', tier: 'flight', tempoRatio: 3.0, divergenceDeg: 4 });
    const noneYet = usePracticeSessionStore.getState().active;

    store.startSession('open_range', { environment: 'range' });
    recordPracticeSwingIfActive({ club: '7I', tier: 'flight', tempoRatio: 3.0, divergenceDeg: 3 });
    recordPracticeSwingIfActive({ club: '7I', tier: 'contact', tempoRatio: 3.1, divergenceDeg: null });
    const live = usePracticeSessionStore.getState().activeSummary();

    usePracticeSessionStore.getState().endSession();
    const after = usePracticeSessionStore.getState();
    const ok = (
      noneYet === null &&                                  // stamp before start did nothing
      !!live && live.total === 2 && live.flightSeen === 1 && // tallied only the in-session swings
      after.active === null &&                              // ended
      after.history.length >= 1 && after.history[0].swings.length === 2 // archived with its swings
    );
    // Reset so the persisted store doesn't leak into other scenarios.
    usePracticeSessionStore.setState({ active: null, history: [] });
    return ok;
  })(),
  'a practice session stamps each analyzed Smart Motion swing into the active session and aggregates a live read, the stamp helper no-ops when no session is running, and ending archives the session to history (practice-session primitive)');

check('Session Runner planner — interleaves instead of a blocked grind (Tim+Tank)',
  // 2026-06-13 — a focus knows what today is (irons/short game/driver/...) and the
  // planner lays out an INTERLEAVED sequence: multi-club focuses rotate clubs in
  // small blocks; single-club focuses rotate the TARGET. Never one long one-club
  // grind — the structure that actually transfers (the opposite of the mash).
  (() => {
    const irons = getFocus('irons');
    const driverSpeed = getFocus('driver_speed');
    if (!irons || !driverSpeed) return false;

    const ironPlan = buildInterleavedPlan(irons, 8);
    const ironClubs = ironPlan.map((r) => r.club);
    const rotatesClubs = new Set(ironClubs).size > 1;            // not a one-club grind
    const blocksOfTwo = ironClubs[0] === ironClubs[1] && ironClubs[1] !== ironClubs[2]; // blockSize 2
    const switchCount = ironPlan.filter((r) => r.switchClub).length;

    const drvPlan = buildInterleavedPlan(driverSpeed, 6);
    const oneClub = new Set(drvPlan.map((r) => r.club)).size === 1; // single-club focus
    const variedTargets = new Set(drvPlan.map((r) => r.targetCue)).size > 1; // ...but targets rotate

    return (
      PRACTICE_FOCUSES.length >= 6 &&                            // irons/short game/driver x2/hands/putting
      ironPlan.length === 8 && rotatesClubs && blocksOfTwo && switchCount >= 3 &&
      isInterleaved(ironPlan, irons) &&
      oneClub && variedTargets && isInterleaved(drvPlan, driverSpeed) &&
      buildInterleavedPlan(irons, 0).length === 0               // empty-safe
    );
  })(),
  'the Session Runner offers focus presets and builds an interleaved plan — multi-club focuses rotate clubs in small blocks, single-club focuses rotate targets — never a blocked one-club grind (Practice Engine session planner)');

check('Open Range surface wired — Smart Motion stamps, screen + entry point exist (Tim)',
  // 2026-06-13 — the Practice Engine reaches the user: smartmotion stamps each
  // analyzed swing into the active session (no-op outside practice), the Open Range
  // screen shows the live read, and there's a tools-menu entry to reach it. Pure
  // JS so it ships OTA over any build.
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    const screen = read('app/practice/open-range.tsx');
    const layout = read('app/_layout.tsx');
    const caddie = read('app/(tabs)/caddie.tsx');
    return (
      // 2026-07-04 (drift reconcile) — the sample is built above the call now.
      /recordPracticeSwingIfActive\(sample\)/.test(sm) &&           // smartmotion stamps swings
      /stampedClipsRef\.current\.has\(clipUri\)/.test(sm) &&        // exactly-once per clip
      /summarizeOpenRange\(active\.swings\)/.test(screen) &&        // screen shows the live read
      /name="practice\/open-range"/.test(layout) &&                // route registered
      // 2026-07-04 (elite-clean) — the old caddie.tsx entry lived inside the DEAD
      // Quick Tools FAB (users never saw it; now deleted). The LIVE entries are the
      // SwingLab hub card + voice (open_range → navigate).
      /\/practice\/open-range/.test(read('app/(tabs)/swinglab.tsx')) &&
      /open_range: \{ type: 'navigate', path: '\/practice\/open-range' \}/.test(read('services/intents/openToolHandler.ts'))
    );
  })(),
  'smartmotion stamps each analyzed swing into the active practice session (exactly-once, inert outside practice), and the Open Range screen + tools-menu entry surface the live honest read (Practice Engine surface wired, OTA-able)');

check('Structured Session Runner UI — focus picker + auto-advancing interleaved run (Tim)',
  // 2026-06-13 — pick a focus → a 'focus' session with a targetReps plan; the runner
  // shows the current rep (club + cue) and AUTO-ADVANCES as swings stamp in
  // (currentRep = swings recorded), completing at targetReps. Pure JS, OTA-able.
  (() => {
    const screen = read('app/practice/session.tsx');
    const layout = read('app/_layout.tsx');
    const caddie = read('app/(tabs)/caddie.tsx');
    const store = read('store/practiceSessionStore.ts');
    return (
      /buildInterleavedPlan\(focus, total\)/.test(screen) &&        // builds the interleaved plan
      /plan\[done\]/.test(screen) &&                                // current rep = swings recorded (auto-advance)
      /startSession\('focus'/.test(screen) &&                       // focus session
      /targetReps/.test(store) && /targetReps/.test(screen) &&      // plan length carried on the session
      /name="practice\/session"/.test(layout) &&                    // route registered
      // 2026-07-04 (elite-clean) — the caddie.tsx entry lived inside the DEAD Quick
      // Tools FAB (deleted). Live entries: SwingLab hub card + voice.
      /\/practice\/session/.test(read('app/(tabs)/swinglab.tsx')) &&
      /focus_session: \{ type: 'navigate', path: '\/practice\/session' \}/.test(read('services/intents/openToolHandler.ts'))
    );
  })(),
  'the structured Session Runner lets you pick a focus and walks an interleaved plan that auto-advances as Smart Motion swings stamp in, completing at the target rep count (Practice Engine Session Runner UI)');

check('Goal planner (SmartPlan) — weights to where strokes live + adapts to location (Tank)',
  // 2026-06-13 — Tank's "break 90 in 60 days, N days/week, range or carpet+glass at
  // home → break it down." Weights focuses to where strokes are (scoring goals →
  // short game + putting), filters by LOCATION (home = putting/chipping only), never
  // promises an outcome, and returns an honest note when a goal can't be done there.
  (() => {
    const b90 = buildGoalPlan({ goal: 'break_90', daysPerWeek: 3, minutesPerSession: 60, location: 'full', deadlineDays: 60 });
    const home = buildGoalPlan({ goal: 'break_90', daysPerWeek: 4, minutesPerSession: 20, location: 'home' });
    const distHome = buildGoalPlan({ goal: 'more_distance', daysPerWeek: 3, minutesPerSession: 30, location: 'home' });
    const scoringFocus = b90.sessions.map((s) => s.focusKey);
    return (
      PRACTICE_GOALS.length >= 5 &&
      b90.sessions.length === 3 &&
      scoringFocus.includes('short_game') && scoringFocus.includes('putting') && // scoring zone weighted
      b90.notes.some((n) => /days out|no promises|stroke/i.test(n)) &&            // honest framing, no guarantee
      home.sessions.length === 4 && home.sessions.every((s) => s.focusKey === 'putting' || s.focusKey === 'short_game') && // location-filtered
      distHome.sessions.length === 0 && distHome.notes.some((n) => /full swings/.test(n)) // can't be done at home → honest, not a fake plan
    );
  })(),
  'buildGoalPlan turns a goal + days/week + minutes + location into a weighted weekly plan — scoring goals lean on short game and putting, home filters to putting/chipping, distance-at-home returns an honest "needs full swings" instead of a fake plan, and it never promises an outcome (SmartPlan goal planner)');

check('SmartPlan UI — goal+constraints picker that runs a day through the Session Runner (Tim)',
  // 2026-06-13 — the SmartPlan brain reaches the user: pick goal/days/minutes/where,
  // see the weighted weekly plan, tap a day to launch it as a focus session. Pure JS,
  // OTA-able. Simplified Sophistication: chip rows + a plan, depth in the brain.
  (() => {
    const screen = read('app/practice/smartplan.tsx');
    const layout = read('app/_layout.tsx');
    const caddie = read('app/(tabs)/caddie.tsx');
    return (
      /buildGoalPlan\(\{ goal, daysPerWeek: days, minutesPerSession: minutes, location \}\)/.test(screen) &&
      /startSession\('focus', \{ focus: focusKey, targetReps: reps/.test(screen) && // tap a day → run it
      /\/practice\/session/.test(screen) &&                        // launches the Session Runner
      /name="practice\/smartplan"/.test(layout) &&                 // route registered
      // 2026-07-04 (elite-clean) — the caddie.tsx entry lived inside the DEAD Quick
      // Tools FAB (deleted). Live entries: SwingLab hub card + voice.
      /\/practice\/smartplan/.test(read('app/(tabs)/swinglab.tsx')) &&
      /smartplan: \{ type: 'navigate', path: '\/practice\/smartplan' \}/.test(read('services/intents/openToolHandler.ts'))
    );
  })(),
  'the SmartPlan screen lets you set goal + days/week + minutes + location, shows the weighted weekly plan, and launches any day through the Session Runner as a focus session (SmartPlan UI, OTA-able)');

// 2026-07-07 (Tim — SmartPump third rail) — imported golf-workout volume becomes a
// third dashboard correlation rail (training → performance), ingested from a
// date-stamped export (PDF/image AI-parsed, JSON/CSV on-device), deduped + persisted
// + backed up. End-to-end wired: store → builder → dashboard card → ingest → route.
check('SmartPump third rail: workout import → TRAINING → PERFORMANCE dashboard card',
  (() => {
    const dash = read('app/(tabs)/dashboard.tsx');
    return (
      // Store exists + is on the backup allowlist (survives a phone swap).
      /addWorkouts/.test(read('store/workoutStore.ts')) &&
      /'workout-store-v1'/.test(read('services/cloudSync/snapshot.ts')) &&
      // Pure weekly-bucket builder, honest (association not causation).
      /export function computeWorkoutPerformance/.test(read('services/practice/workoutPerformance.ts')) &&
      // Dashboard reads the store, builds the series, and renders the third card.
      /useWorkoutStore/.test(dash) &&
      /computeWorkoutPerformance/.test(dash) &&
      /TRAINING → PERFORMANCE/.test(dash) &&
      // Ingest service + settings entry point + server route all present.
      /ingestSmartPumpExport/.test(read('services/smartPumpIngest.ts')) &&
      /ingestSmartPumpExport/.test(read('app/settings.tsx')) &&
      /\/api\/workout-import/.test(read('services/smartPumpIngest.ts')) &&
      /"\/api\/workout-import"/.test(read('vercel.json'))
    );
  })(),
  'a SmartPump golf-workout export imports (deduped, persisted, backed up) and drives a third dashboard rail correlating training volume vs. scoring — honest, quiet until enough data');

// 2026-07-07 (Tim — chunk honesty PROPAGATED) — the deep SwingLab audit found the badge
// fix reached only ONE consumer; every other swing-judge still read motion-only faults.
// This locks the contact signal into ALL of them: saved report, per-swing row, drill
// verdict, CNS learning, spoken narration.
check('Chunk honesty propagates to every swing-judge (not just the live badge)',
  (() => {
    const drill = read('services/drillVerdict.ts');
    return (
      // Shared contact helper reused everywhere (single source of truth).
      /function deriveContact\(/.test(smSrc) &&
      /function contactIssue\(/.test(smSrc) &&
      // Saved report: a contact mishit / no-launch OVERRIDES the motion classification.
      /const primaryIssue: PrimaryIssue = contactIssue\(contact\)/.test(smSrc) &&
      // CNS learns the evidence-gated / contact fault, NOT the 'none'-biased detected_issue.
      /recordSwingFault\(\{ fault: learnedFault/.test(smSrc) &&
      /contactMishitFaultId\(contact\.reportedMishit\)/.test(smSrc) &&
      // Multi-swing report re-persists over the COMPLETE cache (was swing-0 only).
      /F2\b/.test(smSrc) &&
      // Spoken narration + summary carry per-swing contact so they match the badge.
      /deriveVerdict\(a, false, deriveContact\(a\)\)/.test(smSrc) &&
      // Drill Check never grades a mishit 'got_it'.
      /contactMishit\?: 'fat' \| 'thin' \| 'topped' \| null/.test(drill) &&
      /can't credit the \$\{drill\} yet/.test(drill) &&
      // Per-swing library row labels a fat strike instead of "no clear issue".
      /contactLabel/.test(read('app/swinglab/swing/[swing_id].tsx')) &&
      // Metric honesty: a handicap-table lookup shows "—", not a fake per-swing number.
      /isSwingDerived/.test(smSrc)
    );
  })(),
  'the contact signal (feel/ball-departure/contact_read) reaches the saved report, per-swing row, drill verdict, CNS, and narration — a chunk is never called clean on any surface, and lookup-only metrics render "—"');

check('Verdict no longer claims ANALYZING forever',
  /function deriveVerdict\(/.test(smSrc) &&
    /a: SwingAnalysis \| null,\s*\n\s*analyzing: boolean,/.test(smSrc) &&
    /NO READ — RECORD AGAIN/.test(smSrc),
  'errored/empty read shows honest state, not a perpetual spinner');

// 2026-07-07 (Tim — "I hit a chunk and it says GOOD SWING / clean") — the motion
// read can't see strike, so a "no fault" motion read must NOT be celebrated as a
// good shot. Contact signals (feel note / camera ball-departure / model contact_read)
// override it; a clean-motion read with unconfirmed contact is a neutral
// informational verdict, never a green "GOOD SWING".
check('Chunk-shot honesty: verdict never green-lights a mishit as a good swing',
  // The old unconditional "GOOD SWING" on any 'none' is gone.
  !/return \{ text: 'GOOD SWING', tone: 'good' \}/.test(smSrc) &&
    // Contact overrides exist and downgrade.
    /reportedMishit/.test(smSrc) &&
    /BALL DIDN.T LAUNCH/.test(smSrc) &&
    // Clean motion with unconfirmed contact is neutral (info), not a green check.
    /return \{ text: 'MOTION LOOKS CLEAN', tone: 'neutral' \}/.test(smSrc) &&
    // A confirmed strike is the ONLY path to the triumphant green verdict.
    /contact\?\.ballLaunched === true.*'SOLID SWING'/s.test(smSrc) &&
    // The server carries an honest, evidence-gated strike read defaulting to unknown.
    /contact_read/.test(read('api/swing-analysis.ts')) &&
    /parsed\.contact_read = 'unknown'/.test(read('api/swing-analysis.ts')),
  'a chunk/fat/thin strike (from feel note, ball-departure, or the model contact_read) downgrades the verdict; clean MOTION with unconfirmed contact is a neutral read, and only a confirmed ball launch shows the green "SOLID SWING"');

check('Acoustic Listening only while recording AND actually metering',
  /listening\?: boolean/.test(read('components/smartmotion/SmartMotionHud.tsx')) &&
    /Calibrated ✓ — Record to listen/.test(read('components/smartmotion/SmartMotionHud.tsx')) &&
    // 2026-06-12 (honesty) — gate on meteringActive too: never claim "Listening" when no
    // mic track is running (course-in-round / chip-mode-on-range have metering off).
    /listening=\{phase === 'recording' && meteringActive\}/.test(smSrc) &&
    /const \[meteringActive, setMeteringActive\] = useState\(false\)/.test(smSrc) &&
    /setMeteringActive\(meteringRef\.current != null\)/.test(smSrc),
  'no fake "Listening…" in setup or when the mic isn\'t metering');

check('Calibration auto-applies after a clean read',
  /Auto-apply: the user shouldn't have to tap/.test(read('app/swinglab/calibrate.tsx')) &&
    /Dialed in ✓/.test(read('app/swinglab/calibrate.tsx')),
  'save+apply+confirm without a separate tap');

check('Acoustic card always tappable to (re)calibrate',
  /Re-calibrate acoustics, 10 strikes/.test(smSrc),
  'tapping the pill opens calibration whether or not already calibrated');

check('Ball box shown by default + confirmatory (never gates)',
  /DEFAULT_BALL_BOX = \{/.test(smSrc) && /toolRail/.test(smSrc),
  'default reference box, optional, never blocks recording/analysis');

check('Hands-free voice record (start/stop) wired',
  exists('services/smartMotionRecordBus.ts') &&
    /subscribeSmartMotionCommand/.test(smSrc) && /setSmartMotionActive\(true\)/.test(smSrc) &&
    /isSmartMotionActive\(\)/.test(read('services/intents/mediaHandlers.ts')) &&
    /emitSmartMotionCommand/.test(read('services/intents/mediaHandlers.ts')),
  'voice capture phrase drives the open Smart Motion window via the record bus');

// ─── 2026-06-09: auto club detection + single-source club + owner restore ──
check('Club state is a single source (shared store, reactive)',
  /const club = useClubSelectionStore\(\(s\) => s\.lastClub\)/.test(smSrc),
  'voice / scan / picker all update the same club and the HUD reflects it');

check('Auto club detection wired (scan → recognize → set or confirm)',
  /detectClubFromCamera/.test(smSrc) && /recognizeClubFromBase64/.test(smSrc) &&
    /takePictureAsync/.test(smSrc) && /scanClub/.test(read('services/smartMotionRecordBus.ts')),
  'camera scan recognizes club; low-confidence opens picker to confirm');

check('Voice club-change + scan work on Smart Motion (no cage session needed)',
  /isSmartMotionActive\(\)/.test(read('services/intents/clubHandler.ts')) &&
    /useClubSelectionStore\.getState\(\)\.setLastClub/.test(read('services/intents/clubHandler.ts')) &&
    /emitSmartMotionCommand\('scanClub'\)/.test(read('services/intents/clubHandler.ts')),
  'spoken club updates the shared store; "scan my club" triggers detection');

const ownerProfileSrc = read('store/playerProfileStore.ts');
check('Owner tools restorable: hotmail allow-listed + settings email input',
  /t\.gustafson@hotmail\.com/.test(ownerProfileSrc) &&
    /Account email/.test(read('app/settings.tsx')) && /setAccountEmail/.test(read('app/settings.tsx')),
  'owner can set email in Settings to unlock Owner Tools (issue log / voice misses / harness)');

// ─── 2026-06-09: feels engine + putt mode ──────────────────────────────────
check('Feels engine wired (capture → caddie brain reconcile)',
  exists('services/swing/feelReconcile.ts') &&
    /reconcileFeel/.test(smSrc) && /submitFeel/.test(smSrc) &&
    /setSessionFeel/.test(read('store/cageStore.ts')) &&
    /\/api\/swing-question/.test(read('services/swing/feelReconcile.ts')),
  "player feel → swing-question reconciles it with the real read + coaches back");

check('Putt mode: explicit + decoupled from sticky club (no misroute)',
  /const isPutt = puttMode/.test(smSrc) && /analyzePutt\(/.test(smSrc) &&
    /PUTT MODE/.test(smSrc) && /puttModeRef\.current/.test(smSrc) &&
    !/isPutt = club === 'PT'/.test(smSrc),
  'putt mode is explicit per-recording state (not derived from persisted club), routes to putt analysis + PUTT MODE pill; a sticky putter no longer sends swings to the putt analyzer');

// 2026-06-09 (audit) — putt mode MUST clear on every new recording, or it
// sticks across "Record again"/the voice loop (the only off-switch, the DTL/
// FO/PUTT toggle, is hidden in review) and re-traps swings into putt analysis.
check('Putt mode resets on every new recording (no re-trap via record-again/voice)',
  /const reset = useCallback\([\s\S]*?setPuttMode\(false\)[\s\S]*?\}, \[/.test(smSrc),
  'reset() clears puttMode so a putt set once cannot trap later full-swing recordings');

// Voice "switch to putter"/non-putter keeps putt mode in sync (parity with
// the picker + camera club scan), via the record bus.
check('Voice club change drives putt mode (puttOn/puttOff bus)',
  /'puttOn' \| 'puttOff'/.test(read('services/smartMotionRecordBus.ts')) &&
    /emitSmartMotionCommand\(parsed\.club_id === 'PT' \? 'puttOn' : 'puttOff'\)/.test(read('services/intents/clubHandler.ts')) &&
    /cmd === 'puttOn'/.test(smSrc) && /cmd === 'puttOff'/.test(smSrc),
  'a hands-free club change to/from the putter sets/clears putt mode so the analysis branch matches the spoken club');

// The tagged club is sent to the swing analyzer (was hardcoded 'unknown').
check('Tagged club threaded into analyzeSwing (not hardcoded unknown)',
  /club: clubRef\.current \? clubIdToServerKey\(clubRef\.current\) : 'unknown'/.test(smSrc),
  'analyzeSwing receives the real tagged club for context-aware fault reads');

// Uploaded-putt analysis failure is terminal (failed-card), not an infinite spinner.
check('Uploaded putt failure sets terminal failed status',
  /putting analyze failed:/.test(read('services/videoUpload.ts')) &&
    /setSessionAnalysisStatus\(\s*sessionId,\s*'failed'/.test(read('services/videoUpload.ts')),
  'a putt upload that throws shows the failed-card with Re-analyze instead of spinning forever');

// ─── 2026-06-09 (audit fixes): voice-restart + control bar + slow-mo ───────
check('Voice record restarts from review (camera re-mount fix)',
  /pendingStartRef/.test(smSrc) && /beginNextRecording/.test(smSrc) &&
    /onCameraReady=\{/.test(smSrc),
  'voice "record" from review resets→setup→onCameraReady auto-starts (hands-free loop)');

check('startRecording clears prior-swing results (no stale data in loop)',
  /Clear the prior swing's results so the next minute starts clean/.test(smSrc),
  'analysis/putt/feel/tempo cleared on each new recording');

check('Universal control bar: record/play-pause/save/delete + slow-mo',
  /togglePlay/.test(smSrc) && /discardSwing/.test(smSrc) && /cycleSpeed/.test(smSrc) &&
    /deleteSession/.test(smSrc) && /rate=\{playbackRate\}/.test(smSrc),
  'review bar with play/pause, slow-mo (rate prop), save, delete');

check('Tempo on the LEFT rail (badge, honest) + result-overlay hide toggle',
  // Tempo moved from a standalone pill into the LEFT metric rail (tempo · ball speed
  // · ball result), each a custom badge, honest "—" until measured.
  /leftMetrics/.test(smSrc) && /ICON_METRIC\.tempo/.test(smSrc) &&
    /tempo\?\.ratio != null \? `\$\{tempo\.ratio\.toFixed\(1\)\}`/.test(smSrc) &&
    /styles\.leftRail/.test(smSrc) &&
    /m\.value \?\? '—'/.test(smSrc) &&
    /const \[showResults, setShowResults\] = useState\(true\)/.test(smSrc) &&
    /setShowResults\(\(v\) => !v\)/.test(smSrc),
  'tempo + ball speed + ball result render as custom badges on the LEFT rail (flanking the video, centre clear), honest "—" until measured, and every result overlay is gated on a showResults toggle for a clean Smart Capture frame');

check('Face-on: NO launch/trace line on review (false from the front); framing guides both angles',
  // 2026-06-11 (cage test) — the slanted launch line is REMOVED from face-on
  // review. From the front you cannot see ball flight, so it read as a false
  // line (Tim flagged it). Review keeps the vertical target alignment only.
  // Review now uses the DRAGGABLE EditableCageTargets, which renders the overlay
  // with launchDir={null} internally (no false face-on launch line).
  /<EditableCageTargets/.test(smSrc) &&
    !/launchDir=\{angle === 'face_on'/.test(smSrc) &&
    /launchDir=\{null\}/.test(read('components/swinglab/CageTargetingCard.tsx')) &&
    // No launch line during live capture either (declutter line-up). 2026-06-12 — putt
    // now also shows a target (the CUP flag), so the gate dropped `&& !isPutt` and adds
    // targetKind; still launchDir={null} (no false launch line in any mode).
    /<CageTargetingOverlay ballArea=\{draftBall\} target=\{angle === 'down_the_line' \? draftTarget : null\} launchDir=\{null\} targetKind=/.test(smSrc) &&
    // Framing guides (incl. FO side lines) render for BOTH angles.
    /!isReview\n\s*\? <CaptureGuides/.test(smSrc),
  'face-on review shows the vertical target alignment only (no false launch line — EditableCageTargets passes launchDir null); live capture shows framing guides for both DTL and FO');

// ─── 2026-06-09: acoustics-free swing localizer + honest networking ──────────
const poseSrc = read('services/poseDetection.ts');
const apiSrc = read('api/swing-analysis.ts');
const breakerSrc = read('services/voiceCircuitBreaker.ts');

check('Swing localizer: locate_swing API mode + client locator wired into analyzeSwing',
  /mode === 'locate_swing'/.test(apiSrc) && /swing_time_sec/.test(apiSrc) &&
    /export async function locateSwingWindow/.test(poseSrc) &&
    /const located = await locateSwingWindow/.test(poseSrc) &&
    /effectiveBoundaries = located/.test(poseSrc),
  'unbounded long uploads run an AI locate pass (find the swing) then analyze a tight window around it — no acoustics, no manual marking');

check('Timeout is NOT mislabeled as lost-connection (honest networking)',
  /name === 'TimeoutError'/.test(poseSrc) &&
    /recordFailure\('swing-analysis', 'timeout'\)/.test(poseSrc) &&
    /REQUEST_TIMEOUT_MS = 63_000/.test(poseSrc) &&
    /export type FailureKind/.test(breakerSrc),
  'a server-slowness timeout returns an honest "took too long" (not "check your network") and keeps the client above the 60s server deadline');

// 2026-06-10 — FAIL-SAFE caddie: the breaker never blocks the user and never
// auto-engages Local Mode; the voice path + brain always attempt.
check('Circuit breaker is fail-safe: never blocks, never auto-engages Local Mode',
  /export function isDegraded\(_endpoint: VoiceEndpoint\): boolean \{\s*return false;/.test(breakerSrc) &&
    !/maybeAutoEngageLocalMode/.test(breakerSrc) &&
    !/Cell signal weak/.test(breakerSrc),
  'isDegraded always returns false (always attempt), Local Mode auto-engage removed, no "cell signal weak" toast');

check('Voice path has no preemptive "voice paused" / brain short-circuit walls',
  !/voice paused\. Tap again/.test(read('hooks/useVoiceCaddie.ts')) &&
    !/isVoiceEndpointDegraded/.test(read('hooks/useVoiceCaddie.ts')),
  'mic + brain always attempt; removed the breaker short-circuits that walled voice on a transient blip');

check('Brain failure falls back to a real local answer (not a snag prompt)',
  /brainFallbackReply/.test(read('hooks/useKevin.ts')) &&
    /tryLocalReply/.test(read('hooks/useKevin.ts')) &&
    !/Hit a snag on my end/.test(read('hooks/useKevin.ts')),
  'a failed brain call answers locally (on-course status) or a brief non-alarming line — never "hit a snag / no network"');

check('Offline caddie Tier 1: local CLUB CALL + LAST SHOT, grounded + honest (2026-06-12)',
  // Extends tryLocalReply (the single brain-failure hook used by useKevin /
  // useVoiceCaddie / voiceCommandRouter), so it works on every fallback path with
  // no native module — ships via OTA. The club call uses the player's REAL logged
  // bag (bagDistances) + the GPS/green distance; NEVER a fabricated yardage.
  (() => {
    const s = read('services/localStatusResponder.ts');
    return /import \{ bagDistances \} from '\.\/shotStrategy'/.test(s) &&
      /clubRec:\s*\//.test(s) && /lastShot:\s*\//.test(s) &&            // the two new intents
      /if \(RX\.clubRec\.test\(t\)\) \{\s*return clubCallReply/.test(s) &&
      /if \(RX\.lastShot\.test\(t\)\) \{\s*return lastShotReply/.test(s) &&
      // honesty: empty bag → say so (no generic chart numbers), and the call is built
      // from the measured carry (best[1]) + GPS distance, not an invented figure.
      /if \(bag\.length === 0\) \{\s*return \{ text: L\[lang\]\.noBag/.test(s) &&
      /L\[lang\]\.clubCall\(dist, best\[0\], best\[1\]\)/.test(s) &&
      // last shot reads the real logged shots array.
      /const shots = round\.shots \?\? \[\]/.test(s);
  })(),
  'when the cloud brain is unreachable the caddie still CALLS A CLUB (real bag + GPS distance, honest when the bag is empty or GPS is weak) and recalls your LAST SHOT from logged round state — no fabricated numbers, no native module (OTA-able)');

// 2026-06-14 (Tim) — "every golfer wants to know what their drive did." The ask
// resolves the LAST DRIVER shot specifically, and its distance is auto-computed
// from GPS (tee→ball) the moment the player reaches their ball — the most reliable
// drive-distance source (no acoustics/pose). Honest by construction: GPS only fills
// distance_yards when nothing measured it, never clobbering a real value.
check('Drive distance: "what did my driver do" finds the driver shot + GPS auto-calc',
  (() => {
    const r = read('services/localStatusResponder.ts');
    const askFindsDriver =
      /wantsDriver = \/\\b\(driver\|drive\|tee shot\|off the tee\)\\b\//.test(r) &&
      /\[\.\.\.shots\]\.reverse\(\)\.find\(\(x\) => typeof x\.club === 'string' && \/driv\/i\.test\(x\.club\)\)/.test(r) &&
      /L\[lang\]\.noClubShot\('driver'\)/.test(r) &&
      // distance falls back measured → GPS tee→ball → carry, never invents one.
      /gps_distance_yards === 'number' \? s\.gps_distance_yards/.test(r);
    const store = read('store/roundStore.ts');
    const gpsBackfill =
      /gps_distance_yards\?: number \| null/.test(store) &&
      // computed in the end_location back-fill via haversine, jitter-floored.
      /haversineYards\(x\.start_location, incomingStart\)/.test(store) &&
      /d >= 5 && d <= 500/.test(store) &&
      // never clobbers a measured distance_yards.
      /typeof x\.distance_yards === 'number' \? x\.distance_yards : gpsYds/.test(store) &&
      // 2026-06-14 (audit #5) — GPS distance DISPLAYS but does NOT train the bag:
      // learning uses measuredCarry, which excludes a GPS-sourced distance_yards.
      /const measuredCarry = \(sh: ShotResult\): number \| null =>/.test(store) &&
      /sh\.distance_yards !== sh\.gps_distance_yards/.test(store) &&
      /const driverYards = enriched\.club === 'Driver' \? measuredCarry\(enriched\) : null/.test(store) &&
      !/gpsCompleted/.test(store); // the GPS-feeds-learning path was removed
    return askFindsDriver && gpsBackfill;
  })(),
  'asking "how far was my drive" returns the last DRIVER shot; its distance is auto-filled from the GPS tee→ball total (jitter-floored, never overwriting a measured value) for DISPLAY only — the learned bag/longestDrive train on measuredCarry, never the GPS estimate (audit #5 honesty)');

// 2026-06-14 (audit #1 — data loss) — endRound snapshotted `s = get()` then called
// closeHoleEndLocation (which set()s shots), but built the record from the STALE
// s.shots — so every saved round dropped the final-hole green-close + its distance.
// Now the record reads the post-close shots.
check('Round save: final-hole end_location persists (record built after closeHoleEndLocation)',
  (() => {
    const store = read('store/roundStore.ts');
    return (
      /const persistedShots = get\(\)\.shots;/.test(store) &&
      /shots: \[\.\.\.persistedShots\]/.test(store) &&
      !/shots: \[\.\.\.s\.shots\],/.test(store) // the stale-snapshot build is gone
    );
  })(),
  'endRound rebuilds the saved record from the live post-close shots, so the final hole\'s green-close (and GPS distance) is no longer lost from every round');

// 2026-06-14 (audit #2 — silent round-save loss) — zustand persist→AsyncStorage
// swallowed setItem rejections, so a quota/disk failure lost a round with NO
// breadcrumb (the documented round killer). The shared storage now logs every
// write failure to the owner issue log (guarded against recursing on its own key).
check('Persist: AsyncStorage write failures surface (no more silent round loss)',
  (() => {
    const s = read('services/ssrSafeStorage.ts');
    return (
      /const guardedStorage: StateStorage = \{/.test(s) &&
      /reportPersistFailure\(name, err\)/.test(s) &&
      /throw err;/.test(s) &&                                  // zustand still sees the rejection
      /addAppEvent\('persist_write_failed'/.test(s) &&
      /if \(key === ISSUE_LOG_KEY\) return;/.test(s) &&        // no write→fail→log→write loop
      /const ISSUE_LOG_KEY = 'issue-log-v1'/.test(s) &&
      /getPersistStorage\(\)[\s\S]{0,80}guardedStorage/.test(s)
    );
  })(),
  'every persisted store now routes through a guarded storage that logs setItem failures (with the store key) to the owner issue log instead of silently losing the write — a lost round leaves a breadcrumb');

// 2026-06-14 (audit #3 — honesty) — the reported "fault at X% of swing" used
// FRAME_TIME_FRACTIONS[idx] (the full-tier 5-frame array) regardless of which
// sampling array actually produced the frame. Quick-tier (3-frame) and long-clip
// (even-spread) reads therefore reported a wrong position. Each Frame now carries
// its REAL sampled fraction, read back by index.
check('Analysis honesty: fault-frame fraction uses the frame\'s real sampled position',
  (() => {
    const p = read('services/poseDetection.ts');
    return (
      /export type Frame = \{ b64: string; media_type: string; time_sec: number; fraction\?: number \}/.test(p) &&
      /time_sec: timeMs \/ 1000, fraction: t \} as Frame/.test(p) &&          // real fraction stamped at extraction
      /faultFrameFraction = frames\[idx\]\.fraction \?\? null/.test(p) &&       // read back the real one
      !/faultFrameFraction = FRAME_TIME_FRACTIONS\[idx\]/.test(p)              // the wrong index is gone
    );
  })(),
  'the fault-frame fraction surfaced to the user is the actual position the fault frame was sampled at (quick/full/long-clip aware), not a blind index into the full-tier fraction array');

// 2026-06-14 (audit #4 — honesty) — a missing server score defaulted to 70, then a
// kid was told "Up N points — real progress" off two placeholder 70s. The delta is
// now only computed when BOTH this swing and the prior had REAL (server-graded)
// scores; otherwise no progress chip.
check('Analysis honesty: kids\' progress delta only when both scores are real',
  (() => {
    const j = read('services/juniorSwingAnalyzer.ts');
    return (
      /scoreEstimated\?: boolean/.test(j) &&
      /const scoreEstimated = typeof data\.overallScore !== 'number'/.test(j) &&
      /function autoVsPrevious\(overall: number, scoreEstimated: boolean, prior:/.test(j) &&
      /if \(scoreEstimated \|\| prior\.scoreEstimated\) return null;/.test(j) &&
      // the network fallback (placeholder 50) never claims progress either
      /\/\/ Fallback score is a placeholder, so never claim a progress delta[\s\S]{0,40}vs_previous: null/.test(j)
    );
  })(),
  'a child only sees a "+N points" progress chip when both the current and prior swing had real graded scores — a defaulted/placeholder score never fabricates progress');

check('One-time migration clears auto-trapped Local Mode (settings v12)',
  // refreshed: store is at version 19 now (v18 active-listening on, v19 single-provider
  // aiProvider→openai); the one-time version<12 localMode clear is still present
  // (migrations are cumulative), which is what this guards.
  /version: 19/.test(read('store/settingsStore.ts')) &&
    /if \(version < 12\)[\s\S]{0,160}p\.localMode = false/.test(read('store/settingsStore.ts')),
  'users trapped in auto-engaged Local Mode by the old breaker boot clean once');

// 2026-06-14 (Tim — bilateral / second video source) — link two analyzed swings (one
// DTL, one face-on of the same swing) → one combined read. Honest: each angle's valid
// half, impact-anchored (acoustic strike = shared event), labeled 2D not 3D.
check('Bilateral: link two angles → merged read (impact-anchored, honest 2D)',
  (() => {
    const svc = read('services/swing/bilateralMerge.ts');
    const view = read('app/swinglab/bilateral.tsx');
    const detail = read('app/swinglab/swing/[swing_id].tsx');
    const svcOk =
      /export function mergeBilateral\(a: BilateralSwingInput, b: BilateralSwingInput\): BilateralRead/.test(svc) &&
      // pure (no store/RN imports)
      !/from '\.\.\/\.\.\/store|from 'react-native'/.test(svc) &&
      // classifies by angle, honest about same/missing angle
      /s\.angle === 'down_the_line'/.test(svc) && /s\.angle === 'face_on'/.test(svc) &&
      /Link one of each angle/.test(svc) &&
      // impact alignment (acoustic anchor) + honest 2D-not-3D line
      /alignedAtImpact = \(dtlIn\?\.impactSec != null\) && \(faceOnIn\?\.impactSec != null\)/.test(svc) &&
      /Aligned on the acoustic impact/.test(svc) &&
      /Not 3D \(that needs synced, calibrated capture\)/.test(svc);
    const viewOk =
      /mergeBilateral\(toInput\(sa\), toInput\(sb\)\)/.test(view) &&
      // impact anchor read from the shot's detectionOffsetSeconds
      /s\.shots\?\.\[0\]\?\.detectionOffsetSeconds/.test(view);
    const entryOk =
      /Link a second angle \(bilateral\)/.test(detail) &&
      /router\.push\(`\/swinglab\/bilateral\?a=\$\{swing_id\}&b=\$\{os\.id\}`/.test(detail);
    return svcOk && viewOk && entryOk;
  })(),
  'a swing detail can link a second library swing (the other angle) → a bilateral read that merges DTL (path/plane) + face-on (sway/weight), aligned on the shared acoustic impact when both have one, honestly labeled 2D-not-3D');

// 2026-06-14 (audit rerun — 5 confirmed fixes before testing) ──────────────────
check('Audit fix: upload never strands on "Saving…" if ingest throws',
  (() => {
    const u = read('app/swinglab/upload.tsx');
    // ingest is wrapped; on throw it restores the form + alerts (no infinite spinner)
    return /try \{\s*\n\s*sessionId = await ingestVideoFromPick\(\{/.test(u) &&
      /\} catch \(e\) \{[\s\S]{0,180}setStep\('metadata'\);[\s\S]{0,120}Alert\.alert\('Upload failed'/.test(u);
  })(),
  'a rejected video ingest restores the editable upload form + shows an alert instead of hanging on the Saving spinner forever (tonight\'s 2nd-video-source path)');

check('Audit fix: end-of-round summary credits points + opens recap even if TTS fails',
  (() => {
    const c = read('app/(tabs)/caddie.tsx');
    // the voiceEnabled audio block is wrapped so a TTS/audio throw can't skip
    // the points award + recap navigation that follow it.
    return /if \(voiceEnabled\) \{\s*\n\s*try \{\s*\n\s*await configureAudioForSpeech\(\);/.test(c) &&
      /round-summary speak failed \(non-fatal, continuing to points \+ recap\)/.test(c);
  })(),
  'a network/TTS failure during the end-of-round summary no longer throws past the points award + recap navigation — the round still credits points and opens the recap (mute, not broken)');

check('Audit fix: cage-review stops caddie TTS on unmount (no cross-screen audio bleed)',
  (() => {
    const cr = read('app/cage-review/[review_session_id].tsx');
    return /import \{[^}]*stopSpeaking[^}]*\} from '\.\.\/\.\.\/services\/voiceService'/.test(cr) &&
      /void stopSpeaking\(\)\.catch\(\(\) => undefined\)/.test(cr);
  })(),
  'navigating away from a cage review mid-question stops the spoken TTS instead of letting it play over the next screen');

check('Audit fix: synthesized whole-clip fallback swing is surfaced to segments state',
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    // when no strikes + no recovery, the synthesized firstSeg is also pushed to
    // state + selected, so the review's per-swing effects don't see [].
    return /segsForAnalysis = \[firstSeg\];\s*\n\s*setSegments\(segsForAnalysis\);\s*\n\s*setSelectedSwing\(0\);/.test(sm);
  })(),
  'a missed-strike single-swing recording surfaces its synthesized whole-clip segment to state (was []), so the review per-swing effects run instead of silently skipping');

check('Audit fix: review video loop reads live swing selection via ref (no reel-scrub jump)',
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    // both onLoad + onPlaybackStatusUpdate read selectedSwingRef.current, not the
    // stale closed-over selectedSwing.
    return (sm.match(/const seg = segments\[selectedSwingRef\.current\]/g) || []).length >= 2;
  })(),
  'the windowed-loop + onLoad seek read the live selected-swing ref, so tapping a reel chip for an earlier swing no longer briefly yanks playback back to the old swing');

// 2026-06-14 (Tim — multi-swing cage test) — two reliability fixes: (1) per-swing trace
// was computed ONCE off the first strike and never recomputed, so swings 2-5 showed
// swing 1's trace; now cached per swing index off THAT swing's strike. (2) a loud bay
// bailed cage detection to zero strikes (→ a single whole-clip "1 of 1"); now it
// degrades to relative-threshold detection so the swings survive.
check('Cage multi-swing: per-swing trace + noisy-bay degrade (no lost swings)',
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    const perSwingTrace =
      /const ballDepartureCacheRef = useRef<Record<number, BallDepartureResult \| null>>\(\{\}\)/.test(sm) &&
      // departure computed off the SELECTED swing's strike, cached per index
      /const strikeMs = seg\?\.strikeMs \?\? firstStrikeMsRef\.current/.test(sm) &&
      /if \(selectedSwing in ballDepartureCacheRef\.current\)/.test(sm) &&
      // 2026-06-15 — cache write is now the confidence-gated `accepted` value
      // (video-located degrade), not the raw result.
      /ballDepartureCacheRef\.current\[selectedSwing\] = accepted/.test(sm) &&
      // the old first-strike-only single-shot guard is gone
      !/firstStrikeMsRef\.current == null \|\| ballDeparture\) return/.test(sm) &&
      // cache cleared on new capture (reset + startRecording)
      (sm.match(/ballDepartureCacheRef\.current = \{\}/g) || []).length >= 2;
    const noisyDegrade =
      /if \(res\.kind === 'noisy-environment' && meterMode === 'cage'\)/.test(sm) &&
      /detectStrikes\(samples, \{ thresholdDb, noisyFloorDb: Number\.POSITIVE_INFINITY \}\)/.test(sm);
    return perSwingTrace && noisyDegrade;
  })(),
  'each swing in a multi-swing cage recording gets ITS OWN ball trace (departure cached per swing index off that swing\'s strike, cleared on new capture), and a loud bay no longer zeros all swings — cage detection degrades to the relative floor+threshold so a 3-5 swing recording keeps its swings instead of collapsing to one whole-clip result');

// 2026-06-14 (Tim — second video source) — a second-angle clip (iPad/GoPro face-on of
// the same swing) imported via Upload must be analyzed as FACE-ON, not the global cage
// DTL default (which withholds face-on metrics). New per-upload angle picker → angleOverride
// threaded onto the session → wins over the cage angle in analysis.
check('Upload angle picker: imported clip read at its true angle (DTL vs face-on)',
  (() => {
    const screen = read('app/swinglab/upload.tsx');
    const svc = read('services/videoUpload.ts');
    const store = read('store/cageStore.ts');
    const uiOk =
      /const \[angle, setAngle\] = useState<'down_the_line' \| 'face_on'>\('down_the_line'\)/.test(screen) &&
      /CAMERA ANGLE/.test(screen) &&
      /onPress=\{\(\) => setAngle\('face_on'\)\}/.test(screen) &&
      /angleOverride: angle/.test(screen);
    const svcOk =
      /angleOverride\?: 'down_the_line' \| 'face_on' \| null/.test(svc) &&
      /angleOverride: args\.angleOverride \?\? null/.test(svc) &&
      // per-upload angle WINS over the global cage angle in analysis
      /const uploadAngle = session\.upload\?\.angleOverride \?\? null/.test(svc) &&
      /if \(uploadAngle === 'down_the_line' \|\| uploadAngle === 'face_on'\)/.test(svc);
    const storeOk = /angleOverride\?: 'down_the_line' \| 'face_on' \| null/.test(store);
    return uiOk && svcOk && storeOk;
  })(),
  'the Upload screen has a DTL/Face-on angle picker; the chosen angle is persisted on the session as angleOverride and wins over the global cage angle when analyzing — so an imported iPad/GoPro face-on clip of the same swing gets the correct face-on read (a second video source → a valid second analysis)');

// 2026-06-14 (Tim — points phase 3) — the honest practice→course connection: practice
// volume vs scoring trend, shown as ASSOCIATION (never causation) and gated until there's
// enough data on both sides. Lower score-vs-par = better.
check('Practice→performance: honest connection card (association, gated, no fabrication)',
  (() => {
    const svc = read('services/practice/practiceImpact.ts');
    const dash = read('app/(tabs)/dashboard.tsx');
    const svcOk =
      /export function computePracticeImpact/.test(svc) &&
      // pure — no store/RN imports (sim-safe, offline-safe)
      !/from '\.\.\/\.\.\/store|from 'react-native'/.test(svc) &&
      // gated until enough on BOTH sides
      /const MIN_SESSIONS = 3/.test(svc) && /const MIN_ROUNDS = 4/.test(svc) &&
      /hasEnough = practiceSessions >= MIN_SESSIONS && roundsCounted >= MIN_ROUNDS/.test(svc) &&
      // honest "keep logging" when not enough; association language when it is
      /Keep logging practice and rounds/.test(svc) &&
      /showing up on the course/.test(svc) &&
      // never claims causation
      !/because you practiced|practice caused|proves/.test(svc);
    const dashOk =
      /PRACTICE → PERFORMANCE/.test(dash) &&
      /computePracticeImpact\(\{/.test(dash) &&
      // two trends: practice volume + score-vs-par (lower better)
      /data=\{practiceImpact\.practiceSeries\}/.test(dash) &&
      /data=\{practiceImpact\.scoreSeries\}/.test(dash) &&
      /higherIsBetter=\{false\}/.test(dash) &&
      /practiceHistory\.length > 0 && roundHistory\.length > 0/.test(dash);
    return svcOk && dashOk;
  })(),
  'the dashboard shows a practice→performance card pairing weekly practice volume against score-vs-par trend, described as an honest association (gated until ≥3 sessions + ≥4 rounds, "keep logging" before that), never claiming practice caused the result');

// 2026-06-14 (Tim — points, phase 2) — the visible payoff: a Practice History on the
// dashboard (sessions by date → tap → per-club striation + tempo trend). Drills now
// land in the same history. Two reusable SVG primitives back the viz.
check('Practice history: dashboard list → detail with per-club striation + tempo trend',
  (() => {
    const ps = read('store/practiceSessionStore.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    const dash = read('app/(tabs)/dashboard.tsx');
    const detail = read('app/practice/[sessionId].tsx');
    const trend = read('components/charts/TrendChart.tsx');
    const stri = read('components/charts/StriationBar.tsx');
    const storeOk =
      /recordCompletedSession: \(input:/.test(ps) &&
      /drillId\?: string \| null;/.test(ps) &&
      /swingCount\?: number \| null;/.test(ps);
    // drills get recorded into the unified history (separate from the award)
    const drillHistory = /usePracticeSessionStore\.getState\(\)\.recordCompletedSession\(\{/.test(sm);
    // dashboard surfaces the history list and navigates to the detail route
    const dashOk =
      /PRACTICE HISTORY/.test(dash) &&
      /recentSessions = useMemo\(\(\) => practiceHistory\.slice\(0, 6\)/.test(dash) &&
      /router\.push\(`\/practice\/\$\{s\.id\}`/.test(dash);
    // detail screen renders the two primitives off real session data
    const detailOk =
      /summarizeOpenRange\(session\.swings\)/.test(detail) &&
      /<StriationBar/.test(detail) &&
      /<TrendChart/.test(detail);
    // primitives exist + are generic (number[] / segments), pure SVG
    const primitivesOk =
      /export default function TrendChart/.test(trend) && /data: number\[\]/.test(trend) &&
      /export default function StriationBar/.test(stri) && /react-native-svg/.test(stri);
    return storeOk && drillHistory && dashOk && detailOk && primitivesOk;
  })(),
  'practice sessions (Open Range / Focus / drills) appear in a dashboard Practice History list; tapping one opens a detail screen with a per-club striation bar + a within-session tempo trend, built on two new reusable react-native-svg primitives');

// 2026-06-14 (Tim — points, phase 1) — practice points were awarded ONLY from the
// Drills screen; Open Range / Focus / SmartPlan granted nothing, and practice never
// fed the visible tier. Now ONE award (awardPracticePoints) records the per-key ledger
// AND feeds the tiered pointsStore, called from every practice completion (session end
// + drill save). Unified points the user actually sees.
check('Points: practice awards from every surface + feeds the visible tier',
  (() => {
    const pp = read('store/practicePointsStore.ts');
    const ps = read('store/practiceSessionStore.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    const dash = read('app/(tabs)/dashboard.tsx');
    const unifiedAward =
      /awardPracticePoints: \(input: \{ key: string; label\?: string \| null; swings: number; now: number \}\) => number/.test(pp) &&
      // feeds the tiered (visible) points store
      /const pts = require\('\.\/pointsStore'\)[\s\S]{0,120}\.addPoints\(granted,/.test(pp) &&
      // back-compat drill wrapper still exists
      /awardDrill: \(drillId, swings, now\) => get\(\)\.awardPracticePoints\(\{ key: drillId, swings, now \}\)/.test(pp);
    // session end (open range / focus / smartplan all funnel here) now awards
    const sessionAward =
      /const swings = active\.swings\.length;\s*\n\s*if \(swings > 0\)/.test(ps) &&
      /awardPracticePoints\(\{ key, label, swings, now: Date\.now\(\) \}\)/.test(ps);
    // drill save uses the unified award (so drills also feed the tier) with a label
    // 2026-07-04 (drift reconcile) — the call went single-line.
    const drillAward = /awardPracticePoints\(\{ key: drillId, label: drillLabel, swings, now: Date\.now\(\) \}\)/.test(sm);
    // dashboard renders non-drill keys via the stored label
    const dashOk = /getDrillEntry\(id\)\?\.title \?\? rec\.label \?\? id/.test(dash);
    return unifiedAward && sessionAward && drillAward && dashOk;
  })(),
  'every practice surface (drills + Open Range + Focus + SmartPlan) now awards practice points through one unified award that also feeds the visible tiered points; the dashboard labels focus/open-range entries — practice finally counts toward the user\'s level everywhere');

// 2026-06-14 (Tim — course book, step 3) — Golf Course API has no website/booking, so
// Google Places (name + coords → official website + phone) bridges it. Anchored into the
// book → "Book Tee Time" deep-links the real site + offline phone-to-call. Client-side
// (one fewer hop, OTA-able), degrades to the existing search if Places isn't enabled.
check('Course book: Places lookup anchors website/phone; booking prefers the real site',
  (() => {
    const cp = read('services/coursePlaces.ts');
    const cph = read('api/course-places.ts');
    const tt = read('services/teeTimeLink.ts');
    const screen = read('app/course/[course_id].tsx');
    const lookupOk =
      /export async function lookupCoursePlaces\(/.test(cp) &&
      // 2026-07-10 (audit S2) — the Google Places key is no longer shipped in the client:
      // the lookup now proxies through OUR server endpoint, and the Google calls + key
      // live server-side. anchoring + cache stay client-side.
      /\/api\/course-places/.test(cp) &&
      /getApiBaseUrl\(\)/.test(cp) &&
      /saveCourseBook\(\{/.test(cp) &&
      /if \(existing && \(existing\.website \|\| existing\.phone\)\)/.test(cp) &&
      !/AIzaSy/.test(cp) &&                          // no hardcoded key in the client
      // server proxy holds the key + makes the Google Places calls, degrading cleanly
      /findplacefromtext\/json/.test(cph) &&
      /place\/details\/json/.test(cph) &&
      // 2026-07-10 — degrade on ANY non-OK Places status (not just REQUEST_DENIED), and read the
      // key that's ACTUALLY in Vercel (GOOGLE_API_KEY, all APIs enabled) — the handler used to
      // read only GOOGLE_MAPS_KEY, which was never set, so every lookup returned not_configured.
      /findData\.status !== 'OK'/.test(cph) &&
      /process\.env\.GOOGLE_API_KEY/.test(cph);
    const bookingOk =
      /export async function openTeeTimeSearch\(courseName: string, locationHint\?: string \| null, courseId\?: string \| null\)/.test(tt) &&
      /const url = book\?\.bookingUrl \?\? book\?\.website \?\? null;/.test(tt);
    const screenOk =
      /lookupCoursePlaces\(\{/.test(screen) &&
      /openTeeTimeSearch\(displayClubName \|\| course\.club_name, loc, course\.id\)/.test(screen);
    return lookupOk && bookingOk && screenOk;
  })(),
  'a course\'s website/phone are looked up once via Google Places (name+coords from the Golf Course API), anchored into the persisted course book, and "Book Tee Time" opens the course\'s OWN site when known (falling back to the search); degrades cleanly when Places isn\'t enabled');

// 2026-06-14 (Tim — course book) — static per-hole knowledge (notes/hazards/tips) is
// anchored ONCE into the CNS so it's persisted, OFFLINE-available, and fed into both the
// brain context and the offline responder — the "range book" that backs no-signal play.
check('Course book: per-hole knowledge anchored into CNS (offline + brain + offline-responder)',
  (() => {
    const store = read('store/caddieMemoryStore.ts');
    const content = read('services/courseContentService.ts');
    const retrieval = read('services/caddieMemoryRetrieval.ts');
    const local = read('services/localStatusResponder.ts');
    const storeOk =
      /export interface CourseBookEntry/.test(store) &&
      /courseBook: Record<string, CourseBookEntry>/.test(store) &&
      /saveCourseBook: \(input:/.test(store) &&
      /getStaticHole: \(courseId: string, hole: number\) => StaticHoleKnowledge \| null/.test(store) &&
      // persisted (v2 migrate preserves players + seeds book)
      /version: 2/.test(store) &&
      /partialize: \(s\) => \(\{ players: s\.players, courseBook: s\.courseBook \}\)/.test(store) &&
      /players: p\.players \?\? \{\}, courseBook: p\.courseBook \?\? \{\}/.test(store);
    // writer: course-content anchors on BOTH fresh fetch and persisted-cache hit
    const writerOk =
      /function anchorCourseBook\(/.test(content) &&
      (content.match(/anchorCourseBook\(courseId,/g) || []).length >= 2 &&
      /saveCourseBook\(\{/.test(content);
    // brain context surfaces the static hole note/hazards
    const brainOk = /getStaticHole\(input\.courseId, input\.hole\)/.test(retrieval) &&
      /Hole notes \(course book\)/.test(retrieval);
    // offline responder answers "what's this hole / what do I watch for" from the book
    const offlineOk =
      /holeInfo:\s*\//.test(local) &&
      /if \(RX\.holeInfo\.test\(t\)\) \{\s*\n\s*return holeInfoReply\(lang\)/.test(local) &&
      /useCaddieMemoryStore\.getState\(\)\.getStaticHole\(courseId, hole\)/.test(local) &&
      /queryType: 'hole_info'/.test(local);
    return storeOk && writerOk && brainOk && offlineOk;
  })(),
  'static course knowledge (hole notes/descriptions/hazards/tips) is saved into a persisted, player-independent CNS course book the moment /api/course-content resolves (fresh OR cached), surfaced to the brain prompt, and answerable OFFLINE via a "what\'s this hole / hazards" intent — the range book that works with no signal');

// 2026-06-14 (course book — imagery) — bundled courses carry 0,0 placeholder hole
// coords; the old `!input.green` check let those through and built a Mapbox satellite
// tile centered on 0°,0° (ocean off Africa) → the "parking lots / houses" thumbnails.
// getHoleImageryUrl now coord-guards (rejects 0,0/near-zero/out-of-range green; degrades
// an invalid tee to null), so those holes return null → filtered → the grid shows the
// bundled photo (which wins first) or its clean "coming soon" placeholder, never garbage.
check('Course book: hole imagery rejects 0,0 placeholder coords (no garbage thumbnails)',
  (() => {
    const m = read('services/mapboxImagery.ts');
    const cg = read('utils/coordGuard.ts');
    const grid = read('components/course/HolePhotosGrid.tsx');
    return (
      /import \{ isValidGolfCoord \} from '\.\.\/utils\/coordGuard'/.test(m) &&
      /const green = input\.green && isValidGolfCoord\(input\.green\.lat, input\.green\.lng\) \? input\.green : null;/.test(m) &&
      /if \(!green\) return null;/.test(m) &&
      /const tee = input\.tee && isValidGolfCoord\(input\.tee\.lat, input\.tee\.lng\) \? input\.tee : null;/.test(m) &&
      // the cache-key path mirrors the same guard (no permanent cache miss)
      /const green = input\.green && isValidGolfCoord[\s\S]{0,200}const fit = green \? computeFitView/.test(m) &&
      // coordGuard rejects 0,0 + near-zero
      /if \(lat === 0 && lng === 0\) return false;/.test(cg) &&
      // grid degrades to a clean placeholder when no valid photos
      /if \(photos\.length === 0\)/.test(grid)
    );
  })(),
  'a hole with 0,0 placeholder coords no longer builds a satellite tile pointed at the ocean — getHoleImageryUrl coord-guards the inputs so the course-book grid shows the bundled photo or a clean placeholder instead of parking-lot/house imagery');

// 2026-06-14 (audit P1 — hot-path serialization) — setLocationContext is the ONLY
// roundStore setter fired on every GPS tick. It used set((s)=>...return {}), but a
// zustand set() always re-serializes the persisted blob (shots + full roundHistory)
// even for {}, so standing still re-stringified the whole history ~1×/s. It now reads
// via get() and only set()s on an ACTUAL tee/green/fairway transition; no-change ticks
// return without touching the store. No data-shape change (safer than relocating shots).
check('Perf: setLocationContext only persists on a real location transition',
  (() => {
    const s = read('store/roundStore.ts');
    return (
      // converted from set((s)=>...) to a get()-read function
      /setLocationContext: \(coords\) => \{\s*\n\s*const s = get\(\);/.test(s) &&
      // no-change branches return WITHOUT calling set()
      /s\.currentTeeBox\?\.hole === hole\.hole\s*\n\s*\) return; \/\/ no change/.test(s) &&
      /if \(s\.currentLocationType === 'green'\) return;/.test(s) &&
      /if \(s\.currentLocationType === 'fairway'\) return;/.test(s) &&
      // real transitions still set the location state
      /set\(\{ currentLocationType: 'fairway', currentTeeBox: null \}\);/.test(s) &&
      // the old always-fires set((s)=>... wrapper is gone
      !/setLocationContext: \(coords\) => set\(\(s\) =>/.test(s)
    );
  })(),
  'a player standing still no longer re-serializes the whole shots+roundHistory blob every GPS tick — setLocationContext only writes on an actual tee/green/fairway transition (a few per round), eliminating the per-tick persistence cost with no data-shape change');

// 2026-06-14 (audit — perf) — the SmartFinder targeting reticle re-rendered the whole
// overlay (×4 corner brackets) on every drag pixel via setTargetX/Y, and fired the
// parent yardage recompute per pixel. Reticle POSITION now lives on reanimated shared
// values (UI-thread, no React re-render) and the parent callback is throttled to ~30fps.
check('Perf: SmartFinder reticle drags on shared values + throttled recompute',
  (() => {
    const t = read('components/smartfinder/TargetingOverlay.tsx');
    return (
      /const tx = useSharedValue\(width \/ 2\)/.test(t) &&
      /const ty = useSharedValue\(height \/ 2\)/.test(t) &&
      /tx\.value = x;/.test(t) && /ty\.value = y;/.test(t) &&
      /const crosshairStyle = useAnimatedStyle\(/.test(t) &&
      /<Animated\.View[\s\S]{0,80}crosshairStyle/.test(t) &&
      // parent recompute throttled to ~30fps during drag
      /now - lastReportAtRef\.current >= 33/.test(t) &&
      // the per-pixel setState position writes are gone
      !/setTargetX\(/.test(t) && !/setTargetY\(/.test(t)
    );
  })(),
  'dragging the targeting reticle moves it via reanimated shared values (no per-pixel React re-render of the overlay/brackets) and throttles the parent yardage/geometry recompute to ~30fps; the final resting point still reports exactly');

// 2026-06-14 (audit — perf) — speakFromBase64 (the primary Kevin-voice path) decoded
// the TTS base64 with an atob()+charCodeAt byte-loop on the JS thread right before
// playback. Now it writes straight to disk with native base64 decoding (expo-file-system).
check('Perf: Kevin voice base64 decodes natively to disk (no JS byte-loop)',
  (() => {
    const v = read('services/voiceService.ts');
    return (
      /writeAsStringAsync\(uri, base64, \{ encoding: FS\.EncodingType\.Base64 \}\)/.test(v) &&
      // the JS byte-loop decode is gone
      !/const binaryStr = atob\(base64\)/.test(v) &&
      !/bytes\[i\] = binaryStr\.charCodeAt\(i\)/.test(v) &&
      // cleanup uses the uri (deleteAsync) on the base64 path
      /void FS\.deleteAsync\(uri, \{ idempotent: true \}\)/.test(v)
    );
  })(),
  'speakFromBase64 writes the TTS audio to disk via native base64 decoding instead of an atob+charCodeAt loop on the JS thread before playback — removes per-response decode jank on the main caddie-voice path');

// 2026-06-14 (audit — perf) — the live acoustic meter callback fired ~every 50ms and
// piped each tick straight into setLiveDb, re-rendering the whole ~3300-line Smart
// Motion component up to 20×/s while recording. Throttle the display state to ~120ms;
// strike detection is unaffected (it runs inside startMeteredRecording).
check('Perf: Smart Motion live meter state is throttled (no 20x/s full re-render)',
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      /const lastDbSetAtRef = useRef\(0\);/.test(sm) &&
      /if \(now - lastDbSetAtRef\.current >= 120\) \{\s*\n\s*lastDbSetAtRef\.current = now;\s*\n\s*setLiveDb\(s\.dB\);/.test(sm) &&
      // the raw every-tick setLiveDb(s.dB) callback form is gone
      !/startMeteredRecording\(\(s\) => setLiveDb\(s\.dB\)\)/.test(sm)
    );
  })(),
  'the live meter pipes the ~50ms acoustic callback into React state at most ~8×/s instead of ~20×/s, so recording no longer re-renders the whole Smart Motion screen every meter tick; detection (inside startMeteredRecording) is untouched');

// 2026-06-14 (audit — store hygiene) — 4 persisted stores had no version+migrate, so
// a future shape bump would silently wipe their state (zustand discards behind-version
// state with no migrate). All four now carry version:1 + a passthrough migrate.
check('Store hygiene: previously-unversioned stores carry version + migrate',
  (() => {
    const files = ['agentBrainStats', 'conversationLogStore', 'clubSelectionStore', 'practicePointsStore'];
    return files.every(f => {
      const s = read(`store/${f}.ts`);
      // any explicit version (practicePoints bumped to v2 for watchedVideos, 2026-07-06)
      return /version: \d+,/.test(s) && /migrate: \(s\) => s as never,/.test(s);
    });
  })(),
  'agentBrainStats / conversationLog / clubSelection / practicePoints all have an explicit version + passthrough migrate, so a future bump upgrades instead of wiping persisted state');

// 2026-07-06 (MOAT Phase 2 — the judge) — the Drill Check grades a drill set against
// the fault it targets, honestly + directionally (per-set, never "you fixed it").
check('Drill Check: grades the set vs the drill target, honest + directional',
  (() => {
    // Target fault still dominant + significant → not_yet
    const notYet = deriveDrillVerdict({ drillId: 'over_the_top', drillName: 'Over the Top', issueId: 'over_the_top', issueName: 'Over the Top', severity: 'significant', confidence: 'high' });
    // Related family fault (outside-in path) still counts as the same target
    const family = deriveDrillVerdict({ drillId: 'over_the_top', drillName: 'Over the Top', issueId: 'swing_path_outside_in', issueName: 'Outside-In Path', severity: 'moderate', confidence: 'high' });
    // Target present but only minor / low-confidence → closer
    const closer = deriveDrillVerdict({ drillId: 'over_the_top', drillName: 'Over the Top', issueId: 'over_the_top', issueName: 'Over the Top', severity: 'minor', confidence: 'high' });
    // Target fault no longer dominant (or none) → got_it
    const gotIt = deriveDrillVerdict({ drillId: 'over_the_top', drillName: 'Over the Top', issueId: null });
    // Not a drill → no verdict
    const none = deriveDrillVerdict({ drillId: '', issueId: 'over_the_top' });
    const noOverclaim = [notYet, family, closer, gotIt].every(v => v != null && !/fixed your|cured|no longer slice|slice is gone/i.test(v.line));
    return (
      notYet?.grade === 'not_yet' &&
      family?.grade === 'not_yet' &&           // related-fault family match works
      closer?.grade === 'closer' &&
      gotIt?.grade === 'got_it' &&
      none === null &&
      noOverclaim &&                            // honesty: never claims a permanent fix
      /this set/i.test(notYet!.line)            // per-set framing, not a cure
    );
  })(),
  'drill target still dominant → not_yet; related-fault family counts; minor/low → closer; gone → got_it; non-drill → null; never overclaims a permanent fix');

// 2026-06-14 (audit — store hygiene) — roundHistory grew unbounded (each record
// carries its full shots[] and the whole blob re-serializes on every persist write).
// A generous backstop cap bounds the worst case at both append sites without dropping
// realistic users' history.
check('Store hygiene: roundHistory has a bounded-growth backstop cap',
  (() => {
    const s = read('store/roundStore.ts');
    return (
      /const MAX_ROUND_HISTORY = 1000;/.test(s) &&
      /const capHistory = \(h: RoundRecord\[\]\): RoundRecord\[\] =>/.test(s) &&
      /roundHistory: capHistory\(\[\.\.\.s\.roundHistory, record\]\)/.test(s) &&    // addImportedRound
      /roundHistory: capHistory\(\[\.\.\.state\.roundHistory, record\]\)/.test(s)   // endRound
    );
  })(),
  'roundHistory appends run through capHistory (max 1000) at both endRound and addImportedRound, bounding the persisted blob against runaway growth while preserving every realistic user\'s full history');

// 2026-06-14 (audit — MED honesty) — two surfaces presented rough/placeholder
// numbers as if real. SmartFinder putt distance (uncalibrated pixels→feet) now reads
// "~N" + "FEET (EST)"; the course-detail generic placeholder layout (18×par-4×380y for
// un-catalogued local courses) now shows an "Estimated layout" banner instead of
// silently fabricating a scorecard. Keep-and-flag, not silent fabrication.
check('Honesty: putt distance + placeholder course layout are flagged as estimates',
  (() => {
    const sf = read('app/smartfinder.tsx');
    const cd = read('app/course/[course_id].tsx');
    return (
      // putt distance shows ~N and an EST label (was a bare number + "FEET")
      /distanceFeet != null \? `~\$\{distanceFeet\}` : '—'/.test(sf) &&
      /FEET \(EST\)/.test(sf) &&
      // course detail flags the generic placeholder layout + clears it on real data
      /const \[layoutEstimated, setLayoutEstimated\] = useState\(false\)/.test(cd) &&
      /setLayoutEstimated\(!realHoles\)/.test(cd) &&
      // 2026-06-16 — API enrichment now preserves the curated location (no town
      // flap) but still clears the estimate flag when real layout lands.
      /setCourse\(prev => \(prev \? \{ \.\.\.c, location: prev\.location, club_name: prev\.club_name \} : c\)\);\s*setLayoutEstimated\(false\)/.test(cd) &&
      /Estimated layout — full course data not available yet\./.test(cd)
    );
  })(),
  'the uncalibrated putt distance reads as an estimate (~N, FEET (EST)) and an un-catalogued course shows an "Estimated layout" banner instead of presenting the 18×par-4×380y placeholder as a real scorecard');

// 2026-06-14 (audit — perf/battery) — the on-course dot tickers forced a fresh
// high-accuracy GPS pull (refreshFix → getOneShotFix maxAgeMs:0) every 3-4s from
// THREE components, on top of the already-running watch. peekFix rides the watch
// cache (≤3s) so the dot stays live without redundant pulses; refreshFix stays for
// the explicit Refresh button (which must be guaranteed-fresh).
check('Perf: on-course dot tickers ride the GPS watch cache (peekFix), not forced pulls',
  (() => {
    const svc = read('services/smartFinderService.ts');
    const sf = read('app/smartfinder.tsx');
    // 2026-07-04 (clean-audit) — SmartFinderCard.tsx deleted (confirmed orphan:
    // zero imports; the caddie.tsx hit was a comment). Check now covers the two
    // LIVE tickers (SmartFinder screen + hole preview).
    const prev = read('components/caddie/L1HolePreview.tsx');
    return (
      /export async function peekFix\(\): Promise<LastFix \| null>/.test(svc) &&
      /getOneShotFix\(\{ maxAgeMs: 3000 \}\)/.test(svc) &&
      // refreshFix keeps its forced-fresh maxAgeMs:0 for explicit refresh
      /const fix = await getOneShotFix\(\{ maxAgeMs: 0 \}\)/.test(svc) &&
      // both live timer callers ride peekFix
      /const fix = await peekFix\(\)/.test(sf) &&
      /await peekFix\(\)/.test(prev) &&
      !/await refreshFix\(\)/.test(prev)
    );
  })(),
  'the SmartFinder screen and hole-preview dot tickers read the running watch cache instead of forcing a high-accuracy GPS pull every 3-4s — the dominant avoidable on-course battery cost; the manual Refresh button stays guaranteed-fresh');

// 2026-06-14 (audit — perf) — SmartVisionTap was defined INSIDE L1HolePreview's
// render, so every 4s dot-tick made a new component type and React remounted the
// whole subtree (hero Image reload + ParallaxTilt DeviceMotion re-subscribe).
check('Perf: L1HolePreview SmartVisionTap is module-level (no 4s remount cascade)',
  (() => {
    const prev = read('components/caddie/L1HolePreview.tsx');
    // module-level component (declared BEFORE the default export, takes onPress)
    const defIdx = prev.search(/const SmartVisionTap: React\.FC<\{ onPress\?: \(\) => void; children: React\.ReactNode \}>/);
    const fnIdx = prev.search(/export default function L1HolePreview/);
    return (
      defIdx >= 0 && fnIdx >= 0 && defIdx < fnIdx &&        // defined at module scope, before the component
      /<SmartVisionTap onPress=\{onOpenSmartVision\}>/.test(prev) &&
      !/const SmartVisionTap: React\.FC<\{ children: React\.ReactNode \}>/.test(prev)  // old in-render def gone
    );
  })(),
  'the hole-preview tap wrapper is a stable module-level component, so the 4s GPS tick reconciles in place instead of remounting the image + parallax sensor every cycle');

// 2026-06-14 (audit — redundant work) — golfbert holes were re-fetched over the
// network on every hole switch even though the cache was populated. Now read-through.
check('Perf: golfbert holes served from cache (no per-hole refetch)',
  (() => {
    const g = read('services/golfbertApi.ts');
    return /const cached = golfbertCache\.get\(smartplayCourseId\);\s*\n\s*if \(cached && cached\.length > 0\) return cached;/.test(g);
  })(),
  'getGolfbertHolesForCourse returns the in-memory cache once fetched instead of re-hitting the network on every hole change');

// 2026-06-14 (audit — lifecycle/audio) — recordings/cameras left running on abrupt
// unmount kept the iOS audio session in record mode (muting later TTS) or left the
// camera recording. Both now clean up on unmount; the cage overlay reads a live
// phaseRef so the []-dep unmount sees the CURRENT phase, not the stale first render.
check('Lifecycle: cage-review + cage-overlay release mic/camera on unmount',
  (() => {
    const cr = read('app/cage-review/[review_session_id].tsx');
    const co = read('components/CageSessionOverlay.tsx');
    return (
      // cage-review: []-effect stops+unloads the in-flight recording and hands the
      // audio session back to playback so the next caddie line isn't silent.
      /return \(\) => \{[\s\S]{0,420}rec\.stopAndUnloadAsync\(\)[\s\S]{0,120}configureAudioForSpeech\(\)/.test(cr) &&
      // cage-overlay: live phaseRef + cleanup reads it (no stale 'requesting' closure)
      /const phaseRef = useRef\(phase\);\s*\n\s*phaseRef\.current = phase;/.test(co) &&
      /if \(phaseRef\.current === 'recording'\) \{\s*\n\s*cameraRef\.current\?\.stopRecording\(\)/.test(co)
    );
  })(),
  'navigating away mid-answer/mid-record stops the recorder + camera and restores the speech audio session — no more muted caddie or orphaned camera after an abrupt exit');

// 2026-06-14 (audit — VAD races) — the listen loop could run two recorders fighting
// for the mic (restart racing a manual start) and the silence poller re-fired the
// stop every 200ms with a floating promise. Now: re-entrancy guard + cancel token,
// and the silence interval clears itself before firing exactly once.
check('Lifecycle: VAD start is single-flight + silence poller fires once',
  (() => {
    const v = read('hooks/useVoiceActivityDetection.ts');
    const vc = read('hooks/useVoiceCaddie.ts');
    return (
      /if \(startingRef\.current \|\| recordingRef\.current\) return;/.test(v) &&   // no double-start
      /stopTokenRef\.current \+= 1;/.test(v) &&                                       // stop cancels in-flight start
      /if \(stopTokenRef\.current !== myToken \|\| !enabledRef\.current\)/.test(v) &&  // bail if cancelled mid-create
      // useVoiceCaddie silence poller fires the stop ONCE via the single-flight
      // hardStopAndProcess fn (refreshed: was an inline handleMicPress call). It
      // clears the poller + nulls recordingRef (idempotent guard) so it can't double-fire.
      /const hardStopAndProcess = async \(\) => \{/.test(vc) &&
      /clearInterval\(silenceVadTimer\.current\); silenceVadTimer\.current = null;/.test(vc) &&
      /recordingRef\.current = null;/.test(vc) &&
      /void hardStopAndProcess\(\)\.catch/.test(vc)
    );
  })(),
  'the auto-listen loop never runs two competing recorders, a stop/disable mid-acquire cancels cleanly, and the silence detector fires the stop exactly once instead of every 200ms');

// 2026-06-14 (audit — GPS refresh) — concurrent forceRefreshGps calls tore down each
// other's watch + raced the poll; a thrown/timed-out refresh still showed a confident
// "confirmed hole" toast off stale data. Now: single-flight refresh + honest toast.
check('Lifecycle: GPS force-refresh is single-flight + honest on failure',
  (() => {
    const g = read('services/gpsManager.ts');
    const a = read('services/refreshGpsAction.ts');
    return (
      /let refreshInFlight: Promise<GpsFix \| null> \| null = null;/.test(g) &&
      /if \(refreshInFlight\) return refreshInFlight;/.test(g) &&
      /} finally \{\s*\n\s*refreshInFlight = null;/.test(g) &&
      // honest toast: a confident confirmation only when a FRESH fix actually came back
      /else if \(freshFix\) \{[\s\S]{0,200}Confirmed hole/.test(a) &&
      /Still searching for a strong GPS signal/.test(a)
    );
  })(),
  'tapping Refresh GPS twice coalesces onto one fresh-fix attempt, and a timeout/failure says "still searching" instead of masking it with a confident confirmation off a stale fix');

// 2026-06-10 — Brain works the FIRST ask: minimal-body retry + warm-on-open.
const voiceCaddieSrc = read('hooks/useVoiceCaddie.ts');
check('Brain has a minimal-body fail-safe retry (survives context throw / 413)',
  /brain minimal-retry failed/.test(voiceCaddieSrc) &&
    /throw new Error\(`brain_http_\$\{res\.status\}`\)/.test(voiceCaddieSrc) &&
    !/Hit a snag on my end/.test(voiceCaddieSrc),
  'a context-builder throw or a too-large-payload 413 retries once with a minimal body against the healthy endpoint, so the first ask still answers');

check('Cage-session context build is throw-proof',
  /Array\.isArray\(s\.shots\) \? s\.shots : \[\]/.test(voiceCaddieSrc),
  'a malformed session in history can no longer crash the brain context builder');

check('Caddie brain is warmed whenever the tab is open (not only in a round)',
  // 2026-06-16 — the per-tab __ping__ keepWarm was removed; warming is now the
  // app-wide prewarmVoice heartbeat (NOT round-gated) plus a warm on caddie-tab
  // focus. Kevin is one of the four WARMUP_PATHS, so the brain stays hot off-course.
  /'\/api\/kevin'/.test(read('services/voiceWarmup.ts')) &&
    /export function prewarmVoice/.test(read('services/voiceWarmup.ts')) &&
    /voiceEnabled\) \{[\s\S]*?prewarmVoice\(\);/.test(read('app/(tabs)/caddie.tsx')) &&
    !/if \(!useRoundStore\.getState\(\)\.isRoundActive\) return;/.test(read('app/(tabs)/caddie.tsx')),
  'off-course "good morning Kevin" hits a warm Lambda (app-wide heartbeat + caddie-focus warm)');

// 2026-06-10 — Provider architecture: Anthropic spine, Gemini fast fallback,
// OpenAI out of analysis (ears/mouth only). (swingApiSrc declared above.)
check('Analysis providers: Gemini primary + OpenAI gpt-4o escalation (Anthropic pulled from normal escalation)',
  // 2026-06-27 — refreshed: the analysis chain migrated OFF Anthropic to
  // Gemini-primary → OpenAI-escalation. (Was: Anthropic spine + Gemini fallback.)
  /Gemini 2\.5 Flash = speed primary/.test(swingApiSrc) &&
    /OpenAI gpt-4o = quality escalation/.test(swingApiSrc) &&
    /new OpenAI\(/.test(swingApiSrc) &&
    /escalating to OpenAI gpt-4o/.test(swingApiSrc),
  'swing analysis runs Gemini 2.5 Flash as the speed primary and escalates to OpenAI gpt-4o for quality; Anthropic is no longer in the normal escalation chain');

check('SmartMotion warms the analyzer on open (warm first analysis)',
  /prewarmSwingAnalysis\(\{ force: true \}\)/.test(smSrc) &&
    /Warm \/api\/swing-analysis the moment SmartMotion opens/.test(smSrc),
  'opening SmartMotion FORCE pre-warms /api/swing-analysis (bypasses the 60s dedupe) so the first recording analyzes fast even if another screen warmed recently');

// 2026-06-10 — Ball area threaded into the SWING read (was putt-only).
check('Ball/stand anchor wired into swing analysis',
  /ball_area_norm: draftBallRef\.current \?\? ballAreaRef\.current \?\? null/.test(smSrc) &&
    /ball_area_norm: ballAreaRef\.current \?\? draftBallRef\.current \?\? null/.test(smSrc) &&
    /target_norm: targetPointRef\.current \?\? null/.test(smSrc),
  'both swing analyzeSwing calls pass the ball/target anchor (read via refs) so the analyzer uses the setup prior');

// 2026-06-10 — Foot-placement guides removed (read goofy; analysis never used them).
const hudSrc = read('components/smartmotion/SmartMotionHud.tsx');
check('Foot-placement stance anchors removed from SmartMotion capture guides (all orientations)',
  !/function StanceFeet\(/.test(hudSrc) &&     // component gone
    !/<StanceFeet\b/.test(hudSrc) &&            // not rendered in either orientation
    !/styles\.footAnchor|footDot:|footLabel:/.test(hudSrc),  // orphaned styles cleaned up
  'the lead/trail foot anchors are gone from both face-on and down-the-line capture guides; the framing lines (TARGET/BALL) remain');

// 2026-06-10 — Clips persisted to documents so old uploads/recordings replay + re-analyze.
const uploadSrc = read('services/videoUpload.ts');
check('Captured clips persisted to documents (survive OS cache eviction)',
  /export async function persistClipToDocuments\(/.test(uploadSrc) &&
    /swing_clips\//.test(uploadSrc) &&
    /await persistClipToDocuments\(ingestUri/.test(uploadSrc) && // refreshed: var ingestUri/sessionId (was args.uri)
    /persistClipToDocuments\(rawUri\)/.test(smSrc) &&
    /not found on this device/.test(read('app/swinglab/swing/[swing_id].tsx')),
  'uploads + SmartMotion recordings are copied to documentDirectory so they stay replayable/re-analyzable; a missing source clip gives an honest "re-upload" message instead of a stuck spinner');

// 2026-06-10 — Re-analyze hardening: persist content:// picks, rescue legacy
// clips on open, and tell the truth when frames won't extract (codec/VFR, not
// "lighting"). Root fixes, not patches.
const swingDetailSrc = read('app/swinglab/swing/[swing_id].tsx');
check('Re-analyze hardening: content:// persisted, legacy clips rescued on open, honest no-frames copy',
  /uri\.startsWith\('file:'\) \|\| uri\.startsWith\('content:'\)/.test(uploadSrc) &&  // content:// now persisted
    /setShotClipUri:/.test(read('store/cageStore.ts')) &&                            // repoint action exists
    /legacy-clip-rescued/.test(swingDetailSrc) &&                                    // rescue effect wired
    /setShotClipUri\(swing_id, shotId, durable\)/.test(swingDetailSrc) &&
    !/better lighting and a wider angle/.test(uploadSrc) &&                          // misleading copy gone
    /can't sample for analysis, even though it plays/.test(uploadSrc),              // honest codec copy
  'content:// picks are persisted to documents, legacy/volatile clips are rescued into documentDirectory on first open, and an unreadable-frames failure names the real cause (format/frame-rate) instead of blaming lighting');

// 2026-06-10 — SPINE FIX: one API base resolver. EXPO_PUBLIC_API_URL is absent
// from eas-update bundles (only eas.json build.env has it), so ~85 sites doing
// `?? ''`/`?? 'localhost'` produced "Invalid URL: /api/voice" — voice, brain,
// and analysis all silently failed. Now a single getApiBaseUrl() with a prod
// fallback that can never emit a relative/dead URL; no site reads the env raw.
const apiBaseSrc = read('services/apiBase.ts');
check('API base URL — one resolver, single custom-domain host, no *.vercel.app failover',
  /export function getApiBaseUrl/.test(apiBaseSrc) &&
    /https:\/\/api\.smartplaycaddie\.com/.test(apiBaseSrc) &&             // the branded custom domain is THE host
    !/const FALLBACK_HOST/.test(apiBaseSrc) &&                            // 2026-07-08: harmful failover to the blocklisted *.vercel.app removed
    !/activeBase = other/.test(apiBaseSrc) &&                             // ensureBackendReachable never switches hosts anymore
    /\^https\?:\\\/\\\/\.\+/.test(apiBaseSrc) &&                          // absolute-url guard present
    !/EXPO_PUBLIC_API_URL \?\? /.test(read('hooks/useVoiceCaddie.ts')) && // voice no longer reads env raw
    !/EXPO_PUBLIC_API_URL \?\? /.test(read('hooks/useKevin.ts')) &&       // brain no longer reads env raw
    /getApiBaseUrl\(\)/.test(read('hooks/useVoiceCaddie.ts')),
  'every backend fetch resolves through getApiBaseUrl() (absolute prod custom-domain fallback, never relative/dead), and the app no longer fails over to the content-filter-blocklisted *.vercel.app alias — the root cause of the recurring on-course voice death');

// 2026-06-10 — Voice warmup coverage. prewarmVoice() previously fired ONLY on the
// greeting screen, so the first mic tap after navigating in (or after the app
// backgrounded long enough for the Lambdas to idle out) paid full cold-start —
// the "thinking forever → took too long" first turn. Now the voice hook warms on
// mount of any voice surface AND on app foreground.
const vcWarmSrc = read('hooks/useVoiceCaddie.ts');
check('Voice warmup fires on voice-surface mount + app foreground (not just greeting)',
  /import \{ prewarmVoice \} from '\.\.\/services\/voiceWarmup'/.test(vcWarmSrc) &&
    /AppState\.addEventListener\('change'/.test(vcWarmSrc) &&
    /next === 'active'\) \{ warmIfVoice\(\); startHeartbeat\(\); \}/.test(vcWarmSrc) &&
    /voiceEnabled\) prewarmVoice\(\)/.test(vcWarmSrc),
  "useVoiceCaddie warms the four voice Lambdas whenever a voice surface mounts and whenever the app returns to the foreground (gated on voiceEnabled, 30s-deduped) so the FIRST mic tap is hot — not the third");

// 2026-06-10 — Pre-response conversational filler removed. With the warm brain at
// 4-6s, a filler firing at 400ms finished ~2s in and left dead air (or got chopped),
// and double-acknowledged the brain's own natural opening. The main voice path now
// awaits the brain directly. (Tool-action ack clips stay.)
check('Pre-response conversational filler removed from the main voice path',
  !/FILLER_DELAY_MS/.test(vcWarmSrc) &&
    !/getClipForCategory\(classifyQuery/.test(vcWarmSrc) &&
    /const rawResponse = await sendToBrain\(transcript\)/.test(vcWarmSrc),
  "the 'Let me see...' bridge no longer fires before Kevin's reply (it conflicted with the now-fast brain that already opens conversationally); the brain response is awaited directly and tool-action ack clips are untouched");

// 2026-06-11 — Environment mode phase 1: range gets a longer window AND now keeps
// the metered track (acoustic candidates the video confirms). Course stays off.
const smEnvSrc = read('app/swinglab/smartmotion.tsx');
check('Environment mode phase 1: range window + metering gating (cage+range on, course off)',
  /environmentMode: 'cage' \| 'range' \| 'course'/.test(read('store/settingsStore.ts')) &&
    /RANGE_RECORDING_MAX_SECONDS = 120/.test(smEnvSrc) &&
    /captureMode === 'range' \? RANGE_RECORDING_MAX_SECONDS : RECORDING_MAX_SECONDS/.test(smEnvSrc) &&
    /\? \(captureMode === 'cage' \|\| \(captureMode === 'course' && !roundActive\)\)/.test(smEnvSrc) && // chip: cage+course (off-round)
    /: \(captureMode === 'cage' \|\| captureMode === 'range'\)/.test(smEnvSrc) &&                       // default: cage+range
    /setEnvironmentMode\(environmentMode === 'cage'/.test(smEnvSrc),                  // toggle cycles modes
  'range records up to 120s and now ALSO runs the metered audio track (its strikes are candidates the in-frame video confirms); ONLY course goes acoustics-off (wind, single shot); a setup-rail toggle cycles cage/range/course');

// 2026-06-11 — Environment mode phase 2: RANGE correlates acoustics with video.
// Acoustics propose WHEN, the in-frame video locator disposes WHICH are yours.
check('Environment mode phase 2: range acoustic↔video correlation (propose/dispose)',
  /export function correlateStrikesWithVideo/.test(read('services/swing/swingSegmentation.ts')) &&
    /export async function locateSwings/.test(read('services/poseDetection.ts')) &&
    /mode: 'locate_swings'/.test(read('services/poseDetection.ts')) &&
    /body\.mode === 'locate_swings'/.test(read('api/swing-analysis.ts')) &&
    /if \(stopMode === 'range'\) \{/.test(smEnvSrc) &&
    /correlateStrikesWithVideo\(acousticStrikes, swings, durMs\)/.test(smEnvSrc) &&
    /segmentsFromVideoSwings\(swings, durMs\); \/\/ nothing heard cleanly/.test(smEnvSrc) &&
    // 2026-07-08 (segmentation audit #3) — acoustic-only best effort now rebound-filtered.
    /segmentsFromStrikes\(filterReboundStrikes\(acousticStrikes\), durMs\)/.test(smEnvSrc),
  'range makes the VIDEO locator the spine (count never inflated by a neighbour); correlateStrikesWithVideo snaps each acoustic candidate onto its in-frame swing for a precise impact + peakDb; degrades to video-only (nothing heard) or acoustic-only (vision empty); unmatched neighbour strikes are dropped');

// 2026-06-11 — Behavioral: the correlation itself is neighbour-proof + precise.
// Two in-frame video swings (~5s, ~12s); acoustic candidates include a MATCH for
// each (slightly off in time, loud) PLUS a neighbour strike at ~8.4s with no
// video swing near it. Expect: 2 segments (video count, neighbour dropped), each
// with the precise acoustic strikeMs + real peakDb.
{
  const videoSwings = [
    { timeSec: 5.0, confidence: 'high' as const },
    { timeSec: 12.0, confidence: 'low' as const },
  ];
  const strikes = [
    { timeMs: 5180, peakDb: 41, attackMs: 12, confidence: 'high' as const },   // matches swing 1 (+180ms)
    { timeMs: 8420, peakDb: 38, attackMs: 9, confidence: 'high' as const },    // NEIGHBOUR — no video swing
    { timeMs: 12350, peakDb: 30, attackMs: 15, confidence: 'medium' as const },// matches swing 2 (+350ms)
  ];
  const segs = correlateStrikesWithVideo(strikes, videoSwings, 60_000);
  const neighbourDropped = segs.length === 2;
  const s0Precise = segs[0]?.strikeMs === 5180 && segs[0]?.peakDb === 41;       // acoustic donated time+energy
  const s1Precise = segs[1]?.strikeMs === 12350 && segs[1]?.peakDb === 30;
  const s1ConfUpgraded = segs[1]?.confidence === 'medium';                       // low video ∪ medium acoustic → medium
  check('SmartMotion: range correlation is neighbour-proof + acoustic-precise (behavioral)',
    neighbourDropped && s0Precise && s1Precise && s1ConfUpgraded,
    `2 swings in frame + a stray neighbour strike → ${segs.length} segments (expect 2), strikeMs ${segs[0]?.strikeMs}/${segs[1]?.strikeMs} with peakDb ${segs[0]?.peakDb}/${segs[1]?.peakDb}: the neighbour at 8.42s is dropped (no in-frame swing), each kept swing carries its confirmed acoustic impact + energy`);

  // A swing the mic never heard cleanly still survives (visual time, peakDb 0).
  const unheard = correlateStrikesWithVideo(
    [{ timeMs: 5180, peakDb: 41, attackMs: 12, confidence: 'high' as const }],
    [{ timeSec: 5.0, confidence: 'high' as const }, { timeSec: 30.0, confidence: 'low' as const }],
    60_000,
  );
  check('SmartMotion: range correlation keeps an unheard in-frame swing (degrade, not drop)',
    unheard.length === 2 && unheard[1]?.peakDb === 0 && unheard[1]?.strikeMs === 30_000,
    `a 2nd in-frame swing with no acoustic match is kept at its visual time with peakDb 0 (still your swing, just not heard) → ${unheard.length} segments, swing2 peakDb ${unheard[1]?.peakDb}`);
}

// 2026-06-10 — Environment mode phase 3: course = acoustics off + single shot,
// and a live round forces course.
check('Environment mode phase 3: course is acoustics-off single-shot; a live round forces course',
  /const effectiveMode.*isRoundActive \? 'course' : environmentMode/.test(smEnvSrc) &&           // round forces course (reactive)
    /isRoundActive[\s\S]{0,30}\? 'course'[\s\S]{0,60}environmentMode/.test(smEnvSrc) &&           // and at capture time
    /const useMetering = chipOnStart/.test(smEnvSrc) &&                                            // metering is mode+chip-aware; course off by default
    /disabled=\{isRoundActive\}/.test(smEnvSrc),                                                    // toggle locked during a round
  'course mode disables acoustics (wind) and is single-shot (skips multi-segmentation → single-swing localization); metering runs for cage+range but NOT course; a live round forces course sensing regardless of the practice toggle, which is locked + shows CRSE on-course');

// 2026-06-10 — Multi-swing UPLOAD expansion: a 60s uploaded video with several
// swings gets one per-swing card, not "1 of 1".
const uploadSrc2 = read('services/videoUpload.ts');
check('Multi-swing UPLOAD expansion (long upload → one analysis per swing)',
  /expandUploadIntoSwings/.test(read('store/cageStore.ts')) &&
    /MULTI_SWING_UPLOAD_MIN_MS/.test(uploadSrc2) &&
    /pose\.locateSwings\(swings\[0\]\.clipUri, durMs\)/.test(uploadSrc2) &&
    /store\.expandUploadIntoSwings\(sessionId/.test(uploadSrc2) &&
    /upload-multi-swing-expand/.test(uploadSrc2),
  'a single uploaded clip long enough to hold multiple swings runs locateSwings; if >1 found, the session is expanded into one windowed shot per swing (each analyzed + carded) reusing the per-shot loop, instead of analyzing the whole clip as one swing');

// 2026-06-10 — Audible end-of-window cue (auto-stop only, mode-aware).
check('Smart Motion end-of-window audible cue (auto-stop only, mode-aware)',
  /autoStopAtLimitRef\.current = true/.test(smEnvSrc) &&            // flagged when the window auto-ends
    /if \(autoStopAtLimitRef\.current\) \{/.test(smEnvSrc) &&         // cue only on auto-stop (not manual)
    /windowSec >= 120 \? 'two minutes' : 'minute'/.test(smEnvSrc) &&  // mode-aware duration
    /Vibration\.vibrate/.test(smEnvSrc),
  'when the recording window AUTO-ends (not a manual stop), a light haptic + a brief mode-aware caddie cue (your minute / two minutes — analyzing now) plays best-effort so the player knows to stop swinging; gated on voiceEnabled, never blocks analysis');

// 2026-06-10 — Pose pipeline is angle-aware (knows DTL from FO).
const poseApiSrc = read('services/poseAnalysisApi.ts');
check('Pose/biomech pipeline is angle-aware (DTL vs FO)',
  /angle\?: 'down_the_line' \| 'face_on' \| 'glasses_pov' \| null/.test(poseApiSrc) &&
    /if \(angle === 'down_the_line'\) \{\s*\n\s*hipTurnDeg = null;\s*\n\s*shoulderTurnDeg = null;\s*\n\s*weightShiftPct = null;/.test(poseApiSrc) &&
    // 2026-07-07 (biomech audit) — DTL also nulls the same-geometry sequencing +
    // hip-slide; face-on nulls the tilt (projection inflates it with the turn);
    // glasses_pov nulls all angular metrics. And the pelvis-in-stance weight shift
    // replaced the planted-ankle drift that read ~0 on every swing.
    /sequencingScore = null;\s*\n\s*hipSlideRatio = null;/.test(poseApiSrc) &&
    /if \(angle === 'face_on'\) \{\s*\n\s*shoulderTiltDeg = null;/.test(poseApiSrc) &&
    /if \(angle === 'glasses_pov'\)/.test(poseApiSrc) &&
    /pelvisImpact - pelvisAddr/.test(poseApiSrc) &&
    /computeBiomechanicsFromFrames\(frames, angle/.test(smSrc),
  'down-the-line nulls turn/weight/sequencing/hip-slide (invalid from behind), face-on nulls the projected tilt, glasses nulls all angular reads; weight shift measures the pelvis-in-stance move; angle threaded end-to-end');

// 2026-06-10 — Caddie CNS Phase 1: memory store + writers (additive, honest).
const memSrc = read('store/caddieMemoryStore.ts');
const roundSrc = read('store/roundStore.ts');
check('Caddie CNS Phase 1: memory store is additive, persisted, honest, bounded',
  /name: 'caddie-memory-v1'/.test(memSrc) &&
    /recordShot:/.test(memSrc) && /recordRoundEnd:/.test(memSrc) && /recordSwingFault:/.test(memSrc) &&
    /samples >= MIN_SAMPLES \? Math\.round\(avg\) : null/.test(memSrc) &&  // honesty: null until learned
    /MAX_REFLECTIONS|MAX_COURSE_NOTES/.test(memSrc),                        // bounded growth
  'persisted per-player/course memory; learned distances stay null until enough real samples; growth is capped');

check('Caddie CNS Phase 1 writers wired (shot + round + fault), best-effort',
  /useCaddieMemoryStore\.getState\(\)\.recordShot\(/.test(roundSrc) &&
    /useCaddieMemoryStore\.getState\(\)\.recordRoundEnd\(/.test(roundSrc) &&
    /useCaddieMemoryStore\.getState\(\)\.recordSwingFault\(/.test(smSrc) &&
    /caddie-memory recordShot failed \(non-fatal\)/.test(roundSrc),
  'real carries feed the bag, round-end distills per-course memory, swing faults roll the dominant miss — all wrapped so they can never break the hot path');

// 2026-06-10 — Caddie CNS Phase 2: retrieval layer feeds the brain.
const retrievalSrc = read('services/caddieMemoryRetrieval.ts');
const kevinHookSrc = read('hooks/useKevin.ts');
const voiceHookSrc = read('hooks/useVoiceCaddie.ts');
check('Caddie CNS Phase 2: retrieval is sync, never-throws, gated, honest',
  /export function getCaddieContext\(/.test(retrievalSrc) &&
    /CNS_RETRIEVAL_ENABLED/.test(retrievalSrc) &&
    /catch \{\s*\n?\s*return EMPTY;/.test(retrievalSrc) &&
    /live GPS still wins/.test(retrievalSrc),
  'getCaddieContext returns a compact null-safe slice, can never throw, is flag-gated, and tells the brain memory is a prior (GPS still wins live)');

check('Caddie CNS Phase 2 wired into BOTH brain paths (live + memory merged)',
  // 2026-06-13 (audit G5) — voice path upgraded: it now MERGES the live context block
  // with the CNS slice (was CNS-only), matching useKevin. Both paths send the merged
  // unified_context_block the server pastes — no server change.
  /mergeMemoryIntoContext\(\s*\n?\s*unifiedPromptBlock/.test(kevinHookSrc) &&
    /getUnifiedVisionContext\(\)\)\.promptBlock/.test(voiceHookSrc) &&
    /unified_context_block: mergeMemoryIntoContext\(\s*\n\s*liveBlock,/.test(voiceHookSrc),
  'typed-chat (useKevin) AND voice (useVoiceCaddie) both merge the LIVE context block with the CNS memory slice into unified_context_block — the field the server already pastes');

// 2026-06-10 — CNS Phase 3 (reflection loop) + Phase 4 (signal-independence).
const memStoreSrc = read('store/caddieMemoryStore.ts');
const retrSrc = read('services/caddieMemoryRetrieval.ts');
check('Caddie CNS Phase 3: durable round reflections (baseline + recap enrichment, deduped)',
  // 2026-06-13 (audit G1 fix) — the baseline reflection now runs course-LESS too.
  /Player-level REFLECTION/.test(roundSrc) &&
    /recordReflection\(\{/.test(roundSrc) &&
    /CNS Phase 3 — enrich the round's durable reflection/.test(read('services/recapGenerator.ts')) &&
    /p\.reflections\.filter\(\(r\) => r\.round_id !== round_id\)/.test(memStoreSrc),
  'round end writes an honest baseline reflection (course-less rounds too); the recap LLM summary enriches it; recordReflection dedupes by round');

check('Caddie CNS Phase 4: signal-independence (answer from course memory when GPS weak)',
  /export function getCourseHoleGuidance\(/.test(retrSrc) &&
    /From memory on hole/.test(retrSrc) &&
    /hm\.played < MIN_HOLE_PLAYS_FOR_GUIDANCE/.test(retrSrc) &&
    /CNS Phase 4 — signal-independence/.test(read('services/localStatusResponder.ts')) &&
    /getCourseHoleGuidance\(\{ courseId: round\.activeCourseId, hole: round\.currentHole \}\)/.test(read('services/localStatusResponder.ts')),
  'on a repeat course with no/weak GPS, the local responder answers from learned course-hole memory (typical club/line/green) instead of going silent');

// 2026-06-10 — Open Thread #2: clip-storage GC. Persisted swing clips + fault
// frames leak when sessions age out of the 50-session window; a boot mark-and-
// sweep reclaims orphans. Safety: hydration gate (never sweep empty pre-hydration
// state), basename match (prefix-drift-proof), all roots (sessions + heroMoments).
const clipGcSrc = read('services/clipStorageGc.ts');
const rootLayoutSrc = read('app/_layout.tsx');
check('Clip-storage GC: boot mark-and-sweep reclaims orphaned clip files (hydration-gated)',
  /export async function gcOrphanClips\(/.test(clipGcSrc) &&
    /hasHydrated/.test(clipGcSrc) &&                       // guard 1: never sweep pre-hydration
    /heroMoments/.test(clipGcSrc) &&                       // guard 3: all referencing roots
    /shot\.clipUri/.test(clipGcSrc) &&
    /referenced\.has\(name\)/.test(clipGcSrc) &&           // guard 2: basename match, keep referenced
    /gcOrphanClips\(\)/.test(rootLayoutSrc),               // wired into boot-guard
  'sessions age out via slice(-50) with no file cleanup; a hydration-gated boot sweep deletes clip/frame files no session or hero moment references');

// 2026-06-10 — Analysis pretext: handedness + CNS learned tendencies feed the analyzer.
// 2026-06-10 — B1: central handicap-tier constants (single source of truth).
const tiersSrc = read('constants/handicapTiers.ts');
check('Handicap tiers: single source of truth + behaviour-neutral refactor',
  /export function deriveTier\(/.test(tiersSrc) &&
    /export const DEFAULT_HANDICAP = 18/.test(tiersSrc) &&
    /export function tierToComplexity\(/.test(tiersSrc) &&
    /COMPLEXITY_ADVANCED_MAX_HCP/.test(read('services/coachingAdaptation.ts')) &&
    /STRENGTH_LABEL_BREAKS\.precision/.test(read('services/patternDetection.ts')) &&
    /DISPERSION_HCP_BREAKS\.tight/.test(read('app/smartfinder.tsx')),
  'handicap tier bands + thresholds live in one file; the scattered magic numbers now reference it at unchanged values (behaviour-neutral)');

check('Analyzer gets handedness + CNS-learned tendencies pretext',
  /handedness\?: 'left' \| 'right' \| null/.test(poseSrc) &&
    /Swinger is \$\{ctx\.handedness\.toUpperCase\(\)\}-HANDED/.test(swingApiSrc) &&
    /handedness: swingerHandedness/.test(smSrc) &&
    /dominant_miss: cnsTend\.dominantMiss \?\? profile\.dominantMiss/.test(smSrc) &&
    /prior_issues: cnsTend\.recentFaults\.length > 0/.test(smSrc),
  'the swing analyzer is told handedness (mirrors direction-dependent faults) and the CNS learned dominant-miss + recent faults as soft priors — closing the brain→analysis loop, with the visual read still winning');

// ─── Smart freehand annotation (geometry fitting) ───────────────────────────────
{
  // Crooked-but-straight line (finger wobble ±3px) → straightened to a line,
  // preserving the drawn orientation/extent.
  let lineD = 'M 20 200';
  for (let i = 1; i <= 30; i++) lineD += ` L ${20 + i * 6} ${200 - i * 5 + (i % 2 ? 3 : -3)}`;
  const lineCls = classifyStroke(lineD);
  check('Smart freehand: crooked line straightens',
    lineCls.kind === 'line' &&
      Math.abs(lineCls.x1 - 20) < 12 && Math.abs(lineCls.y1 - 200) < 12,
    'a roughly-straight finger stroke becomes a clean line with the drawn endpoints preserved (not extended to edges)');

  // Wobbly vertical → line (PCA fit handles verticals; a y=mx+b fit could not).
  let vertD = 'M 100 20';
  for (let i = 1; i <= 25; i++) vertD += ` L ${100 + (i % 2 ? 4 : -4)} ${20 + i * 7}`;
  check('Smart freehand: vertical line straightens', classifyStroke(vertD).kind === 'line',
    'a near-vertical stroke straightens (total-least-squares fit, not slope-based)');

  // Sloppy near-closed circle → snapped to a clean focus circle near the true center/radius.
  let circD = 'M 200 150';
  for (let i = 1; i <= 40; i++) {
    const a = (i / 40) * 2 * Math.PI; const r = 50 + (i % 3 ? 4 : -4);
    circD += ` L ${(150 + r * Math.cos(a)).toFixed(1)} ${(150 + r * Math.sin(a)).toFixed(1)}`;
  }
  const circCls = classifyStroke(circD);
  check('Smart freehand: sloppy circle snaps clean',
    circCls.kind === 'circle' &&
      Math.abs(circCls.cx - 150) < 10 && Math.abs(circCls.cy - 150) < 10 &&
      Math.abs(circCls.r - 50) < 10,
    'a sloppy loop around a hip/shoulder snaps to a clean circle at the true center + radius');

  // Genuine 120° traced arc → stays freehand (we never flatten an intended curve).
  let arcD = 'M 100 50';
  for (let i = 1; i <= 20; i++) {
    const a = (-Math.PI / 2) + (i / 20) * (2 * Math.PI / 3);
    arcD += ` L ${(100 + 60 * Math.cos(a)).toFixed(1)} ${(120 + 60 * Math.sin(a)).toFixed(1)}`;
  }
  check('Smart freehand: real arc stays freehand', classifyStroke(arcD).kind === 'freehand',
    'a deliberately curved 120° stroke (e.g. tracing a swing arc) is NOT straightened');

  // Scribble + a too-short tick → freehand (only replace strokes we are sure about).
  let scribD = 'M 10 10';
  for (const [x, y] of [[40, 80], [70, 15], [100, 90], [130, 20], [160, 85], [60, 60]]) scribD += ` L ${x} ${y}`;
  check('Smart freehand: scribble + short tick stay freehand',
    classifyStroke(scribD).kind === 'freehand' &&
      classifyStroke('M 10 10 L 13 12 L 16 14').kind === 'freehand',
    'ambiguous scribbles and tiny ticks are left as raw freehand, never force-fit');

  // The overlay actually wires the classifier into the freehand commit path.
  const overlaySrc = fs.readFileSync(path.resolve(__dirname, '../../components/swinglab/VideoAnnotationOverlay.tsx'), 'utf-8');
  check('Smart freehand: overlay routes freehand release through classifyStroke',
    /classifyStroke\(d\)/.test(overlaySrc) &&
      /cls\.kind === 'line'/.test(overlaySrc) &&
      /cls\.kind === 'circle'/.test(overlaySrc),
    "the freehand PanResponder release classifies the stroke and commits a clean line/roi when confident, raw freehand otherwise");
}

// ─── Bulk round-list import (Golfshot history → handicap backfill) ───────────────
{
  // Representative rows from Tim's real Golfshot history (the screenshots he sent):
  // 9-hole rounds land in the 30s/40s, 18-hole rounds in the 80s/90s, and a
  // couple of rows are in-progress with no score.
  const rows: ListedRoundRow[] = [
    { played_date: '2026-06-04', course_name: 'Echo Hills Golf Club - Echo Hills', total_score: 39, score_vs_par: 4, holes_played: null },  // par 35 → 9h (vs-par)
    { played_date: '2026-05-25', course_name: 'Menifee Lakes Country Club - Palms', total_score: null, score_vs_par: null, holes_played: null }, // no score → drop
    { played_date: '2026-05-21', course_name: 'Menifee Lakes Country Club - Palms', total_score: null, score_vs_par: null, holes_played: null }, // no score → drop
    { played_date: '2026-05-06', course_name: 'Menifee Lakes Country Club - Palms', total_score: 4, score_vs_par: 0, holes_played: null },   // par 4 → abandoned → drop
    { played_date: '2026-04-18', course_name: 'Menifee Lakes Country Club - Lakes', total_score: 87, score_vs_par: 15, holes_played: null }, // par 72 → 18h (vs-par)
    { played_date: '2026-02-13', course_name: 'Riverwalk Golf Club', total_score: 93, score_vs_par: 21, holes_played: null },               // par 72 → 18h (vs-par)
    { played_date: '2026-01-19', course_name: 'Echo Hills Golf Club - Echo Hills', total_score: 44, score_vs_par: null, holes_played: null }, // no vs-par → forties → 9h
    { played_date: '2025-12-16', course_name: 'The Golf Club at Rancho California', total_score: 55, score_vs_par: null, holes_played: 9 },  // stated 9 overrides (forties would say 18)
  ];
  const norm = normalizeImportedList(rows);

  check('Bulk import: drops no-score AND abandoned (sub-3/hole) rounds',
    norm.skippedNoScore === 2 && norm.skippedIncomplete === 1 && norm.keep.length === 5,
    'two blank-score rows dropped; the "4" abandoned round dropped as incomplete; 5 real rounds kept');

  const echo39 = norm.keep.find(r => r.totalScore === 39)!;
  check('Bulk import: hole count derived from par-played (vs-par), not gross guess',
    echo39.holesPlayed === 9 && echo39.nineHoleMode && echo39.holesSource === 'vs_par',
    "score−vsPar = par 35 → 9-hole, tagged vs_par (reliable signal, not the sub-50 gross guess)");

  const round87 = norm.keep.find(r => r.totalScore === 87)!;
  const round93 = norm.keep.find(r => r.totalScore === 93)!;
  check('Bulk import: 80s/90s (par ~72) are 18-hole rounds',
    round87.holesPlayed === 18 && !round87.nineHoleMode && round87.holesSource === 'vs_par' && round93.holesPlayed === 18,
    'a par-72 full-round stays 18-hole via par-played');

  const forties44 = norm.keep.find(r => r.totalScore === 44)!;
  check('Bulk import: forties rule still classifies a 9 when no vs-par is present',
    forties44.holesPlayed === 9 && forties44.holesSource === 'forties_rule',
    'a sub-50 gross with no vs-par falls back to the 9-hole guess');

  const stated = norm.keep.find(r => r.totalScore === 55)!;
  check('Bulk import: a stated hole count overrides the heuristics',
    stated.holesPlayed === 9 && stated.holesSource === 'stated',
    'when the screenshot says 9, a 55 is kept as 9-hole (forties would have called it 18)');

  const persist = buildListPersistInput(echo39);
  check('Bulk import: persist input matches addImportedRound shape',
    persist.holesPlayed === 9 && persist.nineHoleMode === true && persist.totalScore === 39 &&
      typeof persist.startedAt === 'number' && persist.startedAt < Date.parse('2026-06-05') &&
      Object.keys(persist.scores).length === 0,
    'list rounds persist with the gross + 9/18 flag and empty per-hole scores (handicap uses the total)');

  // The OCR endpoint actually supports the list mode this pipeline calls.
  const importApiSrc = fs.readFileSync(path.resolve(__dirname, '../../api/round-import.ts'), 'utf-8');
  check('Bulk import: round-import API has a list mode',
    /mode === 'list'/.test(importApiSrc) && /LIST_SYSTEM_PROMPT/.test(importApiSrc) && /rounds:/.test(importApiSrc),
    "/api/round-import branches on mode:'list' with a dedicated prompt + {rounds[]} response");

  // ── Audit fixes ──
  // #3: malformed rows (null/undefined) don't throw; valid rows still ingest.
  const dirty = normalizeImportedList(
    [null, undefined, { total_score: 44, course_name: 'X', played_date: '2026-01-01', score_vs_par: 8, holes_played: null }] as unknown as ListedRoundRow[],
  );
  check('Bulk import: tolerates null/malformed rows (audit #3)',
    dirty.keep.length === 1 && dirty.keep[0].totalScore === 44,
    'a null/undefined row in the OCR result is skipped without throwing; valid rows still ingest');

  // #1: bulk path suppresses per-round handicap math (the single rebuild owns it).
  const roundStoreSrc = fs.readFileSync(path.resolve(__dirname, '../../store/roundStore.ts'), 'utf-8');
  check('Bulk import: addImportedRound honors updateHandicap flag (audit #1)',
    /updateHandicap\?: boolean/.test(roundStoreSrc) &&
      /\(input\.updateHandicap \?\? true\) &&/.test(roundStoreSrc),
    'addImportedRound gates the per-round differential/index work on updateHandicap (default true; bulk passes false)');
  const listScreenSrc = fs.readFileSync(path.resolve(__dirname, '../../app/import-rounds-list.tsx'), 'utf-8');
  check('Bulk import: bulk caller passes updateHandicap:false + counts real adds (audit #1)',
    /updateHandicap: false/.test(listScreenSrc) && /roundHistory\.length - before/.test(listScreenSrc),
    'the bulk importer suppresses per-round handicap math and counts adds via the history-length delta (dedupe-aware)');

  // #2: re-imports are deduped on (day, course, score, holes).
  check('Bulk import: addImportedRound dedupes re-imports (audit #2)',
    /dedupe/.test(roundStoreSrc) && /dupKey/.test(roundStoreSrc) && /return dup\.id;/.test(roundStoreSrc),
    'a re-imported round matching an existing (day, course, score, holes) is skipped so duplicates do not inflate the handicap window');
}

// ─── Whole-app audit fixes (pre-SmartMotion-test-day) ───────────────────────────
{
  const smSrc2 = fs.readFileSync(path.resolve(__dirname, '../../app/swinglab/smartmotion.tsx'), 'utf-8');
  check('SmartMotion: cage falls back to video locator when acoustics under-detect',
    /else if \(stopMode === 'cage' && detectedSegments\.length <= 1\) \{/.test(smSrc2) &&
      /worthVideo/.test(smSrc2),
    'cage acoustics that zero out (loud bay) OR find ≤1 strike in a long clip (cage mode at an open range) cross-check the video locator and use it when it finds more — working multi-strike acoustic captures are untouched');

  check('SmartMotion: uploaded clips reuse the located window (skip the redundant 2nd locate)',
    // 2026-06-13 (SPEED) — >= 1 (was > 1): when the upload locate finds the swing,
    // pass it as boundaries so analyzeSwing skips its own ~25s locateSwingWindow.
    // Multi-swing still shows the reel (segs.length > 1); single swing → 1 segment;
    // swings.length === 0 still falls through to analyzeSwing's own locate.
    /pose\.locateSwings\(clipUriParam/.test(smSrc2) && /swings\.length >= 1/.test(smSrc2),
    'a re-analyzed upload runs the video locator once and reuses that window — no redundant double-locate; multi-swing reel + single-swing both work, 0-found still falls through');

  // 2026-06-11 — cage-test fix: "NO READ — RECORD AGAIN" was flashing as a
  // transient mid-pipeline state (bounded acoustic pass → whole-clip video re-scan)
  // before the real read landed. Now keyed off phase so it's strictly terminal.
  check('SmartMotion: NO-READ is terminal (phase-gated, not a mid-pipeline flash)',
    /return deriveVerdict\(analysis, phase === 'analyzing', swingContact\)/.test(smSrc2) &&
      /phase === 'review' && analysisError \? 'NO READ' : 'READING…'/.test(smSrc2),
    'the verdict shows ANALYZING for every in-flight pass (including the video re-scan) and only says NO READ once a read has terminally finished in review — no more fail-state flash before the read lands');

  // 2026-06-11 — cage-test fix: Save was a dead-end toast (deferred-wiring). The
  // session auto-ingests + analysis attaches, so it persisted — but Save now
  // confirms AND takes the user to the library (Tim: "didn't go to swing library").
  check('SmartMotion: confirmSave flushes the coach note + navigates to the library',
    /setSessionCoachNote\(sid, coachNote\)/.test(smSrc2) &&
      /router\.push\('\/swinglab\/library' as never\)/.test(smSrc2),
    'the explicit Save flushes any review-time coach note onto the already-persisted session and routes to the Swing Library so the saved swing is right there — no more silent no-op toast');

  // 2026-06-11 — cage-test fix: 4 swings all returned the SAME fault. Per-swing
  // analysis now hands the analyzer the distinct faults already read this session,
  // and the server (on swing 2+) pushes for a genuinely distinct secondary fault.
  const swingApiSrc = fs.readFileSync(path.resolve(__dirname, '../../api/swing-analysis.ts'), 'utf-8');
  // 2026-06-11 — drag-to-anchor ball/target. The recorded clip's FOV is a tighter
  // crop than the live preview (Samsung video crop), so a setup-placed box can land
  // off on playback. Box is now draggable in setup AND review; review = the actual
  // recorded frame, so dragging there is guaranteed-faithful and sticks to the session.
  const targetingSrc = fs.readFileSync(path.resolve(__dirname, '../../components/swinglab/CageTargetingCard.tsx'), 'utf-8');
  // 2026-06-11 — Framing Coach (Tim's "Golf Fix knows when you're in frame" idea).
  // On-device pose → evaluateFraming reads head+feet+centring from one frame.
  {
    const kp = (name: string, x: number, y: number, score = 0.9) => ({ name, x, y, score });
    // Full body, centred, head + feet in frame → framed.
    const framed = evaluateFraming([
      kp('nose', 0.5, 0.12), kp('left_shoulder', 0.42, 0.3), kp('right_shoulder', 0.58, 0.3),
      kp('left_hip', 0.45, 0.55), kp('right_hip', 0.55, 0.55),
      kp('left_ankle', 0.46, 0.86), kp('right_ankle', 0.54, 0.86),
    ]);
    // Feet not detected (ankles low score) → partial / feet_cut.
    const feetCut = evaluateFraming([
      kp('nose', 0.5, 0.12), kp('left_shoulder', 0.42, 0.3), kp('right_shoulder', 0.58, 0.3),
      kp('left_hip', 0.45, 0.55), kp('right_hip', 0.55, 0.55),
      kp('left_ankle', 0.46, 0.99, 0.05), kp('right_ankle', 0.54, 0.99, 0.05),
    ]);
    // No torso → no_person.
    const empty = evaluateFraming([kp('left_wrist', 0.5, 0.5, 0.4)]);
    check('SmartMotion: Framing Coach reads head+feet+centring (framed / feet-cut / no-person)',
      framed.status === 'framed' && !!framed.feetCenter &&
        Math.abs((framed.feetCenter?.x ?? 0) - 0.5) < 0.01 &&
        feetCut.status === 'partial' && feetCut.reason === 'feet_cut' &&
        empty.status === 'no_person',
      `a fully-in-frame golfer → framed (feetCenter ${framed.feetCenter?.x}); ankles at the bottom edge / low score → "step back, can't see your feet"; no torso → "step into frame". Drives the setup pill + the one-time "you're framed, start swinging" cue and the ball-box auto-anchor below the feet`);
  }

  // 2026-06-11 — chip/short-game sensitivity. A chip's impact is ~half energy, so
  // the default ~30dB threshold missed it; ON drops it to ~18dB above floor.
  // 2026-06-11 — geometry↔tempo/effort. The target's vertical distance above the
  // ball (vs the ball's room to the top) = declared effort; the read is graded
  // against that intended partial shot instead of a generic full swing.
  // 2026-06-11 — periodic auto club detection. It was never auto-fired (manual/voice
  // only despite the comment); now every 3rd cycle queues a SILENT scan for the next
  // setup, gated off the hands-free auto-record so it can't race the camera, and it
  // does NOT pop the club picker on a low-confidence auto read (only manual does).
  check('SmartMotion: club detection auto-fires every 3 cycles, silent + non-racing',
    /cycleCountRef\.current % 3 === 0\) clubScanDueRef\.current = true/.test(smSrc2) &&
      /phase !== 'setup' \|\| !clubScanDueRef\.current \|\| scanningClub \|\| pendingStartRef\.current/.test(smSrc2) &&
      /detectClubFromCamera\(\{ auto: true \}\)/.test(smSrc2) &&
      /\} else if \(!auto\) \{[\s\S]{0,120}setClubMenuOpen\(true\)/.test(smSrc2),
    'a completed recording bumps the cycle count; every 3rd queues a club scan fired silently the next time we settle in setup (NOT during the hands-free auto-record relaunch, so no camera race); a low-confidence AUTO read keeps the current club silently while a MANUAL scan still opens the picker');

  // 2026-06-11 — DTL ball-trace direction + colour (the honest shot tracer).
  {
    const ball = { x: 0.5, y: 0.8 };
    const target = { x: 0.5, y: 0.1 }; // aim straight up the frame
    // Ball departs straight up the aim line → straight, ~0°.
    const straight = computeTraceDirection(ball, { x: 0.5, y: 0.45 }, target);
    // Ball departs up-and-LEFT of the aim line → left, meaningful divergence.
    const left = computeTraceDirection(ball, { x: 0.38, y: 0.45 }, target);
    // Ball departs up-and-RIGHT → right.
    const right = computeTraceDirection(ball, { x: 0.62, y: 0.45 }, target);
    // No visible movement → null (no honest direction).
    const none = computeTraceDirection(ball, { x: 0.5, y: 0.795 }, target);
    const greenish = traceColor(0);     // on line → green family (high G)
    const reddish = traceColor(30);     // way off → red family (high R)
    const gOk = parseInt(greenish.slice(3, 5), 16) > parseInt(greenish.slice(1, 3), 16); // G > R
    const rOk = parseInt(reddish.slice(1, 3), 16) > parseInt(reddish.slice(3, 5), 16);    // R > G
    check('SmartMotion: ball-trace reads departure direction vs the aim line + colours it',
      straight?.side === 'straight' && left?.side === 'left' && right?.side === 'right' &&
        (left?.divergenceDeg ?? 0) > 5 && none === null && gOk && rOk,
      `straight departure → ON LINE (${straight?.divergenceDeg}°); left/right of the aim line → ${left?.side} ${left?.divergenceDeg}° / ${right?.side}; no visible movement → no line (honest); colour green when on-line (${greenish}) → red when way off (${reddish}). Real initial direction only — no fabricated arc`);
  }

  check('SmartMotion: ball-trace is DTL-only + wired to the real departure point + peakDb colour',
    /angle !== 'down_the_line' \|\| isPutt\) return null/.test(smSrc2) &&
      /ballDeparture\?\.departurePoint/.test(smSrc2) &&
      /computeTraceDirection\(ballArea, cvToContainer\(ballDeparture\.departurePoint\), targetPoint\)/.test(smSrc2) &&
      /traceColor\(ballTrace\.divergenceDeg, seg\?\.peakDb/.test(smSrc2) &&
      /ball_after_norm/.test(read('api/ball-departure.ts')) &&
      /<BallTraceOverlay trace=\{ballTrace\}/.test(smSrc2),
    'the trace runs DOWN-THE-LINE ONLY (never face-on/putt), off the real detected departure point (ball-departure server now returns ball_after_norm, mapped to full-frame), measured against the ball→target aim line and coloured by divergence + the segment peakDb — rendered only in review');

  check('SmartMotion: geometry→effort grades the read + LIVE interactive DTL readout',
    /Intended effort \(from geometry\)/.test(swingApiSrc) &&
      /DECLARED a ~\$\{effortPct\}% shot/.test(swingApiSrc) &&
      /const effortRaw = useMemo/.test(smSrc2) &&                       // raw % from LIVE ball/target
      /const liveTarget = targetPoint \?\? draftTarget/.test(smSrc2) &&  // draft target in setup, session in review
      /setDraftTarget\(isPutt \? \{ x: t\.x, y: t\.y \} : \{ x: t\.x, y: Math\.max\(EFFORT_TOP_CAP, t\.y\) \}\)/.test(smSrc2) && // DTL draggable + capped below header; putt = free CUP flag
      /const span = Math\.max\(0\.001, liveBall\.y - EFFORT_TOP_CAP\)/.test(smSrc2) &&        // top cap = 100% effort
      // 2026-07-04 (drift reconcile) — the readout moved into the shot-map deck
      // (components/smartmotion/ShotMapPage.tsx renders the EFFORT stat).
      /Stat label="EFFORT" value=\{effortPct != null \? `\$\{effortPct\}%` : '—'\}/.test(read('components/smartmotion/ShotMapPage.tsx')),
    'server grades against declared effort from ball→target geometry; the DTL target is DRAGGABLE in setup and the shot-map deck shows the live EFFORT stat — the interactive geometry↔tempo Tim expected');

  check('SmartMotion: putt CUP flag replaces the stuck PUTT MODE pill; future card sits at the bottom',
    // 2026-06-12 (Tim) — (1) the persistent "PUTT MODE" pill is GONE (it never
    // disappeared); mode changes ride the transient fade label only. (2) Putt mode
    // gets a DRAGGABLE flag/cup target the user lines over the real cup (targetKind
    // 'cup' → flag pill in the overlay). (3) the COMING SOON face/smash card moved
    // BELOW the real read on page 2 so "what we can't do yet" never sits on top.
    !/PUTT MODE<\/Text>/.test(smSrc2) &&
      /targetKind=\{isPutt \? 'cup' : 'aim'\}/.test(smSrc2) &&
      /targetKind\?: 'aim' \| 'cup'/.test(read('components/swinglab/CageTargetingCard.tsx')) &&
      /targetKind === 'cup'/.test(read('components/swinglab/CageTargetingCard.tsx')) &&
      // COMING SOON now appears AFTER the feels-engine block (bottom of the page),
      // i.e. after "HOW'D IT FEEL?" in source order.
      smSrc2.indexOf('>COMING SOON<') > smSrc2.indexOf('HOW&apos;D IT FEEL?') &&
      // right-rail badges carry a shadow so they read on bright backgrounds.
      /shadowColor: '#000', shadowOpacity: 0\.55/.test(smSrc2),
    'the stuck PUTT MODE pill is removed; putt mode shows a draggable CUP flag (targetKind cup); the COMING SOON card moved to the bottom of page 2; rail badges get a shadow halo');

  check('SmartMotion: page-2 notes + feel inputs have press-to-talk voice dictation',
    // 2026-06-12 (Tim) — the player can SPEAK their note + how-it-felt; one-shot
    // captureUtterance(/api/transcribe), safe because review unmounts the camera so
    // the mic is free. Appends the real transcript (or leaves the field on failure —
    // never fabricated text). Both the COACH NOTES + HOW'D IT FEEL? cards get the mic.
    /captureUtterance, endCaptureEarly \} from '\.\.\/\.\.\/services\/voiceService'/.test(smSrc2) &&
      /const dictate = useCallback\(async \(field: 'note' \| 'feel'/.test(smSrc2) &&
      /await captureUtterance\(15000, getApiBaseUrl\(\), 'en'\)/.test(smSrc2) &&
      /dictate\('note'/.test(smSrc2) &&
      /dictate\('feel'/.test(smSrc2) &&
      // honest: only append when transcription returned text.
      /if \(text && text\.trim\(\)\) append\(text\.trim\(\)\)/.test(smSrc2),
    'COACH NOTES + HOW\'D IT FEEL? on page 2 each have a mic that records → transcribes → appends the text per-swing (no fabricated text on failure)');

  check('SmartMotion: PAGE 3 shot map — DTL course + cage bullseye, honest (no fabricated dots)',
    // 2026-06-12 (Tim) — a third page gated to down-the-line modes (putt/face-on get
    // none). Full-swing plots from REAL effort→carry + the ball-trace direction; cage
    // shows a bullseye + user-CONFIRMED geometry (canvas + camera-behind, persisted).
    /const showShotMap = !isPutt && angle === 'down_the_line'/.test(smSrc2) &&
      /const pageCount = showShotMap \? 3 : 2/.test(smSrc2) &&
      /\{shotMapPage\}/.test(smSrc2) &&
      /Array\.from\(\{ length: pageCount \}\)/.test(smSrc2) &&            // dots are dynamic
      /cageCanvasFeet: number/.test(read('store/settingsStore.ts')) &&    // confirmed geometry persisted
      /cameraBehindFeet: s\.cameraBehindFeet/.test(read('store/settingsStore.ts')) &&
      // honest: course marker only when an effort-carry estimate exists; cage impact is preview-labeled.
      /const has = estCarry != null;/.test(read('components/smartmotion/ShotMapPage.tsx')) &&
      /est · preview/.test(read('components/smartmotion/ShotMapPage.tsx')),
    'page 3 is a DTL-only shot map: full-swing course plots from real effort→carry + trace; cage shows a bullseye + confirmable canvas/camera distances; no fabricated positions (empty until a real read)');

  check('SmartMotion spine fixes: thumbnails, ball-speed honesty, feel-on-save (2026-06-12)',
    // Every library card gets a thumbnail — fall back past the analysis fault frame to a
    // lazily-generated frame screenshot, persisted on the session.
    /thumbnail_uri: primaryThumb \?\? perShotThumb \?\? session\.fault_frame_uri \?\? session\.thumbnailUri \?\? null/.test(read('services/swingLibrary.ts')) &&
      /setSessionThumbnail: \(sessionId: string, uri: string \| null\) => void/.test(read('store/cageStore.ts')) &&
      /await VT\.getThumbnailAsync\(playableUri/.test(read('app/swinglab/library.tsx')) && // refreshed: re-anchored playableUri (was clipUri)
      // BALL SPEED badge is honest: driven by the SwingMetric, "~" prefix when it's an estimate.
      /const bsEst = bs\.value != null && !isTruthGrade\(bs\.source\)/.test(smSrc2) &&
      /\$\{bsEst \? '~' : ''\}\$\{Math\.round\(bs\.value\)\}/.test(smSrc2) &&
      // typed/dictated FEEL persists on Save (not just via the caddie-submit button).
      /if \(sid && feelText\.trim\(\)\) \{[\s\S]*?setSessionFeel\(sid, feelText\.trim\(\)\)/.test(smSrc2),
    'library thumbnails backfill + persist; ball-speed badge shows ~est from the SwingMetric (no raw mph); feel saved on Save');

  check('Scorecard + round-end fixes from Tim\'s round (2026-06-12)',
    // (a) scoring chips open INLINE under the tapped hole (any hole, incl. a missed one),
    // not in one bottom panel you had to scroll to; the row tap doesn't move the hole.
    /const renderInlineChips = \(hole: number, par: number\)/.test(read('app/(tabs)/scorecard.tsx')) &&
      /const \[expandedHole, setExpandedHole\]/.test(read('app/(tabs)/scorecard.tsx')) &&
      /\{isExpanded && renderInlineChips\(h\.hole, h\.par\)\}/.test(read('app/(tabs)/scorecard.tsx')) &&
      !/stickyChipPanel/.test(read('app/(tabs)/scorecard.tsx')) &&
      // (b) ending the round from the Caddie tab now opens the recap (partial rounds too).
      /const roundId = endRound\(\);[\s\S]{0,400}router\.push\(`\/recap\/feelings\?roundId=\$\{roundId\}`/.test(read('app/(tabs)/caddie.tsx')), // refreshed: recap route now /recap/feelings?roundId=
    'inline per-hole scoring chips (no scroll-to-bottom, any hole scorable incl. missed) + the Caddie End Round opens the recap so a partial 9-of-18 round still summarizes');

  check('Battery saver: the low-battery prompt is actually RENDERED (was dead-wired)',
    // 2026-06-12 (Tim's round) — batteryMonitor fired promptVisible at ≤20% but ONLY the
    // debug screen rendered it, so the offer never showed in the real app and rounds
    // drained. The prompt is now mounted globally in _layout, and a round that STARTS
    // already low (≤30%) gets offered up front instead of waiting to hit 20%.
    /<BatterySaverPrompt \/>/.test(read('app/_layout.tsx')) &&
      /import \{ BatterySaverPrompt \}/.test(read('app/_layout.tsx')) &&
      /subscribeBattery/.test(read('components/battery/BatterySaverPrompt.tsx')) &&
      /if \(!bs\?\.promptVisible\) return null/.test(read('components/battery/BatterySaverPrompt.tsx')) &&
      /ROUND_START_THRESHOLD = 0\.30/.test(read('services/batteryMonitor.ts')) &&
      /evaluatePrompt\(state\.level, ROUND_START_THRESHOLD\)/.test(read('services/batteryMonitor.ts')),
    'the battery-saver offer renders in the real app (not just the debug screen) and fires at round start when already low — so a low-battery round can actually ease GPS');

  check('CNS fix: [LAST SHOT] reads roundStore.shots (not the phantom recentShots)',
    /const shots = round\.shots \?\? \[\]/.test(read('services/unifiedVisionContext.ts')) &&
      !/as unknown as \{ recentShots/.test(read('services/unifiedVisionContext.ts')),
    'the unified context [LAST SHOT] line now reads the real shots array, so the brain sees the just-hit shot');

  // 2026-06-12 — custom icon set wired: cycling golfer mode badge (DTL/FO/PUTT +
  // fade label), env scene icons, club glyph (Tim's ChatGPT art, cropped+transparent).
  // 2026-06-12 — yardage estimate from club + effort %, reusing the app's club math
  // (industry table scaled by handicap), honest nulls for putter/unknown.
  {
    const full7i = fullCarryYards('7I', 18);        // 7-iron, handicap 18 → scaled industry
    const half7i = estimateCarryYards('7I', 50, 18); // ~half-effort 7-iron
    const scratch7i = fullCarryYards('7I', 0);       // scratch → full industry (longer)
    const learned = fullCarryYards('7I', 18, 142);   // learned avg wins over the table
    const putt = estimateCarryYards('PT', 80, 18);   // putter → null (no carry)
    const noClub = estimateCarryYards(null, 80, 18);
    check('SmartMotion: carry estimate = club × effort % (reuses club math, handicap-scaled)',
      typeof full7i === 'number' && full7i > 100 && full7i < 150 &&     // high-handicap 7i ~125-130
        half7i != null && Math.abs(half7i - Math.round(full7i * 0.5)) <= 1 &&
        (scratch7i ?? 0) > full7i &&                                     // scratch carries farther
        learned === 142 &&                                              // real learned avg wins
        putt === null && noClub === null,                               // honest nulls
      `7-iron full carry @hcp18 ~${full7i}y (high-handicap baseline from the industry table scaled by handicap); 50% effort ~${half7i}y; scratch carries farther (${scratch7i}y); a learned ${learned}y average overrides the table; putter/no-club → null (no fabricated yardage)`);
  }

  check('SmartMotion: DTL readout shows the carry estimate + cycling badge + icon set',
    /estimateCarryYards\(club, effortRaw, profile\.handicap\)/.test(smSrc2) &&
      // 2026-07-04 (drift reconcile) — the CARRY display moved into the shot-map deck.
      // 2026-07-07 (audit M2) — relabeled "PLAN CARRY" so a projection isn't shown as an outcome.
      /Stat label="PLAN CARRY" value=\{`~\$\{estCarry\}y`\}/.test(read('components/smartmotion/ShotMapPage.tsx')) &&
      /source=\{ICON_RAIL\.calibrate\}/.test(smSrc2) &&                  // rail badges wired
      /source=\{ICON_CTRL\.playpause\}/.test(smSrc2) &&                  // control badges wired
      /styles\.toolBtnBare/.test(smSrc2),                               // bare buttons (icon's own circle = button)
    'the live DTL readout adds a ~Ny CARRY column from the selected club × effort %; the rail uses its own green-circle badges (no double border, toolBtnBare) and the review controls use the matching record/play-pause/slow-mo/delete/save badges');

  check('SmartMotion: cycling mode badge + custom icon set wired',
    /const cycleMode = \(\) => \{/.test(smSrc2) &&
      /ICON_ANGLE\[isPutt \? 'putt' : angle\]/.test(smSrc2) &&        // current-stance icon on the badge
      /showModeFade\('FACE-ON'\)/.test(smSrc2) &&                      // fade-away label on cycle
      /source=\{ICON_ENV\[effectiveMode\]\}/.test(smSrc2) &&          // env scene icon on the toggle
      /source=\{ICON_CLUB\}/.test(smSrc2) &&                          // club glyph on the scan button
      !/ModeToggle/.test(smSrc2),                                     // old 3-chip toggle removed
    'one golfer badge cycles DTL → Face-On → Putting with a fade-away label (replacing the 3-chip ModeToggle); the environment toggle shows the cage/range/course scene badge; the club-scan button shows the club-bag glyph instead of a plain box (assets are cropped + black-knocked-out from Tim\'s art)');

  check('SmartMotion: chip sensitivity — lower threshold + mode-aware acoustics + clear toggle',
    /chipSensitivity: boolean/.test(read('store/settingsStore.ts')) &&
      /CHIP_STRIKE_THRESHOLD_DB = 18/.test(smSrc2) &&
      // 2026-07-08 (cage audit #1) — the calibration branch is now env-gated (calOk).
      /const thresholdDb = chipOn \? CHIP_STRIKE_THRESHOLD_DB : \(calOk \? appliedCalibration\?\.transientThresholdDb : undefined\)/.test(smSrc2) &&
      // mode-aware: chip → cage+course (off-round), NOT range; default → cage+range
      /chipOnStart\s*\n?\s*\? \(captureMode === 'cage' \|\| \(captureMode === 'course' && !roundActive\)\)/.test(smSrc2) &&
      // course+chip single-shot anchor
      /else if \(meterMode === 'course'\) \{/.test(smSrc2) &&
      // unmistakable toggle feedback: filled ON state + a toast
      /show\(next \? 'Chip mode ON/.test(smSrc2),
    'chip ON drops the strike threshold to ~18dB AND is mode-aware — acoustics for the quiet spots (cage + off-round course) and OFF for a noisy range (video-only); the toggle now fills green + fires a toast so a tap is never silent (Tim: "doesn\'t do anything")');

  check('SmartMotion: Framing Coach is wired into the setup loop (on-device pose, fail-safe)',
    /detectPoseFromBase64\(b64\)/.test(smSrc2) &&
      /evaluateFraming\(frame\.keypoints/.test(smSrc2) &&
      /phase !== 'setup'.*setFraming\(null\)/.test(smSrc2) &&
      /styles\.framingPill/.test(smSrc2),
    'setup polls a preview frame, runs on-device pose, evaluates framing into a pill; every step is guarded so a missing native pose module just leaves framing null (no pill, no error) — degrades like biomech until the native build');

  check('SmartMotion: ball/target are drag-to-anchor in setup + review (FOV-drift fix)',
    /export function EditableCageTargets/.test(targetingSrc) &&
      /PanResponder\.create/.test(targetingSrc) &&
      /onChangeBallArea\(b\)/.test(targetingSrc) &&            // commit on release, not per-frame
      /phase === 'setup' && draftBall \? \(/.test(smSrc2) &&    // draggable in setup
      /<EditableCageTargets/.test(smSrc2) &&
      /onChangeBallArea=\{\(a\) => \{ if \(sessionId\) setSessionBallArea\(sessionId, a\); \}\}/.test(smSrc2), // review commits to session
    'EditableCageTargets drags each marker with a PanResponder, smooth via local state, committing to the session only on release; wired draggable in setup (draftBall) and review (session) — so a box the Samsung record-crop nudged off can be fixed on the real recorded frame and stick');

  check('SmartMotion: multi-swing reads vary — earlier-swing faults drive a distinct secondary read',
    /priorFaultSet\.add\(f\)/.test(smSrc2) &&
      /prior_issues: sessionPriorFaults\.length > 0 \? sessionPriorFaults : undefined/.test(smSrc2) &&
      /ctx\.swing_number === 'number' && ctx\.swing_number > 1/.test(swingApiSrc) &&
      /actively look for a genuinely distinct secondary fault/.test(swingApiSrc),
    'swing 2+ passes the distinct faults already found this session; the server treats them (only when swing_number>1) as a "confirm a repeat only with clean evidence, else surface a distinct secondary fault" directive — so four swings stop echoing one identical fault, while swing 1 keeps the neutral cross-session prior');

  check('SmartMotion: auto-window-end calls the CURRENT stopRecording (audit H1)',
    /void stopRecordingRef\.current\(\)/.test(smSrc2) && /stopRecordingRef\.current = stopRecording/.test(smSrc2),
    'the hands-free "let the 60s run out" stop routes through a ref, so it uses current calibration/angle instead of a stale closure');

  check('SmartMotion: reset() restores the user\'s explicit angle after a putt (audit H3)',
    /lastChosenAngleRef\.current = 'face_on'/.test(smSrc2) && /setAngle\(lastChosenAngleRef\.current\)/.test(smSrc2),
    'a putt forces down-the-line; reset() restores the last explicit angle so it does not bleed into the next full swing');

  const settingsSrc2 = fs.readFileSync(path.resolve(__dirname, '../../store/settingsStore.ts'), 'utf-8');
  check('Voice: persona handoff plays the bundled opener (never silent) (audit)',
    /getOpenerAssetForPersona/.test(settingsSrc2) && /playLocalFile/.test(settingsSrc2) &&
      /flashCaption/.test(settingsSrc2) && !/voiceMod\.speak\?\.\(text/.test(settingsSrc2),
    'the handoff plays the zero-network bundled opener clip (with a flashed caption) instead of network TTS, so a cold Lambda no longer leaves the switch silent');

  check('Voice: persona handoff skips the CUSTOM caddie (no Kevin-voice intro)',
    /if \(prev !== p && p !== 'custom'\)/.test(settingsSrc2),
    'switching to the user\'s custom caddie no longer announces it in Kevin\'s voice (no custom opener clip) or flashes a literal "custom stepping in"');

  // 2026-07-07 (Tim — "a while before it says tap the mic; splash removal wasn't needed")
  // — the caddie's spoken opener awaits awaitGreetingComplete() with a 10s safety race.
  // The greeting-skip THROTTLE meant a reopen skipped the greeting, so that promise never
  // resolved and the opener sat 10s (a dead, error-looking gap). Fix: the throttle is
  // GONE (splash shows once per cold launch again), and when the greeting is DISABLED the
  // Index signals completion immediately so the opener never waits on a greeting that
  // won't play.
  check('Launch: greeting shows (no time-throttle) + opener never waits 10s on a skip',
    (() => {
      const idx = read('app/index.tsx');
      return (
        // The time-throttle skip is removed — greeting is gated only by the per-process flag.
        !/recentlyOpened/.test(idx) &&
        !/GREETING_THROTTLE_MS/.test(idx) &&
        /if \(kevinGreetingEnabled && !greetingShownThisProcess\) \{\s*\n\s*greetingShownThisProcess = true;\s*\n\s*return <Redirect href="\/greeting"/.test(idx) &&
        // The greeting-complete promise is resolved on the disabled-greeting bypass.
        /signalGreetingComplete/.test(idx) &&
        /export function signalGreetingComplete/.test(read('app/greeting.tsx'))
      );
    })(),
    'the splash/greeting shows on every cold launch (warmup mask + tap-to-talk handoff restored), and a disabled greeting resolves the completion signal so the opener fires immediately instead of after a 10s dead wait');

  const seqSrc = fs.readFileSync(path.resolve(__dirname, '../../services/intents/sequenceHandler.ts'), 'utf-8');
  check('Voice: chained commands forward a navigating step\'s tool_action (audit 4a)',
    /lastToolAction = result\.tool_action/.test(seqSrc) && /tool_action: lastToolAction/.test(seqSrc),
    '"open Smart Motion and switch to quiet mode" now actually navigates — the sequence handler forwards the step tool_action instead of dropping it');

  // 4c — custom-caddie base64 blobs moved off the hot-write profile store.
  const mediaStoreSrc = fs.readFileSync(path.resolve(__dirname, '../../store/customCaddieMediaStore.ts'), 'utf-8');
  check('Storage 4c: custom-caddie media store exists with an idempotent migration',
    /custom-caddie-media-v1/.test(mediaStoreSrc) && /migrateFromProfile/.test(mediaStoreSrc) &&
      /_migratedFromProfile/.test(mediaStoreSrc) && /selfieB64: null,\s*\n\s*customCaddiePortraitB64: null,/.test(mediaStoreSrc),
    'the two base64 blobs live in their own persisted store; migrateFromProfile copies legacy values then nulls the profile fields (idempotent via _migratedFromProfile)');

  const profileStoreSrc = fs.readFileSync(path.resolve(__dirname, '../../store/playerProfileStore.ts'), 'utf-8');
  check('Storage 4c: profile store no longer writes the base64 blobs',
    !/setSelfieB64: \(b\) => set/.test(profileStoreSrc) && !/setCustomCaddiePortraitB64: \(b\) => set/.test(profileStoreSrc),
    'the profile-store setters that wrote the heavy base64 fields are removed — writes go to the media store, so the profile blob stops re-serializing them on every handicap/profile change');

  const layoutSrc = fs.readFileSync(path.resolve(__dirname, '../../app/_layout.tsx'), 'utf-8');
  check('Storage 4c: migration runs once both stores have hydrated',
    /migrateFromProfile\(\)/.test(layoutSrc) &&
      /usePlayerProfileStore\.persist\.hasHydrated\(\) && useCustomCaddieMediaStore\.persist\.hasHydrated\(\)/.test(layoutSrc),
    'the one-time migration is gated on both stores being hydrated so the legacy values are present to copy');

  const caddieSrc = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf-8');
  check('Storage 4c: avatar read falls back to legacy until migration completes',
    /mediaPortrait \?\? customCaddiePortraitB64/.test(caddieSrc),
    'the caddie avatar reads the media store first and falls back to the legacy profile field, so it never flickers/disappears during migration');

  // ── Swing-analysis triple-check fixes ──
  const smA = fs.readFileSync(path.resolve(__dirname, '../../app/swinglab/smartmotion.tsx'), 'utf-8');
  const poseSrc2 = fs.readFileSync(path.resolve(__dirname, '../../services/poseDetection.ts'), 'utf-8');

  check('Swing analysis: per-swing result is dropped if the reel moved on (stale guard)',
    /if \(selectedSwingRef\.current === idx\) \{/.test(smA) &&
      /useEffect\(\(\) => \{ selectedSwingRef\.current = selectedSwing;/.test(smA),
    'a late-resolving per-swing analysis only updates the display when its swing is STILL selected — no more one swing\'s read under another\'s header on a fast reel scrub');

  check('Swing analysis: ballSpeed cleared on the UPLOAD path, NOT in runAnalysis (cage keeps its measured speed)',
    // The clear lives in the clipUriParam (upload/re-analyze) effect, right
    // before `let cancelled = false`...
    /clipUriParam && phase === 'analyzing'[\s\S]{0,400}?setBallSpeed\(null\);\s*\n\s*setBallDeparture\(null\);\s*\n\s*let cancelled = false;/.test(smA) &&
      // ...and runAnalysis explicitly does NOT clear it (would wipe the acoustic
      // ball speed the cage record path measures just before calling runAnalysis).
      /ball speed\/departure are intentionally NOT cleared here/.test(smA),
    'the upload/re-analyze path (no acoustics) clears stale ball speed; runAnalysis does NOT, so a cage swing keeps the acoustic ball speed it just measured (audit-fixed regression)');

  check('Swing analysis: cached per-swing select clears the analyzing spinner (no stuck spinner)',
    /if \(cached\) \{ setAnalysis\(cached\); setSwingAnalyzing\(false\); return; \}/.test(smA),
    'scrubbing to a cached swing while an earlier read is in flight clears swingAnalyzing on the cached hit — the spinner can no longer stick on forever');

  check('Library phase 1b: a multi-swing cage reel carves into N per-swing shots',
    // 2026-06-12 (Tim) — a cage session with N detected swings now lands in the library AS
    // N shots (each scrubbing its window into the master clip) via ingestLiveCageSession,
    // instead of collapsing to shots[0]. Single-swing clips keep the simple upload path.
    // segmentsRef is synced synchronously so the carve sees the final set (not a stale one).
    /const segmentsRef = useRef<SwingSegment\[\]>\(\[\]\)/.test(smA) &&
      /segmentsRef\.current = segsForAnalysis;/.test(smA) &&
      /const allSegs = segmentsRef\.current;/.test(smA) &&
      /segs\.length > 1[\s\S]{0,120}ingestLiveCageSession\(\{/.test(smA) &&
      /clipStartSeconds: s\.startMs \/ 1000,/.test(smA) &&
      // live-cage session defaults to smart_motion, or 'drill' when a drill passes it through (#5)
      /captureKind: captureKind \?\? 'smart_motion',/.test(read('store/cageStore.ts')),
    'a multi-swing cage reel ingests as N per-swing shots with clip boundaries (library shows all swings, each scrubbing its window); single swings keep the simple path; smart_motion by default, drill when launched from a drill');

  check('Custom caddie always has a voice (male/female default → Kevin/Serena)',
    // 2026-06-12 (Tim) — custom keeps its generated face but speaks with a real default
    // voice for any unrecorded line, picked by a male/female toggle. The server falls back
    // on `gender` for the 'custom' persona, so the client sends customCaddieGender there.
    /customCaddieGender: 'male' \| 'female'/.test(read('store/playerProfileStore.ts')) &&
      /setCustomCaddieGender: \(g\) =>/.test(read('store/playerProfileStore.ts')) &&
      /if \(persona === 'custom'\)/.test(read('services/voiceService.ts')) &&
      /effectiveGender = g/.test(read('services/voiceService.ts')) &&
      /gender: effectiveGender/.test(read('services/voiceService.ts')) &&
      /setCustomCaddieGender\(g\)/.test(read('app/profile/custom-caddie.tsx')),
    'custom caddie maps its male/female toggle to Kevin (onyx) / Serena (nova) for unrecorded lines — never silent, even with zero recorded clips');

  check('Library phase 1: additive captureKind classifier (smart_motion / coach / upload)',
    // 2026-06-12 (Tim) — foundation for the library carrying each session's matching
    // interface. ADDITIVE: the source enum is untouched; captureKind is a new classifier,
    // defaulted at ingest (live_cage → smart_motion, else upload) and inferred for legacy
    // sessions via getCaptureKind. Phase 2 renders the interface off it.
    /export type CaptureKind = 'smart_motion' \| 'coach' \| 'upload'/.test(read('store/cageStore.ts')) &&
      /captureKind\?: CaptureKind;/.test(read('store/cageStore.ts')) &&
      /const resolvedCaptureKind: CaptureKind = captureKind \?\? \(resolvedSource === 'live_cage' \? 'smart_motion' : 'upload'\)/.test(read('store/cageStore.ts')) &&
      /captureKind: resolvedCaptureKind,/.test(read('store/cageStore.ts')) &&
      /export function getCaptureKind\(session: CageSession\): CaptureKind/.test(read('services/swingLibrary.ts')) &&
      /captureKind: getCaptureKind\(session\)/.test(read('services/swingLibrary.ts')),
    'sessions carry an additive captureKind (SmartMotion captures default smart_motion, uploads default upload); legacy sessions infer it; the source enum + its consumers are unchanged');

  check('SmartMotion analysis SPEED fixes (2026-06-12 — first-try read + latency)',
    // The big one: a missed strike on a short cage clip no longer collapses to the slow
    // unbounded locate path. locateSwings is gated to long clips; a whole-clip bounded
    // window is synthesized so analyzeSwing goes bounded + fast.
    /const worthVideo = durMs > 12_000 && \(detectedSegments\.length === 0 \|\| durMs > 20_000\)/.test(smA) &&
      /firstSeg = \{ index: 1, strikeMs: Math\.round\(durMs \* 0\.6\), startMs: 0, endMs: durMs/.test(smA) &&
      /void runAnalysis\(recorded\.uri, firstSeg\)/.test(smA) &&
      // duration is reused from the metered recorder (no 2-3x re-probe)
      /let meteredDurationMs: number \| null = null;/.test(smA) &&
      /const durMs = meteredDurationMs \?\? await pose\.probeDurationMs/.test(smA) &&
      // Lambda warmed at record-start (60s window = free warm time), and ball speed is
      // off the critical path.
      /warm the fault-read Lambda the MOMENT recording starts/.test(smA) &&
      /void detectBallSpeed\(\{[\s\S]{0,200}\}\)\.then\(\(speed\) => \{ if \(speed\) setBallSpeed/.test(smA),
    'short cage clips take the fast BOUNDED path (no cold locate), duration is reused (no re-probe), the Lambda is warmed at record-start, and ball speed runs in parallel — kills the 30-70s first-try NO READ');

  check('Swing analysis: single awaited call + 130s hang guard (server runs its own tier-retry)',
    // 2026-06-27 — refreshed: the old bounded-15s + 2× client retry was SUPERSEDED. The
    // server now runs its own tier retry on a warm Lambda, so the client makes ONE awaited
    // call guarded by a 130s hang timeout (watchdogMs/maxAttempts are now dead — void'd).
    /const hangGuardMs = 130_000;/.test(smA) &&
      /resolve\(\{ kind: 'error', message: 'Analysis timed out' \}\), hangGuardMs\)/.test(smA) &&
      /if \(result\.kind === 'ok'\)/.test(smA),
    'one awaited analysis call with a 130s hang guard; the server-side tier retry handles cold-start, so the client no longer double-waits');

  check('Swing analysis: tempo only from an acoustic impact anchor (sign-agnostic gate)',
    /\(seg\.peakDb \?\? 0\) === 0\) \{ setTempo\(null\); return; \}/.test(smA) &&
      // 2026-06-12 HEADLINE BUG FIX: the gate was `<= 0`, which ALSO matched a negative
      // dBFS acoustic peakDb and silently suppressed Tempo on every cage swing. The honest
      // distinction is video-located === 0 vs acoustic !== 0 (correct whatever the sign).
      !/\(seg\.peakDb \?\? 0\) <= 0\) \{ setTempo/.test(smA),
    'tempo shows for acoustic strikes (peakDb !== 0) and is suppressed ONLY for video-located segments (exactly 0) whose impact time is too coarse — never silently killed by a sign-inverted gate');

  check('Swing analysis: club path not manufactured as a green NEUTRAL',
    !/else \{ value = 'NEUTRAL'; statusTone = 'good'; \}/.test(smA),
    'CLUB PATH renders "—" when the model did not name a path fault, instead of a confident green NEUTRAL the server deliberately withheld');

  check('Swing analysis: review playback updates at frame rate ONLY while the Motion overlay is on (perf)',
    // 2026-07-04 (elite-clean audit) — playbackMs now tracks ALWAYS (the scrubber
    // needs it), but the perf property moved to the update INTERVAL: 25x/s only when
    // the overlay consumes frame-rate position; 4x/s otherwise.
    /progressUpdateIntervalMillis=\{showSkeleton \? 40 : 250\}/.test(smA),
    'position tracks always (scrubber), but the 25x/s frame-rate cadence is gated on the Motion overlay — the review loop never re-renders the whole screen 25x/s for nothing');

  check('Swing analysis: SmartMotion mount forces a warmup',
    /prewarmSwingAnalysis\(\{ force: true \}\)/.test(smA),
    'opening Smart Motion forces a warmup (bypasses the 60s dedupe) so the first analysis hits a hot Lambda');

  check('Swing analysis: no double duration-probe on unbounded clips (perf)',
    /knownDurationMs\?: number/.test(poseSrc2) &&
      /extractKeyFrames\(clipUri, effectiveBoundaries, quickTier, probedDurMs \|\| undefined\)/.test(poseSrc2),
    'analyzeSwing threads its probed duration into extractKeyFrames so the same clip is not probeDurationMs-ed twice on a short/locate-failed upload');

  check('Swing analysis: next swing is prefetched (depth 1, single in-flight)',
    /const prefetchInFlightRef = useRef\(false\)/.test(smA) &&
      /if \(prefetchInFlightRef\.current\) return;/.test(smA) &&
      /prefetchSwing\(selectedSwing \+ 1\)/.test(smA) &&
      /void analyzeSwingForIndex\(idx\)\.finally\(\(\) => \{ prefetchInFlightRef\.current = false; \}\)/.test(smA),
    'once a swing\'s read lands, the next swing prefetches in the background — bounded to depth 1 with a single in-flight prefetch, so stepping the reel is instant without fanning out concurrent calls');

  // Video-locate over-detection merge — validated against Tim's REAL clips
  // (2026-06-11): the live locate_swings returned 3 detections for a 1-swing
  // down-the-line clip and 6 for a face-on; mergeSwingDetections collapses them.
  const dtlReal = mergeSwingDetections([
    { timeSec: 10.2, confidence: 'high' }, { timeSec: 11.1, confidence: 'high' }, { timeSec: 12.0, confidence: 'high' },
  ]);
  check('Smart Motion: a 1-swing clip over-detected as 3 collapses to one (real DTL)',
    dtlReal.length === 1 && Math.abs(dtlReal[0].timeSec - 11.1) < 0.001,
    'the down-the-line clip whose single swing the locator split into 3 (10.2/11.1/12.0s) now reads as ONE swing at the median (≈impact) time — no phantom reel swings in range mode');

  const faceOnReal = mergeSwingDetections(
    [11.6, 13, 14.3, 15.7, 17, 18.4].map((t) => ({ timeSec: t, confidence: 'high' as const })),
  );
  check('Smart Motion: tightly-spaced face-on detections collapse (6 → few)',
    faceOnReal.length === 3,
    'the face-on clip\'s 6 detections at ~1.3s spacing collapse to 3 (each >2.5s apart) instead of showing 6 phantom swings');

  const distinctSwings = mergeSwingDetections([
    { timeSec: 5, confidence: 'high' }, { timeSec: 12, confidence: 'high' }, { timeSec: 20, confidence: 'low' },
  ]);
  check('Smart Motion: genuinely distinct swings (>2.5s apart) are preserved',
    distinctSwings.length === 3,
    'real separate range swings are never merged — only a single swing\'s own sub-2.5s phases collapse');

  check('Smart Motion: selfie/front-camera toggle, recording stays un-mirrored (analysis-safe)',
    /const \[facing, setFacing\] = useState<'back' \| 'front'>\('back'\)/.test(smA) &&
      /facing=\{facing\}/.test(smA) && /mirror=\{false\}/.test(smA) &&
      /setFacing\(\(f\) => \(f === 'back' \? 'front' : 'back'\)\)/.test(smA),
    'a setup-phase toggle flips to the front camera for face-on self-framing; mirror={false} keeps the clip un-mirrored so a front face-on clip reads identically to a rear one — handedness/direction faults/ball-target coords unaffected');

  check('Smart Motion: video locate uses ~2.5s frame spacing (denser, accurate)',
    /Math\.round\(durationMs \/ 1000 \/ 2\.5\)/.test(poseSrc2),
    'the multi-swing locator samples ~2.5s apart (capped 24) — validated on Tim\'s real 60s clip: 5s spacing over-detected (9 for 6 real swings), 2.5s nailed 6');

  check('Smart Motion: cage cross-checks video when acoustics under-detect',
    /stopMode === 'cage' && detectedSegments\.length <= 1/.test(smA) &&
      /swings\.length > segsForAnalysis\.length/.test(smA),
    'cage mode used at an open range (acoustics heard ≤1 strike for many swings) cross-checks the video locator and uses it when it finds MORE swings — never reduces the count');

  // Tempo Trainer (Tour Tempo) — Tank's idea, v1.
  const tempoSrc = fs.readFileSync(path.resolve(__dirname, '../../app/swinglab/tempo-trainer.tsx'), 'utf-8');
  check('Tempo Trainer: Tour-Tempo 3:1 metronome (tick·tick·tock) exists',
    /frames: '24\/8'/.test(tempoSrc) && /tick\.mp3/.test(tempoSrc) && /tock\.mp3/.test(tempoSrc) &&
      /scheduleCycle/.test(tempoSrc) && /back \+ down/.test(tempoSrc),
    'a standalone audio metronome plays tick (takeaway) · tick (top) · tock (strike) at a 3:1 ratio across selectable tempos, looped with a rest');
  const swinglabSrc2 = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/swinglab.tsx'), 'utf-8');
  const enJ = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../i18n/locales/en.json'), 'utf-8'));
  const esJ = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../i18n/locales/es.json'), 'utf-8'));
  const zhJ = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../i18n/locales/zh.json'), 'utf-8'));
  check('Tempo Trainer: SwingLab launcher card + i18n in all locales',
    /key: 'tempo'/.test(swinglabSrc2) && /\/swinglab\/tempo-trainer/.test(swinglabSrc2) &&
      !!enJ.swinglab?.card_tempo_title && !!esJ.swinglab?.card_tempo_title && !!zhJ.swinglab?.card_tempo_title,
    'Tempo Trainer is reachable from a SwingLab card, with translated title/sub in en/es/zh');

  const swingApiSrc2 = fs.readFileSync(path.resolve(__dirname, '../../api/swing-analysis.ts'), 'utf-8');
  check('Swing analysis: output token caps bounded (Gemini 800 / OpenAI 1000)',
    // 2026-06-27 — refreshed to current caps (post provider-migration the main
    // analysis runs Gemini maxOutputTokens 800 + OpenAI max_tokens 1000; the old
    // "650" trim is no longer in the code). Still asserts output is bounded.
    /maxOutputTokens: 800/.test(swingApiSrc2) && /max_tokens: 1000/.test(swingApiSrc2),
    'the swing-analysis model calls cap output (Gemini 800, OpenAI 1000) — bounded cost; the JSON-only one-sentence schema keeps real usage well under the cap');

  const listenSrc = fs.readFileSync(path.resolve(__dirname, '../../services/listeningSession.ts'), 'utf-8');
  check('Voice: hands-free paths dispatch EVERY tool_action through the full dispatcher',
    // 2026-07-04 (clean-audit C1/C2/H4) — dispatch centralized: listeningSession routes
    // every handler tool_action + every brain toolActions[] through the ONE full
    // service dispatcher (which covers all ToolAction types, paywall gates, and the
    // https-only URL allowlist). The watch path also handles route_to_brain now.
    (() => {
      const dispatchSrc = read('services/voice/conversationalToolDispatch.ts');
      return (
        /dispatchConversationalToolActions\(\[ta\]\)/.test(listenSrc) &&           // earbud handler actions
        /dispatchConversationalToolActions\(\[result\.tool_action\]\)/.test(listenSrc) && // watch handler actions
        (listenSrc.match(/dispatchConversationalToolActions\(r\.toolActions\)/g) ?? []).length >= 3 && // brain actions on all branches
        // the dispatcher itself covers the full tool surface
        ['record_swing', 'log_shot', 'plan_shot', 'set_reminder', 'log_score', 'log_emotional_state', 'log_issue',
         'mark_tee', 'mark_green', 'open_smartvision', 'open_smartfinder', 'open_swinglab', 'configure_drill',
         'close_swinglab', 'set_angle', 'set_golfer', 'switch_caddie', 'navigate', 'navigate_replace', 'open_url']
          .every(t => new RegExp(`case '${t}'`).test(dispatchSrc)) &&
        /protocol !== 'https:'/.test(dispatchSrc)                                   // allowlist stays https-only
      );
    })(),
    'earbud/badge/watch dispatch all 20 tool actions (was 3) — the caddie no longer says it acted without acting');

  check('Sim Round: narrated round runs the REAL pipeline but never trains anything (Tim)',
    // 2026-07-04 — voice sim round ("level one of the golf game"). The whole loop:
    // "start a sim round" (precheck, offline) → REAL startRound tagged simulated →
    // narrated shot distances MOVE the simulated fix toward the green → score-driven
    // advance jumps to the next tee → SIM record excluded from every learner.
    (() => {
      const rs = read('store/roundStore.ts');
      const sim = read('services/simRound.ts');
      const pre = read('services/localIntentPrecheck.ts');
      const ot = read('services/intents/openToolHandler.ts');
      const card = read('components/recap/HandicapImpactCard.tsx');
      return (
        // engine: real startRound + simulated flag + movement + tee-follow + GPS restore
        /startRound\(courseName, holes, \{/.test(sim) && /simulated: true/.test(sim) &&
        /simAdvanceTowardGreen/.test(sim) && /placeAtTee\(s\.currentHole\)/.test(sim) &&
        /startGpsManager/.test(sim) &&
        // store: flag persisted + record tagged + shot movement wire + end restore wire
        /isSimRound: s\.isSimRound/.test(rs) && /simulated: s\.isSimRound \|\| undefined/.test(rs) &&
        /simAdvanceTowardGreen\(stated\)/.test(rs) && /stopVoiceSimRound\(\)/.test(rs) &&
        // learning gates: handicap, both rebuild sites, points, CNS, reflection, drive, bag
        /\(holesPlayed === 9 \|\| holesPlayed === 18\) && !s\.isSimRound/.test(rs) &&
        (rs.match(/filter\(\(r: RoundRecord\) => !r\.simulated\)/g) ?? []).length >= 2 &&
        /holesPlayed >= 9 && !s\.isSimRound/.test(rs) &&
        /s\.activeCourseId && !s\.isSimRound/.test(rs) &&
        /holesPlayed > 0 && !s\.isSimRound/.test(rs) &&
        /driverYards != null && !s\.isSimRound/.test(rs) &&
        /carry != null && !s\.isSimRound/.test(rs) &&
        // voice entry (deterministic + offline) + handler + recap-card gate
        /SIM ROUND/.test(pre) && /tool_name: 'sim_round'/.test(pre) &&
        /toolName === 'sim_round'/.test(ot) && /startVoiceSimRound\(/.test(ot) &&
        /!round\?\.simulated/.test(card)
      );
    })(),
    'a narrated Palms sim exercises SmartFinder/brain/voice/advance end-to-end on simulated GPS, and the SIM-tagged record never touches handicap, points, CNS, longest drive, or the learned bag');

  const dashSrc2 = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/dashboard.tsx'), 'utf-8');
  check('Dashboard: quick-score placeholder shots excluded from lifetime stats',
    /!s\.id\?\.startsWith\('qs-'\)/.test(dashSrc2),
    'qs- placeholder shots no longer inflate lifetime fairway% / shot count');

  const scoreSrc2 = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/scorecard.tsx'), 'utf-8');
  check('Scorecard: quick-score does NOT fabricate 2 putts/hole',
    !/logPutts\(hole, 2\)/.test(scoreSrc2),
    'a bare score tap no longer writes a fake 2-putt that corrupted GIR%/avg-putts and persisted to history');

  const vadSrc = fs.readFileSync(path.resolve(__dirname, '../../hooks/useVoiceActivityDetection.ts'), 'utf-8');
  check('Voice: denied mic permission turns Auto-Listen toggle OFF',
    /setAutoListenEnabled\(false\)/.test(vadSrc),
    'the toggle stops lying — a denied mic flips Auto-Listen off instead of showing ON while nothing listens');

  const cageDbgSrc = fs.readFileSync(path.resolve(__dirname, '../../app/cage-debug.tsx'), 'utf-8');
  check('Stores: cage-debug Feel Capture viewer no longer uses a fresh-array selector',
    /useCageStore\(\(s\) => s\.activeSession\)/.test(cageDbgSrc) &&
      /return listFeelCaptureTuples\(50\)/.test(cageDbgSrc) &&
      !/useCageStore\(\(s\) => \{[\s\S]*?return listFeelCaptureTuples/.test(cageDbgSrc),
    'the last render-loop crash-class instance is closed (raw store fields selected; the array is built in useMemo, not returned fresh from a selector)');

  // ─── On-device pose: analyzePoseFromUri → existing MediaPipe service ──────
  const poseApiSrc = fs.readFileSync(path.resolve(__dirname, '../../services/poseAnalysisApi.ts'), 'utf-8');
  check('Pose: analyzePoseFromUri runs on-device MediaPipe BEFORE the cloud proxy',
    /import\('\.\/mediaPipePoseService'\)[\s\S]*?detectPoseFromUri\(imageUri, undefined, timestampMs\)[\s\S]*?if \(onDevice\) \{[\s\S]*?return onDevice;[\s\S]*?await fetch\(`\$\{apiUrl\(\)\}\/api\/pose-analysis`/.test(poseApiSrc),
    'the choke point SmartMotion tempo/biomech use directly now routes to the already-built MediaPipe module first (model + native ship via withMediaPipePose), cloud only as fallback');

  check('Pose: no redundant ML Kit module left behind (reuse MediaPipe, not a 2nd engine)',
    !/detectOnDevice|onDevicePose|MlkitPose/.test(poseApiSrc),
    'the duplicate ML Kit backend was removed once the audit found the existing MediaPipe pose path — no second pose native dependency bloating the build');

  const mpSrc = fs.readFileSync(path.resolve(__dirname, '../../services/mediaPipePoseService.ts'), 'utf-8');
  check('Pose: MediaPipe service projects BlazePose→COCO-17 for tempo+biomech joints',
    /detectPoseFromUri/.test(mpSrc) &&
      ['left_wrist', 'right_wrist', 'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'].every(j => mpSrc.includes(`'${j}'`)),
    'the existing service already maps the wrists/shoulders/hips getKp() looks up — so wiring it through analyzePoseFromUri needs no downstream changes');

  // ─── Handicap: incomplete-round drop + proper 9-hole conversion ──────────
  // Tim's real Golfshot history (score, holes): the May-06 "4" is an
  // abandoned round; Golfshot's official Index is 17.9, his own estimate ~16.
  const TIM_ROUNDS = [
    [39, 9], [4, 9], [44, 9], [87, 18], [40, 9], [93, 18], [45, 9], [93, 18], [90, 18], [44, 9],
    [40, 9], [43, 9], [88, 18], [46, 9], [89, 18], [99, 18], [46, 9], [90, 18], [94, 18], [91, 18],
  ].map(([s, h], i) => ({ startedAt: i * 1000, totalScore: s, holesPlayed: h }));
  const timDiffs = rebuildDifferentialsFromHistory(TIM_ROUNDS);
  const timIndex = estimateNewIndex(timDiffs).newIndex;
  check('Handicap: incomplete "4" round is dropped from the differentials',
    timDiffs.length === 19,
    `19 differentials expected (20 rounds − 1 abandoned 4); got ${timDiffs.length}`);
  check('Handicap: Tim\'s real history lands ~16 (was 8.7), near Golfshot 17.9',
    timIndex != null && timIndex >= 15 && timIndex <= 17.5,
    `expected ~16.2 (the naive double-score method gave 8.7); got ${timIndex}`);

  // A lone abandoned round must not produce a phantom-great differential.
  const partialOnly = rebuildDifferentialsFromHistory([
    { startedAt: 1, totalScore: 4, holesPlayed: 9 },
    { startedAt: 2, totalScore: 20, holesPlayed: 18 },
  ]);
  check('Handicap: sub-3-strokes/hole rounds excluded (4@9h, 20@18h both partial)',
    partialOnly.length === 0,
    `both are under 3 strokes/hole = incomplete; got ${partialOnly.length} differentials`);

  check('Handicap: expectedNineDifferential rises with Index (WHS second-nine)',
    expectedNineDifferential(8) < expectedNineDifferential(18) && expectedNineDifferential(18) > 10,
    `expected a monotonic, ~10-13 value at HI 18; got ${expectedNineDifferential(18)}`);

  // ─── GPS: weighted smoothing + canonical confidence (no-regression) ──────
  const gpsSrc = fs.readFileSync(path.resolve(__dirname, '../../services/gpsManager.ts'), 'utf-8');
  check('GPS: outlier gate stays at 90m (NOT lowered — would refreeze yardages)',
    /OUTLIER_ACCURACY_M = 90\b/.test(gpsSrc),
    'the gate was hardened 15→60→90 for real tree/canopy play; re-tightening brings back "no signal / frozen yardage" — guard against the stale-doc regression');

  check('GPS: smoothing is inverse-accuracy WEIGHTED over a 5-fix window',
    /SMOOTHING_WINDOW = 5\b/.test(gpsSrc) &&
      /1 \/ Math\.max\(f\.accuracy_m \?\? 30, 5\)/.test(gpsSrc) &&
      /wLat \/ wSum/.test(gpsSrc) && /wLng \/ wSum/.test(gpsSrc),
    'stronger fixes pull the smoothed position harder than the weak (up-to-90m) fixes we now keep — replaces the flat 3-average');

  check('GPS: smoothed fix reports the CURRENT accuracy, not the buffer best',
    /lat: wLat \/ wSum,[\s\S]*?accuracy_m: raw\.accuracy_m,/.test(gpsSrc),
    'the accuracy pill must reflect live signal — reporting the buffer minimum (Grok\'s bestAccuracy) would overstate quality');

  check('GPS: GpsFix carries a canonical confidence bucket (high/medium/low)',
    /confidence\?: 'high' \| 'medium' \| 'low';/.test(gpsSrc) &&
      /function confidenceFromAccuracy/.test(gpsSrc) &&
      /accuracy_m < 5\) return 'high'/.test(gpsSrc) && /accuracy_m < 15\) return 'medium'/.test(gpsSrc),
    'confidence derived from accuracy at classifyAccuracy thresholds (5m/15m), no import cycle — set on every emit path');

  // ─── On-course GPS dot (LiveGpsDot, Option A global mount) ───────────────
  const liveDotSrc = fs.readFileSync(path.resolve(__dirname, '../../components/LiveGpsDot.tsx'), 'utf-8');
  check('GPS dot: fed by REAL gpsManager data (no placeholder), gated on active round',
    /subscribe, getLastFix.*from '\.\.\/services\/gpsManager'/.test(liveDotSrc) &&
      /classifyAccuracy\(f\?\.accuracy_m/.test(liveDotSrc) &&
      /if \(!isRoundActive\) return null/.test(liveDotSrc),
    'the dot reads live fixes + classifyAccuracy off gpsManager and only renders during a round — never hardcoded/fake (no deferred-wiring placeholder)');

  check('GPS dot: global overlay is non-blocking (pointerEvents none)',
    /export function GlobalGpsDotOverlay/.test(liveDotSrc) && /pointerEvents="none"/.test(liveDotSrc),
    'the root mount can never intercept a tap — purely visual, the answer to "the pill blocks things"');

  const rootLayoutSrc = fs.readFileSync(path.resolve(__dirname, '../../app/_layout.tsx'), 'utf-8');
  check('GPS dot: mounted once in the root layout (persists across on-course screens)',
    /<GlobalGpsDotOverlay \/>/.test(rootLayoutSrc) && /import \{ GlobalGpsDotOverlay \}/.test(rootLayoutSrc),
    'single global mount inside SafeAreaProvider so the dot is the same on caddie / hole-view / smartfinder');

  // ─── SmartVision consolidation: the redundant legacy hole-view is retired (2026-06-12) ──
  check('Consolidation: legacy hole-view retired; Play "View" opens SmartVision instead',
    // hole-view was ~90% duplicated by smartvision.tsx and orphaned from the daily flow.
    // It + its exclusive render components are deleted; the one entry point (Play-tab "View")
    // now opens SmartVision, which resolves the course from previewCourseId.
    !fs.existsSync(path.resolve(__dirname, '../../app/hole-view.tsx')) &&
      !fs.existsSync(path.resolve(__dirname, '../../components/smartvision/GolfshotHoleView.tsx')) &&
      !fs.existsSync(path.resolve(__dirname, '../../components/smartvision/VectorHoleView.tsx')) &&
      !fs.existsSync(path.resolve(__dirname, '../../components/smartvision/ShotPlotLayer.tsx')) &&
      /setPreviewCourse\(selected\.id\);[\s\S]{0,160}router\.push\('\/smartvision'/.test(read('app/(tabs)/play.tsx')) &&
      !/name="hole-view"/.test(read('app/_layout.tsx')),
    'the redundant hole-view screen + its exclusive deps are deleted, the Play-tab preview opens SmartVision (via previewCourseId), and the orphaned route registration is gone — one canonical map surface');

  check('GPS: the canonical SmartVision map sources from gpsManager, not a private watch',
    !/Location\.watchPositionAsync/.test(read('app/smartvision.tsx')) &&
      /getLastFix, subscribeFixChange/.test(read('app/smartvision.tsx')),
    'the surviving map surface rides the smoothed / 90m-tolerant / confidence pipeline via getLastFix/subscribeFixChange — single GPS source, no rogue second watch');

  // ─── Health-aware coaching: mobility flag catches sciatica (was joint-only) ──
  check('Coaching: hasMobilityFlag catches sciatica + common conditions, ignores negations',
    hasMobilityFlag({ physicalLimitation: 'sciatica' }) === true &&
      hasMobilityFlag({ physicalLimitation: 'mild arthritis in left wrist' }) === true &&
      hasMobilityFlag({ physicalLimitation: 'recovering from rotator cuff surgery' }) === true &&
      hasMobilityFlag({ physicalLimitation: 'bad back' }) === true &&
      hasMobilityFlag({ physicalLimitation: null }) === false &&
      hasMobilityFlag({ physicalLimitation: '' }) === false &&
      // negation/benign must NOT flag (review finding)
      hasMobilityFlag({ physicalLimitation: 'no injuries' }) === false &&
      hasMobilityFlag({ physicalLimitation: 'no pain' }) === false &&
      hasMobilityFlag({ physicalLimitation: 'fully recovered' }) === false &&
      hasMobilityFlag({ physicalLimitation: 'none' }) === false &&
      hasMobilityFlag({ physicalLimitation: 'healthy' }) === false,
    'sciatica/arthritis/surgery/nerve flag mobility-aware coaching; "no injuries"/"no pain"/"fully recovered"/"none"/"healthy" correctly do NOT (the deterministic path matches the LLM via physicalLimitation context)');

  // ─── Elevation → plays-like (infra; call-site wiring is the next step) ──────
  const elevSrc = fs.readFileSync(path.resolve(__dirname, '../../services/elevationService.ts'), 'utf-8');
  check('Elevation: client service caches successes + fails safe to flat (0)',
    /const cache = new Map/.test(elevSrc) &&
      /getPlaysLikeElevationDeltaFeet/.test(elevSrc) &&
      /if \(p == null \|\| t == null\) return \{ deltaFeet: 0, hasData: false \};/.test(elevSrc) && // refreshed: honesty-aware result (was bare return 0)
      /return \{ deltaFeet: Math\.round\(\(t - p\)/.test(elevSrc),
    'elevation cached per ~11m cell; a missing lookup returns 0 (flat) so it can never block/corrupt a yardage — target−player matches playsLike uphill-positive');

  const elevApiSrc = fs.readFileSync(path.resolve(__dirname, '../../api/elevation.ts'), 'utf-8');
  check('Elevation: /api/elevation proxies Open-Topo-Data + returns feet, 200+null on failure',
    /api\.opentopodata\.org/.test(elevApiSrc) && /elevation_ft/.test(elevApiSrc) &&
      /status\(200\)\.json\(\{ elevation_ft: null/.test(elevApiSrc),
    'keyless server proxy converts meters→feet; failures return 200 + null so the client falls back to flat, never an error path');

  const vercelSrc = fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf-8');
  check('Elevation: /api/elevation route registered in vercel.json allowlist',
    /"\/api\/elevation"/.test(vercelSrc),
    'explicit route exists before the SPA fallback, so /api/elevation returns JSON not index.html (deploy-mechanics gotcha)');

  const hookSrc = fs.readFileSync(path.resolve(__dirname, '../../hooks/useElevationDelta.ts'), 'utf-8');
  check('Elevation: useElevationDelta is safe — 0/flat until both points resolve, gridded deps',
    /useElevationDeltaStatus/.test(hookSrc) && /getPlaysLikeElevation\b/.test(hookSrc) && // refreshed: status hook + getPlaysLikeElevation
      /setState\(\{ deltaFeet: 0, hasData: false \}\);\s*\n\s*return;/.test(hookSrc) &&
      /Math\.round\(v \* 1e4\)/.test(hookSrc),
    'safe to pass straight to playsLikeDistance — never blocks a yardage; deps gridded to the ~11m cache cell so GPS jitter does not thrash the effect');

  const sfSrc = fs.readFileSync(path.resolve(__dirname, '../../app/smartfinder.tsx'), 'utf-8');
  check('Elevation: SmartFinder reticle plays-like now factors real elevation',
    /useElevationDeltaStatus\(elevPlayer, elevTarget\)/.test(sfSrc) && // refreshed: status hook variant
      /playsLikeDistance\(targetYards, weather, targetBearing \?\? shotBearingDeg, elevationDeltaFeet\)/.test(sfSrc),
    'the interactive aim-point plays-like passes the cached elevation delta — uphill/downhill is live (was always flat); other surfaces remain flat-safe follow-ups');

  const qsSrc = fs.readFileSync(path.resolve(__dirname, '../../services/intents/queryStatusHandler.ts'), 'utf-8');
  check('Elevation: voice "plays like" answer factors elevation (flat-safe)',
    /getPlaysLikeElevationDeltaFeet\(here, green\)/.test(qsSrc) &&
      /playsLikeDistance\(actual, w, bearing, elevationDeltaFeet\)/.test(qsSrc),
    'the spoken plays-like answer includes uphill/downhill via the cached elevation service; 0/flat on any miss so it never blocks the answer');

  // ─── SmartMotion cage-test fixes (face-on launch-line checked above) ──────
  const swingDetailSrc2 = fs.readFileSync(path.resolve(__dirname, '../../app/swinglab/swing/[swing_id].tsx'), 'utf-8');
  // 2026-06-11 — tap the video to play/pause (Tim: intuitive, not hunting for the
  // button). Single-tap via ZoomableView, composed UNDER double-tap-reset + pinch/pan
  // so zoom/annotation stay intact; native controls off, a tap-to-seek bar replaces
  // the native scrubber so nothing competes with the tap gesture.
  check('Swing Library: tap-to-play/pause without breaking zoom/scrub',
    /onSingleTap\?: \(\) => void/.test(read('components/swinglab/ZoomableView.tsx')) &&
      /Gesture\.Exclusive\(doubleTap, singleTap, composed\)/.test(read('components/swinglab/ZoomableView.tsx')) &&
      /onSingleTap=\{togglePlayPause\}/.test(swingDetailSrc2) &&
      /useNativeControls=\{false\}/.test(swingDetailSrc2) &&
      /void scrubTo\(frac \* duration\)/.test(swingDetailSrc2),
    'ZoomableView gains an optional single-tap (Exclusive: double-tap-reset wins, then single-tap, then pinch/pan), wired to play/pause; native controls off + a tap-to-seek bar replaces the scrubber so the tap-to-pause never fights native tap handling, and pinch-zoom + annotation are untouched');

  check('Swing Library: state-aware — no full-clip re-analyze of a cage multi-swing (1-min-stuck fix)',
    /if \(session\?\.source === 'live_cage' \|\| durationMs > 20_000\) return;/.test(swingDetailSrc2),
    'the biomech backfill is gated off cage/long clips — a ~60s multi-swing session is no longer watched whole as one swing in the library detail (Tim\'s 1-min stuck)');

  // 2026-06-14 (Tim) — Smart Motion REVIEW playback: "shows them bending to place
  // the ball / won't play / replaced the whole video." Three fixes: (1) AWAIT the
  // seek before play so it lands on the swing, not frame 0; (2) onLoad seeks to the
  // selected swing window first; (3) loop is WINDOWED to the swing so it stops
  // replaying the pre-swing setup. Guarded re-seek prevents status-tick seek spam.
  check('Smart Motion review: video seeks to the swing window + windowed loop (no setup replay)',
    (() => {
      const sm = read('app/swinglab/smartmotion.tsx');
      return (
        // selectSwing awaits the seek before playing
        /try \{ await v\.setPositionAsync\(seg\.startMs\); \} catch/.test(sm) &&
        // onLoad seeks to the selected swing window before kicking play (live ref, audit-fixed)
        /const seg = segments\[selectedSwingRef\.current\];\s*\n\s*if \(seg && seg\.startMs > 0\) \{ try \{ await v\.setPositionAsync\(seg\.startMs\)/.test(sm) &&
        // looped playback re-seeks to the swing start once it runs past endMs (windowed)
        /const windowed = seg && seg\.endMs > seg\.startMs && \(dur === 0 \|\| seg\.endMs < dur - 250\)/.test(sm) &&
        /loopSeekGuardRef\.current/.test(sm) &&
        // phase scrub pauses then awaits the seek so it holds on the phase frame
        /try \{ await v\?\.pauseAsync\(\); \} catch[\s\S]{0,80}try \{ await v\?\.setPositionAsync\(f\.timestampMs\); \}/.test(sm)
      );
    })(),
    'review playback opens on the actual swing (not the bend-to-place-the-ball setup frame), the loop stays windowed to the swing instead of replaying the whole clip, and seeks are awaited so they land — the "won\'t play / replaced the whole video" report');
}

// ─── Strengths + setup check (2026-06-14, Tim) ──────────────────────────────────
{
  const apiSrc = read('api/swing-analysis.ts');
  const classifierSrc = read('services/swingIssueClassifier.ts');
  const cardSrc = read('components/swinglab/PrimaryIssueCard.tsx');
  const setupSvc = read('services/swing/setupCheck.ts');
  const setupScreen = read('app/swinglab/setup-check.tsx');
  const swinglabTab = read('app/(tabs)/swinglab.tsx');

  check('Strengths: server `strengths` field staged in prompt + type + normalize',
    apiSrc.includes('"strengths"') &&
      /strengths\?: string\[\]/.test(apiSrc) &&
      /parsed\.strengths = \[\]/.test(apiSrc) &&
      /valid_swing === false[\s\S]{0,80}parsed\.strengths = \[\]/.test(apiSrc),
    'strengths added to SYSTEM_PROMPT JSON, response type, and coerced/cleared in the normalizer (cleared when valid_swing=false)');

  check('Strengths: classifier threads strengths through all return sites via cleanStrengths',
    /function cleanStrengths/.test(classifierSrc) &&
      (classifierSrc.match(/strengths: cleanStrengths\(/g) || []).length >= 3,
    'single / multi-consensus / fallback all map analysis.strengths → PrimaryIssue.strengths, capped + trimmed');

  check('Strengths: card leads with a "WHAT\'S WORKING" block above the fault',
    cardSrc.includes('WHAT&apos;S WORKING') &&
      /hasStrengths/.test(cardSrc) &&
      cardSrc.indexOf('hasStrengths &&') < cardSrc.indexOf("primary_fault === 'inconclusive'"),
    'strengths render above the fault branches — positive first (honesty-gated: hidden when empty)');

  check('Setup check: gated by SETUP_CHECK_ENABLED (server-deploy switch, now LIVE)',
    /export const SETUP_CHECK_ENABLED = (true|false)/.test(setupSvc) &&
      setupScreen.includes('if (!SETUP_CHECK_ENABLED)') &&
      /SETUP_CHECK_ENABLED \?/.test(swinglabTab),
    'single flag gates screen ("coming" state when off) + launcher card (spread-hidden when off) — no dead entry (no-deferred-wiring); flipped true once SETUP_SYSTEM_PROMPT deployed');

  check('Setup check: rides /api/swing-analysis via swing_tag=setup with honest fail-safe',
    /swing_tag: 'setup'/.test(setupSvc) &&
      /isSetup = swingTag === 'setup'/.test(apiSrc) &&
      apiSrc.includes('SETUP_SYSTEM_PROMPT') &&
      /catch \{\s*return FAILED;/.test(setupSvc),
    'single address frame → SETUP_SYSTEM_PROMPT; never throws (returns an honest unreadable result), reusing strengths=fundamentals / fix=adjustment');
}

// ─── Pre-round orchestrator (2026-06-15, Tim) ───────────────────────────────────
{
  const p10 = composePreroundPlan({ minutes: 10, focus: 'tempo' });
  const p20 = composePreroundPlan({ minutes: 20, focus: 'tempo' });
  const p30 = composePreroundPlan({ minutes: 30, focus: 'power' });

  check('Pre-round: momentum-first — always opens loose, always ends on a confidence ball',
    p10.steps[0].kind === 'stretch' && p10.steps[p10.steps.length - 1].kind === 'finish' &&
      p20.steps[0].kind === 'stretch' && p20.steps[p20.steps.length - 1].kind === 'finish' &&
      p30.steps[0].kind === 'stretch' && p30.steps[p30.steps.length - 1].kind === 'finish',
    'every composed plan starts with stretch (loosen up) and ends with the confidence finish — never drilled-then-cold to the first tee');

  check('Pre-round: adaptive to the time budget — tighter time = fewer steps, fits the budget',
    p10.steps.length < p20.steps.length && p20.steps.length <= p30.steps.length &&
      p10.allocated <= 12 && p20.allocated <= 24 && p30.allocated <= 36 &&
      // the brief (mental prep, not a swing) is dropped on the tightest 10-min plan
      !p10.steps.some(s => s.kind === 'brief') && p20.steps.some(s => s.kind === 'brief'),
    'the plan COMPOSES to the minutes you actually have (10<20<=30 steps, allocated within budget); 10-min drops the lower-ROI brief but keeps stretch+setup+swing+finish');

  check('Pre-round: readiness is DERIVED from completion, never fabricated',
    preroundReadiness(5, 0) === 0 && preroundReadiness(5, 5) === 1 &&
      Math.abs(preroundReadiness(5, 3) - 0.6) < 1e-9 && preroundReadiness(0, 0) === 0,
    'readiness = completed/total (0..1), divide-by-zero safe — no hardcoded score (honesty bar); screen renders "N of M" + a bar');

  check('Pre-round: focus leads the matching club without dropping the others',
    (() => {
      const swings20 = p20.steps.filter(s => s.kind === 'swings');
      const powerLeadsDriver = p30.steps.filter(s => s.kind === 'swings')[0]?.club === 'driver';
      return swings20.length >= 2 && powerLeadsDriver;
    })(),
    'focus re-orders the swing emphasis (power → driver leads) but every club the budget allows still survives');
}

// ─── AI club fitting — Fit Profile v1 (2026-06-15, Tim) ─────────────────────────
{
  const fp = composeFitProfile([
    { club: 'Driver', yards: 230, measured: true },
    { club: '5I', yards: 160, measured: true },   // 70-yd gap below Driver in this sparse set
    { club: '6I', yards: 154, measured: true },   // within 7 of 5I → overlap
    { club: 'PW', yards: 110, measured: true },    // 44-yd gap below 6I
    { club: 'Putter', yards: 0, measured: false }, // excluded
  ]);
  const gapDriver5i = fp.gaps.some((g) => g.upper === 'Driver' && g.lower === '5I' && g.gapYards === 70);
  const overlap = fp.overlaps.some((o) => o.longer === '5I' && o.shorter === '6I');

  check('Fit Profile: ladder excludes putter, finds gaps + overlaps from real distances',
    fp.ladder.length === 4 && fp.ladder[0].club === 'Driver' && !fp.ladder.some((c) => c.club === 'Putter') &&
      gapDriver5i && overlap,
    'full-swing ladder sorted longest→shortest (Putter/0 excluded); a >=20yd adjacent gap is a hole, a <=7yd one is a redundant club');

  check('Fit Profile: honesty — confidence scales with measured, never a fabricated spec',
    fp.measuredCount === 4 && fp.confidence === 'medium' &&
      /starting point/i.test(fp.disclaimer) && !/(\d+\s?°|mph|smash)/i.test(fp.disclaimer + fp.headline) &&
      composeFitProfile([{ club: '7I', yards: 140, measured: false }]).confidence === 'low',
    'confidence = measured-club count (4→medium, <4→low); disclaimer says "starting point" and nothing claims lie degrees / mph / smash');

  check('Fit Profile: stated My Bag fills the ladder + lifts confidence honestly (never high on stated alone)',
    (() => {
      const stated = composeFitProfile([
        { club: 'Driver', yards: 260, measured: false, stated: true },
        { club: '3W', yards: 235, measured: false, stated: true },
        { club: '5I', yards: 175, measured: false, stated: true },
        { club: '6I', yards: 165, measured: false, stated: true },
        { club: '7I', yards: 155, measured: false, stated: true },
        { club: '8I', yards: 145, measured: false, stated: true },
        { club: '9I', yards: 135, measured: false, stated: true },
        { club: 'PW', yards: 120, measured: false, stated: true },
      ]);
      return (
        stated.statedCount === 8 && stated.measuredCount === 0 && stated.knownCount === 8 &&
        stated.ladder.length === 8 && stated.confidence === 'medium' && // knownCount>=8 lifts to medium...
        composeFitProfile([{ club: '7I', yards: 155, measured: false, stated: true }]).confidence === 'low'
      );
    })(),
    'a stated bag fills the ladder + reaches medium (knownCount>=8) but never high on stated-only; measured stays the gold standard');

  check('My Bag: editable store path + Fit Profile read + dashboard surface + caddie yardages',
    // 2026-06-15 (Tim — clubs gone from dashboard, no fit credit) — the editable bag
    // is the canonical distance source: setManual writes it, distanceFor reads
    // tracked→stated→chart, the Fit Profile ladder + dashboard card render it, and
    // getLearnedClubDistances feeds the caddie the STATED carry when none is tracked.
    (() => {
      const store = read('store/clubStatsStore.ts');
      const screen = read('app/practice/fit-profile.tsx');
      const dash = read('app/(tabs)/dashboard.tsx');
      return (
        /setManual:/.test(store) && /distanceFor:/.test(store) && /hasManual:/.test(store) &&
        /else if \(s\.manual\[club\] != null\) out\[club\] = s\.manual\[club\]!/.test(store) &&
        /useClubStatsStore\.getState\(\)\.setManual/.test(screen) &&
        /st\.distanceFor\(c\), measured: st\.hasSamples\(c\), stated: st\.hasManual\(c\)/.test(screen) &&
        /MY BAG/.test(dash) && /router\.push\('\/practice\/fit-profile'/.test(dash)
      );
    })(),
    'editable My Bag: store setManual/distanceFor → Fit Profile ladder + dashboard card + caddie yardages');

  // FLEX — honest only off a MEASURED driver carry, distance→flex (no fabricated mph).
  const flexStiff = recommendFlex(240, true);
  const flexReg = recommendFlex(205, true);
  const flexNone = recommendFlex(210, false); // not measured → no guess
  check('Fit Profile: flex from MEASURED driver carry only, distance heuristic, no fake mph',
    flexStiff?.flex === 'Stiff flex' && flexReg?.flex === 'Regular flex' && flexNone === null &&
      !/mph|\bspeed\b.*\d/i.test(flexStiff?.note ?? '') && /starting point/i.test(flexStiff?.note ?? ''),
    '240yd carry → Stiff, 205 → Regular; unmeasured driver → null (no guess); note is a "starting point", never a claimed mph');

  // BALL — category-level from speed tier + handicap; never a SKU or fabricated spin.
  const ballFast = recommendBallCategory(255, 8);
  const ballSlow = recommendBallCategory(185, 22);
  const ballDefault = recommendBallCategory(0, null); // unknown → assume mid, still honest
  check('Fit Profile: ball is CATEGORY-level from readable signals, no SKU / no fabricated spin',
    ballFast.category === 'Tour (urethane)' && ballSlow.category === 'Low-compression soft' &&
      typeof ballDefault.category === 'string' &&
      [ballFast, ballSlow].every((b) => /spin\/compression/i.test(b.note) && !/\b(Pro V1|TP5|Chrome|\$)\b/i.test(b.category)),
    'fast+low-hcp → Tour urethane, slow → low-compression; category not a SKU; note states we don\'t measure spin/compression');
}

// ─── Library points → performance graph (2026-06-15, Tim) ───────────────────────
{
  const DAY = 24 * 60 * 60 * 1000;
  const now = 1_700_000_000_000; // fixed clock (Date.now() unavailable in sims)
  // estimate matches the tracked ledger's conservative scheme (5 base + 1/swing, cap 5).
  const estOk = estimateSessionPoints(3) === 8 && estimateSessionPoints(5) === 10 &&
    estimateSessionPoints(20) === 10 && estimateSessionPoints(0) === 5;

  // Not enough on both sides → honest "keep logging", no fabricated connection.
  const thin = computePointsPerformance({ sessions: [{ startedAt: now - DAY, swings: 4 }], rounds: [], nowMs: now });

  // Enough on both sides → totals + series populated; never claims causation.
  const full = computePointsPerformance({
    sessions: Array.from({ length: 5 }, (_, i) => ({ startedAt: now - (i + 1) * 3 * DAY, swings: 5 })),
    rounds: Array.from({ length: 5 }, (_, i) => ({ endedAt: now - (i + 1) * 5 * DAY, scoreVsPar: 10 - i })),
    nowMs: now,
  });

  check('Library points: estimate matches the tracked conservative scheme (no inflation)',
    estOk,
    '5 base + 1/swing capped at 5 → 3 swings = 8, 5+ swings = 10, 0 swings = 5 (same as practicePointsStore)');

  check('Library points→performance: honest gate + totals/series, association not causation',
    !thin.hasEnough && /keep practicing|enough/i.test(thin.headline) &&
      full.hasEnough && full.totalEstimatedPoints === 50 && full.pointsSeries.length === 6 &&
      full.scoreSeries.length === 5 && !/cause|because/i.test(full.headline),
    'thin data → "keep logging" (no claim); enough data → estimated total (5 sessions x 10) + points/week + score series, headline describes association only');

  // Tim — "run live, re-estimate clean start later": sinceMs baseline starts clean.
  const baseline = now - 10 * DAY; // only the 2 most-recent of the 5 sessions land after it
  const live = computePointsPerformance({
    sessions: Array.from({ length: 5 }, (_, i) => ({ startedAt: now - (i + 1) * 3 * DAY, swings: 5 })),
    rounds: [],
    nowMs: now,
    sinceMs: baseline,
  });
  check('Library points: clean-start baseline (sinceMs) counts only sessions after it',
    live.sessionsCounted === 3 && live.totalEstimatedPoints === 30 &&
      full.sessionsCounted === 5, // all-time (no sinceMs) still sees everything for the later re-estimate
    'sinceMs excludes pre-baseline sessions so the graph builds live from a clean start (3 of 5 here); omitting sinceMs counts all-time for the future re-estimate');
}

// ─── Shot-shape drills (2026-06-15, Tim) ────────────────────────────────────────
{
  const origin = { x: 0.5, y: 0.8 };
  // steep-up vector → high launch; shallow vector → low launch.
  const high = readActualLaunch(origin, { x: 0.52, y: 0.55 });   // mostly vertical
  const low = readActualLaunch(origin, { x: 0.75, y: 0.77 });    // mostly horizontal
  const none = readActualLaunch(origin, { x: 0.505, y: 0.795 }); // negligible move
  const flop = getShotShape('flop');

  check('Shot-shape: launch read from origin→one departure point (height + direction, no fabrication)',
    high?.height === 'high' && low?.height === 'low' && none === null &&
      (low?.direction === 'right') && SHOT_SHAPES.length >= 6 && !SHOT_SHAPES.some(s => s.id === 'putt'),
    'a steep vector reads HIGH, a shallow one LOW, negligible movement reads NULL (no honest direction); putting is excluded (ground roll, not a launch)');

  check('Shot-shape: intended-vs-actual grades on launch height, and NEVER claims roll',
    (() => {
      if (!flop) return false;
      const onTarget = compareShotShape(flop, high);     // flop=high vs high read
      const missed = compareShotShape(flop, low);        // flop=high vs low read
      const unread = compareShotShape(flop, null);       // no departure
      const noRollClaim = ![onTarget, missed, unread].some(v => /\broll|release|check\b/i.test(v.feedback));
      return onTarget.match === 'on' && missed.match === 'off' && unread.match === 'off' &&
        /couldn't read/i.test(unread.feedback) && noRollClaim;
    })(),
    'flop vs a high read = on; vs a low read = off; no departure = honest "couldn\'t read"; feedback never claims roll/check/release (single point can\'t see it)');
}

// ─── Voice racing on swing navigation (2026-06-15, Tim) ─────────────────────────
check('Swing detail: stops voice on swing CHANGE, not just unmount (no late-catch-up racing)',
  (() => {
    const src = read('app/swinglab/swing/[swing_id].tsx');
    // a stopSpeaking cleanup keyed on [swing_id] (fires on every swing change +
    // unmount), so a slow/failing TTS fetch from the prior swing can't play late
    // while the next swing's narration queues behind it on the serial speak queue.
    return /return \(\) => \{ void stopSpeaking\(\); \};\s*\}, \[swing_id\]\)/.test(src);
  })(),
  'navigating between swing-library files aborts the prior swing\'s in-flight/queued narration (stopSpeaking bumps the speak generation + aborts the TTS fetch) so voices don\'t stack and catch up late');

// ─── Scenario 13: critical-path diagnostic markers present (2026-06-16) ─────────
//
// Path 2 (ROUND) and Path 4 (VOICE) MIN VERIFY works by grepping logcat for the
// flow-boundary markers documented in docs/critical-paths.md. If a marker isn't
// emitted, the device verification silently can't confirm that boundary ran —
// the exact "code audit passes, device run fails" gap Phase AO exists to close.
// An earlier sweep found 5/9 Path 2 and 8/10 Path 4 markers missing from the
// code while still documented in the spec. This scenario is the regression guard:
// it scans the source tree and fails if any documented marker drifts out again.
console.log('\n=== Scenario 13: critical-path diagnostic markers ===');
{
  const walkTs = (dir: string): string[] => {
    const out: string[] = [];
    let entries: string[] = [];
    try { entries = fs.readdirSync(path.resolve(__dirname, '../../', dir)); } catch { return out; }
    for (const e of entries) {
      const rel = `${dir}/${e}`;
      let stat;
      try { stat = fs.statSync(path.resolve(__dirname, '../../', rel)); } catch { continue; }
      if (stat.isDirectory()) out.push(...walkTs(rel));
      else if (/\.(ts|tsx)$/.test(e)) out.push(rel);
    }
    return out;
  };
  // Scan the dirs that own flow-boundary instrumentation (excludes scripts/ so the
  // marker strings in THIS harness don't count as emission sites).
  const sourceFiles = ['services', 'store', 'app', 'hooks'].flatMap(walkTs);
  const corpus = sourceFiles.map((f) => {
    try { return read(f); } catch { return ''; }
  }).join('\n');

  // The contract from docs/critical-paths.md. Keep in sync with that doc.
  const PATH2_MARKERS = [
    '[path2:round] start', '[path2:round] gps_prewarm', '[path2:round] hole transition',
    '[path2:round] shot logged', '[path2:round] anchor_tee', '[path2:round] anchor_green',
    '[path2:round] mark ', '[path2:round] end', '[path2:round] recap generated',
  ];
  const PATH4_MARKERS = [
    '[path4:voice] tap_open', '[path4:voice] opener_done', '[path4:voice] capture_start',
    '[path4:voice] capture_done', '[path4:voice] intent=', '[path4:voice] filler_start',
    '[path4:voice] filler_end', '[path4:voice] response_start', '[path4:voice] response_end',
    '[path4:voice] close',
  ];
  const missing2 = PATH2_MARKERS.filter((m) => !corpus.includes(m));
  const missing4 = PATH4_MARKERS.filter((m) => !corpus.includes(m));
  check('Path 2 ROUND: all 9 diagnostic markers emitted in source',
    missing2.length === 0,
    missing2.length === 0 ? 'all 9 present' : `MISSING (MIN VERIFY can\'t grep these): ${missing2.join(', ')}`);
  check('Path 4 VOICE: all 10 diagnostic markers emitted in source',
    missing4.length === 0,
    missing4.length === 0 ? 'all 10 present' : `MISSING (MIN VERIFY can\'t grep these): ${missing4.join(', ')}`);
}

// ─── Synthesis ─────────────────────────────────────────────────────────────────

console.log('\n=== SYNTHESIS ===');
const total = results.length;
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed);
console.log(`Total scenarios: ${total}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed.length}`);

if (failed.length > 0) {
  console.log('\nFailures:');
  for (const f of failed) {
    console.log(`  ✗ ${f.scenario} :: ${f.details}`);
  }
  process.exit(1);
}

console.log('\nAll harness scenarios passed.');
process.exit(0);
