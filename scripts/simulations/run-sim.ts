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
import { mergeSwingDetections, correlateStrikesWithVideo } from '../../services/swing/swingSegmentation';
import { evaluateFraming } from '../../services/swing/framingCheck';
import { computeTraceDirection, traceColor } from '../../services/swing/ballTrace';
import { normalizeImportedList, buildListPersistInput, type ListedRoundRow } from '../../services/roundImportRules';
import { rebuildDifferentialsFromHistory, estimateNewIndex, expectedNineDifferential } from '../../services/handicapCalculator';
import { hasMobilityFlag } from '../../services/coachingAdaptation';

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
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');

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
  /SvgPolygon/.test(targetOverlaySrc) && /SvgEllipse/.test(targetOverlaySrc) &&
    />TARGET</.test(targetOverlaySrc) && />BALL AREA</.test(targetOverlaySrc),
  'green perspective ball-area trapezoid + white target line/ring + pills');

check('Pre-record ball box: default box + verifier gated to Motion step',
  /draftBall/.test(smSrc) && /placeBallMode/.test(smSrc) &&
    /label=\{placeBallMode \? 'Tap your ball' : 'Ball box'\}/.test(smSrc) &&
    /\[showSkeleton, clipUri, ballArea, ballDeparture\]/.test(smSrc),
  'default reference box + verifier runs under Motion (keeps the default read fast)');

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
  // Maps staticmap (external), and the Meta-glasses swing-tempo placeholder
  // which is handled by an Expo Router app/api route, not vercel.json.
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

check('AR shot tracer labels carry/apex as estimates',
  /~\{trace\.flight\.carry_yd\}y/.test(read('components/ArShotTraceOverlay.tsx')) &&
    /Landing around/.test(read('services/arShotTracer.ts')),
  'simulated flight shown/spoken as ~estimate, not exact');

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
check('Motion data is unstacked (off by default, gated behind Motion step)',
  /useState\(false\);[\s\S]{0,400}Motion overlay/.test(smSrc) &&
    /!showSkeleton\) return;/.test(smSrc) && /\{showSkeleton \? \(/.test(smSrc),
  'pose/tempo/stat cards only compute + render when Motion is on (clean video default)');

check('Verdict no longer claims ANALYZING forever',
  /deriveVerdict\(a: SwingAnalysis \| null, analyzing: boolean\)/.test(smSrc) &&
    /NO READ — RECORD AGAIN/.test(smSrc),
  'errored/empty read shows honest state, not a perpetual spinner');

check('Acoustic Listening only while recording',
  /listening\?: boolean/.test(read('components/smartmotion/SmartMotionHud.tsx')) &&
    /Calibrated ✓ — Record to listen/.test(read('components/smartmotion/SmartMotionHud.tsx')) &&
    /listening=\{phase === 'recording'\}/.test(smSrc),
  'no fake "Listening…" in setup');

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

check('Tempo pill on the left (review, swings, honest)',
  /tempoPill/.test(smSrc) && /isReview && !isPutt && tempo\?\.ratio != null/.test(smSrc),
  'headline tempo shown as a left pill, only when a real ratio exists');

check('Face-on: NO launch/trace line on review (false from the front); framing guides both angles',
  // 2026-06-11 (cage test) — the slanted launch line is REMOVED from face-on
  // review. From the front you cannot see ball flight, so it read as a false
  // line (Tim flagged it). Review keeps the vertical target alignment only.
  // Review now uses the DRAGGABLE EditableCageTargets, which renders the overlay
  // with launchDir={null} internally (no false face-on launch line).
  /<EditableCageTargets/.test(smSrc) &&
    !/launchDir=\{angle === 'face_on'/.test(smSrc) &&
    /launchDir=\{null\}/.test(read('components/swinglab/CageTargetingCard.tsx')) &&
    // No launch line during live capture either (declutter line-up).
    /<CageTargetingOverlay ballArea=\{draftBall\} target=\{angle === 'down_the_line' && !isPutt \? draftTarget : null\} launchDir=\{null\}/.test(smSrc) &&
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

check('One-time migration clears auto-trapped Local Mode (settings v12)',
  /version: 12/.test(read('store/settingsStore.ts')) &&
    /if \(version < 12\)[\s\S]{0,160}p\.localMode = false/.test(read('store/settingsStore.ts')),
  'users trapped in auto-engaged Local Mode by the old breaker boot clean once');

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
  !/if \(!useRoundStore\.getState\(\)\.isRoundActive\) return;/.test(read('app/(tabs)/caddie.tsx')) &&
    /Warm the brain whenever the Caddie tab is open/.test(read('app/(tabs)/caddie.tsx')),
  'off-course "good morning Kevin" hits a warm Lambda so the first ask is fast');

// 2026-06-10 — Provider architecture: Anthropic spine, Gemini fast fallback,
// OpenAI out of analysis (ears/mouth only). (swingApiSrc declared above.)
check('Analysis providers: Anthropic primary + Gemini fallback, OpenAI removed',
  /const USE_GEMINI = true/.test(swingApiSrc) &&
    !/tryOpenAI/.test(swingApiSrc) &&
    !/openai\.chat\.completions/.test(swingApiSrc) &&
    !/new OpenAI\(/.test(swingApiSrc) &&
    /Gemini FAST FALLBACK/.test(swingApiSrc) &&
    /if \(USE_GEMINI && !winner\.parsed/.test(swingApiSrc) &&
    /escalating to Anthropic Sonnet/.test(swingApiSrc),
  'swing analysis runs Anthropic Haiku→Sonnet (spine) and only falls back to Gemini when Anthropic returns nothing parseable; OpenAI is no longer CALLED in the analysis chain');

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
    /const persistentUri = await persistClipToDocuments\(args\.uri\)/.test(uploadSrc) &&
    /persistClipToDocuments\(rawUri\)/.test(smSrc) &&
    /isn't on this device anymore/.test(read('app/swinglab/swing/[swing_id].tsx')),
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
check('API base URL — one resolver, never relative/dead (spine fix)',
  /export function getApiBaseUrl/.test(apiBaseSrc) &&
    /https:\/\/smartplay-beta\.vercel\.app/.test(apiBaseSrc) &&
    /\^https\?:\\\/\\\/\.\+/.test(apiBaseSrc) &&                          // absolute-url guard present
    !/EXPO_PUBLIC_API_URL \?\? /.test(read('hooks/useVoiceCaddie.ts')) && // voice no longer reads env raw
    !/EXPO_PUBLIC_API_URL \?\? /.test(read('hooks/useKevin.ts')) &&       // brain no longer reads env raw
    /getApiBaseUrl\(\)/.test(read('hooks/useVoiceCaddie.ts')),
  'every backend fetch resolves through getApiBaseUrl(), which honors EXPO_PUBLIC_API_URL only when it is an absolute http(s) url and otherwise falls back to production — so an env var missing from an OTA bundle can never again leave the client with no server address');

// 2026-06-10 — Voice warmup coverage. prewarmVoice() previously fired ONLY on the
// greeting screen, so the first mic tap after navigating in (or after the app
// backgrounded long enough for the Lambdas to idle out) paid full cold-start —
// the "thinking forever → took too long" first turn. Now the voice hook warms on
// mount of any voice surface AND on app foreground.
const vcWarmSrc = read('hooks/useVoiceCaddie.ts');
check('Voice warmup fires on voice-surface mount + app foreground (not just greeting)',
  /import \{ prewarmVoice \} from '\.\.\/services\/voiceWarmup'/.test(vcWarmSrc) &&
    /AppState\.addEventListener\('change'/.test(vcWarmSrc) &&
    /next === 'active'\) warmIfVoice\(\)/.test(vcWarmSrc) &&
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
    /segmentsFromStrikes\(acousticStrikes, durMs\); \/\/ vision empty/.test(smEnvSrc),
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
    /analyzeSwingFromVideo\(clipUri, videoDurationMs, angle\)/.test(smSrc),
  'down-the-line nulls the width-foreshortening turn + lateral weight metrics (invalid from behind) instead of reporting wrong numbers; angle threaded end-to-end');

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

check('Caddie CNS Phase 2 wired into BOTH brain paths (additive, server-pasted block)',
  /mergeMemoryIntoContext\(\s*\n?\s*unifiedPromptBlock/.test(kevinHookSrc) &&
    /unified_context_block: getCaddieContext\(\{ courseId: activeCourseId, hole: currentHole, club \}\)\.promptBlock/.test(voiceHookSrc),
  'typed-chat (useKevin) and voice (useVoiceCaddie) both fold the memory slice into unified_context_block — the field the server already pastes — so no server change and live builders stay as fallback');

// 2026-06-10 — CNS Phase 3 (reflection loop) + Phase 4 (signal-independence).
const memStoreSrc = read('store/caddieMemoryStore.ts');
const retrSrc = read('services/caddieMemoryRetrieval.ts');
check('Caddie CNS Phase 3: durable round reflections (baseline + recap enrichment, deduped)',
  /CNS Phase 3 — capture a durable, HONEST BASELINE reflection/.test(roundSrc) &&
    /recordReflection\(\{/.test(roundSrc) &&
    /CNS Phase 3 — enrich the round's durable reflection/.test(read('services/recapGenerator.ts')) &&
    /p\.reflections\.filter\(\(r\) => r\.round_id !== round_id\)/.test(memStoreSrc),
  'round end writes an honest baseline reflection; the recap LLM summary enriches it; recordReflection dedupes by round so one round = one reflection');

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

  check('SmartMotion: uploaded/library clips segment multi-swing from video (the "6 swings, 1 of 1" bug)',
    /pose\.locateSwings\(clipUriParam/.test(smSrc2) && /swings\.length > 1/.test(smSrc2),
    'a re-analyzed upload (no acoustics) runs the video locator and shows all swings when >1 found; a genuine single-swing upload is unchanged');

  // 2026-06-11 — cage-test fix: "NO READ — RECORD AGAIN" was flashing as a
  // transient mid-pipeline state (bounded acoustic pass → whole-clip video re-scan)
  // before the real read landed. Now keyed off phase so it's strictly terminal.
  check('SmartMotion: NO-READ is terminal (phase-gated, not a mid-pipeline flash)',
    /return deriveVerdict\(analysis, phase === 'analyzing'\)/.test(smSrc2) &&
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
      /computeTraceDirection\(ballArea, ballDeparture\.departurePoint, targetPoint\)/.test(smSrc2) &&
      /traceColor\(ballTrace\.divergenceDeg, seg\?\.peakDb/.test(smSrc2) &&
      /ball_after_norm/.test(read('api/ball-departure.ts')) &&
      /<BallTraceOverlay trace=\{ballTrace\}/.test(smSrc2),
    'the trace runs DOWN-THE-LINE ONLY (never face-on/putt), off the real detected departure point (ball-departure server now returns ball_after_norm, mapped to full-frame), measured against the ball→target aim line and coloured by divergence + the segment peakDb — rendered only in review');

  check('SmartMotion: geometry→effort grades the read + LIVE interactive DTL readout',
    /Intended effort \(from geometry\)/.test(swingApiSrc) &&
      /DECLARED a ~\$\{effortPct\}% shot/.test(swingApiSrc) &&
      /const effortRaw = useMemo/.test(smSrc2) &&                       // raw % from LIVE ball/target
      /const liveTarget = targetPoint \?\? draftTarget/.test(smSrc2) &&  // draft target in setup, session in review
      /onChangeTarget=\{\(t\) => setDraftTarget\(t\)\}/.test(smSrc2) &&   // DTL target is draggable in setup
      /styles\.aimReadout/.test(smSrc2),                                // live effort% + aim direction readout
    'server grades against declared effort from ball→target geometry; the DTL target is now DRAGGABLE in setup (floating end) and a live readout shows the effort % + aim direction updating as you move the line — the interactive geometry↔tempo Tim expected, plus the review EFFORT chip');

  // 2026-06-12 — custom icon set wired: cycling golfer mode badge (DTL/FO/PUTT +
  // fade label), env scene icons, club glyph (Tim's ChatGPT art, cropped+transparent).
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
      /thresholdDb: chipOn \? CHIP_STRIKE_THRESHOLD_DB : appliedCalibration\?\.transientThresholdDb/.test(smSrc2) &&
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

  check('Swing analysis: unbounded clips get a longer analyze watchdog',
    /const watchdogMs = boundaries \? 30_000 : 70_000;/.test(smA),
    'course single-shot / single-swing uploads (which run an internal probe+locate before the fetch) no longer time out at 30s before the real read starts');

  check('Swing analysis: tempo only from an acoustic impact anchor',
    /\(seg\.peakDb \?\? 0\) <= 0\) \{ setTempo\(null\); return; \}/.test(smA),
    'tempo is suppressed for video-located segments (range/upload, peakDb===0) whose impact time is too coarse to anchor the downswing — never shows a dishonest number');

  check('Swing analysis: club path not manufactured as a green NEUTRAL',
    !/else \{ value = 'NEUTRAL'; statusTone = 'good'; \}/.test(smA),
    'CLUB PATH renders "—" when the model did not name a path fault, instead of a confident green NEUTRAL the server deliberately withheld');

  check('Swing analysis: review playback setState gated behind the Motion overlay (perf)',
    /if \(showSkeleton && 'positionMillis' in s/.test(smA),
    'playbackMs only updates while the skeleton overlay is open, so the review loop stops re-rendering the whole screen every frame when it is off (default)');

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
  check('Swing analysis opt #2: analysis output token caps trimmed 800→650',
    /maxOutputTokens: 650/.test(swingApiSrc2) &&
      (swingApiSrc2.match(/max_tokens: 650/g) || []).length >= 2 &&
      !/max_tokens: 800/.test(swingApiSrc2) && !/maxOutputTokens: 800/.test(swingApiSrc2),
    'the three analysis calls (Gemini/Sonnet/Haiku) cap output at 650 — JSON-only one-sentence schema (~250-450 real tokens) — trimming output-token cost with a safe margin; locate caps (120/400) untouched');

  const listenSrc = fs.readFileSync(path.resolve(__dirname, '../../services/listeningSession.ts'), 'utf-8');
  check('Voice: listeningSession dispatches navigate tool_actions',
    /=== 'navigate'/.test(listenSrc) && /router\.push\(path\)/.test(listenSrc),
    'hands-free "open Smart Motion" now actually navigates (the navigate tool_action was previously dropped — only open_url was handled)');

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
    /import\('\.\/mediaPipePoseService'\)[\s\S]*?detectPoseFromUri\(imageUri, undefined, timestampMs\)[\s\S]*?if \(onDevice\) return onDevice;[\s\S]*?await fetch\(`\$\{apiUrl\(\)\}\/api\/pose-analysis`/.test(poseApiSrc),
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

  // ─── hole-view unified onto the canonical GPS pipeline (over-strict gate fix) ──
  const holeViewSrc = fs.readFileSync(path.resolve(__dirname, '../../app/hole-view.tsx'), 'utf-8');
  check('GPS: hole-view sources from gpsManager, not a private Location.watch',
    !/watchPositionAsync/.test(holeViewSrc) &&
      /import\('\.\.\/services\/gpsManager'\)/.test(holeViewSrc) &&
      /gps\.subscribe\(/.test(holeViewSrc) && /gps\.getLastFix\(\)/.test(holeViewSrc),
    'the hole map now rides the smoothed / 90m-tolerant / confidence pipeline — no rogue second watch (single GPS source)');

  check('GPS: hole-view dropped the accuracy<55m cliff (no go-dark under canopy)',
    !/coords\.accuracy < 55/.test(holeViewSrc),
    'player marker + yardages no longer vanish above 55m; gpsManager already filters >90m + garbage, so any fix shown is usable — KEEP-and-FLAG, not hide');

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
      /if \(p == null \|\| t == null\) return 0;/.test(elevSrc) &&
      /return Math\.round\(\(t - p\)/.test(elevSrc),
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
    /getPlaysLikeElevationDeltaFeet/.test(hookSrc) &&
      /setDelta\(0\);\s*\n\s*return;/.test(hookSrc) &&
      /Math\.round\(v \* 1e4\)/.test(hookSrc),
    'safe to pass straight to playsLikeDistance — never blocks a yardage; deps gridded to the ~11m cache cell so GPS jitter does not thrash the effect');

  const sfSrc = fs.readFileSync(path.resolve(__dirname, '../../app/smartfinder.tsx'), 'utf-8');
  check('Elevation: SmartFinder reticle plays-like now factors real elevation',
    /useElevationDelta\(playerLoc, targetLoc\)/.test(sfSrc) &&
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
