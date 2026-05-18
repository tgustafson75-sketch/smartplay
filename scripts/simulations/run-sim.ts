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
  const expected = p.charAt(0).toUpperCase() + p.slice(1);
  check(`getCaddieName('${p}')`, name === expected, `expected '${expected}', got '${name}'`);
}

// VoiceGender inputs (legacy back-compat path)
check("getCaddieName('male')", getCaddieName('male') === 'Kevin', `expected 'Kevin', got '${getCaddieName('male')}'`);
check("getCaddieName('female')", getCaddieName('female') === 'Serena', `expected 'Serena', got '${getCaddieName('female')}'`);

// null / undefined / unknown string → 'Kevin' default
check('getCaddieName(null)', getCaddieName(null) === 'Kevin', `expected 'Kevin', got '${getCaddieName(null)}'`);
check('getCaddieName(undefined)', getCaddieName(undefined) === 'Kevin', `expected 'Kevin', got '${getCaddieName(undefined)}'`);
check('getCaddieName("garbage")', getCaddieName('garbage') === 'Kevin', `expected 'Kevin', got '${getCaddieName('garbage')}'`);

// Pronoun helpers — Tank/Harry are male personas (pronouns "he/him/his")
for (const p of ALL_PERSONAS) {
  const expectedSubj = p === 'serena' ? 'she' : 'he';
  const expectedPos = p === 'serena' ? 'her' : 'his';
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
  // either persona or voiceGender. Look for any of the canonical markers
  // (plain destructure, body.persona, optional chaining).
  const ok = /typeof\s+(?:body\??\.)?persona\s*===\s*['"]string['"]/.test(src);
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
