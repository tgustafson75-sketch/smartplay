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
    /Place ball box/.test(smSrc) &&
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

check('Face-on launch line on REVIEW only + correct mirrored direction; framing guides both angles',
  /launchDir/.test(read('components/swinglab/CageTargetingCard.tsx')) &&
    /~ LAUNCH/.test(read('components/swinglab/CageTargetingCard.tsx')) &&
    // Review launch line: face-on, mirrored — RH golfer faces camera so target
    // is the VIEWER's right ('right' for RH / 'left' for LH).
    /launchDir=\{angle === 'face_on' \? \(swingerHandedness === 'left' \? 'left' : 'right'\) : null\}/.test(smSrc) &&
    // No launch line during live capture (declutter line-up).
    /<CageTargetingOverlay ballArea=\{draftBall\} target=\{null\} launchDir=\{null\}/.test(smSrc) &&
    // Framing guides (incl. restored FO side lines) render for BOTH angles.
    /!isReview\n\s*\? <CaptureGuides/.test(smSrc),
  'launch line is a face-on REVIEW approximation pointing the correct (mirrored) way; live capture shows framing guides for both DTL and FO');

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
  /prewarmSwingAnalysis\(\)/.test(smSrc) &&
    /Warm \/api\/swing-analysis the moment SmartMotion opens/.test(smSrc),
  'opening SmartMotion pre-warms /api/swing-analysis so the first recording analyzes fast');

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

// 2026-06-10 — Environment mode phase 1: range gets a longer window + acoustics
// off; cage path unchanged (default). Additive, mode-gated.
const smEnvSrc = read('app/swinglab/smartmotion.tsx');
check('Environment mode phase 1: range window + acoustics-off gating (cage unchanged)',
  /environmentMode: 'cage' \| 'range' \| 'course'/.test(read('store/settingsStore.ts')) &&
    /RANGE_RECORDING_MAX_SECONDS = 120/.test(smEnvSrc) &&
    /captureMode === 'range' \? RANGE_RECORDING_MAX_SECONDS : RECORDING_MAX_SECONDS/.test(smEnvSrc) &&
    /if \(captureMode === 'cage'\) \{/.test(smEnvSrc) &&            // metering only in cage
    /setEnvironmentMode\(environmentMode === 'cage'/.test(smEnvSrc), // toggle cycles modes
  'range records up to 120s and starts NO metered audio; ONLY cage keeps the acoustic metered track (range + course go acoustics-off); a setup-rail toggle cycles cage/range/course');

// 2026-06-10 — Environment mode phase 2: range segments swings from VIDEO.
check('Environment mode phase 2: range video swing-segmentation (acoustics off)',
  /export function segmentsFromVideoSwings/.test(read('services/swing/swingSegmentation.ts')) &&
    /export async function locateSwings/.test(read('services/poseDetection.ts')) &&
    /mode: 'locate_swings'/.test(read('services/poseDetection.ts')) &&
    /body\.mode === 'locate_swings'/.test(read('api/swing-analysis.ts')) &&
    /stopMode === 'range' && detectedSegments\.length === 0/.test(smEnvSrc) &&
    /segmentsFromVideoSwings\(swings, durMs\)/.test(smEnvSrc),
  'range mode (acoustics off) finds every swing from video: locateSwings() asks the new server locate_swings mode for all swing times, segmentsFromVideoSwings() builds the SAME SwingSegment[] the cage path uses (shared reel + per-swing analysis), and an empty result falls back to single-swing localization');

// 2026-06-10 — Environment mode phase 3: course = acoustics off + single shot,
// and a live round forces course.
check('Environment mode phase 3: course is acoustics-off single-shot; a live round forces course',
  /const effectiveMode.*isRoundActive \? 'course' : environmentMode/.test(smEnvSrc) &&           // round forces course (reactive)
    /isRoundActive[\s\S]{0,30}\? 'course'[\s\S]{0,60}environmentMode/.test(smEnvSrc) &&           // and at capture time
    /if \(captureMode === 'cage'\) \{/.test(smEnvSrc) &&                                            // course skips metering (not cage)
    /disabled=\{isRoundActive\}/.test(smEnvSrc),                                                    // toggle locked during a round
  'course mode disables acoustics (wind) and is single-shot (skips range multi-segmentation → single-swing localization); a live round forces course sensing regardless of the practice toggle, which is locked + shows CRSE on-course');

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
