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
import { rebuildDifferentialsFromHistory, estimateNewIndex, expectedNineDifferential, computeWhsPostingScore } from '../../services/handicapCalculator';
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
import { resolveSpokenCourse } from '../../services/courseNameResolver';
import { normalizeClub } from '../../services/clubNormalize';
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
import { GOLF_KNOWLEDGE } from '../../services/knowledgeBase/modules';
import { APP_FEATURES, lookupFeature } from '../../services/knowledgeBase/appCatalog';
import { isAppHelpQuery } from '../../services/knowledgeBase/capabilities';
import { WHATS_NEW } from '../../services/knowledgeBase/whatsNew';
import { interpretWristSwing } from '../../services/watchWristInterpretation';
import type { KBHonesty, KBLayer } from '../../services/knowledgeBase/schema';
import { assessDiagnosticEvidence, evidenceGateQuestion } from '../../services/intents/inRoundDiagnosticHandler';
import { GROW_MOSTLY_KEYS } from '../../services/cloudSync/growMostlyKeys';
import { BACKED_UP_STORE_KEYS } from '../../services/cloudSync/snapshot';
import { classifyLayout } from '../../hooks/layoutClassify';

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

// ─── Scenario 0: KB integrity (data-dump safety guard) ─────────────────────────
// 2026-07-25 — before/after ingesting any data-dump into the caddie KB (e.g. the Tank
// Doctrine beta layer), every entry must be structurally sound: globally-unique id, a
// valid honesty tag (so the caddie never presents coaching_only reasoning as measurable),
// a valid layer, and non-empty topic/aliases/principle so retrieval can actually match it.
// This runs FIRST so a malformed ingest fails the gate loudly instead of silently shipping.
console.log('\n=== Scenario 0: KB integrity ===');
{
  const VALID_LAYERS: KBLayer[] = ['app_feature', 'setup', 'contact', 'full_swing', 'short_game', 'putting', 'ball_flight', 'course_mgmt', 'psychology', 'practice', 'equipment'];
  const VALID_HONESTY: KBHonesty[] = ['measurable', 'directional', 'coaching_only'];
  const ids = new Set<string>();
  const dupes: string[] = [];
  const badHonesty: string[] = [];
  const badLayer: string[] = [];
  const emptyField: string[] = [];
  for (const e of GOLF_KNOWLEDGE) {
    if (ids.has(e.id)) dupes.push(e.id); else ids.add(e.id);
    if (e.honesty != null && !VALID_HONESTY.includes(e.honesty)) badHonesty.push(e.id);
    if (!VALID_LAYERS.includes(e.layer)) badLayer.push(e.id);
    if (!e.id || !e.topic || !e.principle || !Array.isArray(e.aliases) || e.aliases.length === 0) emptyField.push(e.id || '(no id)');
  }
  check('KB: all entry ids are globally unique',
    dupes.length === 0, dupes.length === 0 ? `${GOLF_KNOWLEDGE.length} entries, no dupes` : `DUPLICATE ids: ${dupes.join(', ')}`);
  check('KB: every honesty tag is a valid KBHonesty value',
    badHonesty.length === 0, badHonesty.length === 0 ? 'all honesty tags valid' : `INVALID honesty: ${badHonesty.join(', ')}`);
  check('KB: every layer is a valid KBLayer value',
    badLayer.length === 0, badLayer.length === 0 ? 'all layers valid' : `INVALID layer: ${badLayer.join(', ')}`);
  check('KB: no entry has an empty id/topic/principle/aliases',
    emptyField.length === 0, emptyField.length === 0 ? 'all entries populated' : `EMPTY fields on: ${emptyField.join(', ')}`);
  // The mined decision-engine reasoning (evidence-order, course-vs-range, brush-the-grass, smart-miss,
  // test-before-buy, breathe-first) is folded into the CENTRAL KB modules as plain caddie knowledge —
  // not a separate branded layer. Spot-check the anchor entries actually landed + resolve.
  const anchors = ['contact.diagnose-evidence-order', 'cm.course-vs-range', 'cm.smart-miss-shape', 'contact.brush-the-grass', 'mind.think-behind-ball', 'mind.breathe-reset', 'equip.test-before-buy'];
  const present = anchors.filter((id) => GOLF_KNOWLEDGE.some((e) => e.id === id));
  check('KB: decision-engine reasoning folded into central modules',
    present.length === anchors.length, present.length === anchors.length ? `all ${anchors.length} anchor entries present` : `MISSING: ${anchors.filter((a) => !present.includes(a)).join(', ')}`);
}

// ─── Scenario 0b: evidence-order diagnostic gate (Tank doctrine) ───────────────
// A vague "why did that happen" must ask the ONE most-useful question (ball flight / low
// point) OFFLINE before guessing at mechanics; a shot already described with real evidence
// must pass straight through to the brain (null = no gate question).
console.log('\n=== Scenario 0b: evidence-order diagnostic gate ===');
{
  const vague = evidenceGateQuestion(assessDiagnosticEvidence('why did that happen'));
  check('Diagnostic gate: vague "why" asks the ball-flight question',
    typeof vague === 'string' && /which way|start left or right|curve/i.test(vague), vague ?? 'null (should have asked)');

  const chunk = evidenceGateQuestion(assessDiagnosticEvidence("why'd I chunk that"));
  check('Diagnostic gate: a named mishit asks the low-point / grass question',
    typeof chunk === 'string' && /grass|before the ball|lie/i.test(chunk), chunk ?? 'null (should have asked)');

  const rich = evidenceGateQuestion(assessDiagnosticEvidence('driver started right and kept slicing off the tee'));
  check('Diagnostic gate: a shot with flight + lie passes through to the brain',
    rich === null, rich === null ? 'passed through' : `unexpectedly gated: ${rich}`);

  const richStrike = evidenceGateQuestion(assessDiagnosticEvidence('pulled it left and caught it thin'));
  check('Diagnostic gate: flight + strike passes through to the brain',
    richStrike === null, richStrike === null ? 'passed through' : `unexpectedly gated: ${richStrike}`);

  // Brush-the-grass / low-point practice focus (Tank drill) — resolves + interleaves like any focus.
  const brush = getFocus('contact_lowpoint');
  const brushPlan = brush ? buildInterleavedPlan(brush, 8) : [];
  check('Practice: brush-the-grass low-point focus resolves + builds a plan',
    !!brush && brush.emphasis === 'contact' && /brush the grass/i.test(brush.intent) && brushPlan.length > 0,
    brush ? `${brush.label} · plan ${brushPlan.length}` : 'focus missing');
}

// ─── Scenario 0d: backup grow-mostly guard (data-loss protection) ──────────────
// 2026-07-25 (deep audit S2) — the client + server grow-mostly lists had drifted (data loss); they
// now share ONE constant. Assert the formerly-clobbered stores are protected AND that every protected
// key is actually backed up (a guard on an un-backed-up key is dead).
console.log('\n=== Scenario 0d: backup grow-mostly guard ===');
{
  const formerlyLost = ['coach-lesson-history-v1', 'practice-plan-v1', 'trust-level-store-v1', 'points-baseline', 'smartfinder-store-v1', 'acoustic-calibration-v1', 'cage-overlay-calibration-v1'];
  const missing = formerlyLost.filter((k) => !GROW_MOSTLY_KEYS.includes(k));
  check('Backup: grow-mostly guard protects the formerly-clobbered stores',
    missing.length === 0, missing.length === 0 ? `${GROW_MOSTLY_KEYS.length} protected` : `UNPROTECTED: ${missing.join(', ')}`);
  const notBackedUp = GROW_MOSTLY_KEYS.filter((k) => !BACKED_UP_STORE_KEYS.includes(k));
  check('Backup: every grow-mostly key is actually in the backup allowlist',
    notBackedUp.length === 0, notBackedUp.length === 0 ? 'all protected keys are backed up' : `DEAD GUARD on: ${notBackedUp.join(', ')}`);
}

// ─── Scenario 0e: useLayout responsive classifier (one source of truth for sizing) ─────────
// 2026-07-26 (Tim) — every screen used its own W/H breakpoints → drift + per-size bugs. classifyLayout
// is the single classifier; guard the device classes so a refactor can't silently mis-size a class.
console.log('\n=== Scenario 0e: useLayout responsive classifier ===');
{
  const iphone = classifyLayout(390, 844);
  check('Layout: iPhone (390×844) → phone, not tablet, not split',
    iphone.breakpoint === 'phone' && !iphone.isTablet && !iphone.isSplit && iphone.isPhone,
    `${iphone.breakpoint} tablet=${iphone.isTablet} split=${iphone.isSplit}`);
  const foldFolded = classifyLayout(344, 882);
  check('Layout: Fold-Z folded (344×882) → phone + isNarrow (compact gutter)',
    foldFolded.breakpoint === 'phone' && foldFolded.isNarrow && foldFolded.gutter === 12,
    `${foldFolded.breakpoint} narrow=${foldFolded.isNarrow} gutter=${foldFolded.gutter}`);
  const proMax = classifyLayout(430, 932);
  check('Layout: Pro Max (430×932) → largePhone, not narrow',
    proMax.breakpoint === 'largePhone' && !proMax.isNarrow && proMax.isPhone,
    `${proMax.breakpoint} narrow=${proMax.isNarrow}`);
  const ipad = classifyLayout(768, 1024);
  check('Layout: iPad portrait (768×1024) → tablet (shortest-side rule), capped content',
    ipad.isTablet && ipad.breakpoint === 'tablet' && ipad.maxContentWidth === 760 && !ipad.isPhone,
    `tablet=${ipad.isTablet} maxW=${ipad.maxContentWidth}`);
  const ipadLand = classifyLayout(1024, 768);
  check('Layout: iPad landscape (1024×768) → tablet + split + landscape',
    ipadLand.isTablet && ipadLand.isSplit && ipadLand.isLandscape,
    `tablet=${ipadLand.isTablet} split=${ipadLand.isSplit} land=${ipadLand.isLandscape}`);
  check('Layout: contentWidth never exceeds the screen width',
    [classifyLayout(320, 800), classifyLayout(1400, 900)].every((l) => l.contentWidth <= l.width),
    'clamped');
}

// ─── Scenario 0c: undo precheck must not fire on the dismissal "never mind" ─────
// 2026-07-25 (deep audit S1) — "never mind" was matching the undo regex and silently reverting the
// last logged score/putt/shot. It must NOT trigger undo; explicit undo verbs still must.
console.log('\n=== Scenario 0c: undo precheck guard ===');
{
  const nm = precheckLocalIntent('never mind');
  check('Undo precheck ignores the dismissal "never mind"',
    !nm || nm.intent_type !== 'undo', nm ? `got ${nm.intent_type}` : 'no match (ok)');
  const undo = precheckLocalIntent('undo that');
  check('Undo precheck still fires on explicit "undo that"',
    !!undo && undo.intent_type === 'undo', undo ? undo.intent_type : 'no match');
  const scratch = precheckLocalIntent('scratch that');
  check('Undo precheck still fires on "scratch that"',
    !!scratch && scratch.intent_type === 'undo', scratch ? scratch.intent_type : 'no match');
  // 2026-07-25 (deep audit S3) — bare "exit" token no longer yanks the user home.
  const whereExit = precheckLocalIntent("where's the exit");
  check('Nav precheck ignores a bare "exit" mention',
    !whereExit || !(whereExit.intent_type === 'navigate' && whereExit.parameters?.direction === 'home'),
    whereExit ? `${whereExit.intent_type}:${whereExit.parameters?.direction ?? ''}` : 'no match (ok)');
  const closeThis = precheckLocalIntent('close this');
  check('Nav precheck still fires on "close this"',
    !!closeThis && closeThis.intent_type === 'navigate', closeThis ? closeThis.intent_type : 'no match');
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
  // 2026-08-08 — the prompt's tail union is now INTERPOLATED from INTENT_TYPE_ENUM (can't drift), so
  // check membership in the enum source of truth: quoted anywhere in the file (enum entries are
  // 'single-quoted'; prompt sections may also "double-quote" them).
  const inUnion = voiceIntentSrc.includes(`"${intent}"`) || voiceIntentSrc.includes(`'${intent}'`);
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
/**
 * 2026-08-20 (stale-guard sweep) — A MISSING FILE MUST NOT READ AS A PASSING GUARD.
 *
 * This returned '' for any unreadable path. Positive assertions then fail and we notice — but every
 * assertion of ABSENCE (`!/x/.test(src)`, of which this harness has six, all of the "X was removed"
 * kind) passes VACUOUSLY against an empty string. Rename or move a file and those guards go green
 * while proving nothing at all, which is the exact shape of "grep guards can't see dead code": a
 * green suite that has quietly stopped looking.
 *
 * All 266 paths this harness reads currently exist, so nothing changes today. What changes is the
 * future: a rename now fails LOUDLY at the end of the run instead of being absorbed. The read still
 * returns '' so a single missing file cannot mask the rest of the results behind a thrown error —
 * we want the whole picture AND the alarm.
 */
const missingReads: string[] = [];
const readPaths = new Set<string>();
const read = (rel: string) => {
  readPaths.add(rel);
  try {
    return fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');
  } catch {
    if (!missingReads.includes(rel)) missingReads.push(rel);
    return '';
  }
};

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

check('SmartMotion: dragging the ball/target box does not page the card carousel',
  // 2026-08-01 (tester — "when he tries to move the ball box in SmartMotion the screen tries to scroll
  // to another card"). The setup ball/target rig lives in a horizontal PAGER ScrollView; RN's native
  // horizontal recognizer was stealing the drag. Fix: the drag PanResponders claim the gesture in the
  // CAPTURE phase AND signal onDragActiveChange(true) so the pager freezes (scrollEnabled off) mid-drag.
  (() => {
    const card = read('components/swinglab/CageTargetingCard.tsx');
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      /onDragActiveChange\?: \(active: boolean\) => void/.test(card) &&
      /onStartShouldSetPanResponderCapture: \(\) => !lockedRef\.current/.test(card) &&
      /onMoveShouldSetPanResponderCapture: \(_e, g\) => !lockedRef\.current/.test(card) &&
      /cbRef\.current\.onDragActiveChange\?\.\(true\)/.test(card) &&
      /onDragActiveChange=\{setTargetsDragging\}/.test(sm) &&
      /scrollEnabled=\{phase !== 'recording' && !targetsDragging\}/.test(sm)
    );
  })(),
  'the ball/target box moves under the finger instead of paging the carousel — the drag captures the gesture and freezes the pager while it is in flight');

check('SmartMotion runs + surfaces the ball-departure cross-check',
  /detectBallDeparture/.test(smSrc) && /ballDeparture/.test(smSrc) &&
    /Sound only/.test(smSrc) && /Ball strike confirmed/.test(smSrc),
  'verifier called on stop + honest confirmed/sound-only/unseen UI');

check('Ball-departure verdict is honest (departed = before && !after)',
  /departed = before && !after/.test(read('api/ball-departure.ts')),
  'no departure claimed unless a ball was visible then gone');

check('Analysis self-corrects a mislabeled camera angle (geometry beats the toggle)',
  // 2026-07-30 (Tim — "my videos recorded DTL but were face-on; couldn't see the toggle in
  // daylight. Did that affect analysis?"). YES — the biomech metrics branch on angle. The angle
  // toggle is a UI hint the user can get wrong; the pose geometry is ground truth. So even an
  // EXPLICIT down_the_line/face_on label is cross-checked against the CONSERVATIVE inferCameraAngle,
  // and a confident disagreement self-corrects to the frames. glasses_pov is never overridden.
  (() => {
    const pa = read('services/poseAnalysisApi.ts');
    return (
      /else if \(angle === 'down_the_line' \|\| angle === 'face_on'\)/.test(pa) &&
      /const inferred = inferCameraAngle\(frames\);/.test(pa) &&
      /if \(inferred && inferred !== angle\) angle = inferred;/.test(pa)
    );
  })(),
  'a face-on swing filmed with the DTL toggle set is re-read from the pose geometry, so the angle-specific metrics are computed correctly');

check('BODY ANALYSIS tiles + biomechanics narrative read ONE source (icons carry the numbers)',
  // 2026-07-30 (Tim — screenshot: "those icons and data are supposed to be together"). The tiles
  // were reading a shot_map SNAPSHOT that persisted only {key,label,tone,icon} — the measured
  // `value` was stripped, so Sway/Tilt/Posture/Weight showed "—" while the narrative above had the
  // numbers. deriveBodyItems now lives in the shared HUD module and the swing-detail screen derives
  // the row FRESH from session.biomechanics (same source as the narrative), falling back to the
  // snapshot only for older swings without biomechanics.
  (() => {
    const hud = read('components/smartmotion/SmartMotionHud.tsx');
    const detail = read('app/swinglab/swing/[swing_id].tsx');
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      /export function deriveBodyItems/.test(hud) &&
      /export const ICON_BIOMECH/.test(hud) &&
      // detail screen derives fresh from the ACTIVE (per-selected-swing) biomechanics
      /activeBiomech\s*\n?\s*\?\s*deriveBodyItems\(bodyAnalysis, activeBiomech\)/.test(detail) &&
      // capture screen no longer defines its own copy — imports the shared one
      /deriveBodyItems,/.test(sm) &&
      !/function deriveBodyItems\(/.test(sm)
    );
  })(),
  'the swing-detail BODY ANALYSIS row is derived from the live biomechanics (not the value-stripped snapshot), so the icons always carry the same measured numbers as the narrative');

check('Clubhead arc is computed at ANALYSIS time + persisted (not re-extracted on an autoplaying clip)',
  // 2026-07-30 (Tim — "no clubhead arc path" + "the video is auto playing on open"). Root cause: the
  // arc was re-extracted at VIEW time via a native retriever that raced the autoplaying ExoPlayer, so
  // it was gated abort-while-playing → on an autoplaying clip it never computed. Fix = compute it ONCE
  // during the analysis pass (nothing playing) and PERSIST it on the session; the view screen draws the
  // stored points (works even while the clip plays), live-extracting only for legacy swings (club_arc
  // undefined).
  (() => {
    const store = read('store/cageStore.ts');
    const upload = read('services/videoUpload.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    const detail = read('app/swinglab/swing/[swing_id].tsx');
    return (
      /club_arc\?:/.test(store) && /setSessionClubArc:/.test(store) &&
      // both analysis paths (upload runPhaseK + cage/SmartMotion) persist the arc
      /setSessionClubArc\(/.test(upload) && /detectClubPath\(/.test(upload) &&
      /setSessionClubArc\(/.test(sm) &&
      // view screen prefers a REAL persisted arc (this shot's own, or the session's for shot 0) before any
      // live extraction; 2026-08-06 — a stored EMPTY arc no longer locks it blank forever (falls through to
      // the paused-gated live re-extraction), so the guard now asserts the real-arc short-circuit.
      /const storedArc = shotArc !== undefined \? shotArc/.test(detail) && /if \(storedArc && storedArc\.length >= 3\)/.test(detail)
    );
  })(),
  'the clubhead arc is detected during analysis (retriever runs while nothing plays) and stored, so it draws immediately on open regardless of autoplay — no view-time re-extraction race');

check('Swing-detail transport is CROPPED to the located swing window (bar + stages line up)',
  // 2026-07-30 (Tim — "the buttons for the swing points and the video points are not lining up" +
  // "can it crop out the not swing part of the video?"). VIRTUAL crop: the scrub bars, clock, jog and
  // playback loop all rebase to [clipStartSeconds, clipEndSeconds] so the swing fills the bar and the
  // stage chips (absolute frame times) align. No native trim — logic-only; legacy no-window clips fall
  // back to the full clip.
  (() => {
    const d = read('app/swinglab/swing/[swing_id].tsx');
    return (
      /const winStartSec =/.test(d) && /const winEndSec =/.test(d) && /const winSpanSec =/.test(d) &&
      /const winFrac = /.test(d) && /const winSeek = /.test(d) &&
      // both bars use the windowed fraction/seek
      /winFrac\(position\)/.test(d) && /scrubTo\(winSeek\(frac\)\)/.test(d) &&
      // clock shows window-relative time
      /fmtClock\(Math\.max\(0, position - winStartSec\)\)/.test(d) &&
      // playback tail-crop loops back to the swing start (guarded, no setState storm)
      /tailLoopRef/.test(d) && /posSec >= winEndRef\.current/.test(d)
    );
  })(),
  'the swing-detail player presents ONLY the located swing — walk-up/waggle/post-swing dead air are cropped from the timeline and from playback, and the jump-to-stage chips line up with the bar');

// 2026-08-07 (Tim — the FATAL "Maximum update depth exceeded" at onPlaybackStatusUpdate that keeps coming
// back). ROOT CAUSE: unstable props on the native <Video>. At 25×/s (overlay on) each re-render handed the
// Video a NEW prop identity → expo-av re-subscribed + re-emitted status synchronously → setState cascade →
// crash. LOCK every Video prop as referentially stable so a re-render can never re-subscribe. Also: the
// Motion overlay is OFF by default and a normal library open does NOT auto-play (only the ?watch=1 path).
check('Swing-library video: every <Video> prop is STABLE (no re-subscribe loop) + overlay-off + no autoplay',
  (() => {
    const d = read('app/swinglab/swing/[swing_id].tsx');
    return (
      /const videoSource = useMemo\(/.test(d) &&                          // source memoized
      /const onPlaybackStatusUpdate = useCallback\(/.test(d) &&           // callback identity stable
      /const videoStyle = useMemo\(/.test(d) &&                           // style memoized (was inline array)
      /const onVideoLoad = useCallback\(/.test(d) &&                      // onLoad stable
      /const onVideoError = useCallback\(/.test(d) &&                     // onError stable
      /source=\{videoSource\}/.test(d) && /style=\{videoStyle\}/.test(d) &&
      /onPlaybackStatusUpdate=\{onPlaybackStatusUpdate\}/.test(d) &&
      /onLoad=\{onVideoLoad\}/.test(d) && /onError=\{onVideoError\}/.test(d) &&
      // Motion overlay OFF by default; only the deferred-analysis path auto-plays.
      /const \[showSkeleton, setShowSkeleton\] = useState\(false\)/.test(d) &&
      /shouldPlay=\{shouldAutoplayThenAnalyze\}/.test(d)
    );
  })(),
  'the swing-library <Video> has fully referentially-stable props (memoized source/style + useCallback status/load/error) so a 25x/s re-render can never re-subscribe expo-av into the fatal update-depth loop; Motion overlay defaults OFF and a normal open does not auto-play');

// 2026-08-08 (Tim — "if it tries to do too much — mechanics, shot trace AND playback together — it
// crashes. Addressed 50 times"). The memoized-props fix stopped the re-subscribe loop, but the crash
// still fired with the HEAVY overlay on: at 25×/s each setPosition re-renders the whole screen + SVG
// skeleton/trace; a render slower than the 40ms tick lets updates pile into "Maximum update depth".
// LOCK a WALL-CLOCK throttle on the position setState — while the overlay is mounted, commit at most
// ~every 90ms — which caps the setState rate to what React sustains AND drops any sub-frame re-emit.
check('Swing-library position setState is wall-clock throttled when the heavy overlay is on (no update-depth pile-up)',
  (() => {
    const d = read('app/swinglab/swing/[swing_id].tsx');
    return (
      /overlayActiveRef/.test(d) &&
      /overlayActiveRef\.current = hasPose && \(showSkeleton \|\| showTrace \|\| motionOnly\)/.test(d) &&
      /const minGapMs = overlayActiveRef\.current \? 90 : 40/.test(d) &&
      /nowMs - playbackEmitRef\.current\.lastPosAt >= minGapMs/.test(d)
    );
  })(),
  'mechanics + trace + playback together can no longer pile 25x/s setStates into a fatal update-depth crash (position commits throttled to ~11x/s when the overlay is mounted)');

// 2026-08-08 (Tim — "exportable PDF report is pretty bad"): (1) CLUB showed a raw "H"; (2) the swing frame
// was a tiny portrait crammed in a WIDE box with black side-bars; (3) WHAT I SEE ≈ WHY IT HAPPENS. LOCK
// all three fixes: club label resolved, frame sized to its own aspect (no forced letterbox), duplicate
// cause section dropped.
// 2026-08-08 (Tim — "white background… a logical professional coaching swing report. This is the
// Caddie's job"). LOCK the professional white report: structured lesson write-up (session facts →
// numbers → key frame → primary focus w/ severity → What's Working → see/why → fix → PRACTICE PLAN
// with named drills + steps from the catalog → coach's note), readable club label, de-duplicated cause.
check('Swing report PDF: WHITE professional coaching report with practice plan + real data sections',
  (() => {
    const rep = read('services/coachReport.ts');
    const caller = read('app/swinglab/swing/[swing_id].tsx');
    return (
      /html, body \{ background: #ffffff; \}/.test(rep) &&                        // white, professional
      /SWING ANALYSIS REPORT/.test(rep) &&
      /What's Working/.test(rep) && /Practice Plan/.test(rep) &&                  // real coaching sections
      /class="sev"/.test(rep) &&                                                  // severity badge
      /width: auto; max-width: 100%; max-height: 4\.2in/.test(rep) &&             // frame sizes to its aspect
      /shared \/ cau\.size >= 0\.7/.test(rep) &&                                  // dupe cause dropped
      /FAMILY\[rawClub\.toUpperCase\(\)\]/.test(caller) &&                        // "H" → "Hybrid"
      // 2026-08-08 (verification wave) — issue_id-then-primary_fault: the old `issueId ??` fallback was
      // dead (issue_id is required), so 'tentative_read' sessions lost the named-drill plan.
      /getDrillEntry\(String\(pi\.issue_id\)\) \?\? getDrillEntry\(String\(pi\.primary_fault/.test(caller) && // catalog drills w/ real fallback
      /strengths: pi\.strengths \?\? null/.test(caller)
    );
  })(),
  'the export is a white professional lesson write-up: severity, strengths, evidence, and a named practice plan with steps — the caddie doing its job');

// 2026-08-08 (Tim — "shot trace has yet to work right"). The stale crash-era `if (isPlaying) return`
// blocked clubhead extraction whenever the clip was playing → no trace on swings without a stored arc.
// Safe to remove ONLY because detectClubPath extracts from a PRIVATE COPY and hard-refuses to run
// without it (no retriever/ExoPlayer same-file collision). LOCK both halves together: the guard stays
// gone AND the copy-refusal stays in — reintroducing either breaks this check.
check('Club trace extracts during playback (no stale isPlaying gate) + private-copy refusal intact',
  (() => {
    const d = read('app/swinglab/swing/[swing_id].tsx');
    const cp = read('services/swing/clubPath.ts');
    // the extraction effect must not early-return on isPlaying anymore
    const effect = d.slice(d.indexOf('const shotArc = shot?.club_arc'), d.indexOf('clubArcRunKeyRef.current === runKey'));
    return (
      effect.length > 0 && !/if \(isPlaying\) return;/.test(effect) &&
      // 2026-08-19 — was pinning the literal `if (!tempCopy) return null;`. The INVARIANT is that a
      // failed private copy REFUSES rather than falling back to decoding the file ExoPlayer is
      // playing (the SIGSEGV vector) — not the exact shape of the early return. The refusal now logs
      // first (a silently-missing clubhead arc is how it went unnoticed for a week), so assert the
      // refusal AND that it is observable, and assert the thing that must never come back: a fallback
      // to the original URI.
      // The refusal itself, and that it is now observable. (An earlier draft of this guard also
      // asserted `!workUri = videoUri` as a "no fallback" check — wrong: that line is the variable's
      // ordinary initialiser, declared long before the refusal. Assert what the refusal DOES, not
      // incidental text near it.)
      /if \(!tempCopy\) \{[\s\S]{0,240}?return null;\s*\}/.test(cp) &&
      /logCapabilityLost\('clubpath_no_private_copy'/.test(cp)
    );
  })(),
  'the swing trace can extract while the clip plays (private-copy makes it collision-safe), a failed copy REFUSES rather than decoding the playing original, and that refusal is logged instead of losing the arc silently');

// 2026-08-08 (Tim photographed the OFFICIAL Berlin CC scorecard). LOCK the card-sourced data: official
// men's yardages + rating/slope in the bundle, and the local rules (OB stone walls, the No.9 brook
// lift-clean-place) seeded into the CNS course book — which is the path the caddie's hole brief READS
// (caddieMemoryRetrieval getStaticHole) — anchored at boot.
check('Berlin CC carries the OFFICIAL card: yardages + rating/slope + local rules in the course book',
  (() => {
    const c = read('data/courses.ts');
    const seeds = read('data/courseBookSeeds.ts');
    const layout = read('app/_layout.tsx');
    return (
      /hole:  1, par: 4, distance: 312/.test(c) && /hole:  9, par: 3, distance: 133/.test(c) &&
      /rating: '62\.4', slope: '98', par: 33, totalYards: 2233/.test(c) &&
      /course_id: 'local:berlin-cc'/.test(seeds) &&
      /lift-clean-and-place/.test(seeds) && /OB stone wall/.test(seeds) &&
      /saveCourseBook\(/.test(seeds) &&
      /seedBundledCourseBooks\(\)/.test(layout) // anchored at boot
    );
  })(),
  'Berlin briefs cite the real card: official yardages, 62.4/98, per-hole OB walls + the brook rule, offline from hole 1');

// 2026-08-08 (Tim — "you have to allow a 9-hole course to be played twice"). LOCK all four twice-around
// seams: 18-format at a 9-hole course expands holes to 18 (10-18 replay 1-9); geometry wraps for the
// second loop; the hole count treats live-18-over-bundled-9 as 18 (advance doesn't stop at 9); the
// course book's notes wrap so OB/local rules carry to the second nine.
check('9-hole course plays TWICE with the 18 format (holes, geometry, count, book all wrap)',
  (() => {
    const c = read('app/(tabs)/caddie.tsx');
    const g = read('services/courseGeometryService.ts');
    const d = read('data/courses.ts');
    const m = read('store/caddieMemoryStore.ts');
    return (
      /holes\.length === 9 && !opts\.nineHole/.test(c) && /hole: h\.hole \+ 9/.test(c) &&    // expansion
      /holeNumber >= 10 && holeNumber <= 18 && c && c\.holes\.length === 9/.test(g) &&        // geometry wrap
      /bundled\.length === 9 && liveLength === 18\) return 18/.test(d) &&                     // count seam
      /keys\.every\(k => k <= 9\)\) return book\.holes\[hole - 9\]/.test(m)                   // book wrap
    );
  })(),
  'picking 18 at a 9-hole course = twice around: full 18 scorecard/WHS, GPS + briefs + card notes on the second loop');

// 2026-08-08 (Tim — "my last few 9-hole rounds dropped the index ~2 points, which is incorrect"). ROOT:
// differentials used a hardcoded neutral par-36 nine regardless of the course — par-33 Berlin scores read
// ~3 strokes better than reality every round and cratered the Index. LOCK the real-baseline math: the
// rebuild derives parTotal from the round's holePars + real bundled rating/slope (halved for a 9-hole
// posting), with the neutral 36/72 only as the final fallback.
check('Handicap differentials use the REAL course par/rating (no par-36 assumption cratering the index)',
  (() => {
    const h = read('services/handicapCalculator.ts');
    const rs = read('store/roundStore.ts');
    return (
      /export function postingBaseline/.test(h) &&
      /posted === 9 \? Math\.round\(\(rr \/ 2\) \* 10\) \/ 10 : rr/.test(h) &&       // 18-hole card rating halves for a 9 posting
      /r\.baseRating \?\? NINE_HOLE_CR/.test(h) && /r\.baseRating \?\? 72\.0/.test(h) && // real baseline wins, neutral only as fallback
      /postingBaseline\(r\)/.test(h) &&                                                // derived inside for RoundRecord callers
      /\.\.\.calcMod\.postingBaseline\(r\)/.test(rs)                                    // round-end + delete paths pass it
    );
  })(),
  'a 9-hole round at par-33 Berlin differentials against ~31.2/98 (real card), not the neutral 36/113 that dragged the index down ~2 points');

// 2026-08-08 (Tim — "in onboarding and in general I should be able to TELL the caddie what's in my bag
// and my yardages and it gets registered correctly"). LOCK the full bag-by-voice chain: ONE registrar
// seam; the brain tool (rich sentences + interview) and the offline precheck ("my 7-iron goes 165")
// both write through it; the get-to-know hard-mute EXEMPTS register_bag; the client suppression
// allowlist does NOT include it (data tool, not navigation).
check('Bag-by-voice: registrar seam + brain tool + offline set + interview exemption all wired',
  (() => {
    const reg = read('services/bagVoiceRegistration.ts');
    const turn = read('api/pipecat-turn.ts');
    const tools = read('api/_brainTools.ts');
    const disp = read('services/voice/conversationalToolDispatch.ts');
    const pre = read('services/localIntentPrecheck.ts');
    const idx = read('services/intents/index.ts');
    return (
      /export function registerBagFromSpeech/.test(reg) &&
      /registerClub\(parsed\.club_id, \{ source: 'voice' \}\)/.test(reg) &&        // bag membership
      /stats\.setManual\(name, yds\)/.test(reg) &&                                  // honest stated carry
      /yds < 30 \|\| yds > 400/.test(reg) &&                                        // plausibility clamp
      // 2026-08-19 (lockstep reconciliation) — tool declarations moved OUT of api/pipecat-turn.ts into
      // api/_brainTools.ts, the single owner both brains import. This guard used to grep the brain file
      // and would have gone RED on the fix while the behaviour it protects got STRICTLY better — the
      // same "guard pins the old location" trap that hid the practice-swing gate siblings. Assert the
      // CONTRACT (declared once, routed to the client) rather than which file the literal sits in.
      /name: 'register_bag'/.test(tools) &&                                          // brain tool declared (one owner)
      // 2026-08-08 (verification wave) — REACHABILITY, not just presence: the tool was declared and the
      // client case existed while the server dispatch fell through to bare 'Done.' (no toolActions.push)
      // → the caddie verbally confirmed a bag it never recorded and THIS guard stayed green. Require
      // register_bag in the UI_TOOLS dispatch set so the action actually reaches the client.
      /UI_TOOLS = new Set\(\[[\s\S]*?'register_bag'[\s\S]*?\]\)/.test(tools) &&   // server DISPATCHES it
      /register_bag stays ON/.test(turn) &&                                         // interview exemption
      /case 'register_bag':/.test(disp) &&                                          // client dispatch
      !/NAV_OPEN_ACTIONS = new Set\(\[[^\]]*register_bag/.test(disp) &&             // not suppressed in interview
      /'set_club_distance', \{ club_phrase/.test(pre) &&                            // offline declarative form
      /registerHandler\(setClubDistanceHandler\)/.test(idx)
    );
  })(),
  '"I carry driver, 3-wood…" and "my 7-iron goes 165" register the real bag + carries the brain then quotes — onboarding interview included');

// 2026-08-07 (Tim — "the upload picker isn't working to set the golfer; swing entries need to be editable
// after the fact — who it is, the orientation"). Two fixes: (1) upload resolves the picked swinger →
// player_id so the swing FILES under that golfer (library groups by player_id, not the swinger text);
// (2) the swing-detail screen has an ORIENTATION editor (was golfer-only) that patches the camera angle
// and re-analyzes with the correct metric set.
check('Upload files the swing under the PICKED golfer (swinger→player_id), not always the account holder',
  (() => {
    const cs = read('store/cageStore.ts');
    const vu = read('services/videoUpload.ts');
    return (
      /export function resolveSwingerToPlayerId/.test(cs) &&
      /resolveSwingerToPlayerId\(upload\.swinger\)/.test(vu) &&
      /setSessionPlayer\(sessionId, resolvedPlayerId\)/.test(vu)
    );
  })(),
  'a swing uploaded as "Matt" files under Matt (swinger resolved to player_id + stamped), not the account holder');

check('Swing entries are editable after the fact: golfer AND orientation (angle → re-analyze)',
  (() => {
    const d = read('app/swinglab/swing/[swing_id].tsx');
    return (
      // golfer editor (pre-existing) still present
      /setGolferSheetOpen\(true\)/.test(d) && /setSessionPlayer\(/.test(d) &&
      // NEW orientation editor: chip → sheet → assignAngle → patch angleOverride → re-analyze
      /const \[angleSheetOpen, setAngleSheetOpen\] = useState\(false\)/.test(d) &&
      /const assignAngle = useCallback\(/.test(d) &&
      /patchSessionUpload\(swing_id, \{ angleOverride: angle \}\)/.test(d) &&
      /assignAngle\('down_the_line'\)/.test(d) && /assignAngle\('face_on'\)/.test(d)
    );
  })(),
  'swing detail lets you re-tag the golfer AND fix the camera orientation (which re-analyzes with the right metrics)');

// 2026-08-07 (Tim — raw "NO_ELIGIBLE_DEVICE / DAT_SESSION_FAILED" glasses toast). North star: no robotic
// error codes. The connect-failure now shows a HUMAN, actionable line via describeGlassesError, while the
// raw code still lands in the issue log for diagnosis.
check('Glasses connect errors show a human message (not a raw DAT_ code), raw code still logged',
  (() => {
    const b = read('services/metaWearablesBridge.ts');
    const s = read('app/settings.tsx');
    return (
      /export function describeGlassesError/.test(b) &&
      /NO_ELIGIBLE_DEVICE|ELIGIBLE/.test(b) && /DAT_SESSION_FAILED|SESSION/.test(b) &&
      /show\(describeGlassesError\(code, msg\)\)/.test(s) &&        // human toast
      /addAppEvent\('glasses_connect_failed', \{ code, message: msg \}/.test(s) // raw code still logged
    );
  })(),
  'a glasses connect failure reads like a person (actionable guidance), raw DAT code kept in the issue log');

// 2026-08-07 (Tim — Berlin CC had bundled geometry but the round loaded no yardage/wind/tee-brief).
// ROOT: bundled holes (real coords) were only used when courseId === 'local:<slug>'. Any other entry
// (search / GPS-nearby / download) to the same course got scorecard-only holes with no coords. LOCK the
// name-based override so a bundled course's real geometry is used no matter how the round was started.
check('Round start uses bundled hole GEOMETRY by name, not just for local: ids',
  (() => {
    const c = read('app/(tabs)/caddie.tsx');
    return (
      /const bundledMatch = getCourse\(courseName\)/.test(c) &&
      /bundledHasCoords/.test(c) && /loadedHasCoords/.test(c) &&
      /holes = bundledMatch\.holes/.test(c) &&
      /courseId = `local:\$\{bundledMatch\.id\}`/.test(c)
    );
  })(),
  'a bundled course (e.g. Berlin) loads its real tee/green coords for yardage+wind no matter the entry path');

// 2026-08-10 (Tim — "the course builder engine like Arccos HAS to work… combine our Gemini abilities
// with golfcourse api to help"). LOCK the course-builder resilience chain so an unbundled course a
// tester browses/plays off-site still gets live greens:
//   • Finding #1 — the live GPS fix is used as a last-resort centroid (client), not thrown away.
//   • Gemini combo — server derives a centroid from the golfcourseapi record, else Gemini-locates it
//     from the course name (+city/state), so OSM green-fill can fire with NO client centroid.
//   • Finding #2 — the 9-hole bundled courses register their TRUE physical count (no 9→18 ghost pad).
check('Course builder: live GPS centroid fallback + golfcourseapi→Gemini locate + 9-hole counts',
  (() => {
    const svc = read('services/courseGeometryService.ts');
    const geo = read('api/course-geometry.ts');
    const ws = read('api/_webSearch.ts');
    const clientGpsFallback =
      /getLastFix\(\)/.test(svc) && /centroid = \{ lat: fix\.lat, lng: fix\.lng \}/.test(svc);
    const holeCounts =
      /'berlin-cc':\s*9/.test(svc) && /'webster-dudley':\s*9/.test(svc) && /'echo-hills':\s*9/.test(svc);
    const geminiHelper =
      /export async function groundedCourseCoords/.test(ws) && /tools: \[\{ googleSearch: \{\} \}\]/.test(ws);
    const serverLocate =
      /coordsFromCourseRecord\(course\)/.test(geo) &&
      /groundedCourseCoords\(nameHint, \{ context: locHint \}\)/.test(geo) &&
      /if \(loc\) \{ centroid = loc;/.test(geo);
    return clientGpsFallback && holeCounts && geminiHelper && serverLocate;
  })(),
  'an unbundled course resolves a centroid from live GPS, its API record, or a Gemini web-locate — so live greens/yardages build off-site, and 9-hole courses never pad to 18');

// 2026-08-07 (Tim — "NO more auto tool-opening. I ask for 'play' and it opens Tight Lie. Unless I say
// OPEN/SHOW ME the tool by name, leave it conversational"). LOCK the gate: a navigation open without an
// explicit open-verb routes to the brain (conversational) instead of yanking the user into a screen.
check('Tool opens require an explicit open-verb; otherwise stay conversational',
  (() => {
    const h = read('services/intents/openToolHandler.ts');
    return (
      /EXPLICIT_OPEN\s*=\s*\/\\b\(open\|show me/.test(h) &&
      /EXEMPT_ACTION_TOOLS/.test(h) &&
      /route_to_brain: true/.test(h) &&
      /!EXEMPT_ACTION_TOOLS\.has\(toolName\) && !EXPLICIT_OPEN\.test\(raw\)/.test(h)
    );
  })(),
  'bare tool names / misclassified opens stay conversational; only an explicit "open/show me <tool>" navigates');

// 2026-08-07 (Tim — "Tee box is the ONLY spot for an auto brief… missing yardage/wind because we couldn't
// build the holes"). LOCK the tee-box auto-brief: fires once per hole when GPS confirms arrival at the
// current hole's tee, independent of interactiveRound, gated on real tee coords.
check('Tee-box auto-brief fires once at the tee (GPS-confirmed), yardage/wind from live context',
  (() => {
    const c = read('app/(tabs)/caddie.tsx');
    return (
      /teeBriefedHoleRef/.test(c) &&
      /haversineYards\(\{ lat: fix\.lat, lng: fix\.lng \}, \{ lat: tee\.teeLat, lng: tee\.teeLng \}\)/.test(c) &&
      /distYds > 40/.test(c) && // must be AT the tee
      /kind: 'shot_strategy'/.test(c)
    );
  })(),
  'the one allowed auto-brief per hole fires at the tee box (≤40y, once per hole), not mid-walk');

// 2026-08-07 (Tim — "'I'm gonna hit a 5 wood off this tee' → 'got it, 5 wood' with NO correlation. Not
// AI, not a caddie"). LOCK: an in-round club declaration SETS the club then routes to the brain so the
// caddie acknowledges WITH context (yardage this leaves, wind, fit) — no canned "got it".
check('In-round club declaration routes to the brain for a CONTEXTUAL reply (not a canned confirm)',
  (() => {
    const h = read('services/intents/clubHandler.ts');
    // the round branch: setClub then route_to_brain (no canned "Got it, <club>")
    return /round\.setClub\(parsed\.club_id\)/.test(h) &&
      /round:club_switched:\$\{parsed\.club_id\}`\],\s*follow_up_needed: false,\s*route_to_brain: true/.test(h);
  })(),
  'declaring a club on the tee correlates hole/yardage/wind via the brain instead of "got it, 5-wood"');

// 2026-08-07 (Tim — "if I switch tabs it stops talking. I want TOTAL PRESENCE — look at the dashboard and
// let it finish"). LOCK: the route-change stopSpeaking must NOT fire on a pure tab↔tab switch, so the
// caddie finishes its response while the player browses other tabs.
check('Caddie keeps talking across tab switches (total presence); only deep-tool moves stop stale speech',
  (() => {
    const l = read('app/_layout.tsx');
    return (
      /const isMainTab = /.test(l) &&
      /caddie\|dashboard\|play\|scorecard\|swinglab/.test(l) &&
      /if \(isMainTab\(prev\) && isMainTab\(pathname\)\) return;/.test(l)
    );
  })(),
  'switching between the main tabs does NOT cut the caddie mid-sentence; deep-tool navigations still stop leaks');

// 2026-08-07 (Tim — "if I ask remaining yardage, confirm my drive: 'you just hit 275, you've got 135
// remaining, here's the play'"). LOCK: the caddie context carries a LIVE tee→player distance (the drive
// estimate) and the on-course prompt tells the caddie to confirm that shot, then give the remaining, then
// the play. 2026-08-23 — RE-AIMED off services/pipecatContext + api/pipecat-turn (the second payload
// builder and the second brain, both retired) onto the ONE builder and the ONE brain. The order
// instruction was pipecat-only, so this guard was green while the live path had the number and not
// the shape of the answer; it is now carried on kevin. [[grep-guards-cant-see-dead-code]]
check('Caddie confirms the just-hit drive + remaining + play (live tee-to-player distance in context)',
  (() => {
    const ctx = read('services/caddieRequestBody.ts');
    const brain = read('api/kevin.ts');
    return (
      /distanceFromTeeYds:/.test(ctx) &&
      /haversineYards\(\{ lat: fix\.lat, lng: fix\.lng \}, \{ lat: tee\.teeLat, lng: tee\.teeLng \}\)/.test(ctx) &&
      /distanceFromTeeYds === 'number'/.test(brain) &&
      /CONFIRM that shot naturally first/.test(brain)
    );
  })(),
  'the caddie has the drive distance and confirms it → remaining → play, one flowing sentence');

// 2026-08-07 (Tim — "how can we use the watch to turn on swing detection in a LIVE round?"). LOCK: a
// watch-detected swing during an active round triggers the live shot detector (from the phone's current
// position), gated on a real swing + a 20s debounce. Watch's own GPS is NOT in the event yet (native).
// 2026-08-08 (audit + Tim picker — "bypass in cart"): the first wiring rode the AUTO path, which
// suppresses in cart mode (recorded nothing from the cart). LOCK the TRUE manual seam.
check('Watch swing fires the MANUAL shot flow (cart-suppression bypassed), debounced + round-gated',
  (() => {
    const b = read('services/watchSwingBridge.ts');
    return (
      /conversationalLoggingOrchestrator\.triggerManual\(\)/.test(b) &&
      !/require\('\.\/shotDetectionService'\)/.test(b) && // the suppressed auto path must stay un-imported
      /isRoundActive/.test(b) &&
      /LIVE_SHOT_TRIGGER_COOLDOWN_MS/.test(b) &&
      /const realSwing =/.test(b)
    );
  })(),
  'a watch swing in a live round records the shot even from the cart (manual seam, not the suppressed auto path)');

// 2026-08-07 (Tim — "add a record button on the watch to control SmartMotion record + stop"). LOCK the
// PHONE side: a watch control command opens SmartMotion + start/stops the camera via the shared record
// bus. The watch UI button that SENDS the command lives in the native Wear app.
check('Watch command controls SmartMotion record/stop on the phone (bus wired end-to-end)',
  (() => {
    const wb = read('services/watchBridge.ts');
    const cb = read('services/watchCaddieBridge.ts');
    const hf = read('services/handsFreeOrchestrator.ts');
    return (
      /export function notifyWatchCommand/.test(wb) && /export function subscribeWatchCommand/.test(wb) &&
      /addListener\('onWatchCommand'/.test(cb) && /notifyWatchCommand\(c\)/.test(cb) &&
      /subscribeWatchCommand\(handleWatchCommand\)/.test(hf) &&
      /emitSmartMotionCommand\('start'\)/.test(hf) && /emitSmartMotionCommand\('stop'\)/.test(hf)
    );
  })(),
  'watch → SmartMotion record/stop/open is wired on the phone (native Wear app supplies the button)');

check('TTS never sends `speed` to gpt-4o-mini-tts (the 500 "Voice generation failed" root cause)',
  // 2026-07-30 (Tim — voice_silent_fail 500, "this has happened since we adjusted speed"). ROOT CAUSE:
  // gpt-4o-mini-tts does NOT accept the `speed` param (only tts-1 / tts-1-hd), so OpenAI 500'd every
  // REAL speech.create that passed it (the warmup calls, which never sent speed, kept succeeding —
  // exactly the boot logs). speed is removed everywhere; pace lives in the instructions.
  (() => {
    const voice = read('api/voice.ts');
    const kevin = read('api/kevin.ts');
    const kv = read('api/_kevinVoice.ts');
    return (
      !/KEVIN_TTS_SPEED/.test(kv) &&        // the export is gone
      !/speed:\s*KEVIN_TTS_SPEED/.test(voice) && !/speed:\s*KEVIN_TTS_SPEED/.test(kevin) &&
      // and the failure is no longer a black box — the real reason is surfaced
      /detail: msg\.slice/.test(voice) && /upstream_status/.test(voice)
    );
  })(),
  'no unsupported `speed` param reaches gpt-4o-mini-tts (so cloud voice generates instead of 500ing), and a genuine failure now reports the real upstream reason instead of a generic string');

check('Custom caddie inherits a chosen base persona voice (Kevin/Serena/Harry/Tank)',
  // 2026-07-30 (Tim — "tie my persona and tendencies to Tank or Kevin or Serena"). The custom caddie
  // keeps its name + face but inherits a real persona's speaking voice (+ gender), so it always has an
  // on-character voice instead of a generic default. A photo-matched customCaddieVoice still overrides.
  (() => {
    const store = read('store/playerProfileStore.ts');
    const vs = read('services/voiceService.ts');
    const ui = read('app/profile/custom-caddie.tsx');
    return (
      /customCaddieBasePersona:/.test(store) && /setCustomCaddieBasePersona:/.test(store) &&
      /customCaddieBasePersona: 'kevin'/.test(store) &&
      // voice path inherits the base persona's mapped voice unless a custom voice is set
      /const base = .*customCaddieBasePersona/.test(vs) && /BASE_VOICE\[base\]/.test(vs) &&
      // the setup screen exposes the picker
      /setCustomCaddieBasePersona\(p\.id\)/.test(ui)
    );
  })(),
  'the custom caddie ties to a real persona under the hood — inherits that persona\'s voice + gender (photo-matched voice still wins), selectable in the My Caddie setup, so it is never a voiceless name-only shell');

check('Custom caddie inherits the base persona\'s BRAIN character (not hardcoded Kevin)',
  // 2026-07-30 (Tim). lib/persona hardcodes custom → Kevin's character spec. The chosen base persona
  // flows through the payload builder to the brain, which builds the character spec from it (keeping
  // the custom NAME). So a custom caddie tied to Tank actually TALKS like Tank.
  // 2026-08-23 — RE-AIMED onto the one builder + api/kevin. Verified against source rather than
  // assumed: kevin resolves `personaInput = rawPersona === 'custom' ? customBase : rawPersona` and
  // feeds THAT to getCharacterSpec, while caddieName keeps the custom name. Property intact.
  (() => {
    const ctx = read('services/caddieRequestBody.ts');
    const brain = read('api/kevin.ts');
    return (
      /customCaddieBasePersona: safe\(\) => p\.customCaddieBasePersona/.test(ctx.replace(/\(\(\) =>/g, '() =>')) &&
      /const personaInput = rawPersona === 'custom' \? customBase : rawPersona/.test(brain) &&
      /getCharacterSpec\(personaInput\)/.test(brain)
    );
  })(),
  'the custom caddie\'s brain personality is the CHOSEN base persona (Tank/Serena/Harry/Kevin), not always Kevin — name stays custom, character is inherited');

check('Mental-game tone reading is ALWAYS-ON, from ONE owner both brains import',
  // 2026-07-30 (Tim — "make sure the caddie when listening processes the tone and emotions of the golfer…
  // original intent, track user state and help the mental game"). The MENTAL GAME block reads emotional
  // subtext + logs state, always-on, including off-round conversation.
  //
  // 2026-08-13 (one-brain pass) — this check used to read pipecat-turn.ts for the literal text, and it
  // passed the whole time the block was DUPLICATED into kevin.ts: the earlier "move" copied it and
  // deleted nothing, so the two were free to drift and the guard couldn't see it. Measured before the
  // fix, they were byte-identical at 1,248 chars — pure duplication waiting to diverge.
  //
  // Now the block has one owner (api/_brain.ts) and both transports import it, so the guard asserts the
  // SHAPE — the text exists once, and neither brain restates it — rather than the presence of a string
  // in one file.
  (() => {
    const core = read('api/_brain.ts');
    const kevin = read('api/kevin.ts');
    const pipecat = read('api/pipecat-turn.ts');
    const owned = /export function mentalGameBlock\(\)/.test(core) &&
      /ALWAYS-ON, on the course AND off it/.test(core) &&
      /read the TONE and emotional state underneath the words/.test(core);
    const bothImport = /from '\.\/_brain'/.test(kevin) && /from '\.\/_brain'/.test(pipecat) &&
      /\$\{mentalGameBlock\(\)\}/.test(kevin) && /\$\{mentalGameBlock\(\)\}/.test(pipecat);
    // and neither may restate it inline again — restating is how the duplicate got there the first time
    const noInlineCopy = !/ALWAYS-ON, on the course AND off it/.test(kevin) &&
      !/ALWAYS-ON, on the course AND off it/.test(pipecat);
    return owned && bothImport && noInlineCopy;
  })(),
  'the caddie reads the golfer\'s tone/emotional state on EVERY turn — from one shared block both brains import, with no inline copy in either');

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
    // 2026-08-12 — and dropped `showSkeleton`: the pose-skeleton toggle must not decide whether
    // shot trace gets computed (it was silently switching trace + the shot map off by default).
    /\[clipUri, ballArea, segments, selectedSwing\]/.test(smSrc) &&
    // 2026-06-15 (Tim) — video-located segments (peakDb EXACTLY 0, ~±1s) no longer go
    // DARK; they ATTEMPT departure and accept ONLY a high-confidence, clearly-departed
    // read (degrade+flag), so a clearly-departed daytime ball still traces while a
    // loose anchor never draws a wrong direction. Acoustic anchors keep frame-accuracy.
    /const videoLocated = \(seg\?\.peakDb \?\? 0\) === 0;/.test(smSrc) &&
    // 2026-07-04 (drift reconcile) — acceptance deliberately LOOSENED from
    // confidence==='high' to !== 'low' (high-only threw away good medium reads).
    /videoLocated[\s\S]{0,200}r\.departed && r\.confidence !== 'low' && r\.ball_present_before/.test(smSrc),
  'default reference box + verifier runs under Motion (fast default), per-swing; video-located swings degrade to a not-low-confidence trace instead of going dark');

// ─── White-screen guard: geometry-driven top-down maps must reject a NON-FINITE hole
//     axis before it reaches react-native-svg. `axisYards <= 0` does NOT catch NaN
//     (NaN <= 0 === false), so a malformed tee/green coordinate used to flow into
//     <Circle cy={NaN}>/<Line> and crash the native SVG parser (white-screen the recap,
//     the live-round home surface, and the SmartFinder target tool). The guard must be
//     the NaN-rejecting `!(axisYards > 0)` form, and smartvision's clampMarker must
//     sanitize non-finite coords (Math.max/min pass NaN through). ────────────────────
check('White-screen guard: SVG hole maps reject a non-finite axis (NaN-safe), clampMarker sanitizes',
  /if \(!\(axisYards > 0\)\) return \[\];/.test(read('components/recap/HoleShotMap.tsx')) &&
    /if \(!\(axisYards > 0\)\) \{/.test(read('components/caddie/L1HolePreview.tsx')) &&
    /if \(!\(axisYards > 0\)\) return <View/.test(read('app/smartfinder.tsx')) &&
    // the fragile `<= 0` NaN-passthrough must be gone from all three
    !/if \(axisYards <= 0\)/.test(read('components/recap/HoleShotMap.tsx')) &&
    !/if \(axisYards <= 0\)/.test(read('components/caddie/L1HolePreview.tsx')) &&
    // smartvision clampMarker coerces a non-finite input to a finite fallback before clamping
    /const px = Number\.isFinite\(p\.x\) \? p\.x : imageW \/ 2;/.test(read('app/smartvision.tsx')) &&
    /const py = Number\.isFinite\(p\.y\) \? p\.y : imageH \/ 2;/.test(read('app/smartvision.tsx')),
  'HoleShotMap / L1HolePreview / SmartFinder reject a NaN hole axis before rendering SVG anchors, and SmartVision clampMarker sanitizes non-finite coords — no malformed-geometry white-screen');

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
check('Caddie bag distances only include real (logged) clubs — as honest CARRY',
  // 2026-07-24 (club-logic unification) — gates on hasDistance() (real data, not the chart) and emits
  // carryFor() so the safety hub feeds the brain honest CARRY, never a roll-inclusive total-as-carry.
  /if \(!stats\.hasDistance\(c\)\) continue/.test(read('services/shotStrategy.ts')) &&
  /const y = stats\.carryFor\(c\)/.test(read('services/shotStrategy.ts')),
  "bagDistances gates on hasDistance + emits carryFor — no chart leak, and no tee→rest total quoted as carry");

check('Caddie TARGET no longer a hardcoded CENTER',
  !/const targetDirection = 'CENTER'/.test(read('app/(tabs)/caddie.tsx')),
  'frozen CENTER placeholder removed (honest — until a real aim engine)');

// 2026-08-11 (Tim — "you should be able to also HEAR that acoustic shot"). The mute is now scoped to
// iOS, where the audio session really is a singleton and a second recorder kills strike metering.
// Android has no such conflict, so it records the strike and playback has sound. The invariant this
// guard protects is unchanged — iOS must never record camera audio alongside the metering recorder.
check('SmartMotion camera audio muted ON iOS (no iOS dual-recorder conflict); Android records the strike',
  /mute=\{Platform\.OS === 'ios'\}/.test(read('app/swinglab/smartmotion.tsx')) &&
    // and the review player must not re-mute what we just captured
    /isMuted=\{false\}/.test(read('app/swinglab/smartmotion.tsx')),
  'iOS keeps the mute (singleton audio session); Android captures audio and the review loop plays it');

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
// 2026-08-12 (Tim — "check shot trace, I don't think you actually fixed the guards so it will work").
// This guard USED to assert the bug: that the ball-departure compute was gated on showSkeleton. That
// coupling meant a rendering preference about the POSE SKELETON (defaulted off in June for lag)
// silently switched off shot trace — and, downstream, the analysis card's shot map — for everyone who
// never taps the Motion chip. The skeleton keeps its off-by-default rendering; the ball reads no
// longer ride on it.
check('Motion (pose skeleton) OFF by default — but it no longer gates the ball reads',
  /const \[showSkeleton, setShowSkeleton\] = useState\(false\)/.test(smSrc) &&
    /Motion overlay/.test(smSrc) &&
    /\{showSkeleton \? \(/.test(smSrc) &&
    // the ball reads run for any DTL non-putt swing, skeleton or not
    !/if \(!showSkeleton \|\| !clipUri \|\| !ballArea\) return;/.test(smSrc) &&
    /if \(!clipUri \|\| !ballArea\) return;/.test(smSrc),
  'the pose skeleton still defaults OFF (no lag) and is toggle-gated, but shot trace + shot map no longer depend on that toggle');

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
  // The planner drives an additive layup waypoint + leave label. Existing
  // tee→target→pin lines + projection math are untouched.
  // 2026-08-01 (tester — "we should ALWAYS be able to move the tee dot; it goes away when the cart
  // moves"): the 2026-06-13 "clear the T on capture" behavior was REVERSED — the tee marker now
  // renders ALWAYS (draggable at all times), never hidden by a target override.
  (() => {
    const s = read('app/smartvision.tsx');
    return /import \{ planAimLines, layupFraction \} from '\.\.\/utils\/layupPlan'/.test(s) &&
      /const aimPlan = useMemo\(\(\) => planAimLines\(approachYards\)/.test(s) &&
      /const layupCanvas = useMemo/.test(s) &&
      /layupCanvas && aimPlan\.mode === 'layup'/.test(s) &&
      /cx=\{layupCanvas\.x\}/.test(s) && // layup waypoint marker (the "LAY UP · Ny in" SvgText was removed 2026-06-23; marker + panel carry it)
      // T marker renders ALWAYS now (draggable), NOT gated behind !targetOverride
      /<Marker\s*\n\s*kind="T"\s*\n\s*x=\{teeCanvas\.x\}[\s\S]*?draggable\s*\n\s*onDragEnd=\{onTeeDragEnd\}/.test(s) &&
      !/\{!targetOverride && \(\s*\n\s*<Marker\s*\n\s*kind="T"/.test(s);
  })(),
  'hole view shows the two-line layup plan at 200y+; the tee (T) marker is ALWAYS visible + draggable (no longer cleared when the cart moves / a target is captured)');

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
      // 2026-07-24 — now universal (every screen), NOT round-only. Route-suppressed on live-camera
      // screens (a still golfer must not black out) + suppressCount blocks it during video/capture.
      /if \(!active\) return null/.test(ov) &&
      /SUPPRESS_ROUTES = \[.*smartmotion/.test(ov) &&
      /routeSuppressedRef\.current \|\| suppressCount > 0/.test(ov) &&
      /onStartShouldSetResponderCapture=\{\(\) => \{ useRestModeStore\.getState\(\)\.noteActivity\(\); return false; \}\}/.test(lay) &&
      /<RestModeOverlay \/>/.test(lay);
  })(),
  'idle on ANY screen → near-black rest (keeps GPS alive in-round); route-suppressed on live-camera screens + during video/capture; any touch wakes it, OTA-safe');

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
      // library badge knows 'drill'; 2026-08-06 (Tim) Tank + Randy cards removed from the grid
      /drill:\s*\{ label: 'Drill'/.test(lib) &&
      /HIDDEN_DRILL_IDS: ReadonlySet<string> = new Set\(\['tank_caddie_practice'\]\)/.test(idx) &&
      /DRILL_CATALOG\.filter\(e => !HIDDEN_DRILL_IDS\.has\(e\.id\)\)/.test(idx) // Tank hidden from the grid
    );
  })(),
  'drill card → Smart Motion 3-5 shot drill session, tagged + badged "Drill"; Tank card removed, grid = filtered catalog');

check('Voice: the caddie NEVER speaks in a device voice',
  /**
   * 2026-08-22 (Tim, after a round at Greenhill) — "fuck local altogether. I don't wanna fucking
   * hear a robot voice anymore. Rip it out. I don't wanna ever hear it again."
   *
   * REPLACES the 2026-06-13 guard that asserted the OPPOSITE ("a failed TTS fetch now speaks on the
   * device instead of leaving the caddie silent"), and the 2026-06-14 one that made that robot
   * gender-aware. Both were reasonable trades at the time — say SOMETHING rather than nothing — and
   * in the field they produced a stranger reading the caddie's lines mid-round, which is the loudest
   * way this app can break [[feels-like-a-real-caddie]].
   *
   * The rule now: the cloud voice, or the persona's own cached clip, or silence with the answer on
   * screen. Enforced at the single choke point every path already funnels through, so a tenth call
   * site cannot reintroduce it.
   */
  (() => {
    const v = read('services/voiceService.ts');
    const from = v.indexOf('async function deviceSpeakFallback(');
    const fn = v.slice(from, v.indexOf('\n}', from) + 2);
    return (
      from > -1 &&                                   // the choke point still exists; callers untouched
      !/Speech\.speak\(/.test(fn) &&                  // it just never speaks
      !/function pickDeviceVoice\(/.test(v) &&        // and the machinery is DELETED, not unreachable
      !/Speech\.getAvailableVoicesAsync\(\)/.test(v) &&
      /voice_device_tts_suppressed/.test(fn) &&      // a silent turn stays explainable
      /resolveCachedOfflineClipUri/.test(v)          // the persona's REAL cached voice is untouched
    );
  })(),
  'a failed cloud voice leaves the caddie silent with the answer on screen — it never speaks in a device/OS voice; the persona own cached clips still play');

// 2026-06-14 (Tim) — the device-TTS fallback used the OS DEFAULT voice (often female),
// so a male caddie (Kevin/Harry/Tank) read a finding in a jarring "robotic female"
// voice. The fallback is now GENDER-AWARE: it derives gender from the LIVE persona
// (above the outer try so the catch agrees too), tries to pick a matching device voice,
// and deepens the pitch when a male voice is wanted but unmatchable.

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

// 2026-07-24 (final QA — "ask for features, tools, settings, and courses"). Handedness + units
// were settable in the app but NOT by asking. Handedness now routes OFFLINE (local-first) and the
// handler sets the profile the swing analysis reads. Critically: aiming/direction talk must NEVER
// be misread as a handedness change.
check('Ask for settings: handedness routes offline (and aiming talk never flips it)',
  (() => {
    // (a) behavioral: unambiguous handedness phrasings classify offline...
    const lefty = precheckLocalIntent("I'm left-handed");
    const setLeft = precheckLocalIntent('set me to left-handed');
    const righty = precheckLocalIntent('switch to right-handed');
    const isHand = (i: ReturnType<typeof precheckLocalIntent>, v: string) =>
      i?.intent_type === 'change_setting' && i?.parameters?.setting_name === 'handedness' && i?.parameters?.new_value === v;
    // ...but ordinary aiming/direction talk does NOT.
    const aim = precheckLocalIntent('aim left');
    const missRight = precheckLocalIntent('the green is to the right');
    const okPrecheck =
      isHand(lefty, 'left') && isHand(setLeft, 'left') && isHand(righty, 'right') &&
      !(aim?.parameters?.setting_name === 'handedness') &&
      !(missRight?.parameters?.setting_name === 'handedness');
    // (b) source: the handler actually applies handedness + units (was missing entirely).
    const h = read('services/intents/changeSettingHandler.ts');
    const okHandler =
      /usePlayerProfileStore\.getState\(\)\.setHandedness\(hand\)/.test(h) &&
      /useSettingsStore\.getState\(\)\.setDistanceUnit\(unit\)/.test(h);
    return okPrecheck && okHandler;
  })(),
  'a lefty can turn on left-handed by voice (offline), a metric player can switch units, and "aim left" / "green is to the right" never change handedness');

// 2026-07-24 (final QA pass — 4-agent audit). A cluster of confirmed, different-from-already-fixed bugs.
check('Final QA: start-a-round + tool-open + course-imagery + scoring-math correctness',
  (() => {
    // (a) quick_round resolves EVERY bundled course via the shared resolver (was a stale 9-course
    //     list → other courses hit the network / wrong course). Behavioral proof of unification:
    const qr = resolveSpokenCourse('Pembroke');
    const okQuickRound =
      qr?.previewId === 'local:pembroke-pines' &&
      /import \{[^}]*\bresolveSpokenCourse\b[^}]*\} from '\.\.\/courseNameResolver'/.test(read('services/intents/quickRoundHandler.ts')) &&
      /return spoken \? \{ id: spoken\.previewId, displayName: spoken\.label \} : null/.test(read('services/intents/quickRoundHandler.ts'));
    // (b) the three headline SwingLab tools are voice-openable, swingsim is DISTINCT from sim_round,
    //     and the "Opening undefined" fallback guard is in place.
    const ot = read('services/intents/openToolHandler.ts');
    const okTools =
      /coach_lesson: \{ type: 'navigate', path: '\/swinglab\/coach-lesson' \}/.test(ot) &&
      /hotel_mode: \{ type: 'navigate', path: '\/swinglab\/indoor' \}/.test(ot) &&
      /swingsim: \{ type: 'navigate', path: '\/swinglab\/simround' \}/.test(ot) &&
      /TOOL_LABEL\[toolName\] \?\? 'that'/.test(ot);
    // (c) name-path imagery now covers Spessard/Webster + "green hill" (space) — were dead.
    const img = read('data/localCourseImages.ts');
    const okImagery =
      /c\.includes\('spessard'\) \|\| c\.includes\('holland'\)\) return SPESSARD_HOLLAND_HOLE_IMAGES/.test(img) &&
      /c\.includes\('webster'\) \|\| c\.includes\('dudley'\)\) return WEBSTER_DUDLEY_HOLE_IMAGES/.test(img) &&
      /c\.includes\('greenhill'\) \|\| c\.includes\('green hill'\)\) return GREENHILL_HOLE_IMAGES/.test(img);
    // (d) golfer-model vs-par is normalized per-hole then projected to 18 (was blending 9s + 18s).
    const gm = read('services/golferModel.ts');
    const okScoring =
      /\(r\.scoreVsPar as number\) \/ r\.holesPlayed/.test(gm) &&
      /avg\(perHoleVsPar\) \* 18/.test(gm);
    return okQuickRound && okTools && okImagery && okScoring;
  })(),
  'start-a-round resolves every bundled course offline; Coach Caddie/Hotel Mode/SwingSim open by voice with no "Opening undefined"; Spessard/Webster/Green Hill name-path imagery works; and avg vs-par no longer blends 9- and 18-hole totals');

// 2026-07-24 (final QA — "everything cleaned up"). Club-distance ask + offline settings + chart calibration.
check('Final QA: "what\'s my 7 iron" answers, offline settings flip, and the fallback chart is consistent',
  (() => {
    // (a) "what's my 7 iron" routes to a real handler (was cage-only / re-prompt), and doesn't
    //     hijack score/handicap; offline persona/theme/cart/ghost flip locally.
    const seven = precheckLocalIntent('how far do I hit my 7 iron');
    const persona = precheckLocalIntent('switch to Tank');
    const okRouting =
      seven?.intent_type === 'query_status' && seven?.parameters?.query_topic === 'club_distance' &&
      precheckLocalIntent("what's my score")?.parameters?.query_topic === 'score' &&
      persona?.intent_type === 'change_setting' && persona?.parameters?.new_value === 'tank' &&
      /case 'club_distance':/.test(read('services/intents/queryStatusHandler.ts'));
    // (b) chart calibration: Driver is no longer the scratch-level 275, and 5H no longer collides
    //     with 3I (was 206 vs 205). Both copies (store + recommendation) match.
    // 2026-08-12 — the chart itself moved to services/standardBag.ts. Asserting the literal in each
    // consumer was asserting the DUPLICATION; there were four copies and they had drifted to three
    // different driver numbers. Assert the calibration once, at the source, and that the consumers
    // read it rather than declaring their own.
    const bag = read('services/standardBag.ts');
    const cs = read('store/clubStatsStore.ts');
    const br = read('services/bagRecommendation.ts');
    const cns = read('services/cnsShotRead.ts');
    const okChart =
      /Driver: 245,/.test(bag) && /'5H': 183,/.test(bag) && !/Driver: 275/.test(bag) &&
      /const STANDARD_YARDS: Record<ClubName, number> = STANDARD_CARRY_YARDS;/.test(cs) &&
      /const STANDARD_YARDS: Record<ClubName, number> = STANDARD_CARRY_YARDS;/.test(br) &&
      /const STANDARD_LADDER = SHARED_LADDER;/.test(cns);
    return okRouting && okChart;
  })(),
  'a mid-handicapper can ask "how far do I hit my 7 iron" (offline), flip persona/theme/cart/ghost offline, and the pre-data bag chart is internally consistent (no Driver=275, no 5H≈3I collision)');

// 2026-07-24 (Tim — "club logic always causes issues; it's a central tenet"). Two roots fixed:
// (a) VOCABULARY — a shot's club was written as ClubName/ClubId/acoustic/words then read as one, so a
//     driver logged by voice ('DR') / quick-log ('driver') never registered in the bag. normalizeClub()
//     collapses all four to canonical ClubName, applied at every shot.club write/aggregate boundary.
// (b) CARRY vs TOTAL — clubStats was fed a GPS tee→rest TOTAL by shot tracking but read as CARRY
//     everywhere (over-clubbing forced carries). Now explicit carry/total ladders + carryFor/totalFor.
check('Club logic unified: one vocabulary (normalizeClub) + explicit carry vs total',
  (() => {
    // (a) behavioral: every vocabulary of Driver/Putter/7-iron collapses to the canonical name.
    const okVocab =
      normalizeClub('DR') === 'Driver' && normalizeClub('driver') === 'Driver' && normalizeClub('D') === 'Driver' &&
      normalizeClub('PT') === 'Putter' && normalizeClub('7-iron') === '7I' && normalizeClub('hybrid') === null;
    // (b) source: the store has explicit carry/total ladders + honest carryFor (total − roll), and the
    // GPS-total writer feeds recordTotal while real carries feed recordCarry.
    const cs = read('store/clubStatsStore.ts');
    const okStore =
      /recordCarry: \(club: ClubName, yards: number\) => void/.test(cs) &&
      /recordTotal: \(club: ClubName, yards: number\) => void/.test(cs) &&
      /carryFor: \(club: ClubName\) => number/.test(cs) &&
      /Math\.max\(1, Math\.round\(t\.avgYards - ROLL_YARDS\[club\]\)\)/.test(cs) && // carry = tracked total − roll
      /version: 2/.test(cs); // migration moves old GPS-total `stats` → the `total` ladder
    // (c) the writers are wired to the right ladder + normalized.
    const track = read('services/shotTracking.ts');
    const round = read('store/roundStore.ts');
    const okWiring =
      /const club = normalizeClub\(shot\.club\);/.test(track) &&
      /useClubStatsStore\.getState\(\)\.recordTotal\(club, yards\)/.test(track) && // GPS total → total ladder
      /const normClub = \(\(\) => \{/.test(round) &&
      /\.recordCarry\(normClub, carry\)/.test(round) &&                            // real carry → carry ladder
      // the safety hub emits carry.
      /const y = stats\.carryFor\(c\)/.test(read('services/shotStrategy.ts'));
    return okVocab && okStore && okWiring;
  })(),
  'a driver logged by voice/quick-log now registers in the bag (normalizeClub), the caddie quotes honest CARRY (not a tee→rest total), and one club no longer splits into multiple usage rows');

// 2026-07-24 (Tim — tempo, OTA-only). Accel+gyro fusion is ADDITIVE + hard-guarded on top of the proven
// gyro tempo detector: it must NEVER change the result when accel isn't fed (safe fallback), and can only
// nudge the through-swing timing by a bounded amount. Uses expo-sensors (already installed) → OTA, no build.
check('Tempo: accel+gyro fusion refines the through-swing but safely falls back to gyro',
  (() => {
    // Behavioral: same synthetic swing gyro-only vs with a real linear-accel bottom burst.
    const swing = (() => { const g: { t: number; x: number; y: number; z: number }[] = [];
      for (let t = 0; t <= 700; t += 10) g.push({ t, x: 2.0 * Math.sin((Math.PI * t) / 700), y: 0, z: 0 });
      for (let t = 710; t <= 1000; t += 10) g.push({ t, x: -3.0 * Math.sin((Math.PI * (t - 710)) / 290), y: 0, z: 0 });
      for (let t = 1010; t <= 1350; t += 10) g.push({ t, x: 0.05, y: 0, z: 0 }); return g; })();
    const run = (burst: boolean) => { const d = new IndoorRepDetector('swing'); let rep: ReturnType<IndoorRepDetector['onSample']> = null;
      for (const s of swing) { if (burst) d.onAccel({ t: s.t, x: s.t >= 900 && s.t <= 940 ? 4 : 0, y: 0, z: 9.8 }); const r = d.onSample(s); if (r) rep = r; } return rep; };
    const gyroOnly = run(false); const fused = run(true);
    const okBehavior =
      gyroOnly != null && fused != null &&
      gyroOnly.impactSource === 'gyro' &&                                   // no accel → gyro fallback
      fused.impactSource === 'gyro+accel' &&                               // a sane bottom engages fusion
      fused.backswingMs === gyroOnly.backswingMs &&                        // backswing NEVER touched
      Math.abs(fused.downswingMs - gyroOnly.downswingMs) <= 150;           // bounded ±150ms nudge
    // Source: the master switch + the screen's OWN-try-catch accel subscription (gyro unaffected if accel fails).
    const svc = read('services/indoorSwing.ts');
    const screen = read('app/swinglab/indoor.tsx');
    const okWiring =
      /export const ACCEL_FUSION_ENABLED = true/.test(svc) &&
      /if \(win\.length < 5\) return \{ downswingMs: gyroDownswingMs, source: 'gyro' \}/.test(svc) && // no coverage → gyro
      /Accelerometer\.addListener/.test(screen) &&
      /\/\* accel is a bonus — gyro tempo works without it \*\//.test(screen);
    return okBehavior && okWiring;
  })(),
  'the accelerometer sharpens the through-swing bottom (tempo trends toward a truer 3:1) but is byte-identical to the gyro baseline when accel is absent, never moves the backswing, and is bounded to a small correction — OTA-safe (expo-sensors already installed)');

// 2026-07-24 (M3/M4 — WHS posting honesty for high-handicap play).
check('Handicap: blow-up holes capped (net double bogey) + pick-up rounds still count',
  (() => {
    // Behavioral: a par-4 course, courseHcp 18 (1 stroke/hole → cap = par+3 = 7).
    const pars: Record<number, number> = {}; for (let h = 1; h <= 18; h++) pars[h] = 4;
    const blow: Record<number, number> = {}; for (let h = 1; h <= 18; h++) blow[h] = 5; blow[7] = 10;
    const capped = computeWhsPostingScore({ intendedHoles: 18, courseHandicap: 18, pars, scores: blow });
    const pickup: Record<number, number> = {}; for (let h = 1; h <= 18; h++) pickup[h] = 5; delete pickup[12];
    const filled = computeWhsPostingScore({ intendedHoles: 18, courseHandicap: 18, pars, scores: pickup });
    const okMath =
      capped?.adjustedGrossScore === 17 * 5 + 7 &&      // the 10 caps to 7, not 10
      filled?.playedHoles === 17 && filled?.postedHoles === 18 && filled?.adjustedGrossScore === 18 * 5 && // pick-up filled net par
      computeWhsPostingScore({ intendedHoles: 18, courseHandicap: 18, pars, scores: { 1: 5 } }) === null; // too incomplete → null
    // Wiring: round-end computes + stores the posting basis; the recalc + eligibility honor it.
    const rs = read('store/roundStore.ts');
    const okWire =
      /computeWhsPostingScore\(\{/.test(rs) &&
      /record\.handicapAgs = post\.adjustedGrossScore; record\.handicapHoles = post\.postedHoles/.test(rs) &&
      /handicapAgs: r\.handicapAgs, handicapHoles: r\.handicapHoles/.test(rs) &&
      /r\.handicapHoles != null \|\| r\.holesPlayed === 9 \|\| r\.holesPlayed === 18/.test(rs); // eligibility includes filled pick-ups
    return okMath && okWire;
  })(),
  'a 10 on a par 4 caps at net double bogey (stops inflating the Index), a round with a picked-up hole fills to net par and still posts, and the recalc/eligibility use the same WHS basis as round-end');

// 2026-07-24 (final QA). Co-located course auto-detect + local search match.
check('Final QA: co-located courses ask which nine; search matches bundled courses locally',
  (() => {
    const play = read('app/(tabs)/play.tsx');
    // (a) C3 — atCourse detects a same-location sibling that shares the club family, and the banner
    //     offers BOTH (no one-tap-start of a guessed nine with the wrong par/yardages).
    const okChooser =
      /const sibling = within\.slice\(1\)\.find\(o =>/.test(play) &&
      /family\(o\.course\.club_name\) === family\(best\.course\.club_name\)/.test(play) &&
      // 2026-07-30 (audit #1 — DATA LOSS) — both "start a round" banners are now also gated on
      // !isRoundActive so a one-tap start can't wipe an in-progress round.
      /atCourse && !isRoundActive && atCourse\.sibling &&/.test(play) &&
      /atCourse && !isRoundActive && !atCourse\.sibling && selected\?\.id !== atCourse\.course\.id/.test(play);
    // (b) C5 — search matches BUNDLED courses locally first (offline-safe) and only shows the
    //     connectivity error when there's nothing (local OR remote) to show.
    const okSearch =
      /const localMatches: CourseSummary\[\] = LOCAL_COURSES\.filter\(/.test(play) &&
      /if \(err && merged\.length === 0\) setSearchError/.test(play) &&
      /if \(localMatches\.length === 0\) setSearchError/.test(play);
    return okChooser && okSearch;
  })(),
  'at a co-located club (Menifee Palms/Lakes) the app asks which course instead of starting the wrong nine, and typing a bundled course name resolves it locally even offline / on API error');

// 2026-07-24 (Tim field log — "I only want local mode if local toggle is on; its clashing error state
// overtakes the first minute of warmup"). A cold-boot network blip was dropping EVERY user into the
// on-device (LOCAL) STT re-prompt loop ("Say that again for me?") regardless of the Local Mode toggle.
check('Voice: on-device (local) STT fallback is gated behind the Local Mode toggle',
  (() => {
    const v = read('hooks/useVoiceCaddie.ts');
    return (
      /const localModeOn = \(\(\) => \{ try \{ return useSettingsStore\.getState\(\)\.localMode === true;/.test(v) &&
      /if \(localModeOn && stt\.isOnDeviceSTTReady\(\)\)/.test(v)
    );
  })(),
  'a player who has NOT turned on Local Mode no longer gets dropped into the on-device STT re-prompt loop on a cold-boot network blip — they degrade straight to the seamless "stay on this shot" line; on-device STT runs only when Local Mode is explicitly ON');

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
  // 2026-06-13 — another offline-mute fix: a wind QUESTION ("what's the wind / how's the
  // wind") answers locally from cached weather, described relative to the shot (into your
  // face / at your back / cross) via the playsLike wind decomposition. Routed AFTER
  // plays-like so "with the wind" still goes to the distance read. Honest no-reading.
  // 2026-07-31 (Tim — "no canned voice blocking the AI") — the matcher now requires QUESTION
  // phrasing (a bare "it's windy" converses with the brain instead of a canned wind read).
  (() => {
    const src = read('services/localStatusResponder.ts');
    return (
      /import \{ playsLikeDistance \} from '\.\.\/utils\/playsLike'/.test(src) &&
      /wind:\s*\/\\b\(how\(\?:'s\|s\)\?\\s\+\(\?:the\\s\+\)\?wind/.test(src) && // wind QUESTION matcher
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

/**
 * 2026-08-23 — REMOVED with the thing it measured. This asserted that a memory-backed
 * tryLocalReply answer in voiceCommandRouter reclassified cloud→local, so the hit-rate reflected
 * CNS growth. That local answer is gone (Tim: every spoken question reaches the caddie), so there
 * is no cloud→local reclassification left to assert — and a guard whose subject no longer exists
 * cannot fail, which is worse than no guard.
 *
 * The CNS growth it was proxying for is now visible where it actually belongs: the learned layer
 * reaches the caddie as context, asserted by "No local path answers before the caddie is asked".
 */

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
    /**
     * 2026-08-23 — RE-AIMED. G5 asserted that the voice path and the diagnostic handler each CALL
     * mergeMemoryIntoContext themselves. Both now reach the same merged block through the one
     * payload builder (services/caddieRequestBody composes live + CNS in a single place), so the
     * spelling changed while the property did not. Asserting the property: each path supplies the
     * LIVE half, and the builder merges it with the CNS half.
     */
    const builder = read('services/caddieRequestBody.ts');
    const g5 = /mergeMemoryIntoContext\(/.test(builder) &&
      /getCaddieContext\(/.test(builder) &&
      /getUnifiedVisionContext\(\)\)\.promptBlock/.test(voice) &&
      /unified_context_block: mergeMemoryIntoContext\(\s*\n\s*liveBlock,/.test(voice) &&
      /getUnifiedVisionContext\(\)\)\.promptBlock/.test(diag) &&
      /liveBlock: live,/.test(diag);
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
      // 2026-08-07 — onLoad is now a STABLE useCallback (onReviewVideoLoad) to kill the re-subscribe crash;
      // it still kicks playback on load when not paused (async so the swing-window seek awaits first).
      /const onReviewVideoLoad = useCallback\(async \(s: AVPlaybackStatus\) => \{[\s\S]*?if \(!videoPaused\) v\.playAsync\(\)/.test(sm) &&
      /onLoad=\{onReviewVideoLoad\}/.test(sm) &&
      /onPlaybackStatusUpdate=\{onReviewPlaybackStatus\}/.test(sm) && /onError=\{onReviewVideoError\}/.test(sm) &&
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
      // 2026-08-19 — was /computeBiomechanicsFromFrames\(frames, angle/. The camera angle is no longer
      // a value the screen holds and passes down; null makes the engine infer it from these very frames,
      // which is now the single source of truth. This guard is about the SHARED extraction, not the angle.
      /computeBiomechanicsFromFrames\(frames, null/.test(sm)
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
      // 2026-07-07 (biomech #9) — the upload passes its KNOWN camera angle.
      // 2026-07-24 (full-app audit, root D) — AND threads handedness so a lefty's
      // weight-shift sign isn't inverted (default 'right' read it backwards).
      // 2026-08-09 (verification wave C1) — the null impact slot became poseImpactMs: the vision-located
      // impact now selects the strike-anchored sampling branch (stage labels on the real swing points).
      /analyzeSwingFromVideo\(firstClipSwing\.clipUri!, durationSec \* 1000, session\.upload\?\.angleOverride \?\? null, false, poseWindow, poseImpactMs, resolveSwingerHandedness\(\)\)/.test(up) &&
      /session\.source === 'uploaded_video' \? \(/.test(detail) &&
      /onPress=\{onAnalyzeAtPosition\}/.test(detail)
    );
  })(),
  'uploaded swing windows the cloud read AND the on-device pose on the pointed moment → cards + skeleton');

// 2026-07-24 (full-app audit, root D) — angle-honesty must be AUTOMATIC, not opt-in
// per call-site. Before this, the Coach lesson + library-upload backfill passed no
// angle → computeBiomechanics nulled nothing → geometrically-invalid DTL turn/weight/
// sequencing numbers were spoken/shown as measured. Now computeBiomechanics INFERS the
// angle from pose geometry when the caller doesn't know it, and every call site threads
// handedness so a lefty's weight-shift sign isn't inverted.
check('Biomech honesty is automatic: angle inferred when unknown + handedness threaded everywhere',
  (() => {
    const pose = read('services/poseAnalysisApi.ts');
    const infer = read('services/cameraAngleInference.ts');
    const coach = read('app/swinglab/coach-lesson.tsx');
    const estimator = read('services/poseEstimator.ts');
    const detail = read('app/swinglab/swing/[swing_id].tsx');
    const resolver = read('services/swingerHandedness.ts');
    return (
      // computeBiomechanics infers the angle when the caller passes none.
      /if \(angle == null\) \{\s*\n\s*angle = inferCameraAngle\(frames\);/.test(pose) &&
      // the detector keys off shoulder-width vs torso-height and is conservative
      // (only asserts DTL/face-on at unambiguous ratios, else null = compute as-is).
      /maxRatio < 0\.35\) return 'down_the_line'/.test(infer) &&
      /maxRatio > 0\.60\) return 'face_on'/.test(infer) &&
      // the ONE service-safe handedness source mirrors SmartMotion's derivation.
      /active\?\.handedness === 'left' \|\| active\?\.handedness === 'right'/.test(resolver) &&
      // the Coach lesson (both live-camera + picker paths) threads handedness. 2026-07-24: the
      // camera-first rebuild renamed the window const RECORD_WINDOW_SEC → WINDOW_SEC; honesty (angle
      // null → inferred, handedness threaded) is unchanged.
      /analyzeSwingFromVideo\(uri, WINDOW_SEC \* 1000, null, false, null, null, resolveSwingerHandedness\(\)\)/.test(coach) &&
      /analyzeSwingFromVideo\(asset\.uri, durationMs, null, false, null, null, resolveSwingerHandedness\(\)\)/.test(coach) &&
      // the raw-frame poseEstimator path threads lefty; the MIRROR path must NOT
      // (adjustFrames already flips lefty→righty — double-correcting would re-invert).
      /input\.durationMs, input\.context\?\.angle \?\? null, false, null, null, lefty \? 'left' : 'right'\)/.test(estimator) &&
      /computeBiomechanicsFromFrames\(adjusted\)/.test(estimator) &&
      // the swing-detail backfill threads handedness too.
      /resolveSwingerHandedness\(\)\)/.test(detail)
    );
  })(),
  'the Coach lesson + upload backfill no longer speak DTL-invalid turn/weight numbers as measured (angle inferred from geometry), and lefty weight-shift reads with the correct sign on every analysis path');

// 2026-07-24 (Tim — "doesn't flow like a real lesson"). Coach Caddie REBUILT camera-first + auto-loop:
// the camera is the persistent lesson surface (no text-wall, no per-rep mount flip, no black spinner),
// coaching is captions over the live camera, and the guided/focus flow AUTO-LOOPS reps (no "Record my
// swing" per rep) and auto-advances the plan on the checkpoint.
check('Coach Caddie flows like a real lesson: camera-first, captioned, auto-looping',
  (() => {
    const coach = read('app/swinglab/coach-lesson.tsx');
    const svc = read('services/coachLesson.ts');
    return (
      // Persistent camera whenever a session is live (not only during a capture window).
      /\{sessionLive && <CoachSwingCamera ref=\{coachCamRef\} facing="back" style=\{StyleSheet\.absoluteFill\} \/>\}/.test(coach) &&
      // Hands-free auto-loop: record window → read → feedback caption → re-arm, driven by a cancelable timer.
      /const focusRep = useCallback/.test(coach) &&
      /const scheduleRearm = useCallback/.test(coach) &&
      /const applyFocusResult = useCallback/.test(coach) &&
      // Feedback is a caption over the camera with a "Reading that one…" chip — NOT a black spinner page.
      /Reading that one…/.test(coach) &&
      /captionText/.test(coach) &&
      // Focus/plan control bar is just Pause/End (no per-rep tap in the auto-loop).
      /onPress=\{togglePause\}/.test(coach) &&
      // Auto-advance the plan on the checkpoint (no "Next" tap).
      /setPlanStep\(nextStep\); setFocus\(next\)/.test(coach) &&
      // Short spoken opener (the long instruction paragraph was the "wall of text").
      /export function openerLine/.test(svc) &&
      /Make a swing when you're ready/.test(svc)
    );
  })(),
  'starting a lesson drops straight onto the live camera with a short spoken opener; the guided flow watches → reads (caption, not spinner) → speaks feedback → re-arms and auto-advances hands-free — no wall of text, no per-rep Record/Done taps');

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

// 2026-07-28 (Tim — "make sure the early warm-up is set and locked; no failures or robot voice").
// LOCK the launch warm-up so it can't silently regress: the app pre-warms all voice endpoints + the
// backend connection at app-root mount (ungated — NOT behind the heal probe), and caches the persona
// offline clips so the offline path never falls to the robotic device-TTS fallback.
check('Voice warm-up LOCKED at app start (no cold-tap failure / robot voice for testers)',
  (() => {
    const lay = read('app/_layout.tsx');
    const w = read('services/voiceWarmup.ts');
    return (
      /bootMark\('voice_warmup_fired'\)/.test(lay) &&   // fires at launch, marked
      /m\.prewarmVoice\(\)/.test(lay) &&                 // 5 voice endpoints warmed at root
      /warmBackendConnection\(\)/.test(lay) &&           // DNS/TLS/pool warm (retry-with-backoff)
      /prewarmOfflineVoiceClips\(\)/.test(w)             // persona offline clips cached → no robotic TTS
    );
  })(),
  'the app pre-warms every voice endpoint + the backend connection at launch (ungated) and caches the persona offline clips, so a tester never hits a cold-start failure or the robotic device-TTS fallback');

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
  // on focus (not just tap).
  // 2026-07-20 (BETA — Tim: "Caddie is cutting me off") — the silence endpoint is now
  // ADAPTIVE: a quick command still snaps (SHORT window), but once the user is mid-sentence
  // it waits out a natural pause (LONG window) so it never clips a real thought.
  // 2026-07-30 (Tim — "on iOS Kevin listens too long; calibrate the mic to close sooner"):
  // tightened SHORT 900→650 / LONG 1800→1400 — snappier close, still ≥ a word-search pause.
  (() => {
    const vc = read('hooks/useVoiceCaddie.ts');
    const caddie = read('app/(tabs)/caddie.tsx');
    const vs = read('services/voiceService.ts');
    return (
      /heartbeat = setInterval\(warmIfVoice, 240_000\)/.test(vc) &&
      /if \(next === 'active'\) \{ warmIfVoice\(\); startHeartbeat\(\); \}/.test(vc) &&
      /else stopHeartbeat\(\)/.test(vc) &&
      /voiceEnabled\) \{[\s\S]*?prewarmVoice\(\);/.test(caddie) &&
      /**
       * 2026-08-21 — re-aimed. This pinned the literal 800/2000, which is what CUT TIM OFF: "hi,
       * Serena" is ~900ms, fell under the sentence threshold, got the 800ms window, and closed while
       * he drew breath to ask how she was. The guard was protecting the numbers that broke it.
       *
       * The PROPERTY is what matters: the endpoint is adaptive, and BOTH windows are long enough
       * that a natural breath cannot clip a sentence. Asserted as floors, so the numbers can be tuned
       * without the guard either breaking or silently permitting a regression back to clipping.
       */
      (() => { const m = /const SILENCE_TIMEOUT_SHORT_MS = (\d+);/.exec(vs); return !!m && Number(m[1]) >= 1200; })() &&
      (() => { const m = /const SILENCE_TIMEOUT_LONG_MS = (\d+);/.exec(vs); return !!m && Number(m[1]) >= 2000; })() &&
      // adaptive selection: long window once speech has run past SPEECH_LONG_MS
      /speakingForMs >= SPEECH_LONG_MS \? SILENCE_TIMEOUT_LONG_MS : SILENCE_TIMEOUT_SHORT_MS/.test(vs) &&
      // the FIRST-turn mic path also runs the adaptive window (was a single fixed gap that clipped)
      (() => { const m = /const MIC_SILENCE_SHORT_MS = (\d+);/.exec(vc); return !!m && Number(m[1]) >= 1200; })() &&
      (() => { const m = /const MIC_SILENCE_LONG_MS = (\d+);/.exec(vc); return !!m && Number(m[1]) >= 2000; })() &&
      // And a greeting must reach the PATIENT window: "hi Serena" is ~900ms, so the sentence
      // threshold has to sit below that or the most common opener gets the short one.
      (() => { const m = /const MIC_SPEECH_LONG_MS = (\d+);/.exec(vc); return !!m && Number(m[1]) <= 900; })() &&
      /speakingForMs >= MIC_SPEECH_LONG_MS \? MIC_SILENCE_LONG_MS : MIC_SILENCE_SHORT_MS/.test(vc)
    );
  })(),
  'a 4-min heartbeat keeps endpoints warm; caddie warms on focus; ADAPTIVE silence endpoint on BOTH the follow-up loop AND the first-turn mic windows floored so a natural breath never clips a sentence, and the sentence threshold sits BELOW a ~900ms greeting so "hi Serena" earns the patient window');

check('Voice: an offline turn degrades on a DEADLINE, not on a probe\'s opinion',
  // 2026-07-30 → 2026-08-20. This guard used to assert the fast-abort: both probes actively failing
  // meant "kill the transcribe now". Tim's 08-20 log showed that abort firing on a WORKING
  // connection (elapsedMs 11045 = probes 5018 + 6016, upload cancelled with ~11s of budget left),
  // so the veto is gone. The legitimate half of the old concern — never hang forever and then emit
  // a canned line — survives here, moved onto the clock where it cannot be wrong about the network.
  (() => {
    const vc = read('hooks/useVoiceCaddie.ts');
    const budget = /const VOICE_TOTAL_BUDGET_MS = (\d+);/.exec(vc);
    const bounded = /const retryBudgetMs = Math\.max\(8000, VOICE_TOTAL_BUDGET_MS - spentMs\);/.test(vc)
      && /doTranscribeFetch\(probeSaysDown \? retryBudgetMs/.test(vc);
    // A real attempt, not a token one, and a ceiling a person will actually wait through.
    const sane = !!budget && Number(budget[1]) >= 30000 && Number(budget[1]) <= 45000;
    // The old veto must not creep back in under any name.
    const noVeto = !/bothActivelyFailed/.test(vc);
    return bounded && sane && noVeto;
  })(),
  'a turn that cannot reach the host degrades on a total wall-clock budget (~35s) with the retry floored at a genuine 8s attempt, instead of a probe cancelling an upload that may still be about to succeed');

check('Voice: speakFromBase64 never goes silent on a dead audio load (device-TTS fallback, parity with speak)',
  // 2026-07-30 (audit MED) — the brain's INLINE-audio path (speakFromBase64) had no dead-load recovery,
  // so an OS audio-session hangover (isLoaded true, durationMillis 0) played nothing and the caddie went
  // silent. Now it resets + retries once, then speaks the reply text (opts.caption) via device TTS.
  (() => {
    const vs = read('services/voiceService.ts');
    return (
      /speakFromBase64 first load looked dead/.test(vs) &&
      /base64_dead_load_giving_up/.test(vs) &&
      /await deviceSpeakFallback\(fbText,/.test(vs)
    );
  })(),
  'the inline-audio speak path recovers from a dead OS audio load (reset+retry) and falls back to device TTS speaking the reply instead of leaving the caddie mute');

check('Persona switch: ONE unified handoff (no double-speak, no racing opener, no cold dead-end)',
  // 2026-07-30 (Tim — switching to Serena: "two speaking things racing" [the new handoff + the old
  // "here when you're ready, tap to chat"] and "starts a fresh session that tells me I'm off the
  // course"). Unified: (1) the local-intent route no longer speaks its own ack (setCaddiePersonality's
  // bundled opener is the single handoff for every caddie); (2) a switch claims the one-per-process
  // opener slot so the app-open proactive opener stands down; (3) a switch never auto re-listens (which,
  // cold, dead-ended into the off-course line).
  (() => {
    const csh = read('services/intents/changeSettingHandler.ts');
    const vc = read('hooks/useVoiceCaddie.ts');
    const ss = read('store/settingsStore.ts');
    const cad = read('app/(tabs)/caddie.tsx');
    const guard = read('services/openerGuard.ts');
    return (
      // (1) persona switch returns no spoken ack
      /case 'persona': \{[\s\S]*?voice_response: null, side_effects: \['caddie_persona:'/.test(csh) &&
      // (2) shared opener-slot guard: switch claims it, caddie opener honors it
      /export function claimOpenerSlot/.test(guard) && /export function isOpenerClaimed/.test(guard) &&
      /claimOpenerSlot\(\)/.test(ss) &&
      /openerPlayedThisProcess \|\| isOpenerClaimed\(\)/.test(cad) &&
      // (3) a caddie switch never spawns a follow-up mic turn
      /const switchedCaddie = /.test(vc) && /let shouldRecurse = !switchedCaddie && kevinAskedFollowUp/.test(vc)
    );
  })(),
  'every persona switch (kevin/serena/harry/tank) produces exactly ONE handoff — the bundled opener — with no redundant ack, no app-open opener stacking on top, and no cold follow-up turn dead-ending into the off-course line');

check('Voice: greetings/check-ins route to the BRAIN (no canned pool line blocking the AI)',
  // 2026-07-31 (Tim — "no preprogrammed voice blocking; process everything through the AI"). A greeting
  // ("how are you", "hey Serena") was short-circuited to a canned per-persona pool line + bundled clip,
  // so the caddie deflected ("I'm here, what are you thinking?") and repeated it. socialGreetingHandler
  // is UNREGISTERED → both the caddie-tab and hands-free paths fall through to the brain for a real reply.
  (() => {
    const idx = read('services/intents/index.ts');
    const vc = read('hooks/useVoiceCaddie.ts');
    return (
      // the handler is no longer registered (line commented with the rationale)
      /\/\/ voiceCommandRouter\.registerHandler\(socialGreetingHandler\);/.test(idx) &&
      // and the caddie-tab command-hit gate also excludes social_greeting (defensive)
      /intent\.intent_type !== 'social_greeting'/.test(vc)
    );
  })(),
  'a greeting or check-in is answered by the real brain (in-character, varied) instead of a canned pool line — no preprogrammed voice sits in front of the AI on either voice path');

check('Voice: canned-speech sweep — strategy/conversation reads route to the brain, not local templates',
  // 2026-07-31 (Tim — full-app canned-speech audit). Seven local intercepts that spoke a hardcoded
  // line on ORDINARY conversation now defer to the brain: the golf-father cascade no longer claims
  // "what's the play here"; wind needs question phrasing; "how am I doing" isn't a scoreboard read;
  // hole-info strategy is AI-led online; unmapped query_status defers; "help me X" + acks-with-a-request
  // route to the brain.
  (() => {
    const gf = read('services/intents/askGolfFatherHandler.ts');
    const lsr = read('services/localStatusResponder.ts');
    const qs = read('services/intents/queryStatusHandler.ts');
    const help = read('services/intents/helpHandler.ts');
    const ack = read('services/intents/acknowledgeHandler.ts');
    return (
      // 1 — golf-father reduced to EXPLICIT invocations (generic strategy phrases removed from examples)
      /'ask the golf father'/.test(gf) &&
      // 7 — hole strategy is AI-led online (added to the exclusion set)
      /'club_recommend', 'plays_like', 'reach', 'hole_info'/.test(lsr) &&
      // 3 — unmapped query_status defers to the brain
      /query:unknown_topic:route_to_brain/.test(qs) &&
      // 5 — "help me X" routes to the brain
      /help:coaching:route_to_brain/.test(help) &&
      // 6 — an ack carrying a request routes to the brain instead of a silent swallow
      /acknowledge:has_request:route_to_brain/.test(ack)
    );
  })(),
  'the flagship "what\'s the play here", a passing "it\'s windy", "how am I doing", a hole-strategy ask, a vague status question, "help me read this putt", and "okay so what should I do" all reach the AI brain now — every canned local intercept on ordinary conversation was closed');

check('Tester round 2: typed reply always shows, keyboard dismiss, Harry not selectable, drill name fades',
  // 2026-08-01 (tester feedback batch).
  (() => {
    const ls = read('services/listeningSession.ts');
    const bottombar = read('components/caddie/CaddieBottomBar.tsx'); // the bar actually mounted on every screen
    const cc = read('app/profile/custom-caddie.tsx');
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      // 1 — a TYPED turn shows the brain reply even when voice is muted (regression from removing the
      //     canned greeting handler: "I type hi now and nothing happens"). speak() already flashes the
      //     caption when muted, so handler/command replies show too — this covers the brain branch.
      /try \{ flashCaption\?\.\(r\.text, 7000\); \}/.test(ls) &&
      // 2 — the on-screen input bar can minimize the keyboard while typing
      /accessibilityLabel="Hide keyboard"/.test(bottombar) && /Keyboard\.dismiss\(\)/.test(bottombar) &&
      // 3 — Harry is NOT a selectable base persona for the custom caddie
      !/id: 'harry'/.test(cc) &&
      // 4 — the drill-name banner fades out after 5s instead of overlapping the cards
      /const drillBannerOpacity = useRef\(new Animated\.Value\(1\)\)/.test(sm) &&
      /Animated\.timing\(drillBannerOpacity, \{ toValue: 0, duration: 700, delay: 5000/.test(sm) &&
      /opacity: drillBannerOpacity/.test(sm)
    );
  })(),
  'a typed question always shows a visible answer (even muted); the keyboard can be minimized from the input bar; Harry (dormant) is not selectable as a custom base persona; and the shot-shape drill name fades after 5s so it stops covering the metric cards');

check('First-run tour: auto on the first few opens, skippable, replayable from Settings',
  // 2026-08-01 (tester — "on first 3 uses a skippable icon-by-icon highlight of the tools + how to
  // talk"). A guided TourOverlay (mic/talk → tools → bottom bar → go) auto-shows on the caddie tab for
  // the first few opens until finished/skipped; _layout counts the open; Settings replays it.
  (() => {
    const store = read('store/onboardingTourStore.ts');
    const overlay = read('components/onboarding/TourOverlay.tsx');
    const caddie = read('app/(tabs)/caddie.tsx');
    const layout = read('app/_layout.tsx');
    const settings = read('app/settings.tsx');
    return (
      /shouldAutoShow: \(\) =>/.test(store) && /noteAppOpen:/.test(store) && /completeTour:/.test(store) &&
      /MAX_AUTO_OPENS = 3/.test(store) &&
      /export function TourOverlay/.test(overlay) &&
      /useOnboardingTourStore\.getState\(\)\.noteAppOpen\(\)/.test(layout) &&
      /if \(useOnboardingTourStore\.getState\(\)\.shouldAutoShow\(\)\) setShowTour\(true\)/.test(caddie) &&
      /steps=\{ONBOARDING_TOUR_STEPS\}/.test(caddie) && /completeTour\(\)/.test(caddie) &&
      /relaunchTour\(\)/.test(settings) && /Show Me Around/.test(settings) &&
      // MEASURED spotlights: a target registry + a measure hook, real elements instrumented, and the
      // overlay cuts a hole over the measured bounds (with a geometry fallback).
      /export function setTourTarget/.test(read('store/tourTargets.ts')) &&
      /measureInWindow/.test(read('hooks/useTourTarget.ts')) &&
      /const barTarget = useTourTarget\('caddie\.bar'\)/.test(read('components/caddie/CaddieBottomBar.tsx')) &&
      /useTourTarget\('caddie\.mic'\)/.test(read('components/caddie/CaddieBottomBar.tsx')) &&
      /const toolsTarget = useTourTarget\('caddie\.tools'\)/.test(caddie) &&
      /targetId: 'caddie\.mic'/.test(caddie) && /targetId: 'caddie\.tools'/.test(caddie) &&
      /step\.targetId \? getTourTarget\(step\.targetId\)/.test(overlay)
    );
  })(),
  'the first-run guided tour explains how to talk to the caddie + where the tools + navigation are, auto-shows for the first 3 opens (skippable, replayable from Settings), and spotlights the REAL on-screen mic / tools / bar by their measured bounds (clean cut-out), not just a region box');

check('Sim round: narrated yardage holds (simulated fix not treated as stale) + prewarms on start',
  // 2026-07-30 (Tim — "yardage updated for a second then went back to the whole hole yardage" + "3 min
  // to give the course brief"). The simulated fix never re-ticks, so the 10s freshness gate reverted the
  // read to the static hole distance; and the sim launcher prewarmed nothing so the first turn was cold.
  (() => {
    const yr = read('services/yardageResolver.ts');
    const sr = read('services/simRound.ts');
    return (
      /isSimulatedActive/.test(yr) && /\(isSimulatedActive\(\) \|\| fixAge < 10_000\)/.test(yr) &&
      /prewarmBriefing/.test(sr) && /prewarmVoice\(true\)/.test(sr) && /warmBackendConnection/.test(sr)
    );
  })(),
  'a narrated sim shot moves the position and the yardage HOLDS its countdown (the simulated fix is not aged out to the static hole distance), and starting a sim round prewarms the briefing + TTS + connection so the first brief is not a 3-minute cold wait');

check('Voice: get-to-know interview never opens a tool (fault = info, not a command)',
  // 2026-07-30 (Tim — "in tell-your-caddie mode caddie keeps opening SwingLab while I list my
  // faults; the conversation is to gather info and build the profile by voice"). BOTH dispatch
  // paths (the tab handleToolAction + the hands-free dispatcher) hard-drop every navigational /
  // tool-opening action while the 'getting to know the golfer' screen context is active, and the
  // pipecat brain is told to LISTEN & GATHER, never open/navigate/record or SPEAK as if it did.
  (() => {
    const dispatch = read('services/voice/conversationalToolDispatch.ts');
    const caddie = read('app/(tabs)/caddie.tsx');
    const brain = read('api/pipecat-turn.ts');
    return (
      // shared guard: get-to-know screen + a nav/open action set that includes open_swinglab
      /getting to know the golfer/.test(dispatch) &&
      /export function isSuppressedInGetToKnow/.test(dispatch) &&
      /'open_swinglab'/.test(dispatch) &&
      /'record_swing', 'configure_drill', 'set_angle', 'close_swinglab'/.test(dispatch) &&
      // hands-free dispatcher applies the guard before dispatchOne
      /isSuppressedInGetToKnow\(t\)\)\s*\{[\s\S]*?continue;/.test(dispatch) &&
      // tab dispatcher applies the same guard at the top of handleToolAction
      /isSuppressedInGetToKnow\(action\.type\)\)\s*\{\s*\n\s*return;/.test(caddie) &&
      // brain-prompt honesty layer: don't open AND don't say you opened
      /GET-TO-KNOW INTERVIEW MODE/.test(brain) &&
      /do NOT say you are opening or pulling up anything/.test(brain)
    );
  })(),
  'the get-to-know voice interview builds the profile from what the golfer says — describing a fault is absorbed, never routed to a drill; navigation/open tools are suppressed on the client AND the brain is told not to open or claim it opened anything');

check('Voice: one voice at a time (no racing)',
  // 2026-06-16 (Tim — "two voices racing"). 2026-08-22: the device side no longer speaks at all, so
  // the surviving property is that the cloud/mp3 path stops anything in flight before it starts.
  // The Speech.stop() calls stay as belt-and-braces against a regression.
  (() => {
    const vs = read('services/voiceService.ts');
    const cloudStopsAnything = (vs.match(/try \{ Speech\.stop\(\); \} catch \{\}/g) || []).length >= 3;
    return cloudStopsAnything && !/Speech\.speak\(/.test(vs);
  })(),
  'the cloud/mp3 path cancels anything in flight before speaking, and nothing can start a second, device voice');

check('Voice: capture silences the caddie before opening the mic (no self-record)',
  // 2026-06-16 (Tim — "did the speech leak into its mouth") — captureUtterance must
  // stopSpeaking() (both subsystems) BEFORE configureAudioForRecording, so the mic
  // never records the caddie talking over the user. Centralized for ALL callers; also
  // gives clean barge-in (tap mid-response stops the caddie and listens).
  // 2026-08-17 — the implementation moved into captureUtteranceDetailed (captureUtterance is now a
  // thin wrapper over it, so the ~17 transcript-only callers are unchanged). Anchor the guard to the
  // real implementation, and assert the wrapper DELEGATES — otherwise a future "fast path" in the
  // wrapper could open a mic that never silenced the caddie and this guard would still pass.
  (() => {
    const vs = read('services/voiceService.ts');
    return (
      /export const captureUtteranceDetailed =[\s\S]*?try \{ await stopSpeaking\(\); \} catch[\s\S]*?await configureAudioForRecording\(\)/.test(vs) &&
      /export const captureUtterance = async \([\s\S]*?captureUtteranceDetailed\(timeoutMs, apiUrl, language\)\)\.text/.test(vs)
    );
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

/**
 * 2026-08-23 (Tim's call) — INVERTED. This used to assert that FACTUAL asks answered on-device
 * without calling the brain, and it was the guard protecting the thing that had to go.
 *
 * The local-primary set included yardage and wind — the two questions a caddie exists to answer —
 * and answered them from services/localStatusResponder as a bare number, in no persona (2 persona
 * references across its 960 lines; offlineCaddie has zero). The caddie's own answer doctrine calls
 * that a failure: "It's 158 is something he could read off a screen; you are on the bag to convert
 * it into a decision." Hazard carries, learned tendencies, conditions and the club call were all
 * bypassed at the moment they mattered most.
 *
 * Tim: "everything is everything… the caddie is the person that knows everything, the brain, the
 * central nervous system. There should have been no way we went off reservation and started
 * creating separate paths."
 *
 * So the property is now the opposite: NO local path answers a question before the brain is asked.
 * The learned layer still reaches the caddie — as CONTEXT it reasons over, accumulated in the
 * background (services/caddieMemoryRetrieval → the one payload builder), which is where a learning
 * layer belongs. tryLocalReply survives only where the brain has already FAILED.
 */
check('No local path answers before the caddie is asked',
  (() => {
    const ls  = read('services/listeningSession.ts');
    const uvc = read('hooks/useVoiceCaddie.ts');
    const rtr = read('services/voiceCommandRouter.ts');
    // Strip comments — the notes above deliberately NAME the removed symbols, and matching prose
    // instead of code is how four guards in this repo went wrong. [[grep-guards-cant-see-dead-code]]
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const noPreBrainAnswer =
      !/tryLocalReply\(/.test(code(ls)) &&
      !/tryLocalReply\(/.test(code(uvc)) &&
      !/tryLocalReply\(/.test(code(rtr)) &&
      !/LOCAL_PRIMARY_TYPES/.test(code(ls));
    // The learned layer must still reach the brain, or this trade was a loss.
    const learnedStillReachesTheBrain =
      /getCaddieContext\(/.test(read('services/caddieRequestBody.ts')) &&
      /CNS_RETRIEVAL_ENABLED = true/.test(read('services/caddieMemoryRetrieval.ts'));
    // Commands may still route locally — routing a command is not answering a question.
    const commandRoutingKept = /precheckLocalIntent\(/.test(code(rtr));
    return noPreBrainAnswer && learnedStillReachesTheBrain && commandRoutingKept;
  })(),
  'every spoken QUESTION reaches the caddie; the learned layer arrives as context, not as an interceptor; command routing stays local');

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
      // 2026-08-23 — the local_primary decision point is GONE with the local-first intercept, so
      // there is no longer a "answered on-device instead of asking the caddie" event to count. What
      // the metric now measures is narrower and truer: a COMMAND matched by the regex precheck
      // (no classifier round-trip) versus one that needed the cloud classifier.
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

// 2026-08-07 (Tim — "beep when I tap to listen, ANOTHER sound when I tap again to confirm; caddie confirms
// it heard; tap-to-stop must be reliable in cart/wind noise"). LOCK the earbud endpoint semantics: a second
// tap WHILE LISTENING must END the utterance and SUBMIT it (endCaptureEarly → transcribe what was recorded)
// with a distinct "got it" earcon — NOT closeSession/stopCapture, which DISCARDED the audio ("didn't catch
// that"). The distinct tone + the spoken capture ack are the two confirmations Tim asked for.
check('Earbud tap-again ENDS + submits the utterance (not cancel), with a distinct confirm earcon',
  (() => {
    const ls = read('services/listeningSession.ts');
    // 2026-08-07 (regression audit) — the FIRST version of this guard only checked that the strings
    // existed; it could NOT see that the endpoint branch sat AFTER `if (sessionInFlight) return` and was
    // therefore DEAD (sessionInFlight is true all through 'listening'). This guard now asserts REACHABILITY:
    // the 'listening' endpoint handling must appear BEFORE the sessionInFlight guard, and be gated by the
    // open-echo window so the OPEN tap's own ~350ms second fire can't prematurely end the capture.
    const endpointIdx = ls.search(/if \(state === 'listening'\) \{[\s\S]*?endCaptureEarly\(\)/);
    // 2026-08-19 — the guard now acknowledges + logs the swallow before returning (a tap that vanishes
    // is what "I got ignored on the course" felt like), so match the bail however it returns rather
    // than pinning `return;`. REACHABILITY is the invariant this scenario exists for, not the syntax.
    // Match the STATEMENT, not the prose: a comment a few lines above quotes the old
    // `if (sessionInFlight) return` verbatim, so a loose pattern matches the explanation instead of
    // the code and reports the endpoint as unreachable. The live guard now opens a block.
    const inFlightGuardIdx = ls.search(/if \(sessionInFlight\) \{/);
    return (
      /LISTENING_EARCON[\s\S]*?tock\.mp3/.test(ls) &&
      /GOTIT_EARCON[\s\S]*?tick\.mp3/.test(ls) &&
      endpointIdx !== -1 && inFlightGuardIdx !== -1 &&
      endpointIdx < inFlightGuardIdx && // REACHABILITY: endpoint handled before the sessionInFlight bail
      /Date\.now\(\) - listeningStartedAt < LISTEN_ENDPOINT_MIN_MS/.test(ls) && // open-echo guard
      // 2026-08-08 — the confirm is now a VERBAL cue in the persona voice (Tozo T6 never heard the 200ms
      // tock); playVerbalCue keeps the earcon as its first-run fallback, so the audible confirm is intact.
      /playVerbalCue\('gotit', GOTIT_EARCON/.test(ls) &&
      /playVerbalCue\('listen', LISTENING_EARCON/.test(ls) &&
      /async function playVerbalCue/.test(ls) &&
      /resolveCachedOfflineClipUri/.test(ls) && // real persona-voice cache, not device TTS
      /import \{[^}]*endCaptureEarly[^}]*\} from '\.\/voiceService'/.test(ls)
    );
  })(),
  'tap-again endpoint is REACHABLE (before sessionInFlight guard), echo-guarded, submits + got-it earcon');

// 2026-08-07 (Tim — "how the fuck can we call it a caddie if the brain can't update based on
// conversation? … 'I hit 3 hybrid for that last shot' and shot info, brain, history, scorecard is
// updated"). LOCK the conversational shot CORRECTION path: a "for that last shot" + club utterance
// must AMEND the already-logged shot (editShot) — not append a duplicate (log_shot) and not just set
// the next club (club_change). Deterministic + offline via the precheck; every derived surface reads
// roundStore.shots so the single editShot updates scorecard/recap/bag/adherence.
check('Conversational "…for that last shot" CORRECTS the logged shot (editShot), not a duplicate',
  (() => {
    const h = read('services/intents/correctLastShotHandler.ts');
    const idx = read('services/intents/index.ts');
    const pre = read('services/localIntentPrecheck.ts');
    return (
      /intent_type:\s*'correct_last_shot'/.test(h) &&
      /round\.editShot\(/.test(h) &&
      /kevin_adhered/.test(h) && // adherence recomputed after the correction
      /registerHandler\(correctLastShotHandler\)/.test(idx) &&
      // precheck routes it deterministically, gated on BOTH a last-shot reference AND a club token
      /const refsLast =/.test(pre) && /const namesClub =/.test(pre) &&
      /intent\(t, 'correct_last_shot'/.test(pre)
    );
  })(),
  'brain updates the last shot from conversation (correct_last_shot → editShot); offline-deterministic');

// 2026-08-07 (Tim — "the hero card is basic as shit… no thumbnail, course info, description, add user
// history on that course. Pre-App-Store release, not a bullshit MVP"). LOCK the nearest-course hero as
// RICH: satellite thumbnail, rating/slope + location, the player's own record from roundHistory, and a
// one-tap Start. Guards against a regression back to a bare name+chevron row.
check('Play nearest-course hero is rich: thumbnail + course info + user history + Start',
  (() => {
    const p = read('app/(tabs)/play.tsx');
    return (
      /const heroCourse: CourseSummary \| null/.test(p) &&
      /const heroStats/.test(p) &&
      /roundHistory\.filter/.test(p) && // pulls the player's rounds at this course
      /Played \$\{heroStats\.rounds\}/.test(p) && // history line rendered
      /First time here/.test(p) && // honest empty state
      /<Image source=\{thumb\}/.test(p) && // real thumbnail
      /heroImageWrap/.test(p) && /heroStartBtn/.test(p)
    );
  })(),
  'nearest-course hero shows thumbnail, rating/slope, per-course history, and one-tap Start');

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
  // 2026-07-27 (full-app audit) — postability now keys off what the round ACTUALLY posted
  // (round.handicapHoles set by endRound's WHS engine), NOT holesPlayed, so the card can't show/post a
  // differential the engine refused (9-in-18-mode, pickup rounds, unknown par).
  (() => {
    const card = read('components/recap/HandicapImpactCard.tsx');
    return (
      /postedHoles: 9 \| 18 \| null = \(round\?\.handicapHoles === 9 \|\| round\?\.handicapHoles === 18\)/.test(card) &&
      /const isPostable = postedHoles != null && !round\?\.simulated/.test(card) &&
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

// 2026-07-24 (full-app audit, root A) — course dual-identity. Doral is a MULTI-COURSE resort
// (Blue Monster, Gold, Silver, Red, Great White); we only bundle GOLD. A bare 'doral' name match
// rendered GOLD hole imagery + centroid + calibration lines onto a "Doral Blue Monster" round —
// the wrong course shown as if it were the player's. Lock the gold-required guard on BOTH name
// resolvers so a non-Gold Doral degrades honestly (satellite / live-GPS tile, no wrong crop/lines).
// 2026-08-12 — Doral was PULLED from the bundled catalog (Tim's call). The dual-identity guard it
// used to need is moot: there is no Gold imagery, centroid or hole data left to inherit. What matters
// now is that the removal was COMPLETE — a half-removed course is how a stale centroid or an orphaned
// image map survives and resurfaces.
check('Doral fully removed from the bundled catalog (no orphaned centroid / imagery / holes)',
  !/doral-gold/.test(read('data/courses.ts')) &&
    !/doral-gold/.test(read('app/(tabs)/play.tsx')) &&
    !/'doral-gold'/.test(read('data/localCourseImages.ts')) &&
    !/DORAL_GOLD_HOLE_IMAGES/.test(read('data/localCourseImages.ts')) &&
    !/DORAL_GOLD_HOLES/.test(read('data/courses.ts')),
  'no source has Golden Palm hole GPS, so the course is out rather than rendered from a neighbouring course');

// 2026-07-27 (tester UX — wrong-course trap). Starting a round by voice for a course NOT in our
// bundle resolves through golfcourseapi, which returns MANY hits for a common name. The handler used
// to silently start at the FIRST → a tester lands on a namesake states away (wrong yardages hole 1).
check('Voice quick-round: ambiguous non-listed course asks which one (no silent wrong start)',
  (() => {
    const h = read('services/intents/quickRoundHandler.ts');
    return (
      /dedupeCourses\(/.test(h) &&        // collapse same club as multiple tees/nines
      /reals\.length > 1/.test(h) &&       // multiple DISTINCT matches → don't guess
      /ambiguous_course=/.test(h) &&
      /shortLoc\(/.test(h)                 // city named for the user (country trimmed)
    );
  })(),
  'a common course name that maps to several distinct golfcourseapi hits names the cities and asks which one, instead of silently starting the round at the first (possibly wrong) match');

// 2026-07-27 (tester UX — map honesty). An API-resolved course fetches GPS geometry async; a
// namesake we can't fully map would otherwise show blank distances with no explanation (reads as a
// broken app). The round-start flow now tells the player when mapping lands or when it couldn't.
check('Round start: a non-listed API course reports GPS mapping honestly (no silent blank distances)',
  (() => {
    const c = read('app/(tabs)/caddie.tsx');
    return (
      /const isApiCourse = !picked\.isLocal;/.test(c) &&
      /const hasMapping = !!geom && geom\.holes\.length > 0;/.test(c) &&
      /couldn't pull full GPS mapping/.test(c)
    );
  })(),
  'starting a round on a course resolved via golfcourseapi tells the player when GPS mapping lands (after a blank start) or that it could not be pulled — never blank distances with no explanation');

// 2026-07-27 (tester UX — multi-turn wrong-course fix). The ambiguous-course question now HOLDS the
// candidate list; the user's next utterance resolves against it directly instead of re-issuing the
// whole command or misrouting to the brain (which never had the list).
check('Voice quick-round: "which one?" answer resolves against the held candidate list (multi-turn)',
  (() => {
    const h = read('services/intents/quickRoundHandler.ts');
    const v = read('hooks/useVoiceCaddie.ts');
    const p = read('services/pendingDisambiguation.ts');
    return (
      /setPendingCourseChoices\(/.test(h) &&                                 // handler holds candidates
      /Which one — say the city or state, or "the first one"\?/.test(h) &&    // ends with ? → auto-opens mic
      /resolvePendingCourseUtterance\(/.test(v) &&                            // hook resolves the answer
      /export function matchCourseChoice/.test(p)                             // pure matcher exists
    );
  })(),
  'when the caddie asks which of several matching courses, the next utterance ("the New Jersey one") resolves against the held list and starts the round — no re-issuing the full command, no brain misroute');

// 2026-07-27 (audit fix — anti-hijack). The disambiguation resolver runs BEFORE classification, so it
// must never swallow a normal command or false-start a round from a stray token. Three guards:
check('Voice disambiguation: strict + fall-through — never swallows a command or false-starts a round',
  (() => {
    const p = read('services/pendingDisambiguation.ts');
    const v = read('hooks/useVoiceCaddie.ts');
    return (
      /function positionalIndex\(/.test(p) &&      // positional match only when the utterance is answer-shaped
      /if \(!choice\) return null;/.test(p) &&      // a non-match FALLS THROUGH (does not consume the utterance)
      /if \(source === 'manual'\)/.test(v)          // secondary resolver never fires on ambient VAD speech
    );
  })(),
  'a live 90s pending disambiguation cannot hijack an unrelated command ("what did I shoot on the LAST hole" / "give me 3 tips") or start a round from a playing partner\'s ambient speech — positional matching is answer-shaped, non-matches fall through, and the passive resolver is manual-capture only');

// 2026-07-27 (double-fire sweep). runStartRound is reachable from two effects + the setup modal, and
// startRound() unconditionally mints a roundId + incrementRounds(); an in-flight lock dedupes a
// concurrent double-fire without blocking a deliberate later start.
check('Round start: an in-flight lock drops a concurrent duplicate call (no double round-start)',
  (() => {
    const c = read('app/(tabs)/caddie.tsx');
    return (
      /const startRoundInFlightRef = useRef\(false\);/.test(c) &&
      /if \(startRoundInFlightRef\.current\) \{/.test(c) &&
      /startRoundInFlightRef\.current = true;/.test(c) &&
      /startRoundInFlightRef\.current = false;/.test(c) // released after startRound()
    );
  })(),
  'runStartRound dedupes a concurrent double-fire (two effects on the same entry) so incrementRounds / ghost / the round record never double-execute, while a deliberate later new-round start still proceeds');

// 2026-07-27 (tester UX round 2). Three one-screen dead-end/robotic fixes from the friction survey.
check('Play: opening a searched course shows loading + a retry hint (no silent dead-end)',
  (() => {
    const p = read('app/(tabs)/play.tsx');
    return (
      /setSelectError\(/.test(p) &&                 // failure path sets a user-facing hint
      /Opening course…/.test(p) &&                  // fresh-load feedback (card spinner only shows post-select)
      /!selectedLoading && selectError/.test(p)     // the hint is actually rendered
    );
  })(),
  'tapping a searched/API course that fails to open (network / null record) shows an "opening…" state then a retry hint, instead of the row silently doing nothing');

check('Play: an AI-identified course offers a scorecard-photo path (dead-end → playable)',
  (() => /Add it from a scorecard photo to play with yardages/.test(read('app/(tabs)/play.tsx')))(),
  "a tester whose home course isn't in the DB can add it from a scorecard photo right on the AI card, instead of only a 'visit/book' link");

check('TightLie: analysis failure shows a human caddie line, never a raw JS error',
  (() => {
    const l = read('app/lie-analysis.tsx');
    return (
      !/setErrorMessage\(e instanceof Error \? e\.message/.test(l) && // raw e.message leak removed
      /Never surface a raw JS error/.test(l) &&
      /Couldn't get a read/.test(l)                                   // warm caddie copy
    );
  })(),
  'a mid-request failure in TightLie (the caddie surface) shows a human line rather than "Network request failed" — north-star robotic-moment fix');

// 2026-07-27 (audit — honesty). SmartVision Live Strategy painted a confident green M/F/B yardage
// from an UNGATED GPS fix (bypassing yardageResolver's accuracy gate). Now gated at the source so a
// soft/stale fix degrades to null (card hides the row, brain prompt omits [GEOMETRY]).
check('SmartVision Live Strategy: player yardages gated on a good GPS fix (no confident number from a bad fix)',
  (() => {
    const u = read('services/unifiedVisionContext.ts');
    return (
      /const q = sf\.classifyAccuracy\(fix\.accuracy_m, fix\.timestamp\)/.test(u) &&
      /gpsTrustworthy = q\.level === 'strong' \|\| q\.level === 'moderate'/.test(u) &&
      /yardagesFromPlayer: gpsTrustworthy/.test(u) // null when the fix isn't trustworthy
    );
  })(),
  "the Live Strategy card + the brain prompt only show player-relative yardages when the GPS fix is ≤15m and fresh — a soft fix degrades to '—'/omitted instead of a confident green number (matches yardageResolver)");

// 2026-07-28 (audit Defect 2 — labeling). The Yardage Book measures every F/B from the TEE; without
// a qualifier a tester on their approach reads them as distances from where they stand.
check('SmartVision Yardage Book labels its reference point ("from tee")',
  (() => {
    const p = read('components/smartvision/YardageBookPanel.tsx');
    return (
      /originLabel = 'tee'/.test(p) &&       // defaults to the sole caller's origin (the tee)
      /from \{originLabel\}/.test(p)          // qualifier rendered under the title
    );
  })(),
  'the Yardage Book shows a "from tee" qualifier so tee-referenced hazard/green F/B yardages are not misread as from the player\'s current position mid-hole');

// 2026-07-28 (Tim) — the L4 green-chevron shortcut bar is removed (not needed anymore); the mic
// lives in CaddieBottomBar. Lock the removal so it can't silently return.
check('Caddie tab: the L4 green-chevron shortcut bar is removed',
  (() => {
    const c = read('app/(tabs)/caddie.tsx');
    return !/l4ActionsExpanded/.test(c) && /shortcut bar was REMOVED/.test(c);
  })(),
  'the floating green chevron shortcut bar (l4ActionsExpanded) is gone from the Caddie tab — its functions live in the bottom bar / floating reticle / map tap / Tools');

// 2026-07-28 (Tim — "plays-like numbers are jumbled"). The PLAYS delta is now a small inline span so
// "254 (+5)" stays on ONE line instead of wrapping and colliding with the header.
check('CaddieDataStrip: PLAYS "254 (+5)" stays on one line (small delta span, no wrap)',
  (() => {
    const d = read('components/CaddieDataStrip.tsx');
    return /cellDelta:/.test(d) && /adjustsFontSizeToFit/.test(d) && /minimumFontScale=\{0\.7\}/.test(d);
  })(),
  'the plays-like adjustment renders as a small green inline span and the value is single-line + auto-shrink, so it no longer wraps into a jumbled two-line stack');

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
    // (a2) 2026-08-01 (marquee audit findings 1 & 2) — the rebound is usually LOUDER (the net hit) and
    //      higher-confidence than the impact. Keep the EARLIEST (impact) time, not the louder net; and a
    //      loud rebound must NOT cascade and swallow the next real swing.
    const louderNet = filterReboundStrikes([mk(1000, -8, 'medium'), mk(1700, -4, 'high')]);
    const cascade = filterReboundStrikes([mk(1000, -8, 'medium'), mk(1800, -4, 'high'), mk(3400, -8, 'medium')]);
    const reboundHardOk =
      louderNet.length === 1 && louderNet[0].timeMs === 1000 &&               // impact kept, not the loud net
      cascade.length === 2 && cascade[0].timeMs === 1000 && cascade[1].timeMs === 3400; // 2nd swing survives
    // (b) merge separation scales with the coarse frame interval on long clips, but is CAPPED at 3.5s
    //     (detection root-cause #4) so a 120s clip's ~5s interval can't collapse two real ~4s-apart swings.
    const scaled = /mergeSwingDetections\(raw, Math\.min\(3\.5, Math\.max\(2\.5, frameIntervalSec\)\)\)/.test(read('services/poseDetection.ts'));
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
    return reboundsOk && reboundHardOk && scaled && tokenOk && anchorsOk && earliestOk;
  })(),
  'a net/floor rebound 0.5-2.5s after impact never becomes a phantom swing (even when the net hit is LOUDER than the strike), and a loud rebound never cascades to swallow the next real swing; long-clip locate merges at the real frame interval; an in-flight read can\'t poison the next session\'s cache (token + dedupe); the cage video fallback keeps the real acoustic strike; debounce keeps the earliest (impact) peak');

// ─── Detection root-cause LOCK (2026-07-30) — "swing needs to be found + segmented" ─────────────
check('Detection: swings FOUND + segmented right (root-cause fixes)',
  (() => {
    const mk = (timeMs: number, peakDb: number, confidence: 'high' | 'medium' | 'low') => ({ timeMs, peakDb, confidence, attackMs: 40 } as never);
    // #1 — a loud strike that PEGS the meter for 2 equal-dB samples still yields exactly one candidate
    //      (was silently dropped by the strict local-max). Functional check via detectStrikes.
    const STEP = 50, N = 60;
    const plateau: { timeMs: number; dB: number }[] = [];
    for (let i = 0; i < N; i++) {
      const t = i * STEP;
      let dB = -58;
      if (t === 1500 || t === 1550) dB = -10; // flat-topped peak: two equal-dB samples
      else if (t === 1600) dB = -50;
      plateau.push({ timeMs: t, dB });
    }
    const plateauRes = detectStrikes(plateau);
    const plateauOk = plateauRes.kind === 'ok' && plateauRes.strikes.length >= 1;
    // #3 — a real fast 2nd swing 1.6s after the first SURVIVES (was dropped by the 2000ms rebound window).
    const fast = filterReboundStrikes([mk(1000, -8, 'high'), mk(2600, -8, 'high')]);
    const fastOk = fast.length === 2;
    // source guards for #1 (flat-top allowed), #2 (recover gap widened), #4 (merge cap), #5 (backswing bias)
    const detSrc = read('services/swing/strikeDetector.ts');
    const segSrc = read('services/swing/swingSegmentation.ts');
    const srcOk =
      /if \(s\.dB < next\.dB\) continue;/.test(detSrc) &&              // #1 flat-top allowed
      /RECOVER_MIN_GAP_MS = 1500/.test(segSrc) &&                     // #2 recover gap = locate accuracy
      /minGapMs = 1500/.test(segSrc) &&                              // #3 fast-swing floor
      /BACKSWING_BIAS = 0\.35/.test(segSrc);                         // #5 window favors the backswing
    return plateauOk && fastOk && srcOk;
  })(),
  '#1 a flat-topped/clipped loud strike is no longer silently dropped (missed swing); #3 a real fast 2nd swing 1.6s apart survives the rebound filter; #2 phantom-recovery gap widened to the locator accuracy; #4 long-clip merge capped at 3.5s; #5 the segment window favors the backswing so the takeaway isn\'t clipped');

check('Round data-loss + GPS-resume + per-pillar persona (audit)',
  (() => {
    const rs = read('store/roundStore.ts');
    const layout = read('app/_layout.tsx');
    const play = read('app/(tabs)/play.tsx');
    return (
      // #1 — startRound preserves an active round to history before the reset (no silent wipe), and both
      //      Play "start a round" banners are gated on !isRoundActive.
      /prev\.isRoundActive && !prev\.isSimRound && prev\.currentRoundId !== roundId/.test(rs) &&
      /roundHistory: capHistory\(\[\.\.\.s\.roundHistory, preserved\]\)/.test(rs) &&
      (play.match(/!isRoundActive/g) ?? []).length >= 2 &&
      // #2 — a resumed real round restarts the GPS watch at boot (not tied to autoShotDetection).
      /resumed active round — restarted GPS watch/.test(layout) &&
      // C1 — the brain uses the ACTIVE (per-pillar) caddie, not the raw global.
      // 2026-08-23 — RE-AIMED: the per-pillar resolution moved from the retired pipecat context to
      // the ONE payload builder, where `persona` is getActiveCaddie() and the intensity dial is
      // resolved for that same caddie through brainSettings.
      /getActiveCaddie\(\);?\n?\s*\}, safe/.test(read('services/caddieRequestBody.ts')) &&
      // C2 — the live round's shots are excluded from the golfer model when it's a sim round.
      /round\.isSimRound \? \[\] : round\.shots/.test(read('services/golferModel.ts'))
    );
  })(),
  '#1 startRound preserves an in-progress round instead of wiping it + Play banners hidden mid-round (one-tap data loss); #2 a resumed real round restarts GPS at boot (was silent GPS-death when autoShotDetection off); C1 the brain speaks/sounds as the per-pillar active caddie; C2 a live sim round no longer contaminates the golfer model');

check('SmartMotion review opens PAUSED (no autoplay-vs-analysis crash)',
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    // Tim's crash repro: the review clip auto-played while the pose/ball/club extractors ran a native
    // retriever on the SAME file → SIGSEGV. Review now starts paused + re-pauses on every entry into review.
    return /useState\(true\); \/\/ review play\/pause — starts PAUSED/.test(sm) &&
      /if \(phase === 'review'\) setVideoPaused\(true\);/.test(sm);
  })(),
  'the SmartMotion review video starts PAUSED and re-pauses on every entry into review, so ExoPlayer never decodes the clip while the pose/ball/club extractors run a native retriever on it (the auto-play + simultaneous-analysis crash Tim reproduced)');

check('Multi-swing: EVERY swing gets its own persisted diagnosis + range recovers a cold locate',
  // 2026-08-01 (marquee-feature audit). Carve finding 1: the multi-swing narration loop analyzed
  // swings 1..N in memory but only swing 0 was persisted per-shot, so the saved reel showed swing 1
  // read and 2..N blank. Now each swing's analysis is written to ITS shot row. Severity 1: a cold
  // locate-Lambda returned [] and RANGE collapsed the whole session to one whole-clip swing — now it
  // retries the locate once when the first came up empty with no acoustic fallback.
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      // per-swing persist inside the narration loop (idx>0), mapping segment→shot, mirroring swing 0
      /if \(idx > 0\) \{[\s\S]*?setShotAnalysis\(sessionId, shotId, \{/.test(sm) &&
      /const shotIdx = Math\.max\(0, \(segs\[idx\]\?\.index \?\? idx \+ 1\) - 1\)/.test(sm) &&
      // range locate retry on a cold-Lambda empty return with no acoustic fallback
      /if \(swings\.length === 0 && acousticStrikes\.length === 0\) \{\s*\n\s*swings = await pose\.locateSwings/.test(sm)
    );
  })(),
  'a multi-swing OPEN reel lands in the library with EACH swing carrying its own fault read (not just swing 1), and a cold swing-locate no longer collapses a whole range session to a single whole-clip swing — it retries once');

check('SmartMotion: foam/no-ball mode (video-only) + range recovers a cleanly-heard missed swing',
  // 2026-08-01 (Tim — "turn off acoustic detection so you can analyze with no ball strike or foam
  // balls" + range under-count). Foam mode disables the metered audio track and segments off the video
  // locator (no strike needed), for smartmotion/drills/shot-shapes. Range recovers a HIGH-confidence
  // acoustic strike the video locator missed in your own frame so a partial vision read never
  // undercounts what was cleanly heard.
  (() => {
    const store = read('store/settingsStore.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    const seg = read('services/swing/swingSegmentation.ts');
    return (
      /foamBallMode: boolean/.test(store) && /setFoamBallMode:/.test(store) && /foamBallMode: false/.test(store) &&
      // metering forced off + segmentation forced to the video path when foam mode is on (off-round)
      /const foamOnStart = useSettingsStore\.getState\(\)\.foamBallMode && !roundActive/.test(sm) &&
      /const useMetering = foamOnStart\s*\n\s*\? false/.test(sm) &&
      /const stopMode = foamOnStop \? 'range' : rawStopMode/.test(sm) &&
      // range recovery of high-confidence unmatched strikes
      /recoverUnmatchedHighConf/.test(seg) && /if \(s\.confidence !== 'high'\) continue;/.test(seg) &&
      /recoverUnmatchedHighConf: true/.test(sm)
    );
  })(),
  'foam/no-ball mode reads swings from video alone (no metered audio, no strike required) across smartmotion + drills + shot shapes; and range recovers a cleanly-heard (high-confidence) swing the video locator missed, so it never undercounts below what was unambiguously heard while still rejecting quieter neighbours');

check('Library: a multi-swing reel is reviewable SWING-BY-SWING (own skeleton + numbers + arc)',
  // 2026-08-01 (Tim — per-swing breakdown follow-up). Per-shot biomech + clubhead arc are stored on the
  // SHOT (setShotBiomechanics/setShotClubArc), written per-swing at capture, and the library detail lets
  // you tap a swing in the reel to select it — the video window, skeleton, blue-club arc, and BODY
  // ANALYSIS numbers all follow. Non-primary swings backfill their biomech LAZILY (bounded to the swing
  // window). Shot 0 / single-swing view is unchanged (activeBiomech falls back to session-level).
  (() => {
    const store = read('store/cageStore.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    const detail = read('app/swinglab/swing/[swing_id].tsx');
    return (
      // per-shot storage + setters
      /biomechanics\?: import\('\.\.\/services\/poseAnalysisApi'\)\.SwingBiomechanics/.test(store) &&
      /setShotBiomechanics:/.test(store) && /setShotClubArc:/.test(store) &&
      // capture stores this swing's biomech on its shot
      /useCageStore\.getState\(\)\.setShotBiomechanics\(sessionId, shotId, bio\)/.test(sm) &&
      // detail: selection + active biomech + shot follows selection + lazy backfill (bounded window)
      /const \[selectedShotIdx, setSelectedShotIdx\] = useState\(0\)/.test(detail) &&
      /const shot = session\?\.shots\[selectedShotIdx\]/.test(detail) &&
      /const activeBiomech =/.test(detail) &&
      /if \(idx >= 0\) setSelectedShotIdx\(idx\)/.test(detail) &&
      /setShotBiomechanics\(swing_id, selShot\.id, biomech\)/.test(detail) &&
      /startMs: wStart, endMs: wEnd/.test(detail)
    );
  })(),
  'a multi-swing library reel is now reviewable one swing at a time — tap a swing and its own window, skeleton, blue-club arc, and Sway/Tilt/Posture/Weight numbers all show (computed lazily, bounded to that swing); the single-swing/primary view is unchanged');

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
      // 2026-08-22 — asserts the ENTRY POINTS, not the name of the inner call. Settings now goes
      // through the shared importSmartPumpWithFeedback, and the dashboard's TRAIN YOUR SWING card
      // does too: Tim went looking for the import on the card the training is about and it only
      // ever existed in Settings. Both must stay reachable, and neither may fork the messaging.
      /importSmartPumpWithFeedback/.test(read('services/smartPumpIngest.ts')) &&
      /importSmartPumpWithFeedback/.test(read('app/settings.tsx')) &&
      /importSmartPumpWithFeedback/.test(dash) &&
      /Import workouts from SmartPump/.test(dash) &&
      !/no_workouts_found/.test(dash) &&
      !/no_workouts_found/.test(read('app/settings.tsx')) &&
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
      // Saved report: a contact mishit / no-launch OVERRIDES the motion classification. 2026-08-05 — the
      // on-device pose read can commit the verdict first (fast/offline), so a contact mishit must STILL
      // force the overwrite even when the pose verdict already landed (chunk honesty wins over pose).
      /const contactPi = contactIssue\(contact\);/.test(smSrc) &&
      /const primaryIssue: PrimaryIssue = contactPi/.test(smSrc) &&
      /if \(contactPi \|\| poseVerdictSessionRef\.current !== sessionId\)/.test(smSrc) &&
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

// 2026-07-24 (full-app audit, root E) — the ball-departure duff read is computed LAZILY on
// the Motion step, AFTER the save-time write (which only carried the vision contact_read).
// So a ball-never-launched duff showed live but the SAVED report REOPENED CLEAN. Lock the
// write-back: when detectBallDeparture resolves a no-launch, it persists the duff onto BOTH
// the per-shot row (contact_read='fat') and the session headline — UPGRADE-ONLY.
check('Chunk honesty PERSISTS: a live-detected duff is written back so it never reopens clean',
  (
    // Guarded on the no-launch signal (ball present before, never departed).
    /accepted && accepted\.ball_present_before && !accepted\.departed/.test(smSrc) &&
    // Upgrade-only: skip if the shot already carries a named mishit (no clobber/downgrade).
    /const alreadyMishit = existingCr === 'fat' \|\| existingCr === 'thin' \|\| existingCr === 'topped'/.test(smSrc) &&
    /if \(persistShot && !alreadyMishit\)/.test(smSrc) &&
    // Per-shot row gets the duff strike so club-confidence + the library row honor it.
    /contact_read: 'fat'/.test(smSrc) &&
    // Session headline only UPGRADES a non-contact issue to the duff verdict.
    /!\(curIssueId && contactIssueIds\.includes\(curIssueId\)\)/.test(smSrc) &&
    /const duff = contactIssue\(\{ ballLaunched: false, reportedMishit: null \}\)/.test(smSrc)
  ),
  'the lazily-computed ball-departure duff is persisted onto the per-shot row + session report when it resolves, so reopening the swing shows the chunk instead of a clean read — and the write is upgrade-only so it never overwrites a named mishit or downgrades a real launch');

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
    // 2026-08-19 — the aim target is no longer drawn for a FULL SWING (Tim: "the target line probably
    // needs to be invisible"), so the rig keys off isPutt, not the camera angle. launchDir stays null:
    // the no-false-launch-line invariant this guard exists for is unchanged.
    /<CageTargetingOverlay ballArea=\{draftBall\} target=\{isPutt \? draftTarget : null\} launchDir=\{null\} targetKind=/.test(smSrc) &&
    // ...and the stance guides now render for PUTTING only. They existed to tell the player how to
    // stand for an angle they had to declare first; the angle is read off them now, not asked of them.
    /!isReview && isPutt\n\s*\? <CaptureGuides/.test(smSrc),
  'no false launch line in any mode (launchDir null); the aim guideline and stance guides are hidden for full swings and kept for putts');

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
      // 2026-07-24 (club-logic unification) — the driver check uses the NORMALIZED club so a voice
      // ('DR') / quick-log ('driver') drive is recognized (was `=== 'Driver'`, which missed them).
      /const driverYards = normClub === 'Driver' \? measuredCarry\(enriched\) : null/.test(store) &&
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
  // refreshed: store is at version 21 now (…v20 consent-split shareDiagnostics carry-forward, v21
  // default dark + high-contrast theme migration); the one-time version<12 localMode clear is still
  // present (migrations are cumulative), which is what this guards.
  /version: 21/.test(read('store/settingsStore.ts')) &&
    /if \(version < 12\)[\s\S]{0,160}p\.localMode = false/.test(read('store/settingsStore.ts')),
  'users trapped in auto-engaged Local Mode by the old breaker boot clean once');

check('Consent split: prior opt-out carries into shareDiagnostics (v20 privacy migration)',
  /if \(version < 20\)[\s\S]{0,220}shareCommunityData === false[\s\S]{0,90}shareDiagnostics = false/.test(read('store/settingsStore.ts')),
  'a tester who had community sharing OFF keeps their email+diagnostics auto-send OFF after upgrade (no silent PII re-enable)');

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
    // 2026-08-06 (Tim — "there should be ONE graph not multiple") — the three correlation cards collapsed
    // into a SINGLE PROGRESS graph: score-vs-par (outcome) with the chosen effort line overlaid.
    const dashOk =
      /PROGRESS/.test(dash) &&
      /computePracticeImpact\(\{/.test(dash) &&
      // one chart: score-vs-par primary (lower better) + the selected effort as an OVERLAY
      /data=\{activeProgress\.score\}/.test(dash) &&
      /overlay=\{\{ data: activeProgress\.effort/.test(dash) &&
      // 2026-08-22 — the outcome axis is per-SOURCE now (an owner-only Strike source plots strike
      // rate, where HIGHER is better). Pinning the literal `higherIsBetter={false}` asserted that
      // every source is judged like score-vs-par, which was never the property. What matters is that
      // the practice→score card still treats a LOWER score-vs-par as better, and that the chart binds
      // the per-source value rather than hardcoding one.
      /higherIsBetter=\{activeProgress\.scoreHigherIsBetter\}/.test(dash) &&
      /scoreLabel: 'SCORE VS PAR', scoreDeltaUnit: 'vs par', scoreHigherIsBetter: false/.test(dash) &&
      // source toggle across only the sources with data
      /progressSources\.map\(/.test(dash) && /setProgressSourceKey/.test(dash);
    // The graph self-labels (distinct legend colors + trend) and marks warm-up weeks on the practice line.
    const graphSmartOk =
      /warmupWeekIndices: number\[\]/.test(svc) &&                    // service surfaces warm-up weeks
      /warmupWeeks\.add\(WEEKS - 1 - ageWeeks\)/.test(svc) &&          // bucketed like practiceSeries
      /warmups: practiceHistory/.test(dash) &&                        // dashboard feeds warm-up sessions
      /markerIndices=\{activeProgress\.markers\}/.test(dash) &&        // warm-ups marked on the (overlay) practice line
      /markerLabel=\{activeProgress\.markers\.length \? 'warm-up' : undefined\}/.test(dash) &&
      /legendDotColor=/.test(dash) && /showTrend/.test(dash) &&        // self-labeling legend + trend
      /overlay\?: \{/.test(read('components/charts/TrendChart.tsx')); // one-graph overlay support
    return svcOk && dashOk && graphSmartOk;
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
      // 2026-08-22 — was pinned to this line's exact source text and went red when the cache-hit
      // condition gained `&& existing.lat != null`. The PROPERTY is that a known course is not
      // re-queried; the literal spelling of the condition is not the property. Asserted as a shape,
      // plus the coordinate behaviour that motivated the change: Places knows where the course is,
      // and dropping that left a course added on Wi-Fi with no geometry anchor until arrival.
      /if \(existing &&[^)]*existing\.website[^)]*existing\.phone/.test(cp) &&
      /existing\.lat != null/.test(cp) &&              // a book saved before coords existed re-queries once
      /lat,\s*\n\s*lng,/.test(cp) &&                   // and the coords are anchored into the book
      /fields=website,formatted_phone_number,geometry/.test(cph) &&  // asked for server-side
      /\blat: found\.lat\b/.test(cph) &&               // and returned to the client
      /getCourseBook\(courseId\)/.test(read('services/courseGeometryService.ts')) &&
      !/AIzaSy/.test(cp) &&                          // no hardcoded key in the client
      // server proxy holds the key + makes the Google Places calls, degrading cleanly
      /findplacefromtext\/json/.test(cph) &&
      /place\/details\/json/.test(cph) &&
      // 2026-07-10 — degrade on ANY non-OK Places status (not just REQUEST_DENIED), and read the
      // key that's ACTUALLY in Vercel — the handler used to read only GOOGLE_MAPS_KEY, which was
      // never set, so every lookup returned not_configured.
      /findData\.status !== 'OK'/.test(cph) &&
      // 2026-08-10 — that key read is now the MULTI-PROJECT walker rather than one pinned env var
      // (Tim has two Google Cloud projects with different APIs enabled). _googleKeys covers
      // GOOGLE_API_KEY among the others, so the original intent holds and strengthens: the lookup
      // lands on whichever project has Places enabled instead of failing on the wrong one.
      /withGoogleKeys<Found>\('places-legacy:findplace\+details'/.test(cph) &&
      /\bGOOGLE_API_KEY\b/.test(read('api/_googleKeys.ts'));
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

// 2026-06-14 (audit — perf) — the tap wrapper was defined INSIDE L1HolePreview's render, so every 4s
// dot-tick made a new component type and React remounted the whole subtree (hero Image reload +
// ParallaxTilt DeviceMotion re-subscribe). 2026-07-28 — renamed to HoleFrame and given fill+measure
// (onLayout) + centering so the box is fold-robust and aspect-locks curated art; still module-level.
check('Perf: L1HolePreview HoleFrame is module-level + fills/measures (no 4s remount cascade)',
  (() => {
    const prev = read('components/caddie/L1HolePreview.tsx');
    const defIdx = prev.search(/const HoleFrame: React\.FC</);
    const fnIdx = prev.search(/export default function L1HolePreview/);
    return (
      defIdx >= 0 && fnIdx >= 0 && defIdx < fnIdx &&                                  // module scope, before the component
      /<HoleFrame onPress=\{onOpenSmartVision\} onLayout=\{setMeasuredDims\}>/.test(prev) &&
      !/const SmartVisionTap:/.test(prev)                                             // old wrapper gone
    );
  })(),
  'the hole-preview tap wrapper is a stable module-level component that fills its parent and measures its real size, so the 4s GPS tick reconciles in place and the box is fold-robust');

// 2026-07-28 (Tim — "the larger element is off-center / containment isn't right"). The hole preview
// aspect-locks a curated 2:3 crop into a centered box (cover == contain) instead of the box taking the
// screen's aspect and cropping the baked-in yardage off — the same fix smartvision.tsx already uses.
check('L1HolePreview: hole art is aspect-locked to its OWN aspect + centered (contained, not cropped)',
  (() => {
    const p = read('components/caddie/L1HolePreview.tsx');
    return (
      /function imageAspect\(/.test(p) &&                              // per-image natural aspect (not hard-coded 1.5)
      /Image\.resolveAssetSource/.test(p) &&                           // read real bundled dims
      /function buildHoleBox\(aspect/.test(p) &&                       // fit-and-center to that aspect
      /alignItems: 'center',\s*\n\s*justifyContent: 'center'/.test(p)  // frame centers the locked box
    );
  })(),
  'a hole crop is fully contained + centered at ITS OWN aspect (our crops range 2:3 → 2.6:1 → 1:1), so nothing is cropped off; only a null-aspect captured aerial fills+covers');

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
// 2026-08-12 — the import now also pulls abortVoiceWarmup: a real turn RELEASES warmup connections
// instead of firing five more (which was saturating OkHttp's per-host limit and timing the user's own
// transcribe out on our budget — see __tests__/regression/warmup-must-not-starve-the-turn).
check('Voice warmup fires on voice-surface mount + app foreground (not just greeting)',
  /import \{ prewarmVoice, abortVoiceWarmup \} from '\.\.\/services\/voiceWarmup'/.test(vcWarmSrc) &&
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
    /await processTranscriptOverride\(transcript\)/.test(vcWarmSrc),
  "the 'Let me see...' bridge no longer fires before the reply (it conflicted with the now-fast brain that already opens conversationally); the conversational turn is handed straight to the pipecat brain (processTranscriptOverride) — the legacy /api/kevin fallthrough was deleted 2026-07-23");

// 2026-06-11 — Environment mode phase 1: range gets a longer window AND now keeps
// the metered track (acoustic candidates the video confirms). Course stays off.
const smEnvSrc = read('app/swinglab/smartmotion.tsx');
// 2026-08-08 (Tim — "on-course easy flow: course mode, DTL, ADJUSTED course acoustics") — COURSE now
// runs the metered track too, INCLUDING in-round: segmentation stays VIDEO-primary in course mode (wind
// can't invent a swing), acoustics are confirmatory (impact anchor + smash estimate); mic contention is
// handled by the earbud tap-stop + VAD gates. The old "course off" assertion locked the old behavior.
check('Environment mode phase 1: range window + metering gating (cage+range+course on; course video-primary)',
  /environmentMode: 'cage' \| 'range' \| 'course'/.test(read('store/settingsStore.ts')) &&
    /RANGE_RECORDING_MAX_SECONDS = 120/.test(smEnvSrc) &&
    /captureMode === 'range' \? RANGE_RECORDING_MAX_SECONDS : RECORDING_MAX_SECONDS/.test(smEnvSrc) &&
    /\? \(captureMode === 'cage' \|\| captureMode === 'course'\)/.test(smEnvSrc) &&                                  // chip: cage+course (in-round too)
    /: \(captureMode === 'cage' \|\| captureMode === 'range' \|\| captureMode === 'course'\)/.test(smEnvSrc) &&       // default: all three
    /const effectiveMode: 'cage' \| 'range' \| 'course' = isRoundActive \? 'course' : environmentMode/.test(smEnvSrc) && // live round forces COURSE
    /setEnvironmentMode\(environmentMode === 'cage'/.test(smEnvSrc),                  // toggle cycles modes
  'a live round forces COURSE mode with the metered acoustic track ON (video-primary segmentation, acoustics confirmatory) — the on-course easy-flow default');

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

// 2026-06-10 — Environment mode phase 3: course = single shot, and a live round forces course.
// 2026-08-08 (Tim — "adjusted course acoustics") — course now RUNS the metered track (in-round too);
// segmentation stays video-primary so wind can't invent a swing; acoustics are confirmatory.
check('Environment mode phase 3: course is video-primary single-shot with confirmatory acoustics; a live round forces course',
  /const effectiveMode.*isRoundActive \? 'course' : environmentMode/.test(smEnvSrc) &&           // round forces course (reactive)
    /isRoundActive[\s\S]{0,30}\? 'course'[\s\S]{0,60}environmentMode/.test(smEnvSrc) &&           // and at capture time
    /const useMetering = foamOnStart\s*\n\s*\? false\s*\n\s*: chipOnStart/.test(smEnvSrc) &&        // metering is foam/mode/chip-aware; foam forces off
    /captureMode === 'course'\)/.test(smEnvSrc) &&                                                  // course included in the metering set
    /disabled=\{isRoundActive\}/.test(smEnvSrc),                                                    // toggle locked during a round
  'course mode is single-shot video-primary WITH the metered acoustic track on (impact anchor + smash estimate); a live round forces course sensing; the practice toggle stays locked + shows CRSE on-course');

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
    // 2026-08-19 — the pipeline is still angle-aware; what changed is WHERE the angle comes from.
    // It used to be threaded down from a screen toggle the player could get wrong in daylight. Now the
    // caller passes null and the engine infers it from the swing's own frames, so assert exactly that:
    // the screen hands over nothing, and the engine's inference path is reachable.
    /computeBiomechanicsFromFrames\(frames, null/.test(smSrc) &&
    /angle = inferCameraAngle\(frames\);/.test(poseApiSrc) &&
    // ...and a confident disagreement still overrides an explicitly-supplied label (uploads, coach
    // lesson), which is the invariant that made the toggle redundant in the first place.
    /if \(inferred && inferred !== angle\) angle = inferred;/.test(poseApiSrc),
  'down-the-line nulls turn/weight/sequencing/hip-slide, face-on nulls the projected tilt, glasses nulls all angular reads; the angle is INFERRED from the frames rather than threaded from a toggle');

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

  // 2026-08-06 (audit cycle 5) — back-nine 9-hole rounds (tester Matt Abid). Lock the two anti-corruption
  // guards: (1) startRound falls a back-nine start back to the front nine when the course can't fit a full
  // nine from there (a 9-hole course has no back nine → phantom holes 10-17); (2) the "Which nine" pill is
  // gated on an 18-hole course; (3) the cockpit minus stepper floors on the round's first hole, not 1.
  const roundStoreSrcBN = fs.readFileSync(path.resolve(__dirname, '../../store/roundStore.ts'), 'utf-8');
  const caddieTabSrcBN = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf-8');
  const stepperSrcBN = fs.readFileSync(path.resolve(__dirname, '../../components/caddie/cockpit/StepperPair.tsx'), 'utf-8');
  check('Back nine: a short course cannot start a corrupt phantom-hole round',
    /options\.nineHole && startHoleResolved > 1 && startHoleResolved \+ 8 > nHoles/.test(roundStoreSrcBN) &&
      /getCourseHoleCount\(selectedPickedCourse\?\.id, 18\) >= 18/.test(caddieTabSrcBN) &&
      /onMinus=\{\(\) => onChangeHole\(Math\.max\(firstHole, holeNumber - 1\)\)\}/.test(stepperSrcBN),
    'a back-nine start with no full nine ahead falls back to the front nine (data-layer guard), the nine-picker pill only shows on an 18-hole course, and the cockpit stepper floors on the round first hole');

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

// ─── End-round: the save/discard choice is universal (crash regression) ─────────
// 2026-07-29 (Tim — "say/type 'end round' crashes; to end a round you HAVE to choose save or
// discard"). The voice/text end_round handler used to auto-save + navigate_replace straight to
// /recap/<id>, the ONE path that skipped the save/discard choice every on-screen path enforces — and
// that divergent immediate path crashed. These guards lock the single-source flow in place.
{
  const endFlowSrc = fs.readFileSync(path.resolve(__dirname, '../../services/round/endRoundFlow.ts'), 'utf-8');
  const endHandlerSrc = fs.readFileSync(path.resolve(__dirname, '../../services/intents/endRoundHandler.ts'), 'utf-8');
  const toolsMenuSrc = fs.readFileSync(path.resolve(__dirname, '../../components/tools/GlobalToolsMenu.tsx'), 'utf-8');

  // The shared flow offers Save AND Discard, and routes Save through feelings — never a
  // navigate_replace straight to the recap.
  check('End-round: shared flow presents Save AND Discard',
    /Save & end/.test(endFlowSrc) && /text: 'Discard'/.test(endFlowSrc) && /discardRound\(\)/.test(endFlowSrc),
    'endRoundFlow.promptEndRound offers Save & end + Discard (with a confirm), matching the on-screen choice');
  // NB: match real CODE tokens (`router.replace(`, `type: 'navigate_replace'`, `tool_action:`), not the
  // bare word — the comments in these files legitimately mention "navigate_replace" to explain the fix.
  check('End-round: shared flow routes Save through feelings → recap (no navigate_replace)',
    /\/recap\/feelings\?roundId=/.test(endFlowSrc) && !/router\.replace\s*\(/.test(endFlowSrc) && !/type:\s*'navigate_replace'/.test(endFlowSrc),
    'Save pushes /recap/feelings (which then pushes the recap); the flow never uses navigate_replace or router.replace to the recap');

  // The voice/text handler must DEFER to the shared prompt and emit NO tool_action (no auto-end, no
  // navigate_replace). This is the exact regression that crashed.
  check('End-round: voice/text handler defers to promptEndRound, emits no navigate_replace',
    /promptEndRound\(\)/.test(endHandlerSrc) &&
      !/tool_action:/.test(endHandlerSrc) &&
      !/\.endRound\(\)/.test(endHandlerSrc),
    'endRoundHandler calls promptEndRound() and returns no tool_action / navigate_replace and never calls endRound() itself — the crashing auto-save-and-jump path is gone');

  // Single source of truth: the Tools menu uses the same flow, not an inline copy.
  check('End-round: Tools menu uses the shared promptEndRound (single source)',
    /promptEndRound\(\)/.test(toolsMenuSrc) && !/Save the scorecard to your history/.test(toolsMenuSrc),
    'GlobalToolsMenu.endRoundAction delegates to promptEndRound — the ~70-line inline Alert copy is gone');

  // No end path anywhere navigates_replace to a bare /recap/<id> at end-of-round (that was the crash
  // vector). navigate_replace to /recap/... must not be constructed by any end-round caller.
  const endCallers = [endFlowSrc, endHandlerSrc, toolsMenuSrc].join('\n');
  check('End-round: no end path builds navigate_replace to /recap/<id>',
    !/type:\s*'navigate_replace'/.test(endCallers) && !/router\.replace\s*\([^)]*recap/.test(endCallers),
    'none of the end-round entry points emit a navigate_replace targeting the recap route');
}

// ─── App knowledge & tools (current catalog + the 2026-07 upgrades) ─────────────
// 2026-07-29 (Tim — "add scenarios to the sims/harness for the tools + upgrades that exist now").
// The caddie's app awareness (catalog + capabilities + how-tos + what's-new) and the token gate that
// keeps them off every voice turn are all recent and were UNGUARDED by the harness. These lock them in.
{
  // ── Catalog integrity: every feature is fully populated + uniquely id'd. ──
  const badFeature = APP_FEATURES.filter(f =>
    !f.id || !f.name || !f.route || !f.blurb || !f.whenToUse || !f.category ||
    !Array.isArray(f.aliases) || f.aliases.length === 0 || !f.route.startsWith('/'));
  check('App catalog: every feature fully populated (id/name/route/blurb/whenToUse/aliases)',
    badFeature.length === 0,
    badFeature.length === 0 ? `${APP_FEATURES.length} features, all complete` : `INCOMPLETE: ${badFeature.map(f => f.id || '(no id)').join(', ')}`);
  const catIds = APP_FEATURES.map(f => f.id);
  const dupCatIds = catIds.filter((id, i) => catIds.indexOf(id) !== i);
  check('App catalog: feature ids are unique', dupCatIds.length === 0,
    dupCatIds.length === 0 ? 'no dup ids' : `DUP ids: ${[...new Set(dupCatIds)].join(', ')}`);

  // ── Every route resolves to a REAL app/ screen (dead-route guard). ──
  const routeExists = (route: string): boolean => {
    const rel = route.replace(/^\//, '');
    return [`app/${rel}.tsx`, `app/${rel}.ts`, `app/${rel}/index.tsx`, `app/${rel}/index.ts`]
      .some(c => fs.existsSync(path.resolve(__dirname, '../../', c)));
  };
  const deadRoutes = APP_FEATURES.filter(f => !routeExists(f.route)).map(f => `${f.id}→${f.route}`);
  check('App catalog: every feature route resolves to a real app/ screen',
    deadRoutes.length === 0,
    deadRoutes.length === 0 ? `all ${APP_FEATURES.length} routes exist` : `DEAD ROUTES: ${deadRoutes.join(', ')}`);

  // ── lookupFeature resolves representative spoken names to the right screen. ──
  const lookups: Array<[string, string]> = [
    ['open smart tempo', '/swinglab/smart-tempo'],
    ['import my arccos numbers', '/arccos-import'],
    ['shot shapes', '/practice/shot-shapes'],
    ['setup check', '/swinglab/setup-check'],
    ['open smartvision', '/smartvision'],
    ['scan my bag', '/bag-scan'],
  ];
  const badLookups = lookups.filter(([say, route]) => lookupFeature(say)?.route !== route)
    .map(([say]) => `"${say}"→${lookupFeature(say)?.route ?? 'null'}`);
  check('App catalog: lookupFeature routes spoken tool names to the right screen',
    badLookups.length === 0,
    badLookups.length === 0 ? `${lookups.length} names routed` : `MISROUTED: ${badLookups.join(', ')}`);

  // ── isAppHelpQuery: gates the heavy repertoire+how-tos onto app-help turns ONLY. ──
  const HELP_YES = [
    'how do I record my swing', 'what can you do', "what's new", 'where is the tempo drill',
    'how do I import my arccos numbers', 'what features do you have', 'walk me through setup check',
  ];
  const HELP_NO = [
    "what's the play on 7", 'log a 7 iron', 'how far to the pin', 'I hit it in the water',
    'read this putt', 'give me a club', 'I made a birdie',
  ];
  const helpMissed = HELP_YES.filter(t => !isAppHelpQuery(t));
  const helpFalsePos = HELP_NO.filter(t => isAppHelpQuery(t));
  check('App help gate: app-questions are recognized (isAppHelpQuery true)',
    helpMissed.length === 0, helpMissed.length === 0 ? `all ${HELP_YES.length} recognized` : `MISSED: ${helpMissed.join(' | ')}`);
  check('App help gate: normal golf turns are NOT flagged as app-help (no false positives)',
    helpFalsePos.length === 0, helpFalsePos.length === 0 ? `all ${HELP_NO.length} passed through` : `FALSE POS: ${helpFalsePos.join(' | ')}`);

  // ── Both brains gate capabilities+how-tos behind the help query (Tim's voice-path concern). ──
  const pipecatSrc = fs.readFileSync(path.resolve(__dirname, '../../api/pipecat-turn.ts'), 'utf-8');
  const kevinApiSrc = fs.readFileSync(path.resolve(__dirname, '../../api/kevin.ts'), 'utf-8');
  for (const [label, src] of [['pipecat-turn', pipecatSrc], ['kevin', kevinApiSrc]] as const) {
    check(`App help gate: ${label} injects capabilities/how-tos only when isAppHelpQuery`,
      /isAppHelpQuery\(/.test(src) && /appHelp \? /.test(src) && /catalogForPrompt\(\)/.test(src),
      'the lean catalog is always-on (navigate needs it) but capabilitiesForPrompt/howToForPrompt are behind the appHelp gate');
    // The changelog is UI-only — it must NOT be injected into the brain prompt (bloats every turn).
    check(`App help gate: ${label} does NOT inject the What's-New changelog into the prompt`,
      !/whatsNewForPrompt/.test(src),
      'whatsNewForPrompt is gone from the brain prompt — the changelog lives in Tools → What\'s New only');
  }

  // ── What's New changelog: populated, user-facing, single-source. ──
  const badWhatsNew = WHATS_NEW.filter(e => !e.when || !e.note || e.note.length < 10);
  check("What's New: changelog is populated with user-facing entries",
    WHATS_NEW.length > 0 && badWhatsNew.length === 0,
    badWhatsNew.length === 0 ? `${WHATS_NEW.length} entries` : `BAD: ${badWhatsNew.length}`);
  const jargon = WHATS_NEW.filter(e => /\.tsx?\b|api\/|services\/|store\/|useState|zustand/.test(e.note));
  check("What's New: entries are player-facing (no file names / code jargon)",
    jargon.length === 0, jargon.length === 0 ? 'all clean' : `JARGON in ${jargon.length} entries`);
  const whatsNewScreenSrc = fs.readFileSync(path.resolve(__dirname, '../../app/whats-new.tsx'), 'utf-8');
  const whatsNewStoreSrc = fs.readFileSync(path.resolve(__dirname, '../../store/whatsNewStore.ts'), 'utf-8');
  check("What's New: screen + badge store both read the one WHATS_NEW source",
    /WHATS_NEW/.test(whatsNewScreenSrc) && /WHATS_NEW/.test(whatsNewStoreSrc) && /unseenWhatsNewCount/.test(whatsNewStoreSrc),
    'app/whats-new.tsx renders WHATS_NEW and store/whatsNewStore exposes unseenWhatsNewCount off the same array');

  // ── Arccos import upgrade is fully wired (api + service + screen + catalog entry). ──
  const arccosFiles = ['api/arccos-import.ts', 'services/arccosImport.ts', 'app/arccos-import.tsx']
    .filter(f => !fs.existsSync(path.resolve(__dirname, '../../', f)));
  const hasArccosFeature = APP_FEATURES.some(f => f.route === '/arccos-import');
  check('Arccos import: api + service + screen + catalog entry all present',
    arccosFiles.length === 0 && hasArccosFeature,
    arccosFiles.length === 0 ? 'api/arccos-import + services/arccosImport + app/arccos-import + catalog entry' : `MISSING: ${arccosFiles.join(', ')}`);
}

// ─── LOCKED STATE (Tim 2026-07-29 — "layout is BEAUTIFUL, lock positions/theme, no regressions;
// first voice must fire; keep the tap haptic") — these guard the invariants Tim signed off on so a
// future edit trips the harness instead of silently regressing the look or the first-turn voice.
{
  // 1) DEFAULT THEME = dark + high contrast, with the v21 migration for existing testers.
  const settingsSrc = fs.readFileSync(path.resolve(__dirname, '../../store/settingsStore.ts'), 'utf-8');
  check('LOCK theme: default is dark + high contrast',
    /theme_preference:\s*'dark' as const/.test(settingsSrc) && /highContrast:\s*true/.test(settingsSrc),
    'settingsStore ships theme_preference=dark + highContrast=true as the default state');
  check('LOCK theme: v21 migrates existing "system" testers to dark + high contrast',
    /version:\s*21/.test(settingsSrc) && /version < 21/.test(settingsSrc) && /p\.theme_preference = 'dark'/.test(settingsSrc),
    'persist bumped to v21 and migrates a never-customized (system-default) install to dark + high contrast');
  const themeCtxSrc = fs.readFileSync(path.resolve(__dirname, '../../contexts/ThemeContext.tsx'), 'utf-8');
  check('LOCK theme: dark is the resolved fallback in ThemeContext',
    /darkTheme/.test(themeCtxSrc) && /highContrast/.test(themeCtxSrc),
    'ThemeContext resolves darkTheme by default and wires highContrast through');

  // 2) TOOLS PILL pinned to the upper-right corner on the Caddie tab (was dropped into the data zone).
  const caddieSrc = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf-8');
  check('LOCK layout: Caddie tools pill sits in the upper-right corner (marginTop 0, not dropped)',
    /just inside the upper-right corner/.test(caddieSrc) &&
      /flexDirection: 'row', gap: 6, marginTop: 0 \}\}>/.test(caddieSrc),
    'the tools-pill row is flush with the back chevron (marginTop: 0) so it never overlaps the SmartVision data');

  // 3) FIRST-VOICE cold invariants — the first turn must land, never fast-fail on a slow cold handshake.
  const vcSrc = fs.readFileSync(path.resolve(__dirname, '../../hooks/useVoiceCaddie.ts'), 'utf-8');
  // 2026-08-20 — these assert the BUDGET RULE, not which boolean carries it. Warmth is now tracked
  // per Lambda (kevin answering says nothing about transcribe being awake), which is the fix for
  // "fails the first time"; the invariant that a COLD transcribe gets the long budget is unchanged.
  check('LOCK voice: no single transcribe attempt may exceed the cold ceiling',
    (() => {
      // 2026-08-21 — was "cold first-turn gets the long 22s budget", which pinned exactly the
      // single long bet that made a hung socket cost the whole turn. The ceiling still matters as a
      // BOUND; what changed is that no one attempt is allowed to spend it.
      const ceiling = /const COLD_TRANSCRIBE_TIMEOUT_MS = (\d+);/.exec(vcSrc);
      const budgets = /const attemptBudgets = coldFirstTurn \? \[([\d_,\s]+)\]/.exec(vcSrc);
      if (!ceiling || !budgets) return false;
      const max = Math.max(...budgets[1].split(',').map(x => Number(x.replace(/_/g, '').trim())));
      return max < Number(ceiling[1]) && /const coldFirstTurn = !isEndpointWarmed\('\/api\/transcribe'\)/.test(vcSrc);
    })(),
    'every individual transcribe attempt stays under the cold ceiling, so a hung socket costs one short attempt instead of the entire turn');
  // 2026-08-20 — the "cold abort ONLY when both probes ACTIVELY fail" LOCK was deleted here, not
  // relaxed. It pinned the discriminator that decided WHEN a probe may cancel a live upload; the
  // field log proved no probe may. Its replacement is the deadline guard above plus
  // 'LOCK: nothing but the real request may decide the real request failed'.
  check('LOCK voice: markConnectionWarmed after a successful transcribe (fast path thereafter)',
    /markEndpointWarmed\('\/api\/transcribe'\)/.test(vcSrc),
    'a successful cloud transcribe flips the warmed flag so subsequent turns take the fast path');
  const lsSrc = fs.readFileSync(path.resolve(__dirname, '../../services/listeningSession.ts'), 'utf-8');
  check('LOCK voice: the earbud classify races a hedge — a 22s wait is not "cold-aware"',
    /const CLASSIFY_HEDGE_MS = 2_500;/.test(lsSrc) && /Promise\.any\(\[primary, hedged\]\)/.test(lsSrc),
    'the intent classify opens a second connection after 2.5s rather than betting 22 seconds on the first — the old guard asserted that 22s wait as if it were the feature, and it was the hang');
  const vsSrc = fs.readFileSync(path.resolve(__dirname, '../../services/voiceService.ts'), 'utf-8');
  check('LOCK voice: the earbud transcribe races a hedge instead of waiting out a hung socket',
    /const raceOnce = async \(budgetMs: number\)/.test(vsSrc) && /Promise\.any\(\[primary, hedged\]\)/.test(vsSrc)
      && !/doFetch\(25_000\)/.test(vsSrc),
    'captureUtterance opens a second connection after 2.5s and takes the first answer — the 25s single-shot it replaced made the earbud the SLOWEST entry point, not the safest');

  // 4) TRIGGER HAPTIC — every talk trigger (earbud/glasses tap, mic badge) buzzes on open (feel it's on).
  // 2026-08-11 — the trigger edge moved. 'listening' is now reached ~1s after the tap (we hold
  // 'opening' through the awaited verbal cue rather than claiming to listen while the mic is shut),
  // so a haptic keyed to entering 'listening' would fire a second late and the TAP would feel dead.
  // The guard now asserts the stronger property: the buzz fires on the idle → open edge, whichever
  // state that is, and cannot double-fire on the opening → listening hop.
  check('LOCK haptic: a talk trigger fires a haptic AT THE TAP, not when the mic finally opens',
    /prev === 'idle' && \(next === 'opening' \|\| next === 'listening'\)/.test(lsSrc) && /impactAsync\(H\.ImpactFeedbackStyle\.Medium\)/.test(lsSrc),
    'setSessionStateMirror fires a Medium impact on the idle→open edge — one chokepoint covers earbud/glasses tap + mic badge');

  // 2026-08-11 (Tim — "when I tap to talk, the first message gets cut off"). The mic is provably
  // closed during the awaited verbal cue (it is awaited so the cue cannot be self-recorded), so
  // announcing 'listening' before it invited him to speak into a dead mic.
  check('LOCK voice: the session does not claim to listen until the mic is about to capture',
    (() => {
      const open = lsSrc.indexOf('async function openSession()');
      const body = lsSrc.slice(open, lsSrc.indexOf('function closeSession()', open));
      const cue = body.indexOf("playVerbalCue('listen'");
      const listening = body.indexOf("setSessionStateMirror('listening')");
      const capture = body.indexOf('capture_start');
      return cue > -1 && listening > cue && capture > listening && /if \(state !== 'opening'\) return;/.test(body);
    })(),
    'openSession holds "opening" through the awaited go-ahead cue and flips to listening immediately before capture');

  // Tim: "she ends with something like what's on your mind today, but doesn't listen."
  check('LOCK voice: a caddie question reopens the mic for the answer, bounded',
    /auto_reopen_after_question/.test(lsSrc) &&
    /finalLine !== spokenLineAtOpen/.test(lsSrc) &&
    /autoReopenChain < MAX_AUTO_REOPENS/.test(lsSrc),
    'a reply ending in a question re-arms the mic instead of making the user tap to answer it — capped so an unanswered loop cannot hold the mic');
}

// ─── Watch companion wiring (Tim 2026-07-29: watch WORKS; "wired optimally?" + connected indicator) ──
{
  const swingBr = fs.readFileSync(path.resolve(__dirname, '../../services/watchSwingBridge.ts'), 'utf-8');
  const caddieBr = fs.readFileSync(path.resolve(__dirname, '../../services/watchCaddieBridge.ts'), 'utf-8');
  const layout = fs.readFileSync(path.resolve(__dirname, '../../app/_layout.tsx'), 'utf-8');
  const metrics = fs.readFileSync(path.resolve(__dirname, '../../services/swingMetricsService.ts'), 'utf-8');

  // Both bridges start at boot (not only from the Settings toggle) so the watch works out of the box.
  check('Watch: both bridges initialize at app boot',
    /initWatchSwingBridge\(\)/.test(layout) && /initWatchCaddieBridge\(\)/.test(layout),
    'app/_layout.tsx starts the swing + caddie bridges on launch (gated on native availability)');

  // Connected indicator no longer depends solely on the watch's launch-time hello: ANY inbound
  // message (swing/voice/tap) refreshes the connected flag, so the Settings row reflects reality.
  check('Watch: connected flag refreshes on any inbound message (not just launch hello)',
    /setConnected\(true, 'Galaxy Watch'\)/.test(swingBr) &&
      /markWatchAlive\(\)/.test(caddieBr) && /setConnected\(true, 'Galaxy Watch'\)/.test(caddieBr),
    'onWatchSwing + onWatchVoice/onWatchTap all mark the watch connected — an already-running watch (missed hello) still shows connected once any message flows');

  // Swing CALIBRATION: the wrist IMU summary feeds real metrics at truth-grade 'watch'.
  check('Watch: swing IMU maps into recordSwing (tempo + club-head speed)',
    /onWatchSwing/.test(swingBr) && /recordSwing\(/.test(swingBr) && /clubHeadSpeedEst/.test(swingBr) && /tempoRatio/.test(swingBr),
    'each watch swing (backswing/downswing/tempoRatio/peakWristSpeed/clubHeadSpeedEst) maps into watchStore.recordSwing');

  // Club tagging: a watch swing is tagged with the app's SELECTED club (cage live club → last tagged),
  // normalized to the canonical name so it merges with the Arccos-fed bag — NOT hardcoded 'unknown'.
  check('Watch: swings tag the selected club (normalized), not a hardcoded unknown',
    /const club = resolveSelectedClub\(\)/.test(swingBr) &&
      /useClubSelectionStore/.test(swingBr) && /useCageStore/.test(swingBr) && /normalizeClub\(/.test(swingBr) &&
      /\bclub,/.test(swingBr) && !/club: 'unknown',/.test(swingBr),
    'onWatchSwing tags club via resolveSelectedClub (cage currentClub → clubSelectionStore.lastClub → normalized), so watch speed/tempo lands on the same per-club profile as Arccos carries');
  check("Watch: club speed from the watch is a truth-grade 'watch' source",
    /source: 'watch'/.test(metrics) && /'watch'/.test(metrics),
    'swingMetricsService promotes the Galaxy Watch IMU peak-wrist-speed to the truth-grade watch tier (not a guess)');

  // Drill feedback: after a captured swing, the phone pushes a per-swing readout back to the watch
  // (swipeable metric cards). Payload is club-tagged + normalized here so the wrist shows what the
  // phone logs.
  const bridge = fs.readFileSync(path.resolve(__dirname, '../../services/watchBridge.ts'), 'utf-8');
  check('Watch: drill swing-feedback push exists (phone → watch)',
    /kind: 'swing_feedback'/.test(bridge) && /export async function sendSwingFeedback/.test(bridge) &&
      /sendSwingFeedback\(/.test(swingBr),
    'watchBridge exposes sendSwingFeedback and watchSwingBridge fires it after each captured swing (tempo/clubSpeed/transition/back-down/club)');

  // Lead/trail: a persistent wrist setting (default lead, toggle to trail) tags every swing + drives a
  // per-wrist interpretation. The wrist tag flows into recordSwing + the feedback push.
  check('Watch: wrist setting exists (default lead) + tags every swing',
    /watchWrist: 'lead' as const/.test(settingsSrc) && /wrist\?: 'lead' \| 'trail'/.test(fs.readFileSync(path.resolve(__dirname, '../../store/watchStore.ts'), 'utf-8')) &&
      /watchWrist \?\? 'lead'/.test(swingBr) && /\bwrist,/.test(swingBr),
    'settingsStore.watchWrist defaults lead; watchStore SwingMetrics carries wrist; watchSwingBridge tags each swing + feedback with it');
  // Interpretation is honest + wrist-aware: TRAIL wrist surfaces casting/early-release; club-speed
  // confidence is lower on the trail wrist (rougher proxy).
  const trailEarly = interpretWristSwing({ wrist: 'trail', tempoGood: false, transitionDetected: true, earlyTransition: true });
  const leadSmooth = interpretWristSwing({ wrist: 'lead', tempoGood: true, transitionDetected: true, earlyTransition: false });
  check('Watch lead/trail: trail-wrist early transition reads as an early release / cast (hedged)',
    trailEarly.faultHint != null && /release|lag/i.test(trailEarly.faultHint) && trailEarly.clubSpeedConfidence === 'rough',
    `trail+early → "${trailEarly.faultHint}" (confidence ${trailEarly.clubSpeedConfidence})`);
  check('Watch lead/trail: lead wrist is the cleaner club-speed proxy',
    leadSmooth.clubSpeedConfidence === 'estimate',
    `lead confidence = ${leadSmooth.clubSpeedConfidence} (vs trail 'rough')`);

  // Per-axis RAW capture (for a future calibrated casting/face model — captured, NOT interpreted).
  const watchStoreSrc = fs.readFileSync(path.resolve(__dirname, '../../store/watchStore.ts'), 'utf-8');
  const nativeMod = fs.readFileSync(path.resolve(__dirname, '../../android-native/WearSwingBridgeModule.kt'), 'utf-8');
  check('Watch per-axis: capture flows watch → native → JS store (raw, in-memory only)',
    /axisCapture\?:/.test(watchStoreSrc) && /peakGyro/.test(watchStoreSrc) &&        // store field
      /peakGyro\?:/.test(swingBr) && /axisCapture:/.test(swingBr) &&                  // bridge maps it
      /putMap\("peakGyro"/.test(nativeMod) && /downswingProfile/.test(nativeMod),    // native forwards it
    'the raw per-axis release signature (peakGyro/impactAccel/downswing profile) is captured on the watch, forwarded by the native module, and stored in the in-memory session — never interpreted (no fabricated fault)');
}

// ─── Custom caddie: photo → OpenAI voice (Tim 2026-07-30) ───────────────────────
{
  const profileSrc = fs.readFileSync(path.resolve(__dirname, '../../store/playerProfileStore.ts'), 'utf-8');
  const voiceApiSrc = fs.readFileSync(path.resolve(__dirname, '../../api/voice.ts'), 'utf-8');
  const voiceSvcSrc = fs.readFileSync(path.resolve(__dirname, '../../services/voiceService.ts'), 'utf-8');
  const vercelSrc = fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf-8');
  const endpointExists = fs.existsSync(path.resolve(__dirname, '../../api/caddie-voice.ts'));
  const matchExists = fs.existsSync(path.resolve(__dirname, '../../services/caddieVoiceMatch.ts'));

  check('Custom caddie voice: stored + settable on the profile',
    /customCaddieVoice: string \| null/.test(profileSrc) && /setCustomCaddieVoice:/.test(profileSrc),
    'playerProfileStore carries customCaddieVoice + setCustomCaddieVoice');
  check('Custom caddie voice: the caddie SPEAKS in it (voiceService → /api/voice voice override, validated)',
    /customVoice/.test(voiceSvcSrc) && /voice: customVoice/.test(voiceSvcSrc) &&
      /VALID_OPENAI_VOICES/.test(voiceApiSrc) && /requestedVoice/.test(voiceApiSrc),
    'voiceService passes the custom voice; /api/voice honors it only if it is a valid OpenAI voice');
  check('Custom caddie voice: photo→voice endpoint exists + is allowlisted in vercel.json',
    endpointExists && matchExists && /api\/caddie-voice\.ts/.test(vercelSrc) && /\/api\/caddie-voice/.test(vercelSrc),
    'api/caddie-voice + services/caddieVoiceMatch exist and the route is in the vercel.json build + routes allowlist');
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
    // 2026-08-10 — the call now also passes measuredEvidence (4th arg) so the tile can't contradict
    // the on-device numbers. This guard is about the PHASE GATING, so it no longer pins the exact
    // arity — only that the terminal-vs-in-flight distinction is still driven by `phase`.
    /return deriveVerdict\(analysis, phase === 'analyzing', swingContact/.test(smSrc2) &&
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
    // 2026-08-19 (Tim — "we're still missing the shot maps"). The page used to be gated on the camera
    // ANGLE as well, so a swing filmed down-the-line but mislabelled face-on by a stale toggle lost the
    // whole page silently — down to the pager rendering two dots instead of three. Only the LATERAL
    // half of this map needs a DTL view (left/right comes from the ball trace); downrange carry comes
    // from effort + club, which the camera position has nothing to do with. Putts still have no map.
    /const showShotMap = !isPutt;/.test(smSrc2) &&
      !/showShotMap = !isPutt && angle/.test(smSrc2) &&
      /const pageCount = showShotMap \? 3 : 2/.test(smSrc2) &&
      /\{shotMapPage\}/.test(smSrc2) &&
      /Array\.from\(\{ length: pageCount \}\)/.test(smSrc2) &&            // dots are dynamic
      /cageCanvasFeet: number/.test(read('store/settingsStore.ts')) &&    // confirmed geometry persisted
      /cameraBehindFeet: s\.cameraBehindFeet/.test(read('store/settingsStore.ts')) &&
      // honest: course marker only when an effort-carry estimate exists; cage impact is preview-labeled.
      /const has = estCarry != null;/.test(read('components/smartmotion/ShotMapPage.tsx')) &&
      /est · preview/.test(read('components/smartmotion/ShotMapPage.tsx')),
    'page 3 is a shot map for every full swing (never gated on a camera-angle label): course plots from real effort→carry + trace; cage shows a bullseye + confirmable canvas/camera distances; no fabricated positions (empty until a real read)');

  check('SmartMotion spine fixes: thumbnails, ball-speed honesty, feel-on-save (2026-06-12)',
    // Every library card gets a thumbnail — fall back past the analysis fault frame to a
    // lazily-generated frame screenshot, persisted on the session.
    /thumbnail_uri: primaryThumb \?\? perShotThumb \?\? session\.fault_frame_uri \?\? session\.thumbnailUri \?\? null/.test(read('services/swingLibrary.ts')) &&
      /setSessionThumbnail: \(sessionId: string, uri: string \| null\) => void/.test(read('store/cageStore.ts')) &&
      /await VT\.getThumbnailAsync\(playableUri/.test(read('app/swinglab/library.tsx')) && // refreshed: re-anchored playableUri (was clipUri)
      // BALL SPEED badge is honest: a CLEAN number (no "~" marker) AND gated on isSwingDerived.
      // 2026-07-20 (bug-hunt fix) — the badge must ONLY show a value that is actually
      // swing-derived; a handicap-table 'profile'/'placeholder' fallback (a constant, identical
      // for every swing of a club) must read "—", matching the page-2 tile. No raw-mph fabrication.
      /value: bs\.value != null && isSwingDerived\(bs\.source\) \? `\$\{Math\.round\(bs\.value\)\}` : null/.test(smSrc2) &&
      !/\$\{bsEst \? '~' : ''\}/.test(smSrc2) &&
      // typed/dictated FEEL persists on Save (not just via the caddie-submit button).
      /if \(sid && feelText\.trim\(\)\) \{[\s\S]*?setSessionFeel\(sid, feelText\.trim\(\)\)/.test(smSrc2),
    'library thumbnails backfill + persist; ball-speed badge shows a clean swing-derived number only (isSwingDerived-gated, no fabricated handicap-table constant, no est marker); feel saved on Save');

  // ─── Bug-hunt closeout (2026-07-20) — lock the highest-value fixes so they can't regress ───
  check('Bug-hunt: voice bypasses match whole-word commands, not raw substrings',
    // matchesCommand (word-boundary + short-utterance) replaces the naive t.includes(p) that let
    // "ob" inside "problem"/"probably" add a penalty stroke and drop the user's question.
    /const matchesCommand = \(raw: string, phrases: string\[\], maxWords = 6\)/.test(read('hooks/useVoiceCaddie.ts')) &&
      /matchesCommand\(transcript, PENALTY_PHRASES\)/.test(read('hooks/useVoiceCaddie.ts')) &&
      /matchesCommand\(transcript, MUTE_PHRASES\)/.test(read('hooks/useVoiceCaddie.ts')) &&
      // the raw-substring bypass matching must be gone
      !/PENALTY_PHRASES\.some\(p => t\.includes\(p\)\)/.test(read('hooks/useVoiceCaddie.ts')) &&
      // the ambiguous bare tokens that fired on ordinary speech were removed
      !/^\s*"water",\s*$/m.test(read('hooks/useVoiceCaddie.ts')) &&
      !/^\s*"quiet",\s*$/m.test(read('hooks/useVoiceCaddie.ts')),
    'penalty/hero/mute/vision voice bypasses only fire on short whole-word commands — ordinary conversational speech ("problem", "probably", "I need some water") no longer corrupts the scorecard or drops the question');

  check('Bug-hunt: first-launch consent gate is anchored on termsAcceptedAt, not first_opened_at',
    // the boot trial-lifecycle stamps first_opened_at during hydration, so the welcome/consent
    // screen was silently skipped on cold installs — the gate now keys on the consent field.
    /const hasAcceptedTerms = profileSnap\.termsAcceptedAt != null;/.test(read('app/index.tsx')) &&
      /if \(!hasAcceptedTerms && !hasName\)/.test(read('app/index.tsx')),
    'cold-install users always see the Terms/Privacy consent + profile-capture welcome screen (gate keys on termsAcceptedAt, which only welcome.tsx sets)');

  check('Bug-hunt: backup grow-mostly guards the four accumulating learned stores',
    // 2026-07-25 (deep audit S2) — the client + server lists were unified into ONE shared constant
    // (services/cloudSync/growMostlyKeys.ts) so they can't drift. Verify the keys are protected AND
    // that BOTH the client (snapshot.ts) and server (backup.ts) import that shared source of truth.
    ['coach-knowledge-v1', 'relationship-store-v1', 'team-intelligence-store-v1', 'practice-store'].every(k => GROW_MOSTLY_KEYS.includes(k)) &&
      /from '.*growMostlyKeys'/.test(read('services/cloudSync/snapshot.ts')) &&
      /from '.*growMostlyKeys'/.test(read('api/backup.ts')),
    'coach-knowledge / relationship / team-intelligence / practice stores are in the SHARED grow-mostly constant that both client + server import — a second emptier device can no longer wipe the cloud copy');

  check('Fault→workout map: curated golf exercises per fault, aliases normalized, honest-empty otherwise', (() => {
    // 2026-07-21 — curated (not AI-generated) fault→exercise table; keys match the analysis fault
    // vocabulary so the read drives the training suggestion. Unknown fault → [] (never fabricated).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { exercisesForFault, hasWorkoutsForFault } = require('../../services/swing/faultWorkouts');
    const ee = exercisesForFault('early_extension');
    const alias = exercisesForFault('spine_angle_loss'); // normalizes to early_extension
    const sway = exercisesForFault('sway');
    const unknown = exercisesForFault('totally_made_up_fault');
    const shaped = ee.every((e: { name: string; why: string; category: string }) => !!e.name && !!e.why && !!e.category);
    return ee.length >= 2 && alias.length === ee.length && shaped && sway.length >= 2 &&
      unknown.length === 0 && hasWorkoutsForFault('over_the_top') === true && hasWorkoutsForFault(null) === false;
  })(),
  'exercisesForFault returns 2-3 curated, honestly-rationaled golf exercises for each real fault (aliases like spine_angle_loss → early_extension), and [] for an unknown fault — no fabricated recommendations');

  check('Learned bag: club-carry EWMA accumulates from shot 1 (raw accumulator, not the nulled display)',
    // 2026-07-21 BETA data-integrity fix — the caddie's learned per-club yardages used the DISPLAY
    // fields (null for shots 1-4) as the EWMA accumulator, so the average collapsed to just the 5th
    // shot and dispersion seeded at 0. The accumulator must run on a raw never-nulled state.
    /const baseAvg = prev\.avgAccum \?\? prev\.avgCarryYds \?\? carryYds;/.test(read('store/caddieMemoryStore.ts')) &&
      /const baseDisp = prev\.dispAccum \?\? prev\.dispersionYds \?\? dev;/.test(read('store/caddieMemoryStore.ts')) &&
      /avgAccum: avg,/.test(read('store/caddieMemoryStore.ts')) &&
      // the broken accumulator (using the nulled display field as the base) must be gone
      !/const base = prev\.avgCarryYds \?\? carryYds;/.test(read('store/caddieMemoryStore.ts')),
    'the learned bag EWMA accumulates every shot from #1 on a raw never-nulled accumulator (avgAccum/dispAccum); the display stays null until MIN_SAMPLES — so the caddie no longer cites a yardage that is just the 5th shot with 0 dispersion');

  check('Pose motion anchors: derive top + impact from the hand-velocity signal (synthetic swing)', (() => {
    // 2026-07-21 — pose-first foundation. deriveSwingAnchors finds the swing structure from motion:
    // IMPACT = hand-speed peak (accelerating downswing), TOP = hands-highest (min y) before it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { deriveSwingAnchors } = require('../../services/swing/poseMotion');
    const samples: { tMs: number; x: number; y: number }[] = [];
    for (let t = 0; t <= 1600; t += 50) {
      let x: number; let y: number;
      if (t <= 400) { y = 0.60; x = 0.50; }                                             // address (still)
      else if (t <= 900) { const f = (t - 400) / 500; y = 0.60 - 0.25 * f; x = 0.50 - 0.08 * f; } // backswing → top
      else if (t <= 1150) { const f = (t - 900) / 250; y = 0.35 + 0.27 * f * f; x = 0.42 + 0.08 * f; } // ACCELERATING downswing → impact
      else { const f = (t - 1150) / 450; y = 0.62 - 0.22 * f; x = 0.50 + 0.10 * f; }     // follow-through
      samples.push({ tMs: t, x, y });
    }
    const a = deriveSwingAnchors(samples);
    // top ≈ 900 (min y), impact ≈ 1150 (accelerating peak), start before top, end after impact.
    const ok = !!a && a.topMs >= 850 && a.topMs <= 950 && a.impactMs >= 1100 && a.impactMs <= 1200 && a.startMs < a.topMs && a.endMs > a.impactMs;
    // Degenerate signal (too few / monotonic) → null (caller keeps coarse anchors), never a crash.
    const degenerate = deriveSwingAnchors([{ tMs: 0, x: 0.5, y: 0.5 }, { tMs: 50, x: 0.5, y: 0.5 }]);
    return ok && degenerate === null;
  })(),
  'deriveSwingAnchors recovers TOP (hands-highest) + IMPACT (velocity peak) from the hand-motion signal alone — no audio/segmentation dependence; degenerate input returns null so the caller keeps its coarse anchors');

  check('Pose-first read: measured kinematics → honest multi-dimensional read + threshold faults', (() => {
    // 2026-07-21 — the pose-first re-architecture engine. Faults are thresholds on REAL measured
    // kinematics (not a vision guess); a dimension we couldn't measure is OMITTED, never faked;
    // it never returns "no swing".
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildPoseSwingRead } = require('../../services/swing/poseSwingRead');
    const mkTempo = (ratio: number) => ({ ratio, backswingMs: 900, downswingMs: 300, topMs: 900, sequencingScore: null, source: 'video_pose', confidence: 'med' });
    // 2026-08-06 (analysis audit) — the fault gate now only escalates a scold when the pose was CONFIDENT
    // about the metric (trust ≥ 0.4, unknown → untrusted). Real biomech always carries metric_confidence
    // (poseAnalysisApi.computeBiomechanics), so faulty swings supply it here to represent real data.
    // 2026-08-09 (elite fault engine) — confidence now carries the arm/finish/sway keys too; over_the_top
    // is NO LONGER asserted (fabricated from a width proxy), sway is driven by swayNorm not hipSlideRatio.
    const CONF_HI = { hipTurn: 0.9, shoulderTurn: 0.9, shoulderTilt: 0.9, weightShift: 0.9, spineAngleDelta: 0.9, headDrift: 0.9, hipSlide: 0.9, sequencing: 0.9, leadArm: 0.9, chickenWing: 0.9, sway: 0.9, finish: 0.9 };
    // Clean swing: strong numbers (incl. straight lead arm, centered sway, full finish) → strengths, no faults.
    const clean = buildPoseSwingRead({ hipTurnDeg: 46, shoulderTurnDeg: 92, weightShiftPct: 20, spineAngleDeltaDeg: 4, hipSlideRatio: null, sequencingScore: 72, leadArmTopDeg: 168, leadArmImpactDeg: 165, swayNorm: 0.08, finishWeightPct: 35, headDriftPxNorm: 0.03, frames: [], verdicts: {}, metric_confidence: CONF_HI }, mkTempo(3.0));
    const cleanOk = clean.usable && clean.faults.length === 0 && clean.strengths.length > 0 && clean.dimensions.length >= 6;
    // Faulty swing: early extension + REBUILT sway (swayNorm) + hanging back + bent lead arm → all detected. NO over_the_top.
    const faulty = buildPoseSwingRead({ hipTurnDeg: 40, shoulderTurnDeg: 85, weightShiftPct: -6, spineAngleDeltaDeg: 20, hipSlideRatio: null, swayNorm: 0.26, leadArmTopDeg: 130, sequencingScore: 30, frames: [], verdicts: {}, metric_confidence: CONF_HI }, mkTempo(3.0));
    const fk = faulty.faults.map((f: { key: string }) => f.key);
    const faultyOk = fk.includes('early_extension') && fk.includes('sway') && fk.includes('reverse_pivot') && fk.includes('lead_arm_bent') && !fk.includes('over_the_top') && faulty.faults[0].severity === 'significant';
    // 2026-08-06 (analysis audit, finding #5) — the SAME faulty numbers but LOW confidence must NOT lead with
    // those scolds (unknown/low pose confidence → hedged dimension, no headline fault). Locks the honesty gate.
    const CONF_LO = { hipTurn: 0.2, shoulderTurn: 0.2, shoulderTilt: 0.2, weightShift: 0.2, spineAngleDelta: 0.2, headDrift: 0.2, hipSlide: 0.2, sequencing: 0.2, leadArm: 0.2, chickenWing: 0.2, sway: 0.2, finish: 0.2 };
    const faultyLowConf = buildPoseSwingRead({ hipTurnDeg: 40, shoulderTurnDeg: 85, weightShiftPct: -6, spineAngleDeltaDeg: 20, hipSlideRatio: null, swayNorm: 0.26, leadArmTopDeg: 130, sequencingScore: 30, frames: [], verdicts: {}, metric_confidence: CONF_LO }, mkTempo(3.0));
    const gatedKeys = ['early_extension', 'sway', 'reverse_pivot', 'lead_arm_bent'];
    const lowConfGated = !faultyLowConf.faults.some((f: { key: string }) => gatedKeys.includes(f.key));
    // Unmeasurable (e.g. bad angle): every dimension null → omitted, NO fabricated fault, not usable — never "no swing" as a fault.
    const empty = buildPoseSwingRead({ hipTurnDeg: null, shoulderTurnDeg: null, weightShiftPct: null, spineAngleDeltaDeg: null, hipSlideRatio: null, sequencingScore: null, frames: [], verdicts: {} }, null);
    const emptyOk = empty.dimensions.length === 0 && empty.faults.length === 0 && empty.usable === false;
    return cleanOk && faultyOk && lowConfGated && emptyOk;
  })(),
  'pose-first engine: measured kinematics → per-dimension honest verdicts + threshold-detected faults (confident) — a LOW-confidence swing keeps the same faults OUT of the headline (honesty gate), and unmeasurable dimensions are omitted not fabricated');

  check('Analysis: a stuck upload never spins forever — pending is watchdog-recovered + early retry',
    // 2026-07-21 (BETA analysis P0). An uploaded clip whose auto-analyze never fired (no <Video>
    // duration) sat at 'pending' behind a lying spinner with no escape (the watchdog covered
    // analyzing_* but NOT 'pending'). Fix: the non-terminal watchdog now includes 'pending' and
    // flips to failed→Re-analyze; plus an early manual retry appears after 30s of pending.
    /const nonTerminal = \(st: string \| undefined\) =>\s*st === 'pending'/.test(read('app/swinglab/swing/[swing_id].tsx')) &&
      /if \(nonTerminal\(cur\)\) \{[\s\S]{0,140}setSessionAnalysisStatus\(swing_id, 'failed'/.test(read('app/swinglab/swing/[swing_id].tsx')) &&
      /const \[pendingSlow, setPendingSlow\] = useState\(false\)/.test(read('app/swinglab/swing/[swing_id].tsx')) &&
      /pendingSlow && \(/.test(read('app/swinglab/swing/[swing_id].tsx')),
    'a stuck-pending upload analysis recovers: an early "tap to retry" surfaces at 30s and the watchdog flips it to failed→Re-analyze — the "Analyzing your swing" spinner can no longer run forever');

  check('Plays-like: the adjustment is VISIBLE on the live strip (delta shown, honest)',
    // 2026-07-21 (Tim — plays-like must read as real + useful in live rounds). The portrait strip
    // dropped the raw-yards cell, so PLAYS looked like the raw distance. Now it shows the adjustment
    // delta "(+3)" (uphill/into-wind) / "(−2)" (downhill/downwind) so the user SEES it's adjusted —
    // and nothing when there's genuinely no adjustment (honest, never a fake plays-like).
    /playsLikeDelta\?: number \| null/.test(read('components/CaddieDataStrip.tsx')) &&
      /playsLike != null && playsLikeDelta \?/.test(read('components/CaddieDataStrip.tsx')) &&
      /playsLikeDelta=\{playsLikeYardage != null && displayYardage != null \? playsLikeYardage - displayYardage : null\}/.test(read('app/(tabs)/caddie.tsx')),
    'the live data strip shows the plays-like adjustment delta beside PLAYS, so the number reads as an ADJUSTED "plays like" (wind + slope), not the raw distance — and shows no delta when there is no real adjustment');

  check('Auto-listen is OFF by default and reset each launch (deliberate per-session opt-in)',
    // 2026-07-21 (Tim) — hands-free auto-listen is off by default and the user turns it on each
    // session; onRehydrateStorage forces it false every launch (reverses the old v18 force-on and
    // keeps testers off the auto-listen VAD path unless they explicitly enable it).
    /autoListenEnabled: false,/.test(read('store/settingsStore.ts')) &&
      /useSettingsStore\.setState\(\{ hasHydrated: true, autoListenEnabled: false \}\)/.test(read('store/settingsStore.ts')),
    'auto-listen defaults OFF and is force-reset to OFF on every launch, so hands-free is an explicit per-session choice');

  check('Voice: a swing COMPLAINT/mention does not yank the user into SwingLab (confirm, not auto-nav)',
    // 2026-07-21 (Tim: "every time I said we have an issue with the swing, caddie took me to
    // swinglab — make it a prompt"). The classifier must treat a swing complaint/feedback request
    // as coaching talk (query_status swing_observation), NOT an open_tool, and prefer low
    // confidence when unsure so the DISRUPTIVE_OPEN gate OFFERS instead of navigating.
    /MENTION vs COMMAND/.test(read('api/voice-intent.ts')) &&
      /is NOT an open_tool and must NOT navigate to SwingLab/.test(read('api/voice-intent.ts')) &&
      /query_topic: "swing_observation"/.test(read('api/voice-intent.ts')) &&
      // the client gate that turns a non-high-confidence open into an offer must still exist
      /DISRUPTIVE_OPEN_INTENTS\.has\(intent\.intent_type\) && intent\.confidence !== 'high'/.test(read('services/listeningSession.ts')),
    'a swing complaint ("we have an issue with my swing") is coaching talk, not a navigate — the classifier keeps it out of open_tool and the disruptive-open gate offers "want me to open that?" instead of auto-jumping to SwingLab');

  check('Swing-replay crash: clubhead extraction never runs concurrent with video playback',
    // 2026-07-21 (Tim: crash after replaying an uploaded swing). ROOT CAUSE: a native
    // MediaMetadataRetriever (detectClubPath) decoding the file while ExoPlayer decodes it for
    // playback → SIGSEGV to the launcher / WHITE screen. Timing guards (gated off during playback,
    // abort between frames, grab-frame pauses first) can't interrupt a native call already in flight,
    // so 2026-07-24 added the STRUCTURAL fix: extract from a PRIVATE COPY of the clip so the retriever
    // and ExoPlayer never share a file handle — the crash condition is impossible regardless of timing.
    /shouldAbort\?: \(\) => boolean/.test(read('services/swing/clubPath.ts')) &&
      /if \(shouldAbort\?\.\(\)\) \{ await cleanup\(frames, null\); sharedCopy\?\.release\(\); return null; \}/.test(read('services/swing/clubPath.ts')) &&
      // STRUCTURAL decoupling: acquire the SHARED private copy, extract frames from the COPY (workUri),
      // never videoUri. 2026-08-09 — the copy comes from the refcounted pool (sharedClipCopy); the file
      // cannot be deleted while any consumer holds it, and the copy-or-refuse invariant stands below.
      /acquireClipCopy\(videoUri\)/.test(read('services/swing/clubPath.ts')) &&
      /const f = await frameAt\(workUri, o\)/.test(read('services/swing/clubPath.ts')) &&
      // 2026-07-30 (Tim: "analysis isn't watching the whole swing; playback + analysis tied together") —
      // the club-arc extraction NO LONGER bails on playback: the PRIVATE COPY (above) is the structural
      // crash guard, so it's safe to extract while ExoPlayer loops the original. Abort ONLY on genuine
      // cancellation (unmount / swing change), and the rationale comment must be present so this isn't
      // silently reverted to the analysis-truncating isPlaying gate.
      /shouldAbort: \(\) => cancelled \}\)/.test(read('app/swinglab/swing/[swing_id].tsx')) &&
      /PRIVATE COPY \(distinct file handle\)/.test(read('app/swinglab/swing/[swing_id].tsx')) &&
      // grab-frame still pauses before extracting; extraction routed through the queue wrapper
      /await videoRef\.current\?\.pauseAsync\(\)/.test(read('app/swinglab/swing/[swing_id].tsx')) &&
      /from '\.\.\/\.\.\/\.\.\/utils\/videoThumbnail'/.test(read('app/swinglab/swing/[swing_id].tsx')) &&
      /from '\.\.\/\.\.\/utils\/videoThumbnail'/.test(read('components/swinglab/SwingStillComposite.tsx')),
    'clubhead-arc extraction is SAFE concurrent with playback via a PRIVATE COPY (distinct file handle, never the file ExoPlayer holds) — closes the SIGSEGV structurally AND lets analysis watch the whole swing during autoplay (aborts only on real cancellation)');

  check('Universal ask: caddie finds/opens the user\'s OWN data (rounds + swings)',
    // 2026-07-25 (Tim — the whole point of the app: "ask the caddie to find ANY of my data"). The
    // precheck routes "pull up my last scorecard / find my round at Mines / show my driver swings" to
    // find_my_data BEFORE course-open (so it finds the ROUND, not just the course); universalFind ranks
    // the user's rounds + swings and the handler opens the best match. Local-first, offline.
    /export function universalFind/.test(read('services/universalFind.ts')) &&
      /roundHistory/.test(read('services/universalFind.ts')) &&
      /sessionHistory/.test(read('services/universalFind.ts')) &&
      /intent_type: 'find_my_data'/.test(read('services/intents/findMyDataHandler.ts')) &&
      /universalFind\(/.test(read('services/intents/findMyDataHandler.ts')) &&
      /registerHandler\(findMyDataHandler\)/.test(read('services/intents/index.ts')) &&
      /'find_my_data'/.test(read('services/localIntentPrecheck.ts')),
    'the caddie retrieves + opens the user\'s own rounds/swings from a natural "pull up my …" ask, routed locally before course-open');

  check('Crash capture: render crashes + uncaught JS errors funnel into the Issue Log',
    // 2026-07-21 (Tim: "crashes still don't show up in the error log"). The ErrorBoundary must
    // log a caught render crash, and a global ErrorUtils handler must catch async/handler errors
    // the boundary can't — both via addAppEvent 'app_error' so they appear in the tester's log.
    /require\('\.\.\/services\/crashCapture'\)\.logCrash\('render_crash'/.test(read('components/ErrorBoundary.tsx')) &&
      /initCrashCapture\(\)/.test(read('app/_layout.tsx')) &&
      /ErrorUtils/.test(read('services/crashCapture.ts')) &&
      /setGlobalHandler/.test(read('services/crashCapture.ts')) &&
      /addAppEvent\(/.test(read('services/crashCapture.ts')) &&
      /'app_error'/.test(read('services/crashCapture.ts')) &&
      // must chain to the previous handler so dev red-box / prod fatal still happen
      /prev\?\.\(error, isFatal\)/.test(read('services/crashCapture.ts')),
    'a render crash (white-screen) AND any uncaught async/handler JS error are recorded to the Issue Log as app_error entries, so tester crashes are finally visible + exportable (global handler chains to the platform default)');

  check('Issue Log is tester-accessible while owner tools stay gated (audit N1 lock)',
    // the Issue Log screen renders for everyone (no wholesale owner-gate); only the Claude
    // triage button + result are owner-gated (they burn API credit).
    /\{isOwner && \(/.test(read('app/owner-logs.tsx')) &&
      !/if \(!isOwner\)\s*(?:\{\s*)?return/.test(read('app/owner-logs.tsx')) &&
      // testers can SEND issues — export targets support@smartplaycaddie.com
      /support@smartplaycaddie\.com/.test(read('app/owner-logs.tsx')) &&
      // the Owner Tools SETTINGS section is fully gated so no owner tool leaks to testers
      /const showOwner = isOwnerEmail\(profile\.email\);\s*if \(!showOwner\) return null;/.test(read('app/settings.tsx')),
    'testers can open + export the Issue Log to support@smartplaycaddie.com; ONLY the Claude-triage button and the Owner Tools settings section are owner-gated (no owner tool leaks, no wholesale re-gate of the log)');

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
    // 2026-08-12 (Tim — "make sure SmartMotion planned distance also correlates to the player's bag
    // and/or verified/played distances"). The handicap scaling is GONE and this guard changed with
    // it: it used to assert that SmartMotion quotes a SHORTER default than the caddie does, which is
    // the disagreement itself (caddie "your driver goes 245" vs card "you carried 198"). The default
    // is now the shared standard bag, identical on every surface; personalisation comes from real
    // measured carries, which still override.
    check('SmartMotion: carry estimate = the SHARED standard bag × effort %, learned carry wins',
      full7i === 148 &&                                                 // the one standard-bag 7i
        scratch7i === full7i &&                                         // handicap no longer scales the default
        half7i != null && Math.abs(half7i - Math.round(full7i * 0.5)) <= 1 &&
        learned === 142 &&                                              // real learned avg still wins
        putt === null && noClub === null,                               // honest nulls
      `7-iron full carry ${full7i}y — the same number the caddie quotes (services/standardBag.ts), not a separately handicap-scaled one; 50% effort ~${half7i}y; a learned ${learned}y average overrides it; putter/no-club → null`);
  }

  check('SmartMotion: DTL readout shows the carry estimate + cycling badge + icon set',
    // 2026-08-07 (Tim — unify persisted carry) — estCarry now uses the player's LEARNED carry when present
    // and is fed to synthesizeSwingMetrics (estimatedCarryYds) so all surfaces show ONE carry number.
    /estimateCarryYards\(club, effortRaw \?\? 100, profile\.handicap, learned\)/.test(smSrc2) &&
      /estimatedCarryYds: estCarry/.test(smSrc2) &&
      // 2026-07-04 (drift reconcile) — the CARRY display moved into the shot-map deck.
      // 2026-07-07 (audit M2) — relabeled "PLAN CARRY" so a projection isn't shown as an outcome.
      /Stat label="PLAN CARRY" value=\{`~\$\{estCarry\}y`\}/.test(read('components/smartmotion/ShotMapPage.tsx')) &&
      /source=\{ICON_RAIL\.calibrate\}/.test(smSrc2) &&                  // rail badges wired
      /source=\{ICON_CTRL\.playpause\}/.test(smSrc2) &&                  // control badges wired
      /styles\.toolBtnBare/.test(smSrc2),                               // bare buttons (icon's own circle = button)
    'the live DTL readout adds a ~Ny CARRY column from the selected club × effort %; the rail uses its own green-circle badges (no double border, toolBtnBare) and the review controls use the matching record/play-pause/slow-mo/delete/save badges');

  check('SmartMotion: cycling mode badge + custom icon set wired',
    /const cycleMode = \(\) => \{/.test(smSrc2) &&
      // 2026-08-19 — the badge icon follows the CHOICE (full swing vs putting), not a detected camera
      // angle. Keying it on `angle` is what made the control read as "set to down the line" in the
      // field even though it no longer selects an angle.
      /ICON_ANGLE\[isPutt \? 'putt' : 'down_the_line'\]/.test(smSrc2) &&
      // 2026-08-19 — was showModeFade('FACE-ON'). The badge no longer cycles camera angles at all;
      // it is Full swing ⇄ Putting, and the angle is detected. The fade-away label itself is the
      // behaviour this line is guarding, so it now checks the label that actually exists.
      /showModeFade\('FULL SWING'\)/.test(smSrc2) &&
      /showModeFade\('PUTTING'\)/.test(smSrc2) &&
      /source=\{ICON_ENV\[effectiveMode\]\}/.test(smSrc2) &&          // env scene icon on the toggle
      /source=\{ICON_CLUB\}/.test(smSrc2) &&                          // club glyph on the scan button
      !/ModeToggle/.test(smSrc2),                                     // old 3-chip toggle removed
    'one golfer badge toggles Full swing ⇄ Putting with a fade-away label (camera angle is detected, not cycled); the environment toggle shows the cage/range/course scene badge; the club-scan button shows the club-bag glyph instead of a plain box');

  check('SmartMotion: chip sensitivity — lower threshold + mode-aware acoustics + clear toggle',
    /chipSensitivity: boolean/.test(read('store/settingsStore.ts')) &&
      /CHIP_STRIKE_THRESHOLD_DB = 18/.test(smSrc2) &&
      // 2026-07-08 (cage audit #1) — the calibration branch is now env-gated (calOk).
      /const thresholdDb = chipOn \? CHIP_STRIKE_THRESHOLD_DB : \(calOk \? appliedCalibration\?\.transientThresholdDb : undefined\)/.test(smSrc2) &&
      // 2026-08-08 (Tim — course acoustics in-round): chip → cage+course (INCLUDING in-round), NOT range.
      /chipOnStart\s*\n?\s*\? \(captureMode === 'cage' \|\| captureMode === 'course'\)/.test(smSrc2) &&
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

  check('SmartMotion: the camera angle is DETECTED, never asked for (2026-08-19)',
    // Replaces "reset() restores the user's explicit angle after a putt" (audit H3, 2026-06-11). There
    // is no explicit angle to restore: the 3-way DTL → face-on → putting cycler is now a two-way
    // Full swing ⇄ Putting, because the two camera angles were never a preference — they are a fact
    // the pose geometry reads directly, and the analysis engine had been overriding the player's
    // answer with that geometry since 07-30 regardless. Tim, 08-18: filmed down-the-line, screen said
    // FACE-ON, shot map gone.
    (() => {
      // The cycler offers exactly Full swing / Putting — no angle in it.
      // 2026-08-20 — was pinned to the literal `setPuttMode(false)` inside the cycler, which made it
      // fail the moment putt mode gained provenance (applyPuttMode(false, 'user')) — a change that
      // did not touch this property at all. The property is that the cycler is a TWO-WAY Full swing
      // ⇄ Putting control with no angle in it; which function flips the state is incidental, so the
      // assertion no longer quotes it.
      const twoWay = /if \(isPutt\) \{ \w+\((?:false|false, '\w+')\); showModeFade\('FULL SWING'\); \}/.test(smSrc2)
        && /showModeFade\('PUTTING'\)/.test(smSrc2)
        && !/showModeFade\('FACE-ON'\)/.test(smSrc2)
        && !/showModeFade\('DOWN THE LINE'\)/.test(smSrc2);
      // The "did the player choose?" flag is gone, so nothing can suppress the correction.
      const noExplicitFlag = !/userSetAngleRef\.current \?/.test(smSrc2);
      // The LIVE preview infers while framing, off the pose the framing coach already runs.
      const liveInfer = /inferCameraAngle\(liveAngleFramesRef\.current as never\)/.test(smSrc2)
        && /liveAngleFramesRef\.current = \[\.\.\.liveAngleFramesRef\.current, frame\]\.slice\(-4\)/.test(smSrc2);
      // ...and the recorded swing's own frames get the final word, ungated.
      const swingWins = /if \(\(bio\.angle === 'face_on' \|\| bio\.angle === 'down_the_line'\) && bio\.angle !== angle\) \{/.test(smSrc2);
      return twoWay && noExplicitFlag && liveInfer && swingWins;
    })(),
    'the mode control is Full swing / Putting only; the angle is inferred live from the framing pose and finally from the swing frames, with no user flag able to suppress the correction');

  const settingsSrc2 = fs.readFileSync(path.resolve(__dirname, '../../store/settingsStore.ts'), 'utf-8');
  check('LOCK: the persona handoff SAYS the words it SHOWS',
    (() => {
      /**
       * 2026-08-20 (Tim: "the text will say 'Kevin back on the bag' but what he SAYS is 'Kevin here,
       * I'm here to help'… there's still canned speech clashing").
       *
       * THIS GUARD USED TO ASSERT THE DEFECT. It required getOpenerAssetForPersona + playLocalFile
       * and explicitly FORBADE speaking the caption text (`!/voiceMod\.speak\?\.\(text/`) — so it was
       * green precisely because the screen and the caddie said different things, and it would have
       * turned red on the fix. Its stated goal (never silent on a cold Lambda) was reasonable; it
       * locked one IMPLEMENTATION of that goal and made the divergence permanent.
       *
       * The real invariant is that one moment has one script. Never-silent is preserved by the
       * cached persona clip + speak()'s own fallback, not by playing a different recording.
       */
      const sameTextBothWays = /const cached = cacheMod\.resolveCachedOfflineClipUri\?\.\(text, gender, p\)/.test(settingsSrc2)
        && /voiceMod\.flashCaption\?\.\(text\)/.test(settingsSrc2)
        && /voiceMod\.speak\?\.\(text,/.test(settingsSrc2);
      // The retired "just tap to chat" opener can never be the handoff audio again.
      // Match a CALL, never the prose above it that records why this was removed — a bare
      // /getOpenerAssetForPersona/ matches its own tombstone (same trap as the externalSignal guard).
      const retiredOpenerGone = !/getOpenerAssetForPersona\??\.?\(/.test(settingsSrc2)
        && !/export function getOpenerAssetForPersona/.test(read('services/kevinGreetingManifest.ts'));
      // One owner for the words, so the caption and the recording cannot drift apart again.
      const oneOwner = /PERSONA_HANDOFF_INTROS/.test(read('services/offlineVoiceCache.ts'))
        && /PERSONA_HANDOFF_INTROS/.test(settingsSrc2);
      return sameTextBothWays && retiredOpenerGone && oneOwner;
    })(),
    'a caddie switch speaks the same line it captions, from one owned source, and can never play the retired app-open opener clip under a different caption');

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

  check('Swing analysis: tempo derives for ALL swings (acoustic + video), honest impact source, degrades not fabricates',
    // 2026-07-19 (Tim — "we should be able to get tempo on ALL swings"). The old gate that
    // suppressed tempo for video-located segments (peakDb === 0) is GONE — tempo now computes
    // for every swing that has a strikeMs. deriveSwingTempo is pose-based, so it only needs an
    // accurate impact instant: acoustic swings anchor on the strike detector, video/range/upload
    // swings anchor on the segmenter's frame-accurate strikeMs. Impact source is tagged honestly.
    /const impactSource: 'acoustic' \| 'video' = \(seg\?\.peakDb \?\? 0\) === 0 \? 'video' : 'acoustic';/.test(smA) &&
      /if \(!clipUri \|\| isPutt \|\| !seg \|\| seg\.strikeMs == null \|\| seg\.synthesized\) \{ setTempo\(null\); return; \}/.test(smA) &&
      // 2026-08-09 (pass-2 P4) — a synthesized whole-clip fallback (strikeMs = 0.6·duration guess) is
      // skipped: tempo off a fabricated impact is not honest. Real located/acoustic swings still derive.
      /synthesized: true/.test(smA) &&
      // the old peakDb===0 suppression must be gone (no "=== 0 ... setTempo(null)" gate).
      !/\(seg\.peakDb \?\? 0\) === 0\) \{ setTempo\(null\); return; \}/.test(smA) &&
      /deriveSwingTempo\(clipUri, seg\.strikeMs, \{ impactSource \}\)/.test(smA) &&
      // deriveSwingTempo still degrades honestly: sanity gates return NO_TEMPO ("—") for an
      // unreadable swing, and the source is tagged video_pose vs acoustic_pose (no fabrication).
      /source: opts\?\.impactSource === 'video' \? 'video_pose' : 'acoustic_pose'/.test(read('services/poseAnalysisApi.ts')),
    'tempo computes for every swing with a valid strikeMs (acoustic + video/range/upload), the impact source is tagged honestly (acoustic_pose vs video_pose), and an unreadable swing still degrades to "—" rather than a fabricated number');

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
        // learning gates: handicap, both rebuild sites, points, CNS, reflection, drive, bag.
        // 2026-07-24 (M3/M4) — the handicap post now gates on the WHS posting basis (record.handicapHoles,
        // computed only in a `!s.isSimRound` block) so a sim round never posts; the compute is sim-guarded too.
        /record\.handicapHoles != null && !s\.isSimRound/.test(rs) &&
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
      /void scrubTo\(winSeek\(frac\)\)/.test(swingDetailSrc2),
    'ZoomableView gains an optional single-tap (Exclusive: double-tap-reset wins, then single-tap, then pinch/pan), wired to play/pause; native controls off + a tap-to-seek bar (now rebased to the swing window) replaces the scrubber so the tap-to-pause never fights native tap handling, and pinch-zoom + annotation are untouched');

  /**
   * 2026-08-14 — re-pointed. This asserted the literal gate
   * `source === 'live_cage' || durationMs > 20_000`, and the 20s half of it was scar tissue: it was
   * added when the backfill sampled the WHOLE clip by fixed fractions, and stayed in front of the
   * swing-window (07-25) and located-impact (08-09) fixes that made it unnecessary. Tim: a single
   * swing with a pre-shot routine "can get to twenty six seconds", so the cap refused ordinary swings.
   *
   * The intent — never watch a long clip whole as one swing — is now enforced by something stronger
   * than a length check: the backfill LOCATES the swing when the shot carries no trimmed window, so
   * duration stops being the question and "do we know where the swing is" becomes it. Cage clips are
   * still skipped, because several swings need partitioning rather than a wider window.
   */
  check('Swing Library: never analyses a clip whole — locates the swing, and still skips cage multi-swing',
    (() => {
      const skipsCage = /if \(session\?\.source === 'live_cage'\) return;/.test(swingDetailSrc2);
      // and it must LOCATE a window rather than falling through to the fraction spread
      const locatesWindow = /const \{ locateSwingWindow \} = await import\('\.\.\/\.\.\/\.\.\/services\/poseDetection'\);/.test(swingDetailSrc2) &&
        /if \(!swingWindow\) \{/.test(swingDetailSrc2);
      // the old length cap must NOT come back — it is what refused a 26s single swing
      const noLengthCap = !/durationMs > 20_000/.test(swingDetailSrc2);
      return skipsCage && locatesWindow && noLengthCap;
    })(),
    'the library backfill locates the swing instead of guessing by clip length; cage multi-swing still routes elsewhere');

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
        // 2026-07-24 (club-logic unification) — setManual (stated CARRY) still writes the bag; the honest
        // carry ladder feeds the Fit Profile (carryFor) + the stated carry surfaces in the learned map.
        /setManual:/.test(store) && /carryFor:/.test(store) && /hasManual:/.test(store) &&
        /s\.manual\[club\] != null\) out\[club\] = Math\.round\(s\.manual\[club\]! \+ ROLL_YARDS\[club\]\)/.test(store) &&
        /useClubStatsStore\.getState\(\)\.setManual/.test(screen) &&
        /yards: st\.carryFor\(c\), measured: st\.hasCarry\(c\), stated: st\.hasManual\(c\)/.test(screen) &&
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

// ─── Beta-wrap deep-audit LOCK guards (2026-07-30) ─────────────────────────────
// Regression guards for the full-app adversarial audit fixes. Each locks a fix that
// is invisible to jest (grep on source) so it can't silently revert before the App
// Store cut. Grouped by the audit that found it.
console.log('\n=== Beta-wrap deep-audit LOCK ===');
{
  // ISSUE-LOG (Tim: "make sure users' apps are RECORDING and PROMPTING to send issue logs")
  const promptSrc = read('components/OwnerIssueLogPrompt.tsx');
  check('Issue-log prompt reaches EVERY tester (not owner-gated)',
    !/isOwner\s*&&/.test(promptSrc) && !/isOwnerEmail/.test(promptSrc) && /unsent\s*>=\s*THRESHOLD/.test(promptSrc),
    'SEV-1: the "N issues → Send now" banner is no longer gated on isOwner; any tester at 5+ failures is prompted');

  const issueStoreSrc = read('store/issueLogStore.ts');
  check('Issue-log: passive failures schedule the consented auto-send',
    (issueStoreSrc.match(/scheduleAutoSend\(\)/g) ?? []).length >= 5,
    'SEV-2: addVoiceEvent/addGpsEvent/addAppEvent/addVoiceMiss/addUserIssue all schedule auto-send so a crash reaches the team without a voiced report');
  check('Issue-log: addUserIssue is UN-gated (tester bug reports persist)',
    /addUserIssue:\s*\(text\)\s*=>\s*\{[\s\S]*?\}/.test(issueStoreSrc) &&
      !/addUserIssue:[\s\S]*?isOwnerEmail/.test(issueStoreSrc.slice(issueStoreSrc.indexOf('addUserIssue'), issueStoreSrc.indexOf('addVoiceMiss'))),
    'SEV-3: a beta tester\'s spoken "log an issue" is recorded, not silently dropped');
  check('Issue-log: boot flush sends prior-session crashes',
    /void autoSendIssues\(\);/.test(read('app/_layout.tsx')),
    'SEV-2/4: autoSendIssues() runs at launch so a crash that killed the process before its debounced send still reaches the team');

  // ANALYSIS/SMARTMOTION crash + persistence
  const cageSrc = read('store/cageStore.ts');
  check('cageStore: per-shot pose frames are compacted on persist (SQLITE_FULL)',
    /biomechanics:\s*compactBio\(sh\.biomechanics\)/.test(cageSrc) && /biomechanics:\s*compactBio\(sess\.biomechanics\)/.test(cageSrc),
    'P1: partialize compacts BOTH session- and shot-level biomechanics.frames so per-swing analysis can\'t re-bloat the row past Android\'s ~2MB limit');
  check('deriveSwingTempo extracts from a PRIVATE COPY (no SIGSEGV on review)',
    (() => {
      // 2026-08-09 (speed #3) — the copy now comes from the SHARED refcounted pool; assert the acquire
      // + refusal + workUri adoption (the invariant, not the old inline copyAsync mechanics).
      const fn = read('services/poseAnalysisApi.ts').slice(read('services/poseAnalysisApi.ts').indexOf('export async function deriveSwingTempo'));
      return /acquireClipCopy\(videoUri\)/.test(fn) && /if \(!sharedCopy\)/.test(fn) && /workUri = sharedCopy\.uri/.test(fn) && /sharedCopy\.release\(\)/.test(fn);
    })(),
    'C1: the default headline tempo read no longer decodes the looping original clip (shared refcounted copy)');
  check('Pose extraction routes through the single-flight queue',
    /from '\.\.\/utils\/videoThumbnail'/.test(read('services/poseAnalysisApi.ts')),
    'C4: poseAnalysisApi imports the serialized wrapper, not raw expo-video-thumbnails');
  check('swingDatabase: a failed read degrades read-only (no destructive wipe)',
    /lastReadFailed/.test(read('services/swingDatabase.ts')),
    'P2: a bad reference-DB read can no longer feed an empty baseline into a write that wipes the user\'s library');

  // ON-COURSE GPS leak
  const simRoundSrc = read('services/simRound.ts');
  check('stopVoiceSimRound does NOT restart GPS (no idle-watch leak)',
    /export function stopVoiceSimRound/.test(simRoundSrc) &&
      !/startGpsManager/.test(simRoundSrc.slice(simRoundSrc.indexOf('export function stopVoiceSimRound'))),
    'SEV-1 #1: sim teardown no longer races endRound by starting a live location watch + foreground service with no round');
  check('discardRound tears the sim round down (symmetry with endRound)',
    (read('store/roundStore.ts').match(/stopVoiceSimRound\(\)/g) ?? []).length >= 2,
    'SEV-1 #2: discarding a sim round clears simActive/simPos/holeUnsub (stopVoiceSimRound is now called from BOTH endRound and discardRound)');

  // VOICE-OFF text + custom caddie
  const listenSrc = read('services/listeningSession.ts');
  check('Hands-free surfaces text when voice is muted (H1)',
    (listenSrc.match(/flashCaption\?\.\(/g) ?? []).length >= 4,
    'H1: openSession + handleTranscribedUtterance caption the reply when voice is off so a hands-free turn is never silently dead');
  check('Custom caddie inherits base persona on the kevin fallback (H2)',
    /customCaddieBasePersona/.test(read('api/kevin.ts')) && /customCaddieBasePersona/.test(read('hooks/useKevin.ts')),
    'H2: /api/kevin resolves a custom caddie to its chosen base persona for spec + voice (was Kevin/onyx on follow-ups)');
  check('open_course only navigates at HIGH confidence (H3)',
    /intent\.confidence !== 'high'/.test(read('services/intents/openCourseHandler.ts')),
    'H3: a conversational course MENTION (medium confidence) offers instead of yanking the user to the Play tab');

  // VOICE follow-up audit (2026-07-30 final pass)
  /**
   * 2026-08-23 — RE-AIMED, and the reason it needed re-aiming is the fix itself.
   *
   * This asserted that THREE separate files each remember to send the custom caddie's base persona,
   * which is a guard shaped like the bug: it verifies that every hand-built payload got patched,
   * and it can only ever verify the ones it happens to name. The three payloads it named are gone;
   * every surface now sends the union from ONE builder, which reads the field itself.
   *
   * So the property is asserted where it can no longer be forgotten — in the builder — plus the two
   * surfaces that still merge their own literal over the union.
   */
  check('Custom caddie base persona reaches the brain from every surface (voice #1)',
    /customCaddieBasePersona: safe/.test(read('services/caddieRequestBody.ts')) &&
      /customCaddieName: safe/.test(read('services/caddieRequestBody.ts')) &&
      /customCaddieBasePersona/.test(read('hooks/useVoiceCaddie.ts')) &&
      /buildCaddieRequestBody/.test(listenSrc),
    'voice#1: the one payload builder resolves the custom caddie base persona + name for EVERY surface, so no path can revert to Kevin/onyx');
  // 2026-08-23 — RE-AIMED onto services/caddieBrain, where the acknowledgement now lives for EVERY
  // surface rather than being re-implemented per mic (it was duplicated in three places, and the
  // earbud copy is how the drop was found in the first place).
  check('a tool-only turn is never a silent dead turn (voice #2)',
    /if \(!text && toolActions\.length\) text = 'Done\.'/.test(read('services/caddieBrain.ts')),
    'voice#2: a turn that produced actions but no words acknowledges instead of going silent, on every mic');
  check('watch/typed path gates disruptive-open on HIGH confidence (voice #3)',
    (listenSrc.match(/DISRUPTIVE_OPEN_INTENTS/g) ?? []).length >= 2,
    'voice#3: handleTranscribedUtterance offers instead of yanking a tool open on a medium-confidence watch-STT misread (mirrors the mic + earbud gates)');
}

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
    '[path4:voice] capture_done', '[path4:voice] intent=', '[path4:voice] earcon_start',
    '[path4:voice] earcon_end', '[path4:voice] response_start', '[path4:voice] response_end',
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

// 2026-08-09 (verification wave — "It does not find the points in the swing correctly" +
// "DETECTED MOMENTS" + fabricated upload tempo + practice swings). Four locks on the honest-analysis
// chain: (1) uploads thread the vision-located IMPACT into the pose pass (strike-anchored stages, not
// the 65%-of-window fraction that landed ~1.1s after the ball); (2) only the model's fault-frame moment
// persists as an issue timestamp (never raw sample times — those were the fake DETECTED MOMENTS grid);
// (3) the upload verdict's tempo comes from the real wrist series (tempoFromPoseFrames), never
// tempoFromBiomechanics whose ratio was a CONSTANT of the synthetic offset table; (4) low-confidence
// video-located swings (the practice-swing class) don't auto-expand when a confident swing exists.
check('Swing points: upload pose pass is impact-anchored + honest moments/tempo + practice-swing gate',
  (() => {
    const up = read('services/videoUpload.ts');
    const pose = read('services/poseAnalysisApi.ts');
    const det = read('services/poseDetection.ts');
    return (
      /swingTimeSec: t/.test(det) &&                                              // locator RETURNS the impact
      /poseImpactMs = loc\.swingTimeSec \* 1000/.test(up) &&                      // locate-once threads it
      /locatedImpactSec === 'number'/.test(up) &&                                 // persisted anchor read
      /const faultTs = faultIdx != null && faultIdx >= 0/.test(up) &&             // only the fault moment persists
      !/setShotIssueTimestamps\(sessionId, swing\.id, r\.frame_timestamps_sec\)/.test(up) && // raw sample times DEAD
      /tempoFromPoseFrames\(biomech\.frames, poseImpactMs, 'video'\)/.test(up) &&  // honest tempo in the verdict
      !/tempoFromBiomechanics\(biomech\)/.test(up) &&                              // fabricated-constant path DEAD
      // 2026-08-19 — this line used to assert the practice-swing gate's SOURCE TEXT was PRESENT, so it
      // went green on the defect and would have gone red on the fix. Removing the gate is the fix (the
      // locator prompt has excluded practice swings since 2026-07-01; 'low' means "couldn't see the
      // ball leave"), so the assertion is inverted: the gate must be GONE and the locate still logged.
      !/const confident = found\.filter\(f => f\.confidence !== 'low'\)/.test(up) &&
      /upload-swings-located/.test(up) &&
      /export function tempoFromPoseFrames/.test(pose) &&
      // 2026-08-09 (verifier round 2 — every-surface): the SIBLING producers were half-fixed. Cage
      // summary persisted raw sample times (then the legacy guard hid cage sessions' real moment
      // entirely), and SmartMotion's re-analyze path ran locateSwings with no practice gate.
      (() => {
        const cage = read('app/cage/summary.tsx');
        const sm = read('app/swinglab/smartmotion.tsx');
        return (
          !/setShotIssueTimestamps\(session\.id, swing\.id, r\.frame_timestamps_sec\)/.test(cage) &&
          /const faultTs = faultIdx != null && faultIdx >= 0/.test(cage) &&
          !/const confident = swings\.filter\(sw => sw\.confidence !== 'low'\)/.test(sm) &&
          /\[smartmotion\] re-analyze segmentation/.test(sm)
        );
      })()
    );
  })(),
  'stage points anchor on the REAL located impact; fault moment only (ALL producers); wrist-series tempo; NO practice-swing gate on either video-only upload surface (locate is logged instead)');

// 2026-08-09 (Tim — "UNUSED COURSE DOWNLOAD ENGINE NOT WIRED? WTF") — REACHABILITY lock: every export
// of the download engine must have a real caller. The engine shipped 08-06 with downloadCourse +
// isCourseDownloaded at ZERO callers (locate-only wiring) while being described as done — the exact
// dead-code-behind-green-gates class. Wired 08-09: ARRIVAL auto-download (play.tsx, ≤1.5km nearest),
// SELECTION download (play.tsx tap handler), ROUND-START mark (caddie.tsx runStartRound), and the
// fresh-download toast consumes isCourseDownloaded via downloadCourse's idempotence.
check('Course download engine: every export REACHABLE (arrival + selection + round-start wiring live)',
  (() => {
    const play = read('app/(tabs)/play.tsx');
    const cad = read('app/(tabs)/caddie.tsx');
    return (
      /locateNearbyCourses\(userPosition\.lat, userPosition\.lng/.test(play) &&        // locate live
      /nearest\.distance_m <= 1500/.test(play) &&                                      // arrival trigger
      /eng\.downloadCourse\(\{ name: nearest\.name/.test(play) &&                      // arrival download
      /eng\.downloadCourse\(\{ name: c\.club_name, courseId: c\.id/.test(play) &&      // selection download
      /eng\.downloadCourse\(\{ name: courseName, courseId/.test(cad) &&                // round-start mark
      /full course data downloaded/.test(play)                                          // fresh-download surface
    );
  })(),
  'arriving at a course auto-downloads it (Arccos flow); selecting or starting a round marks offline availability — no dead exports');

// 2026-08-09 (Tim — "missing major club use logic... If user does not change the advised club then
// that use should be logged and tied to the distances") — the CLUB ATTRIBUTION chain. One arbiter
// (services/shotClubResolver): explicit > more-recent-of declared vs ADVISED (silent adherence
// attributes the advised club) > distance inference last. Consumed at ALL THREE shot-log sites, the
// advice hard-expires on hole change, and tracked shots feed the learned bag via confirmTrackedShot.
check('Club attribution: advised club becomes the shot club when un-overridden, at EVERY log site',
  (() => {
    const res = read('services/shotClubResolver.ts');
    const disp = read('services/voice/conversationalToolDispatch.ts');
    const cad = read('app/(tabs)/caddie.tsx');
    const trk = read('services/shotTracking.ts');
    const rs = read('store/roundStore.ts');
    const log = read('services/intents/logShotHandler.ts');
    return (
      /export function resolveShotClub/.test(res) &&
      // Silent adherence still attributes — but ONLY when the stamp was advice. 2026-08-17: this
      // asserted the literal `adhered: true`, which pinned the version that also scored adherence
      // against inferClub() guesses the caddie never spoke.
      /source: 'advised', adhered: advice \? true : null/.test(res) &&
      /resolveShotClub\(typeof a\.club === 'string' \? a\.club : null\)/.test(disp) &&
      /resolveShotClub\(typeof a\.club === 'string' \? a\.club : null\)/.test(cad) &&
      /resolveShotClub\(opts\?\.club \?\? null\)/.test(trk) &&                  // tracked shots too
      /kevin_adhered: resolved\.adhered/.test(trk) &&
      /userStatedYardage: null, pendingKevinRec: null/.test(rs) &&                // advice dies with the hole
      /setClub: \(club\) => set\(\{ club, clubSetAt: Date\.now\(\) \}\)/.test(rs) && // recency arbitration is real
      // EVERY log site uses the one arbiter. logShotHandler computed its own adherence with a raw
      // `===` and none of the arbiter's rules — three shot paths, three answers for one shot.
      /const \{ resolveShotClub \} = require\('\.\.\/shotClubResolver'\)/.test(log) &&
      /const kevinAdhered = resolvedRec\.adhered;/.test(log) &&
      // The clear must key on hadPending, not recClub: recClub is null for an inferred stamp, so
      // conditioning on it would leave that stamp in the slot for a later shot to re-consume.
      /if \(resolved\.hadPending\) round\.clearPendingKevinRec\(\)/.test(trk)
    );
  })(),
  'caddie advises 8i, player hits it silently -> the 8-iron is logged, adherence stamped, and the measured distance trains the bag');

// 2026-08-09 (mechanical dead-export audit, ts-prune) — team-intelligence had FOUR detection
// triggers + a full suggestion UI (CaddieSuggestionCard + accept flow), and only ONE trigger
// (round progress) was ever called. drill_plateau, cage_frustration and user_explicit_stuck were
// dead since Phase 106. REACHABILITY lock: every evaluator must keep a real caller.
check('Team intelligence: ALL four triggers reachable (cage end, shot streak, round progress, explicit stuck)',
  (() => {
    const cage = read('app/cage/summary.tsx');
    const cad = read('app/(tabs)/caddie.tsx');
    const brain = read('services/conversationalBrain.ts');
    return (
      /ti\.evaluateCageEnd\(\)/.test(cage) &&
      /ti\.evaluateCageShotStreak\(maxStreak\)/.test(cage) &&
      /evaluateRoundProgress\(\)/.test(cad) &&
      /ti\.evaluateUserExplicitStuck\(pillar\)/.test(brain) &&
      /contact === 'fat' \|\| contact === 'thin' \|\| contact === 'topped'/.test(cage)  // conservative mishit gate
    );
  })(),
  'the team-of-caddies handoff suggestions can actually fire: plateau + frustration at cage end, stuck via voice, struggle on-course');

// 2026-08-09 (Tim — club logic must be RIGHT) — the club-REC stamp must fire on the DEFAULT pipecat
// path, not just the legacy engine. shot_strategy routes to the brain by default and used to return
// without ever calling setPendingKevinRec, so silent adherence attributed nothing on the path 99% of
// users are on. LOCK: the brain-routed branch stamps the learned-bag club before returning.
check('Club rec stamped on the DEFAULT (pipecat) shot-strategy path, not only the legacy engine',
  (() => {
    const q = read('services/intents/queryStatusHandler.ts');
    // the stamp must sit INSIDE the pipecat early-return branch (before route_to_brain), using the
    // learned-bag inferClub against a real distance-to-green.
    const branch = q.slice(q.indexOf("case 'shot_strategy'"), q.indexOf('route_to_brain: true'));
    return (
      /inferClub\(yds\)/.test(branch) &&
      /setPendingKevinRec\(\{ club: recClub/.test(branch) &&
      /resolveGreenCoords\(r\.currentHole\)/.test(branch)
    );
  })(),
  'asking the caddie for the play on the default voice path stamps a rec, so hitting it silently trains the bag');

// 2026-08-09 (Tim — un-parked exact club attribution) — recommend_club: the brain calls it when it
// advises a club, carrying the EXACT spoken club; client stamps it (overwriting the distance proxy).
// LOCK: tool declared + in UI_TOOLS (server dispatches) + client case exists (reachable, not dead).
check('recommend_club: brain tool declared, server-dispatched, client-stamped (exact spoken-club attribution)',
  (() => {
    const tools = read('api/_brainTools.ts');
    const disp = read('services/voice/conversationalToolDispatch.ts');
    const kevin = read('api/kevin.ts');
    return (
      // 2026-08-19 (lockstep reconciliation) — declarations now live in the single owner.
      /name: 'recommend_club'/.test(tools) &&
      /UI_TOOLS = new Set\(\[[\s\S]*?'recommend_club'[\s\S]*?\]\)/.test(tools) &&
      // AND the reason this whole pass happened: recommend_club existed ONLY on pipecat-turn, so the
      // FOLLOW-UP turn (useVoiceCaddie.processFollowUp → sendToBrain → /api/kevin) could not call it
      // and the advice→outcome pairing died on turn 2. Both brains must source the same list, and
      // kevin's dispatch must not silently swallow a tool it has no bespoke case for.
      /BRAIN_TOOLS/.test(kevin) &&
      /default: \{[\s\S]*?UI_TOOLS\.has\(name\)/.test(kevin) &&
      /case 'recommend_club':/.test(disp) &&
      /setPendingKevinRec\(\{ club: a\.club\.trim\(\)/.test(disp)
    );
  })(),
  'when the caddie speaks a club it is captured exactly, so silent adherence trains the bag with the RIGHT club');

// 2026-08-09 (on-course audit C1/C2 — the wrong-hole voice scoring Tim's fought for months) — a bare
// voice score/putts must resolve the hole the PLAYER means, not nav currentHole (which GPS advance +
// first-score auto-advance move on their own). LOCK: all four voice score/putts sites route through
// voiceScoreHole/voicePuttsHole, never a raw currentHole default.
check('Voice scoring targets the reported hole (voiceScoreHole/voicePuttsHole), not nav currentHole',
  (() => {
    const leaf = read('store/voiceScoringHole.ts');
    const rs = read('store/roundStore.ts');
    const lsh = read('services/intents/logScoreHandler.ts');
    const lph = read('services/intents/logPuttsHandler.ts');
    const disp = read('services/voice/conversationalToolDispatch.ts');
    const cad = read('app/(tabs)/caddie.tsx');
    return (
      /export function voiceScoreHole/.test(leaf) && /export function voicePuttsHole/.test(leaf) &&
      /export \{ voiceScoreHole, voicePuttsHole \} from '.\/voiceScoringHole'/.test(rs) &&
      /parseHole\(params\.hole_number, voiceScoreHole\(round\)\)/.test(lsh) &&
      /voicePuttsHole\(round\)/.test(lph) &&
      /voiceScoreHole\(round\)/.test(disp) &&
      /voiceScoreHole\(useRoundStore\.getState\(\)\)/.test(cad)
    );
  })(),
  '"I got a 5" walking off a GPS-advanced hole logs to the RIGHT hole and does not double-jump; putts follow the score');

// 2026-08-09 (course-engine audit C1) — the `estimated` flag drives the 'AI ESTIMATE / not surveyed'
// badge + 45% confidence cap (coordinate provenance). It was inverted: real OSM hole-way coords were
// badged estimated merely because par was inferred, while the SPECULATIVE centroid-pairing fallback
// (guessed par-4s, bearing-sorted holes) shipped with NO flag = full confidence. LOCK the honest
// direction: hole-way synthesis estimated:false, pairing fallback estimated:true.
check('Course geometry: estimated flag reflects COORD provenance (real hole-ways false, guessed pairing true)',
  (() => {
    const g = read('api/course-geometry.ts');
    // hole-way path (real community-mapped coords): estimated:false even when par was inferred.
    const hwHonest = g.includes('estimated: false,') && g.includes('these coords are AI') === false;
    const hwComment = g.includes('badging real coords');
    // centroid-pairing fallback (synthesized par-4s + bearing-sorted holes): estimated:true, low conf.
    const pairHonest = g.includes('estimated: true,') && g.includes("estimated_confidence: 'low' as const,");
    return hwHonest && hwComment && pairHonest;
  })(),
  'unmapped courses never present fabricated par-4s as trustworthy while badging real community-mapped coords as AI');

// 2026-08-09 (elite fault engine — Tim: over-the-top FABRICATED, missing lead-arm-bent/chicken-wing/
// finish/sway my eyes see). Over-the-top is no longer asserted from the hip/shoulder width 'sequencing'
// proxy (two endpoint frames can't measure transition order or club plane). New reliable ARM/FINISH/
// HEAD faults + a rebuilt sway (hip-midpoint translation) are wired end-to-end.
check('Fault engine: arm/finish/sway faults wired, fabricated over-the-top removed',
  (() => {
    const api = read('services/poseAnalysisApi.ts');
    const read2 = read('services/swing/poseSwingRead.ts');
    const verdict = read('services/swing/poseReadVerdict.ts');
    const drills = read('data/drillCatalog.ts');
    const overlay = read('components/swinglab/SwingBodyOverlay.tsx');
    return (
      /leadArmTopDeg\b/.test(api) && /leadArmImpactDeg\b/.test(api) && /swayNorm\b/.test(api) && /finishWeightPct\b/.test(api) &&
      /jointAngleDeg\(/.test(api) &&                                                    // real 3-point arm angle
      /key: 'lead_arm_bent'/.test(read2) && /key: 'chicken_wing'/.test(read2) && /key: 'poor_finish'/.test(read2) && /key: 'head_movement'/.test(read2) &&
      !/key: 'over_the_top', label: 'Over the top'/.test(read2) &&                       // fabricated assertion GONE
      /faults\.push\(\{ key: 'sway'[\s\S]{0,120}?swayNorm|swayNorm[\s\S]{0,400}?key: 'sway'/.test(read2) &&
      /lead_arm_bent: 'lead_arm_bent'/.test(verdict) && /chicken_wing: 'chicken_wing'/.test(verdict) &&
      /id: 'lead_arm_bent'/.test(drills) && /id: 'poor_finish'/.test(drills) && /id: 'sway'/.test(drills) &&
      /lead_arm_bent:\s*\[/.test(overlay) && /poor_finish:\s*\[/.test(overlay)
    );
  })(),
  'the analyzer names the plainly-visible faults (bent lead arm, chicken wing, incomplete finish, sway, head movement) from reliable arm/hip metrics and no longer fabricates over-the-top');

// 2026-08-10 (Tim — 'haven't seen the club trace in a week'). ROOT: the clubhead arc only drew in the
// overlay's ALIGNED space (real frame dims); when pose frames lacked frameW/frameH the skeleton fell
// back to a self-fit bbox but the club (full-frame normalized) had no frame to map into → skeleton
// shows, club silently dropped. Fix: feed the video's natural size as the aligned-space fallback (both
// review surfaces), and loosen the sparse-arc rejection so real full swings aren't dropped as scatter.
check('Club trace renders without per-frame dims: video-size aligned fallback + sparse-arc gate loosened',
  (() => {
    const overlay = read('components/swinglab/SwingBodyOverlay.tsx');
    const detail = read('app/swinglab/swing/[swing_id].tsx');
    const sm = read('app/swinglab/smartmotion.tsx');
    const cp = read('services/swing/clubPath.ts');
    return (
      /videoW\?: number \| null;/.test(overlay) &&
      /normalized && \(videoW \?\? 0\) > 0 && \(videoH \?\? 0\) > 0/.test(overlay) &&  // aligned fallback from video size
      /onReadyForDisplay=\{onVideoReady\}/.test(detail) && /videoW=\{videoNatural/.test(detail) &&
      /onReadyForDisplay=\{onReviewVideoReady\}/.test(sm) && /videoW=\{reviewVideoNatural/.test(sm) &&
      /b - a < 2\) return false/.test(cp)                                             // sparse full-swing arc no longer over-rejected
    );
  })(),
  'the swing trace draws whenever a real clubhead arc exists (video-size aligned fallback covers dimless pose frames), on both the library detail and live review');

// 2026-08-10 (Tim — honest club-path faults from the arc). The over-the-top/steep/shallow family is a
// CLUB-PLANE read (not the removed hip-width proxy). readClubPath measures the downswing-vs-backswing
// plane delta from the REAL clubhead arc, DTL-only, self-referential (viewpoint-robust). STAGED +
// unit-tested (geometry directionally locked); the angle threshold/sign is PROVISIONAL pending a real
// DTL over-the-top clip. Wires into the verdict tomorrow after that calibration.
// 2026-08-13 (audit — S1) — this was "staged for calibration" on 08-10 and still had ZERO production
// consumers three days later, while over-the-top was being called from SHOULDER TILT, a body proxy.
// Staged is a legitimate state; staged-and-forgotten is how a finished measurement rots. The read is
// now CONSUMED, hedged while provisional, and the lock asserts the wire rather than memorialising the
// gap — a check that only says "it exists" lets it quietly go unused again.
check('Club-path read: DTL-gated plane geometry, provisional-honest, and actually WIRED',
  (() => {
    const cpr = read('services/swing/clubPathRead.ts');
    const detail = read('app/swinglab/swing/[swing_id].tsx');
    const built = (
      /export function readClubPath/.test(cpr) &&
      /if \(angle !== 'down_the_line'\) return EMPTY/.test(cpr) &&      // face-on refused, not fabricated
      /classification = 'over_the_top'/.test(cpr) && /classification = 'shallow'/.test(cpr) &&
      /provisional: true/.test(cpr)
    );
    // Consumed, and fed the SELF-CORRECTED angle from the biomech read — not the user's toggle, which
    // they can get wrong in daylight and would otherwise silently suppress the whole measurement.
    const wired = (
      /import \{ readClubPath \} from '\.\.\/\.\.\/\.\.\/services\/swing\/clubPathRead';/.test(detail) &&
      /readClubPath\(clubArcPoints, activeBiomech\?\.angle \?\? null\)/.test(detail) &&
      /clubPlane\.classification && clubPlane\.planeDeltaDeg != null/.test(detail)
    );
    return built && wired;
  })(),
  'the club-plane read is built, DTL-gated, honest when unmeasurable — and consumed on the swing detail with the angle-corrected read');

// 2026-08-13 (Tim — "not finishing the swing in the pump drill, or kind of not knowing exactly how to
// do it, has been my limitation"). That read as coaching copy and was actually a data defect: the drill
// was independently authored in FIVE files with FIVE rep counts — 3-then-swing, 4th-finishes,
// two-or-three-hit-on-the-third, twenty pumps, and 15-20. He wasn't failing to follow it; the app was
// telling him five different things. Same many-authors class as the caddie identity and the geometry
// writers, landing on the instruction meant to fix his swing.
check('LOCK: the pump drill has ONE rep protocol, imported — never five',
  (() => {
    const proto = read('data/drillProtocols.ts');
    const owner = /export const PUMP_DRILL: DrillProtocol/.test(proto) && /pumps: 3/.test(proto);
    const consumers = [
      'components/CageSessionOverlay.tsx',
      'services/coachKnowledge.ts',
      'services/knowledgeBase/modules/drills.ts',
      'data/drillCatalog.ts',
    ].every((f) => /PUMP_DRILL/.test(read(f)));
    // The five counts that were simultaneously live must not reappear. Restating the protocol is the
    // failure mode, so the guard forbids the STRINGS, not just a missing import.
    const noRelapse = [
      'components/CageSessionOverlay.tsx',
      'services/coachKnowledge.ts',
      'services/knowledgeBase/modules/drills.ts',
      'data/drillCatalog.ts',
      'services/drillRecommendation.ts',
    ].every((f) => !/Twenty pumps|15-20 slow pumps|two or three times|hit on the third/i.test(read(f)));
    return owner && consumers && noRelapse;
  })(),
  'one owner for the pump protocol (data/drillProtocols.ts); every surface imports it and no file restates a competing rep count');

// 2026-08-13 (live audit) — six real builds against the deployed engine: 2.6s, 3.2s, 6.4s, 80s, 80s
// and one past 120s. The client aborts at 30s, so about half the courses around Tim failed on device
// having ALREADY done the work — the serverless function runs to completion and persists a successful
// build to Course Cloud, which the handler reads before the OSM path on any later request. The
// geometry arrived; nothing asked for it again.
check('LOCK: a timed-out course build is re-asked, BOUNDED, and only when nothing is showable',
  (() => {
    const g = read('services/courseGeometryService.ts');
    const scheduled = /const timedOut = e instanceof Error && \(e\.name === 'TimeoutError' \|\| e\.name === 'AbortError'\);/.test(g) &&
      /if \(timedOut && !fallback\) scheduleGeometryRecheck\(courseId, options\);/.test(g);
    // BOUNDED is the property that matters most: an unbounded background retry on a player's battery
    // would be a worse defect than the one this fixes.
    const bounded = /const RECHECK_DELAYS_MS = \[[^\]]+\] as const;/.test(g) &&
      /if \(attempt >= RECHECK_DELAYS_MS\.length\) return;/.test(g);
    // and it must go back through the PUBLIC entry point so the in-flight dedupe still applies —
    // a re-ask that bypassed it would race a real user request and double the Overpass load.
    const deduped = /void fetchCourseGeometry\(courseId, options\)/.test(g);
    return scheduled && bounded && deduped;
  })(),
  'a timeout schedules a bounded re-ask through the deduped entry point, only when there is no bundled/persisted copy to show');

// 2026-08-13 (audit) — two ball-fit engines answer the same question on two screens, and they
// disagreed about where "slow" ends: ballFitting used 210, cnsBallFitting used 215. A 212-yard driver
// carry read "moderate" in the SwingLab Fit Profile and "a low-compression ball loads easier at your
// speed" on the caddie Ball Fit screen — same number, one of the most common amateur bands. The two
// READS stay separate by design (generic categories vs representative balls); the boundary is a fact
// about golf, so it gets one owner.
check('LOCK: both ball-fit reads share ONE set of speed-band boundaries',
  (() => {
    const bf = read('services/ballFitting.ts');
    const cns = read('services/cnsBallFitting.ts');
    const owner = /export const SPEED_BAND_CARRY_YDS = \{ slow: 210, fast: 250, tour: 275 \} as const;/.test(bf) &&
      /if \(carry < SPEED_BAND_CARRY_YDS\.slow\) return 'slow';/.test(bf);
    const shares = /import \{ SPEED_BAND_CARRY_YDS \} from '\.\/ballFitting';/.test(cns) &&
      /carry >= SPEED_BAND_CARRY_YDS\.fast/.test(cns) &&
      /carry >= SPEED_BAND_CARRY_YDS\.slow/.test(cns);
    // and the old inlined edge must not creep back into the CNS read
    const noRelapse = !/carry >= 215/.test(cns) && !/carry >= 250/.test(cns);
    return owner && shares && noRelapse;
  })(),
  'one owner for the carry speed bands; the CNS ball fit imports them instead of inlining its own edge');

// 2026-08-13 (one-voice pass) — api/kevin-read.ts declared "You are Kevin ... in Kevin's voice" and
// received no persona at all, so a player who chose Serena, Harry or Tank read a dashboard assessment
// in the wrong caddie's voice, naming the wrong caddie. Not drift between two prompts — a surface that
// COULDN'T speak as the caddie the player picked.
//
// The guard forbids the SHAPE: no server prompt may name a shipped persona as its own identity. Task
// prompts ("You are a swing analyst", "You are reading a scorecard") are untouched and should be —
// a JSON coordinate detector has no business being Kevin.
check('LOCK: no endpoint hardcodes WHICH caddie it is — identity comes from the player\'s choice',
  (() => {
    const files = [
      'api/kevin-read.ts', 'api/recap.ts', 'api/briefing.ts', 'api/lie-analysis.ts',
      'api/swing-question.ts', 'api/kevin.ts', 'api/pipecat-turn.ts', 'api/meta-voice.ts',
    ];
    const noHardcodedIdentity = files.every((f) => !/You are (Kevin|Serena|Harry|Tank)\b/.test(read(f)));
    // and the read that was broken must resolve the name the same way recap.ts does, from the body
    const kr = read('api/kevin-read.ts');
    const resolves = /getCaddieName\(personaInput\)/.test(kr) &&
      /body\.persona === 'string' \? body\.persona : \(body\.voiceGender \?\? 'male'\)/.test(kr);
    // a server that accepts a persona nobody sends is still broken — the client must send it, and it
    // must send caddiePersonality (voiceGender folds Tank and Harry back into Kevin).
    const clientSends = /persona: useSettingsStore\.getState\(\)\.caddiePersonality/.test(read('services/kevinReadService.ts'));
    return noHardcodedIdentity && resolves && clientSends;
  })(),
  'no endpoint names its own caddie; kevin-read resolves persona from the body and the client sends caddiePersonality');

// 2026-08-13 (speed work) — the metrics engine already computed club speed, ball speed and smash with
// an honest source hierarchy, and the KB already knew about overspeed bursts (focus.driver_speed). But
// DRILL_CATALOG had no speed entry, so the caddie could TALK about speed training and nothing could
// recommend or run it. Exactly the gap step-and-swing had this morning.
check('LOCK: speed training is runnable, and its copy never claims radar',
  (() => {
    const cat = read('data/drillCatalog.ts');
    const overlay = read('components/CageSessionOverlay.tsx');
    const idx = read('app/drills/index.tsx');
    // reachable: in the catalog, a real practice descriptor, and NOT hidden from the grid
    const inCatalog = /id: 'driver_speed'/.test(cat) && /focus: 'speed'/.test(cat);
    const notHidden = !/HIDDEN_DRILL_IDS[^\n]*driver_speed/.test(idx);
    const runnable = /\{ id: 'speed',/.test(overlay);
    // HONEST: SmartPlay owns no radar. The entry may talk about effort, tempo and trend — it may not
    // quote a clubhead-speed number, which would be a fabricated measurement dressed as coaching.
    const seg = cat.slice(cat.indexOf("id: 'driver_speed'"));
    const entry = seg.slice(0, seg.indexOf('videoCategory'));
    const noFakeNumber = !/\d+\s*mph/i.test(entry) && !/radar/i.test(entry.replace(/not own radar/i, ''));
    return inCatalog && notHidden && runnable && noFakeNumber;
  })(),
  'the speed drill is in the catalog with a speed focus, runnable in a cage session, visible on the grid, and quotes no radar-grade number');

// 2026-08-13 (live audit) — Pine Ridge, North Oxford returned NOTHING after 120s. The arithmetic:
// 15s per mirror x 3 mirrors walked sequentially = 45s for ONE query, and the handler runs several
// query stages in sequence. A course that loses every mirror on every stage runs past two minutes.
// Nobody is waiting by then — the client aborts at 30s — and a handler that never returns cannot even
// persist a partial build for the re-ask to collect.
check('LOCK: Overpass work is bounded by a TOTAL request budget, not just per-attempt',
  (() => {
    const g = read('api/course-geometry.ts');
    const budget = /const OVERPASS_TOTAL_BUDGET_MS = [0-9_]+;/.test(g) &&
      /function overpassBudgetLeftMs\(\)/.test(g);
    // the clock must actually be STARTED — an unstamped deadline makes the check inert and the walk
    // unbounded again, which is the defect wearing the fix's clothes.
    const stamped = /overpassDeadlineMs = Date\.now\(\) \+ OVERPASS_TOTAL_BUDGET_MS;/.test(g);
    // and it must be consulted BEFORE committing to a mirror, and cap that attempt to what's left
    const enforced = /const budgetLeft = overpassBudgetLeftMs\(\);/.test(g) &&
      /if \(budgetLeft < OVERPASS_MIN_ATTEMPT_MS\)/.test(g) &&
      /Math\.min\(OVERPASS_TIMEOUT_MS, budgetLeft\)/.test(g);
    return budget && stamped && enforced;
  })(),
  'the mirror walk stops when the request budget is spent, and no single attempt outlives what remains');

// 2026-08-13 (Tim — "putt analysis works pretty well so don't want to break it… would be cool to have a
// line show after putt analysis to the hole, maybe using a photo"). The line is drawn from coordinates
// the analysis returns, over a still re-extracted from the stored clip. Two things must stay true.
check('LOCK: the putt read line is OPTIONAL, and is never sold as the actual roll',
  (() => {
    const api = read('api/putting-analysis.ts');
    const overlay = read('components/swinglab/PuttReadLine.tsx');
    const card = read('components/swinglab/PuttingAnalysisCard.tsx');
    const extractor = read('services/puttFrameExtractor.ts');
    // 1) ADDITIVE. readLine must NOT be in the schema's root `required` list — a putt where the hole is
    //    out of frame has to return a complete, valid analysis exactly as it did before this existed.
    const rootRequired = api.slice(api.indexOf('      required: ['), api.indexOf('      properties: {'));
    const stillOptional = !/readLine/.test(rootRequired) && /readLine: \{/.test(api);
    // 2) the model must be told to OMIT it rather than guess where the hole is
    const omitsRatherThanGuesses = /OMIT readLine entirely if the hole is out of frame/.test(api);
    // 3) HONEST. This is the read, not a trace of the roll — puttRoll.ts is still unfed, so a caption
    //    implying "your putt" would be a claim the player cannot check.
    const labelledAsRead = /Not a trace of your actual roll/.test(overlay);
    // 4) the card only draws when it genuinely has both the coords and a clip
    const guardedRender = /analysis\.readLine && clipUri \?/.test(card);
    // 5) frame index -> time has ONE owner; a second copy of the phase fractions would drift and the
    //    line would then be drawn over the wrong still
    const oneOwner = /export function puttFrameTimeSec/.test(extractor) &&
      /puttFrameTimeSec\(readLine\.frameIndex/.test(overlay);
    return stillOptional && omitsRatherThanGuesses && labelledAsRead && guardedRender && oneOwner;
  })(),
  'readLine stays optional and omitted-when-unsure; the overlay is labelled the READ not the roll, renders only with real inputs, and shares one frame-time owner');

// 2026-08-13 (Tim — "I am getting automatic [reports] but they have my email on them. I wonder if they
// are actually other people's"). He could not tell, and the data was the reason: a report's only
// identity was `email || 'beta tester'`, so every tester who skipped the email field arrived as the
// same literal string. Five people and one person five times were indistinguishable, which made "is
// anyone actually using this?" unanswerable.
check('LOCK: issue reports carry an anonymous install id, attached once, with no schema risk',
  (() => {
    const svc = read('services/installId.ts');
    const exp = read('services/issueLogExport.ts');
    const api = read('api/issue-report.ts');
    // ONE owner that mints and persists it
    const owned = /export async function getInstallId/.test(svc) && /AsyncStorage\.setItem\(KEY/.test(svc);
    // attached at the single SEND point, not at each of the ~10 entry writers
    const attachedOnce = /const installId = await getInstallId\(\);/.test(exp) &&
      (exp.match(/getInstallId\(\)/g) ?? []).length === 1;
    // it must ride INSIDE context: that column is already JSON, so this needs no migration and cannot
    // break the insert. Verified live against the deployed endpoint before shipping.
    const noSchemaRisk = /\.\.\.\(e\.context && typeof e\.context === 'object' \? e\.context : \{\}\), installId/.test(exp);
    // and the owner has to be able to SEE it without opening the mail
    const surfaced = /const who = installId \? `\$\{reporter\} · \$\{installId\}` : reporter;/.test(api) &&
      /Install: \$\{installId \?\? 'unknown/.test(api);
    return owned && attachedOnce && noSchemaRisk && surfaced;
  })(),
  'one owner mints/persists the install id, it is attached once at the send path inside context (no migration), and the email surfaces it in the subject');

// 2026-08-14 (Tim's round at Berlin — white screens at the course, and when it loaded the app was a
// brick: loaded but unresponsive to any tap). That is the JS thread pegged, and this is what pegged it.
//
// On 08-13 commitGeometry began publishing markCommitted, which bumps `completions`. Two effects —
// the caddie tab's hole preview and SmartFinder — both FETCHED geometry and DEPENDED on completions,
// so the circuit closed: fetch → commit → completions++ → re-run → fetch. Invisible at a desk (warm
// cache commits nothing) and it starts on the first real build AT A COURSE. Worse, a build the client
// judges SUSPECT (zero mapped holes) is discarded and refetched, so it need not settle at all.
//
// The signal must cause a RE-READ, never another fetch. This guard forbids the shape everywhere.
check('LOCK: no effect both FETCHES geometry and depends on the completion signal',
  (() => {
    const files = [
      'app/smartfinder.tsx', 'app/smartvision.tsx', 'app/(tabs)/caddie.tsx', 'app/(tabs)/play.tsx',
      'app/course/[course_id].tsx', 'components/caddie/L1HolePreview.tsx',
    ];
    for (const f of files) {
      const s = read(f);
      // walk every useEffect; flag any whose dep array carries the completion signal AND whose body
      // calls fetchCourseGeometry. Reading (getHoleGeometry/getCachedGeometry) is fine and expected.
      let i = s.indexOf('useEffect(');
      while (i !== -1) {
        const seg = s.slice(i, i + 3000);
        const dep = seg.match(/\}, \[([^\]]*)\]\);/);
        if (dep) {
          const deps = dep[1];
          const body = seg.slice(0, dep.index);
          if (/geometryCompletions/.test(deps) && /fetchCourseGeometry\(/.test(body)) return false;
        }
        i = s.indexOf('useEffect(', i + 1);
      }
    }
    return true;
  })(),
  'geometry completion re-reads the cache; it never re-triggers a fetch, so commit -> bump -> fetch cannot loop');

// 2026-08-10 (Tim added a Gemini key for search grounding). The caddie can now SEARCH the live web for
// factual course/world info (grounded + cited, never fabricated) via a search_web tool on BOTH brain
// paths (universal). LOCK the round-trip: helper exists + tool declared + dispatched on pipecat AND kevin.
check('Caddie web search: grounded search_web tool wired on BOTH brain paths (universal)',
  (() => {
    const helper = read('api/_webSearch.ts');
    const turn = read('api/pipecat-turn.ts');
    const kevin = read('api/kevin.ts');
    const tools = read('api/_brainTools.ts');
    return (
      /export async function groundedSearch/.test(helper) &&
      /tools: \[\{ googleSearch: \{\} \}\]/.test(helper) &&                       // real Google Search grounding
      /GOOGLE_API_KEY \|\| process\.env\.GEMINI_API_KEY/.test(helper) &&           // accepts either key name Tim set
      // 2026-08-19 (lockstep reconciliation) — ONE declaration, imported by both brains; each brain
      // still has to EXECUTE it server-side (it is a SERVER_TOOL, not forwarded to the device).
      /name: 'search_web'/.test(tools) &&                                            // declared once
      /SERVER_TOOLS = new Set\(\[[^\]]*'search_web'/.test(tools) &&                  // classified server-executed
      /toolName === 'search_web'/.test(turn) &&                                      // pipecat executes it
      /name === 'search_web'/.test(kevin)                                            // kevin executes it
    );
  })(),
  'ask the caddie a real-world course/fact question and it searches the web (grounded, cited) on whichever brain answers — never a hallucinated fact');

// 2026-08-10 (connected audit #4 — logic universality; Tim: 'no more broken-up frustration'). Same
// question, same answer on every path: the English voice 'how far?' uses the SHARED resolveYardage
// (live/stated), not the raw static currentYardage; voice putts follow the SCORED hole (voicePuttsHole),
// not raw currentHole; swing narration speaks the ACTIVE per-pillar caddie (live == upload identity).
check('Logic universal: voice yardage + putts + swing-caddie match every other path',
  (() => {
    const vc = read('hooks/useVoiceCaddie.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    return (
      /const resolved = resolveYardage\(currentHole\)/.test(vc) &&              // #1 voice how-far uses shared resolver
      // #2 putts land on the SCORED hole, not the nav hole. 2026-08-12 — now stronger: the hole is
      // captured when the caddie ASKS (awaitingPuttsHole), with voicePuttsHole as the fallback, so an
      // answer given after a hole change still lands where the score did.
      /awaitingPuttsHole\(\) \?\? voicePuttsHole\(rs\)/.test(vc) &&
      // ...and the answer is intercepted on EVERY surface before anything can read it as a score.
      /isAwaitingPutts\(\)/.test(vc) && /isAwaitingPutts\(\)/.test(read('services/listeningSession.ts')) &&
      /getActiveCaddieForPillar\('cage'\)/.test(sm) &&                          // #3 narration = active caddie
      /caddie_name: analysisCaddie/.test(sm) && !/caddie_name: caddiePersonality/.test(sm)
    );
  })(),
  'asking how far / logging putts / hearing your swing read is the SAME on the voice shortcut as on the screen and the brain — no divergent path');

// ─── LOCK: React rules-of-hooks, repo-wide ────────────────────────────────────
// 2026-08-09 (Tim — "SMARTMOTION IS CRASHING WHEN I OPEN IT"). Root cause: three useCallbacks added
// 08-07 BELOW the camera-permission gate's early returns → hook count changed between renders →
// "Rendered more hooks than during the previous render", fatal AT OPEN, in the field, for every
// tester. tsc/jest/grep are all BLIND to this class — only the rules-of-hooks lint sees it. Shell out
// to eslint (~4s) and hard-fail the harness on ANY violation in app/components/hooks. This is a LOCK:
// do not remove; if eslint can't run, the check FAILS (a gate that can't see must not pass).
{
  let hooksViolations = -1;
  let detail = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('child_process') as typeof import('child_process');
    const out = execSync('npx eslint app components hooks --format json', {
      cwd: process.cwd(), encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
    const files = JSON.parse(out) as Array<{ filePath: string; messages: Array<{ ruleId: string | null; line: number; message: string }> }>;
    const hits = files.flatMap(f => f.messages.filter(m => m.ruleId === 'react-hooks/rules-of-hooks').map(m => `${f.filePath}:${m.line}`));
    hooksViolations = hits.length;
    detail = hits.slice(0, 5).join(', ');
  } catch (e) {
    // eslint exits 1 when ANY lint error exists — still parse its JSON from stdout.
    const stdout = (e as { stdout?: string }).stdout;
    if (typeof stdout === 'string' && stdout.trim().startsWith('[')) {
      try {
        const files = JSON.parse(stdout) as Array<{ filePath: string; messages: Array<{ ruleId: string | null; line: number; message: string }> }>;
        const hits = files.flatMap(f => f.messages.filter(m => m.ruleId === 'react-hooks/rules-of-hooks').map(m => `${f.filePath}:${m.line}`));
        hooksViolations = hits.length;
        detail = hits.slice(0, 5).join(', ');
      } catch { hooksViolations = -1; detail = 'eslint output unparsable'; }
    } else {
      detail = `eslint failed to run: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`;
    }
  }
  check('LOCK: zero react-hooks/rules-of-hooks violations repo-wide (conditional hooks = field-fatal render crash)',
    hooksViolations === 0,
    hooksViolations === 0 ? 'eslint clean' : `${hooksViolations === -1 ? 'CHECK COULD NOT RUN' : hooksViolations + ' violation(s)'}: ${detail}`);
}

// ─── 2026-08-10 (Tim's Connecticut National round) — three field bugs, locked ──────────────────

// "It's showing hospitals and hotels." Legacy Nearby Search silently DROPS an unrecognized `type`,
// and `golf_course` exists only in Places API (NEW) — so the filter never bound and every business
// in the radius came back. Lock all three layers of the fix; the phantom legacy filter must never
// return, because it fails OPEN (looks like bad ranking, not a broken filter).
check('LOCK: course-locate filters golf via Places(New) includedTypes + keyword fallback + name/type guard',
  (() => {
    const s = read('api/course-locate.ts');
    return (
      // primary: the New API, where golf_course is a real type
      /places\.googleapis\.com\/v1\/places:searchNearby/.test(s) &&
      /includedTypes:\s*\['golf_course'\]/.test(s) &&
      /X-Goog-FieldMask/.test(s) &&
      // fallback: legacy with a keyword (which legacy DOES honor), never the phantom type
      /keyword=\$\{encodeURIComponent\('golf course'\)\}/.test(s) &&
      !/[?&]type=golf_course/.test(s) &&
      // guard: golf evidence required on every row, whichever path produced it
      /function isGolfPlace/.test(s) &&
      /isGolfPlace\(p\)/.test(s) &&
      /NOT_A_COURSE_RE/.test(s)
    );
  })(),
  'no phantom legacy type=golf_course; New-API type filter + keyword fallback + isGolfPlace guard all present');

// "164-yard shot and the caddie defaults to gap wedge." One mis-attributed sample became a club's
// permanent average. The band must be enforced at INGEST *and* at READ — read-time is what heals a
// store already poisoned before the fix shipped, so dropping it silently strands existing players.
check('LOCK: club ladder plausibility band enforced at BOTH ingest and inferClub read',
  (() => {
    const s = read('store/clubStatsStore.ts');
    const ingestGuarded =
      /recordCarry:[\s\S]{0,400}?isPlausibleForClub\(club, yards, 'carry'/.test(s) &&
      /recordTotal:[\s\S]{0,400}?isPlausibleForClub\(club, yards, 'total'/.test(s);
    const readHeals = /inferClub:[\s\S]{0,2000}?isPlausibleForClub\(club, learned, 'total'[\s\S]{0,200}?expectedYards\(club, 'total'/.test(s);
    const bagFiltered = /inferClub:[\s\S]{0,2000}?bagKeys && !bagKeys\.has\(club\)/.test(s);
    return ingestGuarded && readHeals && bagFiltered;
  })(),
  'plausibility band at ingest + self-healing read + registered-bag filter');

// "Back at the main caddy tab, I still get green screen." The preview had only captured/curated
// imagery — no Mapbox tile — so any live-resolved course fell through to the SVG sketch's dark-green
// <Rect>. It must share SmartVision's tile builder so the two views can never disagree.
check('LOCK: L1HolePreview falls back to the same Mapbox hole tile SmartVision renders',
  (() => {
    const s = read('components/caddie/L1HolePreview.tsx');
    return (
      // 2026-08-11 — the import now also pulls getCenteredImageryUrl (the course-centroid fallback
      // that removes the green screen when hole geometry hasn't landed). Assert the tile builder is
      // imported, not the exact import list.
      /import \{[^}]*getHoleImageryUrl[^}]*\} from '\.\.\/\.\.\/services\/mapboxImagery'/.test(s) &&
      /aerialTileUrl/.test(s) &&
      // the tile is a FALLBACK: captured shot and curated bundle still win, in that order
      /capturedUri \? \(\{ uri: capturedUri \}[\s\S]{0,160}?curatedImage \?\? \(aerialTileUrl/.test(s) &&
      // the memo must sit ABOVE the isRoundActive early return (a hook below a gate crashes on open)
      s.indexOf('const aerialTileUrl') < s.indexOf('if (!isRoundActive)') &&
      // 2026-08-10 second pass — the PRE-ROUND branch returns before aerialTileUrl is ever reached,
      // so it needs its OWN tile or a selected course still shows "Pick a course on the Play tab".
      // That was the half missed the first time, and it's the green screen Tim saw again.
      /const previewTileUrl = useMemo/.test(s) &&
      /if \(previewTileUrl\) \{/.test(s) &&
      s.indexOf('const previewTileUrl') < s.indexOf('if (!isRoundActive)') &&
      // and the geometry has to be warmed pre-round or the cache the memo reads is always empty
      /PRE-ROUND geometry warm/.test(s) && /void fetchCourseGeometry\(id\)/.test(s)
    );
  })(),
  'Mapbox tile wired as third source, precedence preserved, hook above the gate');

// "Make sure my thumbnails in the Play tab ALWAYS work and populate when we add a new course, and
// that you get CORRECT thumbnails." `thumbnail` was hand-authored on the bundled course literals
// only, so every dynamically-sourced course rendered a placeholder. ONE resolver must serve EVERY
// thumbnail surface — a new surface that reads `.thumbnail` directly re-opens the hole.
check('LOCK: Play-tab thumbnails resolve through the single courseThumb() helper on every surface',
  (() => {
    const s = read('app/(tabs)/play.tsx');
    // the resolver exists and refuses unverifiable coords (no 0,0 ocean tiles)
    const resolver = /const courseThumb = \(/.test(s) && /isValidGolfCoord\(c\.lat, c\.lng\)/.test(s);
    // 2026-08-13 — the surfaces now call `thumbFor`, a component-level callback that wraps
    // courseThumb and is keyed on the geometry store's `completions`. courseThumb reads the geometry
    // cache during RENDER (it's the only thumbnail source a searched course has, since those records
    // carry no coords), so without that key nothing re-rendered when geometry landed and the rows
    // held the placeholder. Count the resolver the surfaces actually call — the lock is "one
    // resolver, every surface", not the identifier's spelling.
    const uses = (s.match(/thumbFor\(/g) ?? []).length;
    const oneResolver = /const thumbFor = useCallback\(/.test(s) && /=> courseThumb\(c\)/.test(s);
    // and it must stay subscribed: an unkeyed wrapper silently reopens the stale-thumbnail hole
    const subscribed = /useGeometryStatusStore\(st => st\.completions\)/.test(s) &&
      /\[geometryCompletions\],/.test(s);
    // and no surface renders a raw `.thumbnail` behind the resolver's back
    const noRawThumb = !/\{c\.thumbnail \? \(/.test(s) && !/source=\{c\.thumbnail as/.test(s);
    return resolver && oneResolver && subscribed && uses >= 8 && noRawThumb;
  })(),
  'courseThumb() is the only thumbnail path, coord-guarded, used at every Play-tab surface');

// "Holes are not always oriented correctly and the measuring tool does not often land on the teebox
// and green." Proven live: every Connecticut National hole measured 38-95y against a 137-527y card,
// because nearestUnassigned() paired each green with the NEXT hole's tee beside it. The scorecard
// yardage must constrain the pairing, and a pair that still disagrees must be REJECTED, not drawn.
check('LOCK: OSM tee↔green pairing is card-matched, and off-card pairs are rejected not drawn',
  (() => {
    const s = read('api/course-geometry.ts');
    return (
      /function bestByTargetYards/.test(s) &&
      // the tee selection specifically must use the card yardage, not raw nearest
      /h\.green[\s\S]{0,120}?bestByTargetYards\(h\.green, osmTees, usedTees, h\.yardage\)/.test(s) &&
      // and a pair that disagrees with the card drops the tee + bearing rather than rendering a lie
      /measured > h\.yardage \* 1\.35 \|\| measured < h\.yardage \* 0\.65/.test(s) &&
      /h\.tee = null;[\s\S]{0,80}?h\.bearing_deg = null;/.test(s)
    );
  })(),
  'card-constrained pairing + honest rejection of off-card tee→green pairs');

// Two SmartPlay projects exist in Google Cloud with different APIs enabled. No route may pin itself
// to a single key again — that's what left Places(New) unused while a project that had it sat idle.
check('LOCK: Google-backed routes walk EVERY configured project instead of pinning one key',
  (() => {
    const helper = read('api/_googleKeys.ts');
    const locate = read('api/course-locate.ts');
    const places = read('api/course-places.ts');
    const walker =
      /export async function withGoogleKeys/.test(helper) &&
      /export function isCapabilityMiss/.test(helper) &&
      // a quota-exhausted key must NOT silently spill onto the other project (hides a billing problem)
      !/OVER_QUERY_LIMIT/.test(helper.split('export function isCapabilityMiss')[1] ?? '') &&
      // keys are never serialized — diagnostics use the fingerprint
      /createHash\('sha1'\)/.test(helper);
    // neither route may reconstruct a module-level pinned key
    const noPinnedKey = [locate, places].every(s => !/^const KEY =/m.test(s));
    const bothWalk =
      /withGoogleKeys<Located\[\]>\('places-new:searchNearby'/.test(locate) &&
      /withGoogleKeys<Located\[\]>\('places-legacy:nearbysearch'/.test(locate) &&
      /withGoogleKeys<Found>\('places-legacy:findplace\+details'/.test(places);
    return walker && noPinnedKey && bothWalk;
  })(),
  'withGoogleKeys walker + capability-miss detection, no pinned KEY, both Places routes walking');

// "Make sure we're using computer vision correctly, and we're locating the green, the tee box, the
// fairway, hazards correctly and TIGHTLY." The scan must trace OUTLINES (points can't be tight),
// verify them, and the client must actually USE them — the derivation used to hardcode empty arrays.
check('LOCK: hole-scan traces + verifies tight outlines, and the derivation consumes them',
  (() => {
    const scan = read('api/hole-scan.ts');
    const der = read('services/holeGeometryDerivation.ts');
    const tracesAll =
      /green_polygon: POLY_OAI/.test(scan) && /tee_polygon: POLY_OAI/.test(scan) &&
      /fairway_centerline: POLY_OAI/.test(scan) && /hazards: \{ type: 'array', items: HAZARD_OAI \}/.test(scan);
    // outlines are VERIFIED, not trusted: vertex count + extent, so a full-frame "outline" is rejected
    const verified = /const poly = \(v: unknown, minPts: number, maxExtent: number\)/.test(scan) &&
      /if \(w > maxExtent \|\| h > maxExtent\) return null;/.test(scan);
    // the token budget must fit polygons — 500 was sized for 4 points and would truncate the JSON
    const budgetOk = (() => {
      const m = scan.match(/maxTokens: ([\d_]+),[^\n]*schema: HOLE_GEOMETRY_SCHEMA/);
      return m ? Number(m[1].replace(/_/g, '')) >= 2000 : false;
    })();
    // and the client must WIRE them through instead of the old hardcoded empties
    const consumed =
      !/hazards: \[\],\s*\n\s*fairway_centerline: \[\],\s*\n\s*green_outline: \[\],/.test(der) &&
      /green_polygon: greenOutline/.test(der) && /tee_polygon: teeOutline/.test(der) &&
      /bunkers,/.test(der) && /water_hazards: waters,/.test(der) &&
      // vision tees are scorecard-verified, same discipline as the OSM pairing fix
      /measured > cardYards \* 1\.35 \|\| measured < cardYards \* 0\.65/.test(der);
    return tracesAll && verified && budgetOk && consumed;
  })(),
  'outlines traced for green/tee/fairway/hazards, extent-verified, token budget sized for polygons, consumed by the derivation with card-verified tees');

// A z16 tile spans ~1990 yds, so a 30-yd green is ~15px — a hard resolution ceiling on "tightly",
// unfixable by prompting. The read MUST locate wide then re-centre and trace tight, and pixels must
// be unprojected against the tile that produced them or every coordinate silently shifts.
check('LOCK: hole geometry derives in two passes — locate wide, then trace on a re-centred tight tile',
  (() => {
    const d = read('services/holeGeometryDerivation.ts');
    const twoPass =
      /const TRACE_ZOOM = 18/.test(d) &&
      /scanTile\(seed, TILE_ZOOM,/.test(d) &&          // pass 1 locates on the wide tile
      /scanTile\(coarseGreen, TRACE_ZOOM,/.test(d);    // pass 2 traces re-centred on the found green
    // Pass 2 is the VERIFIER. A NEGATIVE VERDICT (found_green=false) must DISCARD the derivation —
    // that is what catches a high-confidence wide read landing on a house. A TRANSPORT failure
    // (null, no verdict reached) keeps the wide read. Collapsing those two cases back together
    // re-opens the false-positive that put a swimming pool on the map as a water hazard.
    const verifier =
      /\} else if \(tight && !tight\.found_green\) \{/.test(d) &&
      /trace pass DISPROVED the located green[\s\S]{0,200}?return null;/.test(d) &&
      /trace pass unreachable — keeping the wide read unverified/.test(d);
    // 2026-08-10 — `data` became nullable when the seeded path landed (seeded + no vision detail is
    // a valid outcome), so assert the INVARIANT — the tight read starts from the wide one and a
    // transport failure keeps it — rather than the exact type annotation.
    const failsSafe = /let data: HoleScanResponse(?: \| null)? = wide;/.test(d) && verifier;
    // and the prompt must name the residential decoys that produced that false positive
    const decoys = (() => {
      const s = read('api/hole-scan.ts');
      return /NOT A GOLF HOLE/.test(s) && /SWIMMING POOL/.test(s) && /DRIVEWAY/.test(s);
    })();
    if (!decoys) return false;
    // projection must be bound to whichever tile produced the data
    const boundProjection =
      /let tileCenter: LatLng = seed;/.test(d) && /let tileZoom = TILE_ZOOM;/.test(d) &&
      /toCoord = \(p: \{ x: number; y: number \} \| null\): LatLng \| null => unproject\(p, tileCenter, tileZoom\)/.test(d);
    // and the timeout must cover TWO vision calls, not one
    const budget = (() => {
      const m = d.match(/const REQUEST_TIMEOUT_MS = ([\d_]+)/);
      return m ? Number(m[1].replace(/_/g, '')) >= 60_000 : false;
    })();
    return twoPass && failsSafe && boundProjection && budget;
  })(),
  'locate-wide → trace-tight, fails safe to the wide read, projection bound to its own tile, timeout sized for two passes');

// "Most of it didn't load correctly" — production returned green 0/18 with tee 18/18, because the
// whole engine hung off ONE free Overpass endpoint and read a throttled EMPTY as "no greens exist".
// UNKNOWN must stay distinguishable from NONE, or an outage masquerades as an unmapped course.
check('LOCK: Overpass has mirrors, and unknown-greens never fills tees (parking-lot hole lines)',
  (() => {
    const s = read('api/course-geometry.ts');
    const mirrors = /const OVERPASS_MIRRORS = \[/.test(s) && (s.match(/api\/interpreter'/g) ?? []).length >= 3;
    const walker = /async function overpassQuery\(/.test(s) && /expectElements/.test(s);
    // fetchOsmFeatures must be able to say "unknown"
    const nullable = /async function fetchOsmFeatures\(centroid: Loc, feature: 'green' \| 'tee'\): Promise<Loc\[\] \| null>/.test(s);
    // a tee is meaningless without a green to orient it against
    const noOrphanTees = /const greensUnknown = greensRes == null;/.test(s) &&
      /const osmTees: Loc\[\] = greensUnknown \? \[\] : \(teesRes \?\? \[\]\);/.test(s);
    // and the osmOnly path must 503 (retryable) rather than 404 (genuinely unmapped) on an outage
    const retryable = /osmGreens == null[\s\S]{0,200}?503[\s\S]{0,120}?retryable: true/.test(s);
    return mirrors && walker && nullable && noOrphanTees && retryable;
  })(),
  '3 Overpass mirrors + empty-is-throttling retry; unknown greens suppress tee fill; outage returns retryable 503');

// "I got a par with two putt" was logged as a 2 — an eagle. Numbers must never outrank a NAMED
// score, and putt counts must be stripped before any number hunting. The parsing must also stay in
// a PURE module: while it lived in the handler (which imports roundStore → image assets) the logic
// suite could not load it, which is why this survived so long.
check('LOCK: score utterances read the WHOLE context — named score beats stray numbers',
  (() => {
    const p = read('services/intents/scoreParse.ts');
    const h = read('services/intents/logScoreHandler.ts');
    // "Pure" means it IMPORTS nothing — a prose mention of roundStore in the header comment is
    // fine, an actual import is what would make it unloadable by the logic suite again.
    const pure = /export function resolveStrokes/.test(p) && !/^\s*import\s/m.test(p);
    const stripsPutts = /export function stripNonScoreClauses/.test(p) && /putt\(\?:s\|ed\|ing\)\?/.test(p);
    // named score wins when present
    const precedence = /if \(mentionsScoreName\(paramStrokes\) \|\| mentionsScoreName\(rawText\)\)/.test(p);
    // earliest number by POSITION, not lowest by value
    const byPosition = /m\.index < best\.idx/.test(p);
    // handler delegates rather than keeping a second copy
    const wired = /resolveStrokes\(params\.strokes, intent\.raw_text, par\)/.test(h) && !/const words: Record<string, number>/.test(h);
    // and the putt count spoken in the same breath is captured, not re-asked
    const puttsRead = /export function parsePutts/.test(p) && /parsePutts\(intent\.raw_text\)/.test(h);
    return pure && stripsPutts && precedence && byPosition && wired && puttsRead;
  })(),
  'pure parser, putt clauses stripped, named score outranks numbers, earliest-by-position, putts captured from the same utterance');

// "Though it gives a readout, the little tile says no swing found." Two systems judged the same
// clip and only the SERVER's vision verdict drove the tile, so a false negative sat beside live
// on-device metrics. Measured turn+tempo must be able to override — while the floor-footage guard
// (which exists because carpet once produced a skeleton and an 82mph club speed) stays intact.
check('LOCK: swing verdict reconciles vision against on-device measurements (both directions)',
  (() => {
    const v = read('services/swingValidity.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    const reconciler = /export function reconcileSwingValidity/.test(v) && /export function hasMeasuredSwing/.test(v);
    // override requires rotation AND timing — either alone is reachable by noise
    const strict = /MIN_SHOULDER_TURN_DEG/.test(v) && /MIN_POSE_FRAMES/.test(v) &&
      /return splitOk \|\| ratioOk;/.test(v) && /if \(!rotated\) return false;/.test(v);
    // a good vision read is never downgraded by this path
    const neverDowngrades = /if \(base\.valid\) return base;/.test(v);
    // and the tile must actually consume the measurements
    const wired = /reconcileSwingValidity\(a, measured \?\? null\)/.test(sm) &&
      /const measuredEvidence: MeasuredSwingEvidence = useMemo/.test(sm) &&
      /deriveVerdict\(analysis, phase === 'analyzing', swingContact, measuredEvidence\)/.test(sm);
    return reconciler && strict && neverDowngrades && wired;
  })(),
  'measured turn+tempo overrides a vision false-negative; noise/floor footage still cannot; good reads never downgraded');

// "Once you get the OSM and you get the coordinates, then you zoom on the available tiles, and you
// orient it correctly." Vision must NEVER hunt for a green we already hold coordinates for — every
// false positive this pipeline produced came from the hunting, not the reading.
check('LOCK: vision is SEEDED from known coords — skips the search, orients from the surveyed axis',
  (() => {
    const d = read('services/holeGeometryDerivation.ts');
    const sv = read('app/smartvision.tsx');
    // seeded input skips the locate pass entirely
    const seeds = /knownGreen\?: LatLng \| null;/.test(d) && /knownTee\?: LatLng \| null;/.test(d) &&
      /SEEDED from known coords — skipping the locate pass/.test(d);
    // the surveyed tee wins outright, so a model can't rotate the hole
    const orientation = /let verifiedTee = input\.knownTee/.test(d) && /const teeIsKnown = verifiedTee === input\.knownTee/.test(d);
    // known coords are the LOCATION; a vision centre that drifts far discards its own detail
    const anchored = /const green = seeded \?\? visionGreen;/.test(d) && /visionDriftYds <= 60/.test(d) &&
      /const greenOutline = visionAgrees \?/.test(d);
    // a seeded read is never DISPROVED by vision — OSM outranks a model that couldn't see the edge
    const seededSurvives = /if \(seeded\) \{[\s\S]{0,240}?keeping OSM geometry/.test(d);
    // and SmartVision must actually run a detail pass on holes that already have coordinates
    const wired = /knownGreen: geo\.green,/.test(sv) && /needsDetail/.test(sv) && /:detail`/.test(sv);
    return seeds && orientation && anchored && seededSurvives && wired;
  })(),
  'known coords skip the search, surveyed tee owns orientation, drifting vision detail is discarded, seeded reads survive a vision miss, detail pass wired');

// Overpass throttles ~1-in-6 even across three mirrors, and that empty response used to be written
// straight over a good cached course — a transient upstream hiccup became PERMANENT local damage.
check('LOCK: the geometry cache never accepts a downgrade (empty read cannot erase a loaded course)',
  (() => {
    const g = read('services/courseGeometryService.ts');
    const measured = /export function mappedHoleCount/.test(g) && /h\.green != null/.test(g);
    const diskGuard = /refusing to overwrite/.test(g) && /refusing to downgrade/.test(g);
    // the in-memory cache needs the SAME guard or the course stays broken until app restart
    const memGuard = /async function commitGeometry/.test(g) && /keeping the better in-memory copy/.test(g);
    // and every fetch path must commit through it rather than setting caches directly
    // Exactly ONE unguarded set+write may exist — the one INSIDE commitGeometry, after its checks.
    // A second occurrence means a fetch path is writing the caches directly again, which is what
    // let an empty read erase a loaded course.
    const directWrites = (g.match(/memCache\.set\(courseId, geo\);\s*\n\s*await writePersistedCache\(geo\);/g) ?? []).length;
    const noDirectWrites = directWrites === 1;
    // the asset mapper that made this module testable at all must stay
    const testable = /imageAsset/.test(read('jest.config.js'));
    return measured && diskGuard && memGuard && noDirectWrites && testable;
  })(),
  'downgrade-proof disk + memory caches committed through one path; image-asset mapper keeps the module testable');

// "This is probably the FIFTH time we've tried to build the course engine." Every prior attempt made
// the LIVE Overpass dependency more reliable without REMOVING it, so the engine kept failing at some
// rate forever. A good build must become PERMANENT — persisted server-side and served to everyone.
check('LOCK: a successful course build is persisted server-side and survives a later Overpass failure',
  (() => {
    const g = read('api/course-geometry.ts');
    const c = read('api/_courseCloud.ts');
    // trusted first-party write, distinct from the public share endpoint's forced ai_vision
    const writer = /export async function recordServerBuild/.test(c) &&
      /source: 'osm',/.test(c) && /SERVER_CONTRIBUTOR/.test(c);
    // the public path must STILL force ai_vision — this must not become a spoofing hole
    const shareStillLocked = /const source = 'ai_vision';/.test(c);
    // write-back only when substantially mapped, and never blocking the response
    // 2026-08-10 — the write must be AWAITED, not fire-and-forget. Verified in production: a Vercel
    // function freezes once it responds, so a post-response write was killed partway and persisted
    // only holes 2-11 — a PARTIAL course made permanent, which is worse than none. It must also be
    // batched (one upsert, parallel recomputes) so it completes inside the request, and bounded so
    // a slow database can't become a slow round.
    const persists = /recordServerBuild\(db, cloudKey \?\? courseId/.test(g) &&
      /mappedNow >= CLOUD_COMPLETE_MIN/.test(g) &&
      /await Promise\.race\(\[persist,/.test(g) &&
      !/void \(async \(\) => \{[\s\S]{0,400}?recordServerBuild/.test(g) &&
      /upsert\(payload, \{ onConflict: 'course_id,hole,contributor_hash' \}\)/.test(c);
    // and a thin live build serves the STORED one instead of an empty course
    const fallsBack = /storedMapped > mappedNow/.test(g) && /source: 'stored_build'/.test(g);
    return writer && shareStillLocked && persists && fallsBack;
  })(),
  'server builds persist as trusted osm-rank rows (public share still forced to ai_vision), write-back is non-blocking + gated, thin builds serve the stored copy');

// "It only allows for one picture, and it hits an error." A scorecard is too wide to shoot legibly
// in one frame (1-9 + OUT, then 10-18 + IN), so people photograph the nines separately.
check('LOCK: scorecard ingest takes MULTIPLE photos and merges them without damaging good data',
  (() => {
    const ci = read('services/courseImport.ts');
    const ri = read('services/roundImport.ts');
    const sc = read('app/add-course.tsx');
    const multi = /export async function pickManyFromLibrary/.test(ri) && /allowsMultipleSelection: true/.test(ri) &&
      /export async function parseCourseScreenshots/.test(ci) && /export function mergeCourseImports/.test(ci);
    // a later photo may FILL a gap but never overwrite a value already read
    const nonDestructive = /if \(existing\.par == null && h\.par != null\)/.test(ci) &&
      /if \(existing\.yardage == null && h\.yardage != null\)/.test(ci);
    // an 18-column card needs resolution — 1280 made the digits unreadable
    const legible = /\[\{ resize: \{ width: 2000 \} \}\]/.test(ci);
    // one bad photo must not lose the whole import
    const tolerant = /if \(ok\.length === 0\)/.test(ci) && /couldn't be read/.test(ci);
    // and the screen must actually use the multi-picker
    const wired = /pickManyFromLibrary\(4\)/.test(sc) && /parseCourseScreenshots\(picked\.uris\)/.test(sc);
    return multi && nonDestructive && legible && tolerant && wired;
  })(),
  'multi-select picker + merge (gap-fill only, never overwrite), 2000px for legibility, partial-failure tolerant, wired into add-course');

// "The club trace does not work. It is not showing at all… you can see the club as easily as you can
// see the body… maybe we need to put a Zoom." His clip: player ~15% of frame height, whole frame
// downscaled to 640px, clubhead ~6px. Nothing finds a 6px object — the arc-shape gates that had been
// retuned for weeks were never the binding constraint. Crop to the player and spend pixels there.
check('LOCK: club trace ZOOMS to the player (pose-derived crop) instead of downscaling the frame',
  (() => {
    const cp = read('services/swing/clubPath.ts');
    const sm = read('app/swinglab/smartmotion.tsx');
    const roi = /export function roiFromBodyBounds/.test(cp) && /ROI_PAD_TOP/.test(cp);
    // the crop must be UPSCALED to the send width — that IS the zoom
    // multi-line object literal — match across whitespace rather than pinning the formatting
    const zooms = /actions\.push\(\{\s*crop:/.test(cp) && /actions\.push\(\{ resize: \{ width: DOWNSCALE_W \} \}\)/.test(cp);
    // detections come back in CROP space and MUST be mapped to full-frame or the arc draws in the
    // wrong place — every gate and the renderer reason in full-frame coords
    const mapsBack = /const fx = roi \? roi\.x \+ pos\.x \* roi\.w : pos\.x;/.test(cp) &&
      /const fy = roi \? roi\.y \+ pos\.y \* roi\.h : pos\.y;/.test(cp);
    // must NOT crop when the player already fills the frame (would clip the arc)
    const safe = /if \(bh >= 0\.55\) return null;/.test(cp);
    // and the caller has to actually supply the bounds, or the zoom never engages
    const wired = /function bodyBoundsFromPose/.test(sm) && /bodyBounds: bodyBoundsFromPose\(poseFrames\)/.test(sm);
    return roi && zooms && mapsBack && safe && wired;
  })(),
  'pose-derived ROI crop + upscale, detections mapped back to full-frame, no crop when the player already fills the frame, wired from SmartMotion');

// "I put this as course mode, but it's based on Canvas. It says Canvas fourteen feet, camera seven
// feet back. That doesn't apply to the course." Cage RIG geometry was stamped onto every shot map
// regardless of environment, so a swing on the tee was captioned with the net's dimensions.
check('LOCK: cage rig geometry (canvas/camera-behind) is recorded ONLY in cage mode',
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    // BOTH write sites must be gated — the save-time write and the live-commit mirror. Fixing one
    // leaves "Canvas 14 ft" reappearing on course via whichever path commits last.
    const gated = /const isCage = effectiveMode === 'cage';/.test(sm) &&
      /const isCageLive = effectiveMode === 'cage';/.test(sm) &&
      (sm.match(/canvasFeet: isCage(?:Live)? \? \(cageCanvasFeet \?\? null\) : null,/g) ?? []).length === 2 &&
      (sm.match(/cameraBehindFeet: isCage(?:Live)? \? \(cameraBehindFeet \?\? null\) : null,/g) ?? []).length === 2;
    // an active round must force course mode, or the gate reads the stale manual setting
    const roundForcesCourse = /effectiveMode: 'cage' \| 'range' \| 'course' = isRoundActive \? 'course' : environmentMode/.test(sm);
    // and the unconditional write must not come back
    const noUnconditional = !/canvasFeet: cageCanvasFeet \?\? null,/.test(sm);
    return gated && roundForcesCourse && noUnconditional;
  })(),
  'canvas/camera-behind only in cage mode; an active round forces course; no unconditional write');

// "The orientation is still completely wrong" then "when I restarted the app, it went back to a green
// screen." ONE root cause: the client cache served a persisted copy for a WEEK without refetching, so
// the broken geometry captured mid-round was pinned locally and no server fix could reach the device.
check('LOCK: geometry cache is versioned, self-healing, race-free, and purgeable',
  (() => {
    const g = read('services/courseGeometryService.ts');
    const root = read('app/_layout.tsx');
    // a pipeline version, stamped on write and enforced on read — so future fixes propagate without a key bump
    const versioned = /const GEOMETRY_PIPELINE_VERSION = \d+;/.test(g) &&
      /pipeline_version = GEOMETRY_PIPELINE_VERSION;/.test(g) &&
      /function cacheIsServable/.test(g);
    // the key bump that orphans today's poisoned entries on every device at once
    const bumped = /const CACHE_KEY_PREFIX = 'course-geometry-v3::';/.test(g);
    // a SUSPECT entry (old pipeline / zero mapped holes) must never be served, not even once more —
    // stale-while-revalidate is for OLD data, not for data we have reason to distrust
    const noSuspectServe = /const suspect =/.test(g) && /discarding suspect cache/.test(g);
    // one fetch per course, so concurrent surfaces can't triple-hammer Overpass or race the writer
    const antiRace = /const inflight: Map<string, Promise<CourseGeometry \| null>>/.test(g) &&
      /const pending = inflight\.get\(courseId\);/.test(g) &&
      /fetchCourseGeometryInner/.test(g);
    // buildup control + a real recovery path, and the sweep must actually RUN at launch
    const hygiene = /export async function sweepGeometryCache/.test(g) &&
      /export async function purgeCourseGeometry/.test(g) &&
      /MAX_CACHED_COURSES/.test(g) &&
      /sweepGeometryCache\(\)/.test(root);
    return versioned && bumped && noSuspectServe && antiRace && hygiene;
  })(),
  'pipeline-versioned cache, v3 key bump, suspect entries never served, one in-flight fetch per course, sweep at launch + purge escape hatch');

// "5G signal but it says we can't connect", four empty-transcript misses, and "switching the caddie
// seemed to bring voice back" — that last one is the tell: changing persona REMOUNTS the hook and
// clears a wedged busy-flag. Voice must self-heal without the user changing caddie.
check('LOCK: voice self-heals — stuck-turn watchdog, advisory probe, persistent in-character re-ask',
  (() => {
    const v = read('hooks/useVoiceCaddie.ts');
    // a busy flag with no escape is a one-way trap; the timestamp makes it recoverable
    const watchdog = /const processingSinceRef = useRef\(0\);/.test(v) &&
      /STUCK_TURN_MS/.test(v) && /wedged for/.test(v) &&
      /processingSinceRef\.current = Date\.now\(\);/.test(v);
    // a 3s probe must never veto a real upload — that's the 5G false-offline
    const probeAdvisory = /const probeSaysDown = !ping\.ok;/.test(v) &&
      /retrying the REAL upload before calling it offline/.test(v);
    // a miss must not be the same canned sentence forever — the caddie is a presence, not a tool
    const persists = /missStreakRef/.test(v) && /const askAgain =/.test(v) &&
      /missStreakRef\.current = 0;/.test(v);
    return watchdog && probeAdvisory && persists;
  })(),
  'wedged turns clear themselves (no caddie-switch needed), probe never vetoes a real upload, misses escalate in-character and reset on success');

// "Two pars and one bogey, and it would tell me to forget the last three." Mental state was
// ACCUMULATED by whichever surface logged the score — and the scorecard tab writes scores directly
// without reporting, so bad holes counted up while pars never counted down. Derive at the funnel.
check('LOCK: mental state is DERIVED from the scorecard at the one seam, never accumulated per-surface',
  (() => {
    const rel = read('store/relationshipStore.ts');
    const rnd = read('store/roundStore.ts');
    const derives = /recomputeMentalState: \(recent\) =>/.test(rel) &&
      /let badRun = 0;/.test(rel) &&
      // a par or bogey must END the run — that is the whole bug
      /if \(played\[i\]\.strokes - played\[i\]\.par >= 2\) badRun\+\+;\s*\n\s*else break;/.test(rel);
    // unknown par must never be judged — guessing invents bad holes
    const noGuessing = /filter\(x => x\.par > 0\)/.test(rnd);
    // and it must run inside logScore, the seam EVERY score path funnels through
    const atFunnel = /recomputeMentalState\(played\)/.test(rnd) &&
      rnd.indexOf('recomputeMentalState(played)') > rnd.indexOf('logScore: (hole, score) =>');
    return derives && noGuessing && atFunnel;
  })(),
  'trailing-run derivation (a par/bogey ends it), unknown par never judged, computed in logScore so no surface can skip it');

// "I went to put a coach's note… but that didn't ingest anywhere." The setter mapped ONLY over
// sessionHistory, so a note typed on a just-captured (still ACTIVE) session matched nothing and was
// dropped — a no-op map looks exactly like a successful write. Tim: "audited a hundred times for
// these specific things and they continue to be there." Presence-greps can't catch a write that
// lands nowhere; this guard checks the setter REPORTS, and that every child surface handles it.
check('LOCK: a coach note can never be silently dropped — setter reports, every surface handles it',
  (() => {
    const store = read('store/cageStore.ts');
    const detail = read('app/swinglab/swing/[swing_id].tsx');
    const sm = read('app/swinglab/smartmotion.tsx');
    // writes to BOTH activeSession and history, and returns whether it landed
    const reports = /setSessionCoachNote: \(sessionId: string, note: string \| null\) => boolean;/.test(store) &&
      /let landed = false;/.test(store) && /return landed;/.test(store) &&
      /activeSession: isActive && s\.activeSession/.test(store);
    // CHILD 1 — swing detail: a miss keeps the draft on screen instead of closing over lost text
    const child1 = /const landed = setSessionCoachNote\(sessionId, draft\);/.test(detail) &&
      /if \(!landed\) \{/.test(detail) && /return; \/\/ stay in edit mode/.test(detail);
    // CHILD 2 — SmartMotion: a note typed before ingest is HELD and flushed, never discarded
    const child2 = /pendingCoachNoteRef/.test(sm) &&
      /pendingCoachNoteRef\.current = coachNote;/.test(sm) &&
      /attached held coach note to session/.test(sm);
    return reports && child1 && child2;
  })(),
  'setter writes activeSession + history and returns landed; swing-detail keeps the draft on failure; SmartMotion holds a pre-ingest note and flushes it');

// "There's a section for coach's note, but not for MY OWN feedback. And we had that at one point.
// Like, how did that feel?" The feel field existed in SmartMotion review but never in the library,
// so a swing opened later had a place for a COACH's words and none for the player's. And
// setSessionFeel carried the IDENTICAL history-only defect as setSessionCoachNote — the twin that
// gets missed when only the reported instance is fixed.
check('LOCK: the player\'s own feel is capturable in the library, and its setter reports like the coach note',
  (() => {
    const store = read('store/cageStore.ts');
    const detail = read('app/swinglab/swing/[swing_id].tsx');
    // the twin setter must have the SAME fix, not just the reported one
    const twinFixed = /setSessionFeel: \(sessionId: string, note: string \| null\) => boolean;/.test(store) &&
      /setSessionFeel: \(sessionId, note\) => \{[\s\S]{0,800}?activeSession: isActive && s\.activeSession/.test(store);
    // the card exists in the library and is actually rendered
    const cardExists = /function FeelNoteCard\(/.test(detail) &&
      /<FeelNoteCard\s*\n?\s*sessionId=\{session\.id\}/.test(detail) &&
      /initialNote=\{session\.feel_note \?\? null\}/.test(detail);
    // and it never discards the player's words on a failed save
    const safeSave = /const landed = setSessionFeel\(sessionId, draft\);/.test(detail) &&
      /if \(!landed\) \{/.test(detail);
    return twinFixed && cardExists && safeSave;
  })(),
  'setSessionFeel fixed like its twin, FeelNoteCard rendered in the library, draft preserved on a failed save');

// "If I say I'm gonna use an eighteen degree driving iron, DON'T ASK ME WHICH IRON. Add that, put it
// in the bag, and correlate distances." Only WEDGE lofts (46-64) parsed, so a driving iron fell to
// null and the caddie interrogated him. Changing the bag mid-round must cost one sentence.
check('LOCK: driving/utility irons parse by name and by loft, into the right club FAMILY',
  (() => {
    const c = read('services/clubRecognition.ts');
    const named = /saysDrivingIron/.test(c) && /driving\|utility/.test(c.replace(/\s+/g, ''))
      || /\\b\(driving\|utility/.test(c);
    const byLoft = /const longLoft = p\.match/.test(c);
    // loft must route to the right family, not blanket-iron everything
    const families = /club_type: 'hybrid'/.test(c) && /club_type: 'wood'/.test(c) && /club_type: 'iron'/.test(c);
    // a named driving iron with no loft must still resolve — never a dead end
    const noDeadEnd = /if \(saysDrivingIron\) return \{ club_id: '3I'/.test(c);
    return named && byLoft && families && noDeadEnd;
  })(),
  'driving/utility iron by name and loft, hybrid/wood lofts stay in their own families, no dead end without a loft');

// "I still pull up Connecticut National and get green screens" + "instead of yardage you get, like,
// f w t z f". TWO causes, both proven: the client aborted the geometry fetch at 12s while the same
// production request measured 3-20s (intermittent by construction — his "little glimpses"), and the
// raw golfcourseapi id was rendered where the course NAME belongs.
check('LOCK: geometry fetch outlives a slow server, and a raw course id is never shown as a name',
  (() => {
    const g = read('services/courseGeometryService.ts');
    const sv = read('app/smartvision.tsx');
    const prev = read('components/caddie/L1HolePreview.tsx');
    // both fetch paths must outlast the measured worst case; 12s aborted a live request
    const timeouts = (g.match(/AbortSignal\.timeout\(30_000\)/g) ?? []).length >= 2 &&
      !/AbortSignal\.timeout\(12_000\)/.test(g);
    // a machine id is never a name — and pipeline labels aren't either
    // 2026-08-13 — was an IIFE, now a useMemo keyed on the geometry store's `completions`. The name
    // it resolves comes FROM the geometry build (`course_name`), so resolving it once during render
    // meant the pre-round path asked before the build landed, got '', and never re-derived. Accept
    // either form for the declaration, and require the key — the empty label was the same defect
    // class as the raw id, just failing quietly instead of loudly.
    const svName = /const derivedCourseLabel = (\(\(\) => \{|useMemo\()/.test(sv) &&
      /return ''; \/\/ never the raw id/.test(sv) &&
      /name !== 'Course Cloud'/.test(sv) &&
      /\}, \[effectiveCourseId, geometryCompletions\]\);/.test(sv);
    const prevName = /getCachedGeometry\(previewCourseId_resolved\)/.test(prev) &&
      !/if \(previewCourseId_resolved\) return previewCourseId_resolved;/.test(prev);
    return timeouts && svName && prevName;
  })(),
  '30s geometry timeouts on both paths; course name resolved from the cache, raw id never rendered');

// "STILL showing a gap wedge for a 324 yard shot" → then: "why are we basing it on EVIDENCE? We know
// a standard golf yardage bag, use that as the DEFAULT if we don't have a user-specific one."
// He was right. The ladder was built only from clubs with evidence, so ONE logged wedge meant a
// one-club ladder and every distance resolved to it. A complete standard bag must always be present.
check('LOCK: club selection starts from a COMPLETE standard bag, personalised per club',
  (() => {
    const e = read('services/distance/equipment_distance_modifier.ts');
    // the full industry ladder is built FIRST, then user numbers overlay it club by club
    const fullBag = /for \(const club of getIndustryClubOrderByCarryDesc\(\)\)/.test(e) &&
      /rowByKey\.set\(key, \{ key, \.\.\.value \}\);/.test(e) &&
      /const rowByKey = new Map/.test(e);
    // "take enough club" means the SHORTEST club that reaches — searching the DESC list returned the
    // longest, i.e. the driver on every shot it could cover
    const conservative = /const ascending = \[\.\.\.sorted\]\.reverse\(\);/.test(e) &&
      /const conservative = ascending\.find/.test(e);
    // and sparse/absurd evidence can still never claim a shot it cannot reach
    const gate = /REACH_FLOOR/.test(e) && /REACH_CEILING/.test(e);
    return fullBag && conservative && gate;
  })(),
  'complete standard bag baseline + per-club personalisation, shortest-club-that-reaches, reach floor/ceiling');

// PASS 2 of the three-pass course-data audit. Two defects found in what production was ACTUALLY
// serving, both invisible to earlier greps because the code "looked right":
//   - the STORED build hardcoded bearing_deg to null, so every hole arrived with coordinates and NO
//     AXIS once a course was served from storage — which is the normal path now. Measured: 0/18
//     bearings on Connecticut National while tee and green were 18/18. That is the orientation bug
//     Tim kept reporting AFTER the pairing fix was verified correct.
//   - green_front/green_back were the green CENTROID, so FRONT/MIDDLE/BACK were the same number
//     three times: fake precision worth up to two clubs on a deep green.
check('LOCK: stored geometry carries a derived bearing, and F/M/B has real green depth',
  (() => {
    const cc = read('api/_courseCloud.ts');
    const cg = read('api/course-geometry.ts');
    // bearing is DERIVED (tee→green), never stored, so the stored path must compute it
    const bearing = /function bearingDeg\(/.test(cc) &&
      /bearing_deg: tee && green \? bearingDeg\(tee, green\) : null,/.test(cc) &&
      !/^\s*bearing_deg: null,$/m.test(cc);
    // front/back come from the real green ring, nearest/farthest from the TEE
    // The rings must come from the SAME Overpass call as the fill. A separate second query for
    // them was verified empty in production (throttling), so bearings landed while F/M/B stayed
    // three copies of one number — the fix looked shipped and did nothing.
    const depth = /real green depth \(front\/back from polygon\)/.test(cg) &&
      /const \[greenRingsRes, teesRes\] = await Promise\.all\(\[/.test(cg) &&
      /const ring = ringByCentroid\.find\(g => haversineYards\(g\.centroid, h\.green!\) < 12\)/.test(cg) &&
      !/const greenRings = await fetchOsmPolygons\(centroid, 'green'\);/.test(cg);
    return bearing && depth;
  })(),
  'stored builds carry orientation; front/back derived from the green polygon rather than echoing the centroid');

// 2026-08-13 (live audit — I built four real courses against the deployed engine instead of reading
// it). Pakachoag came back as NINE PAR 4s of 84-164 yards. The estimate badge was already honest that
// this path's coordinates are synthesized — that half was fixed on 08-09 — but par was hardcoded to 4,
// so the card contradicted itself. An 84-yard par 4 is not an uncertain reading, it is an impossible
// one, and it is what makes a player stop believing the numbers that ARE right.
check('LOCK: a built hole\'s par is MEASURED, never assumed — no path emits a hardcoded par',
  (() => {
    const cg = read('api/course-geometry.ts');
    // Neither OSM path may emit a literal par. Both derive from the tee→green distance.
    const noHardcoded = !/^\s*par: 4,\s*$/m.test(cg);
    const holeWayDerives = /const par = w\.par \?\? \(center <= 215 \? 3 : center >= 460 \? 5 : 4\);/.test(cg);
    const pairingDerives = /const par = !p\.tee \? 4 : yardage <= 215 \? 3 : yardage >= 460 \? 5 : 4;/.test(cg);
    // and the speculative pairing path must stop echoing the centroid for front AND back once it has
    // matched a real green ring — three identical yardages is a green with no depth.
    const pairingDepth = /h\.green_front = front;/.test(cg) && /h\.green_back = back;/.test(cg);
    return noHardcoded && holeWayDerives && pairingDerives && pairingDepth;
  })(),
  'par derived from measured distance on both OSM paths; the pairing path gives F/M/B real depth from the matched ring');

// Re-check pass (Tim: "go back and check your work one more time"). Found by re-reading my own fix,
// not by a failure: bagDistances() keys are ClubName ('7I'), STANDARD_LADDER is labelled ('7 Iron').
// Merging raw ADDED the same club twice — skewing the bag extremes and letting the caddie speak a
// store key at the player. A measured club must REPLACE its chart counterpart.
check('LOCK: measured clubs map onto the ladder label — never a duplicate, never a store key spoken',
  (() => {
    const c = read('services/cnsShotRead.ts');
    return (
      /const LADDER_LABEL: Record<string, string>/.test(c) &&
      /const label = LADDER_LABEL\[club\] \?\? club;/.test(c) &&
      /merged\.set\(label, d\);/.test(c) &&
      /measured\.add\(label\);/.test(c) &&
      // and the raw-key merge must not come back
      !/merged\.set\(club, d\); measured\.add\(club\);/.test(c)
    );
  })(),
  'ClubName→ladder-label mapping so a measured club replaces its chart twin instead of duplicating it');

// "The skeleton's back to showing up PRE-SWING again on playback… it'll start before the swing or
// the user's even in the frame." interpolateFrame CLAMPED, so outside the pose window it returned
// the address (or finish) frame and drew a skeleton over walk-up footage and empty grass.
check('LOCK: the skeleton is drawn ONLY inside the pose window, never clamped onto other footage',
  (() => {
    const pi = read('services/swing/poseInterpolate.ts');
    const ov = read('components/swinglab/SwingBodyOverlay.tsx');
    const windowed =
      /POSE_EDGE_TOLERANCE_MS/.test(pi) &&
      /if \(timeMs < first - POSE_EDGE_TOLERANCE_MS\) return null;/.test(pi) &&
      /if \(timeMs > last \+ POSE_EDGE_TOLERANCE_MS\) return null;/.test(pi);
    // The pure module must stay importable by the logic suite. Assert on real IMPORT statements —
    // a prose mention of react-native in the header comment is fine and tripped this guard once.
    const pure = !/^\s*import .*from '(react-native|react-native-svg)'/m.test(pi);
    // and the component must USE it rather than keeping a private copy that can drift
    const wired = /import \{ interpolateFrame \} from '\.\.\/\.\.\/services\/swing\/poseInterpolate'/.test(ov) &&
      !/^function interpolateFrame\(/m.test(ov);
    return windowed && pure && wired;
  })(),
  'pose-window bounds with an edge tolerance, in a pure testable module the overlay imports');

// "A couple of our courses still have the GOLF SHOT screenshots in them. We need to check all of
// them." All 30 bundled sets were fingerprinted by dimensions and the outliers inspected: three
// carried another app's UI (Golfshot/Golf Pad info buttons, yardage overlays, green rings, player
// dots, cut-out-on-white). They must never be bundled again — Metro ships what is `require`d.
check('LOCK: no third-party (Golfshot / Golf Pad) hole imagery is bundled',
  (() => {
    const li = read('data/localCourseImages.ts');
    // the three third-party folders must have ZERO requires anywhere in the registry
    const noRequires = !/require\('\.\.\/assets\/courses\/(webster-dudley|rancho-california)\//.test(li);
    // and their maps must still EXIST (exported, empty) so consumers don't break
    const stillExported =
      /export const RANCHO_CALIFORNIA_HOLE_IMAGES: Record<number, ImageSourcePropType> = \{\};/.test(li) &&
      /export const WEBSTER_DUDLEY_HOLE_IMAGES: Record<number, ImageSourcePropType> = \{\};/.test(li);
    // the intermediate WD const was the sneaky one — it kept the requires alive after the export
    // was emptied, so the files would still have shipped.
    const noIntermediate = !/const WD = \{\s*\n\s*1: require/.test(li);
    return noRequires && stillExported && noIntermediate;
  })(),
  'third-party hole imagery unregistered (no requires => not bundled), maps still exported empty so consumers are unaffected');

// "On the very first pass, when that's the money shot that shows people, there's a failure. You'll
// get an error where it says it ca[n't]… but then you'll get some data. In swing library it'll work."
// A cold cloud read fails → analysisError set. The on-device pose then lands and is meant to clear
// it, but the clear sat AFTER `if (!pi) return` — and pi is null exactly when there is NO DOMINANT
// FAULT. i.e. on a GOOD swing. The better the swing, the more likely it showed a failure banner.
check('LOCK: a measured on-device read clears the transient cloud error, fault or no fault',
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    // the clear must happen BEFORE any fault-shaped early return
    const clearIdx = sm.indexOf('if (biomech) setAnalysisError(null);');
    const piIdx = sm.indexOf('const pi = poseReadToPrimaryIssue(buildPoseSwingRead(biomech, tempo));');
    const clearsFirst = clearIdx > 0 && piIdx > 0 && clearIdx < piIdx;
    // and a clean swing must not be RECORDED as a failed analysis
    const statusFixed = /no fault to name — the measured read stands on its own/.test(sm) &&
      /if \(biomech\) \{[\s\S]{0,220}?setSessionAnalysisStatus\(sessionId, 'ok'\);/.test(sm);
    return clearsFirst && statusFixed;
  })(),
  'transient cold-cloud error cleared by any measured read; a no-fault swing is recorded ok, not failed');

// Field log: gps_error stale_hard_clear sinceMs 300000, and on the course "every now and then the
// GPS would fire correctly… just little glimpses". The hard clear nulled the fix and then WAITED —
// expo-location's watch dies silently on Android Doze with the subscription still non-null, so
// nothing recovered. A restart existed but only fired on background→foreground, which during a
// round never happens.
check('LOCK: a five-minute GPS gap RESTARTS the watch instead of waiting passively',
  (() => {
    const g = read('services/gpsManager.ts');
    const selfHeals = /stale_hard_clear_restart_watch/.test(g) &&
      /await restartWatch\(\);[\s\S]{0,120}?await getOneShotFix\(\)/.test(g);
    /**
     * 2026-08-14 — tightened after the first real tester reports came in. The old condition here was
     * `roundActive || !wasAccurate`, which still logged with NO round whenever accuracy was unknown —
     * and a hand-placed mark has unknown accuracy by definition, so a manual mark outside a round
     * reported a GPS fault every cycle, forever. Three of the four inbound reports were exactly that.
     *
     * A GPS fault only means something when a round depends on the fix, and a position the player
     * placed by hand is not a satellite reading that can go stale. Both paths now require an active
     * round and skip manual marks.
     */
    const quiet = /const wasAccurate = \(lastFix\.accuracy_m \?\? 999\) <= 10;/.test(g) &&
      /if \(roundActive && !isManualMark\) \{/.test(g) &&
      // the degrade path must be equally quiet, or the noise just moves
      /if \(!isBenignStationaryStale && !isManualMark && roundActive\) \{/.test(g);
    return selfHeals && quiet;
  })(),
  'hard clear restarts the watch + takes a one-shot; benign stationary clears stay out of the log');

// "On the scorecards, a lot of times it'll have a course layout that gives us some kind of references
// to work from. Make sure that's ingested correctly. INJECTION and logic are key." The importer read
// the table only — the printed map is the one place a card says which way a hole BENDS.
check('LOCK: scorecard layout diagrams are read AND injected where the caddie reads them',
  (() => {
    const api = read('api/course-import.ts');
    const svc = read('services/courseImport.ts');
    const courses = read('data/courses.ts');
    // read: shape + drawn hazards, and explicitly null when there is no diagram
    const reads = /COURSE LAYOUT DIAGRAM/.test(api) &&
      /dogleg_left/.test(api) && /"layout": null/.test(api) &&
      // the extra array needs headroom or the whole JSON truncates and the parse fails
      /maxTokens: 3500/.test(api);
    // merged like the table: first good reading wins, null (not []) when no card had a map
    const merges = /const layoutByHole = new Map<number, CourseLayoutHole>/.test(svc) &&
      /layoutByHole\.size > 0 \? \[\.\.\.layoutByHole\.values\(\)\]/.test(svc) &&
      /if \(existing\.shape == null && l\.shape != null\)/.test(svc);
    // INJECTION — it must land on the field every hole consumer already reads
    const injected = /function describeHoleLayout\(/.test(courses) &&
      /note: describeHoleLayout\(h\.shape \?\? null, h\.hazards \?\? null\)/.test(courses);
    return reads && merges && injected;
  })(),
  'layout read from the card map (null when absent), merged non-destructively, injected into hole notes the brain already reads');

// ADVERSARIAL AUDIT (Tim: "assume you only half-assed it"). Five real defects in my OWN last-96h
// work. Each is the same shape: the reported instance fixed, its twins left alive.
check('LOCK: adversarial-audit fixes — 5th club producer, mental-state overwrite, twin setters, inline component',
  (() => {
    const lsr = read('services/localStatusResponder.ts');
    const cage = read('store/cageStore.ts');
    const bil = read('app/swinglab/bilateral.tsx');
    const rs = read('store/roundStore.ts');

    // 1) the FIFTH club producer — the offline voice line the caddie SPEAKS
    // The defect lived here TWICE (club reply + reach reply). One shared builder now, and the
    // sparse read must appear exactly ONCE — inside that builder — so a third reply can't
    // reintroduce it by copying the old line.
    const fifth = /STANDARD_SPOKEN_LADDER/.test(lsr) && /SPOKEN_LADDER_LABEL/.test(lsr) &&
      /function spokenBag\(\)/.test(lsr) &&
      (lsr.match(/for \(const \[club, yds\] of Object\.entries\(bagDistances\(\)\)\)/g) ?? []).length === 1 &&
      !/const bag = Object\.entries\(bagDistances\(\)\) as \[string, number\]\[\];/.test(lsr) &&
      (lsr.match(/const \{ entries: bag \} = spokenBag\(\);/g) ?? []).length === 2;

    // 2) mental state: NOTHING may re-accumulate after logScore derives it
    const files = ['app/(tabs)/caddie.tsx', 'services/intents/logScoreHandler.ts',
                   'services/voice/conversationalToolDispatch.ts'];
    const noOverwrite = files.every(f => !/(?<!\/\/ *)\.updateMentalState\(/.test(read(f)));
    const derives = /recomputeMentalState\(played\)/.test(rs);

    // 3) every session setter writes activeSession too — no more history-only twins
    const setterMisses = [...cage.matchAll(/^      (setSession\w+|toggleSession\w+): \(/gm)]
      .filter(m => {
        const seg = cage.slice(m.index ?? 0, (m.index ?? 0) + 1400);
        return seg.includes('sessionHistory') && !seg.slice(0, 1200).includes('activeSession');
      });

    // 4) no hook-bearing component defined inside another component's body
    const hoisted = /^function FrameTile\(/m.test(bil) && !/  const FrameTile = \(/.test(bil);

    return fifth && noOverwrite && derives && setterMisses.length === 0 && hoisted;
  })(),
  '5th club ladder merged from standard; zero updateMentalState callers left; all session setters write activeSession; FrameTile hoisted out of render');

// TOTAL QA PASS (Tim: "check my courses… make sure the measuring tool lines up on the green and the
// tee box"). Comparing every bundled hole's stored tee→green against its OWN scorecard distance
// found 35 of 452 holes contradicting themselves — Westlake NJ 14/14, Echo Hills 7/8, Greenhill
// 14/16 long holes — all measuring a near-constant ~150y regardless of hole length. A tee 150y from
// the green on a 416y hole draws the wrong line and reports a wrong number with total confidence.
check('LOCK: bundled tees are validated against the scorecard before anything can measure from them',
  (() => {
    const c = read('data/courses.ts');
    const validates = /function validateBundledTees\(/.test(c) &&
      /measured > h\.distance \* 1\.35 \|\| measured < h\.distance \* 0\.65/.test(c) &&
      // the GREEN must survive — live F/M/B depends on it; only the contradictory TEE is dropped
      /teeLat: 0, teeLng: 0,/.test(c);
    // and it must run at the SINGLE seam every consumer already uses, not at some call sites
    const atSeam = /return validateBundledTees\(course\?\.holes \?\? \[\]\);/.test(c) &&
      !/return course\?\.holes \?\? \[\];/.test(c);
    return validates && atSeam;
  })(),
  'bundled tee/green pairs validated against their own scorecard at getBundledHoles; contradictory tees dropped, greens kept');

// "If the bundled courses are causing the issue, then they need to be replaced with the new engine
// courses, but they need to be BUILT because testers are on them." Bundled coords ALWAYS won for
// hint-less local courses, on a premise ("OSM scrambles routing") that predates the osm_holeways
// pass. Measured on Greenhill: bundled 14/16 holes contradict their own card; engine 17/18 correct.
check('LOCK: the engine replaces bundled coords that fail their own scorecard — with a safe fallback',
  (() => {
    const g = read('services/courseGeometryService.ts');
    // bundled only wins when it is TRUSTWORTHY (enough holes survived tee validation)
    const gated = /const bundledIsTrustworthy = \(\(\) => \{/.test(g) &&
      /if \(bundled && bundledIsTrustworthy\) \{/.test(g) &&
      // the old unconditional "bundled always wins" must not come back
      !/if \(bundled\) \{ memCache\.set\(courseId, bundled\);/.test(g);
    // and a failed engine build must NOT leave a tester with less than they had
    const safeFallback = /let bundledFallback: CourseGeometry \| null = null;/.test(g) &&
      (g.match(/bundledFallback \?\? buildBundledGeometry\(courseId\)/g) ?? []).length === 2;
    return gated && safeFallback;
  })(),
  'untrustworthy bundled coords yield to an engine build; a failed build falls back to them rather than to nothing');

// "For the TENTH time, Connecticut National is still a green screen and has no thumbnail in the Play
// tab." Both surfaces could only learn WHERE a course is from the geometry cache, so a searched
// course showed nothing until a multi-second build landed — and nothing at all if it failed. The
// course record we already fetched carries lat/lng; the search payload (verified live) does not.
check('LOCK: a selected course can always draw itself — centroid captured at selection',
  (() => {
    const rs = read('store/roundStore.ts');
    const play = read('app/(tabs)/play.tsx');
    const prev = read('components/caddie/L1HolePreview.tsx');
    // the store holds the centroid, and an id-only call can't wipe it
    const stored = /previewCourseCoords: \{ lat: number; lng: number \} \| null;/.test(rs) &&
      /setPreviewCourse: \(id, coords\) => set\(\{/.test(rs) &&
      /coords !== undefined \|\| id == null/.test(rs);
    // both selection paths supply it — API courses from the record, bundled from the summary
    const passed = /useRoundStore\.getState\(\)\.setPreviewCourse\(c\.id, cCoords\);/.test(play) &&
      /setPreviewCourse\(\s*s\.id,/.test(play);
    // the preview draws the centroid when hole geometry isn't there yet
    const draws = /if \(!previewCourseCoords\) return null;/.test(prev) &&
      /getCenteredImageryUrl\(\{/.test(prev);
    // and the thumbnail resolves coords from cached geometry for searched courses
    const thumb = /const geo = getCachedGeometry\(c\.id\);/.test(play);
    return stored && passed && draws && thumb;
  })(),
  'course centroid captured at selection; preview and thumbnail no longer depend on geometry timing');

// Tim: "Make sure the measuring tool lines up on the green and the tee box." A scorecard yardage is
// the measuring tool's expected answer, so bundled geometry that can't reproduce its own card is not
// ground truth. greenhill/westlake/echo-hills were 51%/61%/40% out and still outranked the engine,
// because the trust test COUNTED coordinates instead of checking them — 16 of 18 present was enough.
check('LOCK: bundled geometry outranks the engine only if it reproduces its own scorecard',
  (() => {
    const g = read('services/courseGeometryService.ts');
    const accuracy = /const measurable = bundled\.holes\.filter/.test(g) &&
      /Math\.abs\(measured - h\.yardage!\) \/ h\.yardage!/.test(g) &&
      /return mean <= 0\.25;/.test(g);
    const presence = /if \(withTee < Math\.ceil\(bundled\.holes\.length \* 0\.5\)\) return false;/.test(g);
    const noDemoteOnNoEvidence = /if \(measurable\.length < 3\) return true;/.test(g);
    const keepsFallback = /bundledFallback = bundled \?\? null;/.test(g);
    return accuracy && presence && noDemoteOnNoEvidence && keepsFallback;
  })(),
  'trust is measured against the card, not counted; too-little-evidence never demotes; bundled stays the fallback');

// ═══════════════════════════════════════════════════════════════════════════════
// 2026-08-17 — ONE MICROPHONE. Tim: "there's still a difference in the logic between the Caddie mic
// and the Caddie tab avatar… the Caddie mic acts just like an earbud tap. It goes 'I'm here', and
// then right away almost goes 'I didn't catch that'. Everything's supposed to be unified."
//
// It was: the bottom-bar mic IS listeningSession.toggle(), the same function the earbud subscribes
// to — while the Caddie tab avatar runs useVoiceCaddie's own recorder. TWO microphone owners with
// no arbiter. A tap on one spoke its go-ahead cue and then found the mic held by the other, and
// reported that as the user's failure to speak.
//
// These guards assert ORDER and REACHABILITY, not the presence of a string — a mic-claim that sits
// AFTER the cue is the exact bug, and it would pass any presence check.
// ═══════════════════════════════════════════════════════════════════════════════

check('LOCK: the caddie claims the mic BEFORE it promises to listen (no cue over a busy mic)',
  (() => {
    const ls = read('services/listeningSession.ts');
    const open = ls.slice(ls.indexOf('async function openSession()'));
    const iHandover = open.indexOf('await releaseExternalMic()');
    const iCue = open.indexOf("playVerbalCue('listen'");
    const iCapture = open.indexOf('captureUtteranceDetailed(');
    // Order is the whole point: handover → cue → capture. Anything else re-opens the bug.
    const ordered = iHandover > -1 && iCue > iHandover && iCapture > iCue;
    // A handover that SUBMITTED a real utterance must stand this turn down, not talk over the reply.
    const standsDown = /handover === 'submitted'[\s\S]{0,400}?setSessionStateMirror\('idle'\);[\s\S]{0,40}?return;/.test(open);
    return ordered && standsDown;
  })(),
  'handover runs before the go-ahead cue and before capture; a submitted utterance stands the new turn down');

check('LOCK: "Didn\'t catch that" is spoken ONLY when the mic actually heard nothing',
  (() => {
    const ls = read('services/listeningSession.ts');
    const vs = read('services/voiceService.ts');
    // The bail reason must exist and reach the caller — a bare string|null cannot tell a busy mic
    // from a silent user, which is what made the caddie blame the user for its own failure.
    const typed = /export type CaptureBail/.test(read('services/voice/captureBail.ts')) &&
      /export type \{ CaptureBail \};/.test(vs) && /return done\('mic_busy'\)/.test(vs) &&
      /return done\('transcribe_failed'\)/.test(vs) && /done\('empty'\)/.test(vs);
    // …and the mic-busy bail must be VISIBLE. It was invisible for months, so an empty issue log
    // was read as a healthy mic path.
    const logged = /logVoiceSilentFail\('capture_mic_busy'/.test(vs);
    // The notice branch must key on the reason via the jest-owned pure rule (services/voice/
    // captureBail), not on inline booleans a later branch can quietly contradict.
    const cb = read('services/voice/captureBail.ts');
    const ruleOwned = /case 'mic_busy':[\s\S]{0,120}?return 'mic_trouble';/.test(cb) &&
      /case 'transcribe_failed':[\s\S]{0,60}?return 'connection';/.test(cb);
    const honest = ruleOwned &&
      /const say = responseForCaptureBail\(bail\);/.test(ls) &&
      /micNeverOpened \? micTroubleFor\(lang\) : CADDIE_NOTICE_DIDNT_CATCH/.test(ls) &&
      /transcribeFailed[\s\S]{0,200}?speakHonestFailure\(/.test(ls);
    // A deliberate cancel is not a failure and must not mail Tim.
    const cancelQuiet = /if \(!silentBail\) logVoiceSilentFail\('listen_no_transcript'/.test(ls);
    return typed && logged && honest && cancelQuiet;
  })(),
  'capture reports WHY it came back empty; mic failures are owned, transcribe failures named, cancels stay silent');

check('LOCK: a mic that never opened is retried, not reported as a failure to hear',
  (() => {
    const ls = read('services/listeningSession.ts');
    // Ported from useVoiceCaddie's restartFresh — and BOUNDED: only the two hardware bails, one
    // retry, and never for a capture that simply heard nothing (that would re-open a hot mic).
    const cb = read('services/voice/captureBail.ts');
    const retries = /if \(shouldRetryCapture\(capture\.bail\) && \(state as SessionState\) === 'listening'\)/.test(ls) &&
      /return bail === 'mic_busy' \|\| bail === 'error';/.test(cb);
    const reclaims = /if \(capture\.bail === 'mic_busy'\) await releaseExternalMic\(\)/.test(ls);
    const bounded = (ls.match(/capture = await runCapture\(\);/g) ?? []).length === 1;
    return retries && reclaims && bounded;
  })(),
  'mic_busy/error retry once with the mic reclaimed; a genuinely silent capture is never retried');

check('LOCK: the app cannot tap its own mic twice (the 334ms double-open)',
  (() => {
    const v = read('hooks/useVoiceCaddie.ts');
    const h = v.slice(v.indexOf('const handleMicPress = useCallback'));
    const iGuard = h.indexOf('sinceLastEntry < MIC_PRESS_REENTRY_MS');
    const iStop = h.indexOf('if (recordingRef.current) {');
    const iStart = h.indexOf('// ── START recording');
    // The guard has to be at the ENTRY. The prior <300ms guard sat downstream of the teardown and
    // missed the field case by 34ms precisely because it ran after the recording was already torn down.
    return iGuard > -1 && iStop > iGuard && iStart > iGuard &&
      /const MIC_PRESS_REENTRY_MS = \d+;/.test(v) &&
      /lastMicPressAtRef\.current = Date\.now\(\);/.test(h);
  })(),
  're-entry guard runs before the stop/start branches, so a duplicate handover cannot tear down a fresh mic');

check('LOCK: a second tap means the same thing on the avatar and on the caddie mic',
  (() => {
    const v = read('hooks/useVoiceCaddie.ts');
    const h = v.slice(v.indexOf('const handleMicPress = useCallback'));
    const iSubmit = h.indexOf("getSessionState() === 'listening'");
    const iForceClose = h.indexOf('forceCloseSession()');
    // While the mic is open the avatar must DEFER to the session's own endpoint (submit), and that
    // check must come FIRST — reaching forceCloseSession while listening discards the utterance,
    // which is the asymmetry: same two taps, answered or binned depending on which icon you touched.
    const defersFirst = iSubmit > -1 && iForceClose > iSubmit && /toggleListeningSession\(\)/.test(h);
    // And the reverse direction: a handover of a capture that heard speech submits it.
    const submitsSpeech = /if \(heardSpeech && uri\)[\s\S]{0,300}?processAudioUri\(uri\)[\s\S]{0,80}?return 'submitted';/.test(v);
    // ALL THREE mic owners must be releasable. The follow-up-listen loop holds the mic through
    // captureInProgress with no recordingRef to see, so a check that only knows the tap path would
    // leave the original symptom alive on the path where the caddie had just asked a question.
    const vs = read('services/voiceService.ts');
    const bothOwners = /if \(captureInProgress\) \{[\s\S]{0,600}?endCaptureEarly\(\);[\s\S]{0,200}?stopCapture\(\)/.test(vs) &&
      /while \(captureInProgress && Date\.now\(\) < deadline\)/.test(vs) &&
      /currentCaptureHeardSpeech = true;/.test(vs);
    return defersFirst && submitsSpeech && bothOwners;
  })(),
  'tap-while-listening submits on both surfaces; neither path can bin an utterance the other would have answered');

// ═══════════════════════════════════════════════════════════════════════════════
// 2026-08-17 — THE WATCH IS A REP SOURCE, and a guard that reads a field that doesn't exist.
//
// Tim: "when you sim around or do your hotel drills, the watch should be able to pick up motion for
// that… I don't know if that would be duplicitous or the information would crash."
// ═══════════════════════════════════════════════════════════════════════════════

check('LOCK: the watch-tempo fallback reads a REAL timestamp, not a field that never existed',
  (() => {
    const smRaw = read('app/swinglab/smartmotion.tsx');
    const store = read('store/watchStore.ts');
    // Assert on CODE, not prose. The comment above the fix necessarily quotes the broken expression
    // to explain it, and a naive source-wide match reads that quotation as the bug still being
    // present — a guard failing on its own documentation. Strip comments first.
    const sm = smRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // The guard read `last.at` through a cast while watchStore stamps `timestamp` — so the typeof
    // test was always false, the ternary always fell to its permissive branch, and the 90s window
    // never applied. The cast is what hid it from the compiler.
    const noPhantomField = !/\(\s*last\s+as\s+\{\s*at\?/.test(sm);
    const readsRealField = /Date\.now\(\) - last\.timestamp < WATCH_TEMPO_MAX_AGE_MS/.test(sm);
    const fieldExists = /^\s*timestamp: number;/m.test(store);
    // ...and no permissive `: true` fallback left in that expression to re-open the hole.
    const notPermissive = !/const fresh = [\s\S]{0,200}?:\s*true;/.test(sm);
    return noPhantomField && readsRealField && fieldExists && notPermissive;
  })(),
  'the 90s freshness window actually applies — a stale watch swing cannot attach itself to this strike');

check('LOCK: SwingSim + Hotel Mode take reps from the watch, not only the phone gyro',
  (() => {
    const sim = read('app/swinglab/simround.tsx');
    const hotel = read('app/swinglab/indoor.tsx');
    const wired = (s: string) => /useWatchReps\(\{/.test(s) && /from '\.\.\/\.\.\/hooks\/useWatchReps'/.test(s);
    // Passive by design: a drill screen must never switch the wrist sensor on by itself — capture is
    // armed by the player on the watch. Assert neither screen reaches for a start/stop control.
    const passive = !/startWatchCapture|WearSwingBridge\.start/.test(sim + hotel);
    // A watch rep must be scored as the mode the player armed, not a hardcoded one.
    const modeCarried = /mode: armedMode/.test(sim) && /setArmedMode\(mode\)/.test(sim);
    return wired(sim) && wired(hotel) && passive && modeCarried;
  })(),
  'both drill screens accept watch reps, stay passive about arming, and score them as the armed mode');

check('LOCK: one physical swing logs ONE rep, whichever IMU reads it',
  (() => {
    const sim = read('app/swinglab/simround.tsx');
    const hotel = read('app/swinglab/indoor.tsx');
    const wr = read('services/swing/watchRep.ts');
    // BOTH sources must pass through the same gate. A gate on only the watch side would still
    // double-count whenever the watch happened to report first.
    const bothGated = (s: string) => /dedupeRef\.current\.take\('phone'/.test(s) && /dedupeRef\.current\.take\('watch'/.test(s);
    // Same-source reps must NEVER be suppressed — two fast reps on one IMU are two real swings.
    const sameSourceAllowed = /if \(this\.lastSource === source\) return false;/.test(wr);
    // Per-screen instance, not a module global two mounted surfaces would share.
    const perScreen = /export class RepDedupe/.test(wr) && /useRef\(new RepDedupe\(\)\)/.test(sim) && /useRef\(new RepDedupe\(\)\)/.test(hotel);
    return bothGated(sim) && bothGated(hotel) && sameSourceAllowed && perScreen;
  })(),
  'cross-IMU echoes are dropped at both screens; same-source reps and the dedupe window are untouched');

check('LOCK: a wrist rep never claims what the wrist cannot measure',
  (() => {
    const wr = read('services/swing/watchRep.ts');
    // Dwell isn't measured by the watch → 0, never a plausible-looking invention.
    const honestDwell = /transitionDwellMs: 0,/.test(wr);
    // The putting decel read needs a through-stroke accel profile the watch doesn't send.
    const noThroughStroke = !/throughStroke:/.test(wr);
    // And an unreadable swing is discarded rather than surfaced as a bad rep.
    const discards = /if \(backswingMs <= 0 \|\| downswingMs <= 0\) return null;/.test(wr);
    // Every rep is labelled with the IMU that produced it, both ways.
    const labelled = /source: 'watch',/.test(wr) && /source: 'phone',/.test(read('services/indoorSwing.ts'));
    return honestDwell && noThroughStroke && discards && labelled;
  })(),
  'watch reps carry measured times only — no invented dwell, no putting decel claim, source always labelled');

// ═══════════════════════════════════════════════════════════════════════════════
// 2026-08-17 (learning-layer audit, Phase 0) — ONE BRAIN MUST REACH BOTH CLIENT SEAMS.
//
// The pipecat brain emits the same tool actions regardless of which mic was used, but the two
// client receivers had drifted: the earbud / bottom-bar path routes everything through
// services/voice/conversationalToolDispatch, while app/(tabs)/caddie.tsx handled a subset and
// merely LOGGED the rest. recommend_club (which stamps pendingKevinRec → kevin_rec_club on the next
// ShotResult) and register_bag both fell in that hole on the Caddie tab.
//
// This guard asserts the SHAPE, not the two instances: every tool the shared dispatcher can run
// must be reachable from the tab seam. Adding a case to one file can no longer leave the other deaf.
// ═══════════════════════════════════════════════════════════════════════════════

check('LOCK: every brain tool the shared dispatcher runs is reachable from the caddie-tab seam too',
  (() => {
    const tab = read('app/(tabs)/caddie.tsx');
    const disp = read('services/voice/conversationalToolDispatch.ts');
    const cases = (s: string) => new Set(
      [...s.matchAll(/case '([a-z_]+)'/g)].map((m) => m[1]),
    );
    const dispatcherTools = cases(disp);
    // The tab's own switch lives inside handleToolAction; scope to it so unrelated switches in the
    // 4,900-line file can't make this pass by accident.
    // Search the end anchor FORWARD from the start index: `const handleMicPressRef` is declared
    // earlier in the file and its name is a prefix of `const handleMicPress`, so a plain indexOf
    // returns the earlier offset and silently yields an empty slice.
    const hStart = tab.indexOf('const handleToolAction');
    const handler = tab.slice(hStart, tab.indexOf('const handleMicPress', hStart));
    const tabTools = cases(handler);
    // The default branch must DELEGATE — that is what makes the remainder reachable. Without it,
    // every tool below is silently swallowed and this guard's set-math would be meaningless.
    const defaultDelegates = /default: \{[\s\S]{0,3000}?dispatchConversationalToolActions\(\[action\]\)/.test(handler);
    // With a delegating default, reachability is total. Report the delta for the log either way.
    const unreachable = [...dispatcherTools].filter((t) => !tabTools.has(t));
    if (!defaultDelegates && unreachable.length) {
      console.log('   [seam-drift] tools the caddie tab would swallow:', unreachable.join(', '));
    }
    // recommend_club specifically: it is NOT in the ToolAction union, so the compiler cannot catch
    // its absence. Pin that the dispatcher still owns it and the tab can now reach it.
    const recClubOwned = /case 'recommend_club':/.test(disp) && /setPendingKevinRec\(/.test(disp);
    return defaultDelegates && recClubOwned;
  })(),
  'the tab seam delegates unknown brain tools to the one dispatcher, so recommend_club/register_bag can no longer be dropped on one mic only');

// ═══════════════════════════════════════════════════════════════════════════════
// 2026-08-17 (Tim — "club logic, I don't know why we've had such issues with it, but everything
// needs to be super super clean with it because it's the whole point of golf").
// ═══════════════════════════════════════════════════════════════════════════════

check('LOCK: adherence compares clubs across VOCABULARIES, never raw string equality',
  (() => {
    const res = read('services/shotClubResolver.ts');
    const cn = read('services/clubNormalize.ts');
    const corr = read('services/intents/correctLastShotHandler.ts');
    // The three sides speak different vocabularies: the brain's free text ("8 iron"), setClub's
    // verbatim string, and inferClub's canonical ClubName ("8I"). `===` between them recorded a
    // player who hit exactly the advised club as having ignored it.
    const normalizes = /export function sameClub/.test(res) &&
      /const na = normalizeClub\(a\);/.test(res) && /const nb = normalizeClub\(b\);/.test(res);
    const noRawEquality = !/adhered: recClub != null \? c === recClub/.test(res) &&
      !/round\.club === recClub/.test(res);
    // The correction handler always normalized — which is why adherence could silently FLIP to
    // correct if a shot happened to be corrected by voice. Both paths must agree now.
    const correctionAgrees = /normalizeClub\(parsed\.club_id\) === normalizeClub\(kevinRecClub\)/.test(corr);
    // Loft/number vocabulary must be shared, not duplicated, between the token and phrase parsers.
    const sharedNumbers = /export function digitizeNumberWords/.test(cn) &&
      /digitizeNumberWords\(phrase\.trim\(\)\)/.test(read('services/clubRecognition.ts'));
    return normalizes && noRawEquality && correctionAgrees && sharedNumbers;
  })(),
  'club comparison normalizes both sides; the phrase and token parsers share one number vocabulary');

check('LOCK: an app-inferred club is attribution, never "advice the player followed"',
  (() => {
    const res = read('services/shotClubResolver.ts');
    const qs = read('services/intents/queryStatusHandler.ts');
    const disp = read('services/voice/conversationalToolDispatch.ts');
    const eng = read('services/smartAnalysisEngine.ts');
    // inferClub(yards) is the APP guessing. It shares the pendingKevinRec slot with real advice,
    // and adherence measured against it fed the recap's "you took my club" rate.
    const kindsTagged = /kind: 'inferred'/.test(qs) && /kind: 'spoken'/.test(disp) && /kind: 'engine'/.test(eng);
    const inferredExcluded = /return kind !== 'inferred';/.test(res);
    // An inferred stamp must not be written into kevin_rec_club either — that would put a club in
    // the caddie's mouth that they never said.
    const recClubGated = /const recClub = advice \? pendingClub : null;/.test(res);
    return kindsTagged && inferredExcluded && recClubGated;
  })(),
  'spoken/engine recommendations score adherence; inferred stamps attribute the club only');

check('LOCK: the body read does not wait for the video player to load',
  (() => {
    /**
     * 2026-08-24 (Tim, range session) — "seems to happen in two stages where you get partial then I
     * tap the screen and it populates more data."
     *
     * The pose/biomech pass is gated on videoDurationMs, and the ONLY writer was the review
     * player's onLoad callback — so SWING BREAKDOWN and SPEED arrived from the server while BODY,
     * sway, tilt and weight sat blank until the video element loaded. The tap was loading it. The
     * duration is known at ANALYSIS time in every branch (metered free during recording, or probed
     * once), so seeding it there starts the body read with everything else.
     *
     * Assert the SHAPE: onLoad is no longer the sole writer.
     */
    const sm = read('app/swinglab/smartmotion.tsx');
    const writers = (sm.match(/setVideoDurationMs\(/g) ?? []).length;
    const seededAtAnalysis = /if \(durMs > 0\) setVideoDurationMs\(durMs\)/.test(sm);
    // 2 clears + the onLoad writer + at least one analysis-time seed.
    return seededAtAnalysis && writers >= 5;
  })(),
  'video duration is seeded when analysis knows it, so BODY fills without a tap');

check('LOCK: the acoustic strike classifier actually reaches the CONTACT card',
  (() => {
    /**
     * 2026-08-24 (Tim, range session) — "since we have acoustic pickup it should know number of
     * shots and be able over the course of a session to know a pure strike for contact and smash
     * versus not."
     *
     * services/acousticsAnalyzer graded pure/good/okay/bad and flush/heel/toe/fat/thin for months.
     * analyzeStrike() had ONE caller (lie analysis) and toCageContact() had NONE, while SmartMotion's
     * CONTACT card printed "Strike not cross-checked on this swing" with ACOUSTIC PICKUP reading
     * "Calibrated" directly beside it. A classifier with no consumer is the Learning-Golfer-Model
     * shape all over again [[the-app-usually-already-knows]].
     *
     * Assert the CHAIN: the screen grades the strike from data it already has, and the card renders
     * the result. Not the wording — the wiring.
     */
    const sm = read('app/swinglab/smartmotion.tsx');
    const grades = /analyzeStrike\(\{/.test(sm) &&
      /noise_floor_db: res\.floorDb/.test(sm) &&   // the floor the detector MEASURED, not a guess
      /decay_db: decayDb/.test(sm);                // computed from the 50ms buffer already captured
    const rendersOnContact = /key: 'contact'/.test(sm) && /acousticRead/.test(sm);
    // The old dead-end string must not be the ONLY thing the card can say.
    const notOnlyTheDeadEnd = /caddie_note/.test(sm);
    // A low-confidence read must fall back rather than dress a guess as a measurement.
    const honestUnknown = /quality !== 'unknown'/.test(sm);
    return grades && rendersOnContact && notOnlyTheDeadEnd && honestUnknown;
  })(),
  'the microphone grades the strike and the CONTACT card shows it; an unconfident read falls back');

check('LOCK: the microphone registry holds EVERY owner, not just the last one to register',
  (() => {
    /**
     * 2026-08-24 (Tim, range session) — "when you stop recording in SmartMotion it asks about going
     * another session but it's not listening."
     *
     * The registry was a single SLOT whose entire membership was useVoiceCaddie's tap-path
     * recording. The acoustic impact detector holds a live Audio.Recording for the whole SmartMotion
     * session and was never in it, so the caddie finished a set, asked a question, opened the mic,
     * and hit "Only one Recording object can be prepared at a given time" — the exact collision the
     * registry exists to prevent. Asking a question you cannot hear the answer to is the worst
     * version of canned speech: it sounds like a caddie and behaves like a recording.
     *
     * A slot also FORGETS the previous owner on the next register(), which is how a second holder
     * stayed invisible through two earlier passes at this same bug. Assert the SHAPE — a collection
     * and a loop — not the membership, so a third owner cannot be added without joining it.
     * [[guard-the-shape-not-the-file-list]]
     */
    const vs = read('services/voiceService.ts');
    const ac = read('services/acousticImpactDetector.ts');
    // A collection of owners, not a slot.
    const isSet = /const externalMicChecks = new Set</.test(vs) &&
      /const externalMicReleases = new Set</.test(vs);
    // Busy if ANY owner says busy.
    const anyHolds = /for \(const fn of externalMicChecks\)/.test(vs);
    // A user turn releases EVERY owner, not the first.
    const releasesAll = /for \(const release of externalMicReleases\)/.test(vs);
    // ...and the recorder that caused this actually joins.
    const acousticJoins = /registerExternalMicCheck/.test(ac) && /registerExternalMicRelease/.test(ac);
    /**
     * 2026-08-24, same day, second pass — I registered acousticImpactDetector for Tim's SmartMotion
     * bug and SHIPPED it, then checked afterwards: app/swinglab/smartmotion.tsx has ZERO references
     * to that module. The recorder it actually holds is services/swing/audioMetering, which was not
     * in the registry either — so the "fix" hardened a real path (the cage overlay) and left the
     * reported one untouched. Assert BOTH, because the registry's whole history is discovering one
     * more owner than anyone remembered. [[my-measurement-is-the-least-reliable-part]]
     */
    const am = read('services/swing/audioMetering.ts');
    const meteringJoins = /registerExternalMicCheck/.test(am) && /registerExternalMicRelease/.test(am) &&
      /leaveOwnership\(\)/.test(am);   // ...and LEAVES on both stop() and cancel(), or it deadlocks the mic
    // The old single-slot assignment must be gone, or the set is decorative.
    const slotGone = !/externalMicCheck = fn/.test(vs) && !/externalMicRelease = fn/.test(vs);
    return isSet && anyHolds && releasesAll && acousticJoins && meteringJoins && slotGone;
  })(),
  'every mic owner is registered and released; SmartMotion cannot deafen the question the caddie just asked');

check('LOCK: per-club tendencies are DERIVED, sent, and actually read by the brain',
  (() => {
    const ct = read('services/clubTendency.ts');
    /**
     * 2026-08-23 — RE-AIMED, and this one was proving the chain on a path nobody walks.
     *
     * The "consumed" half asserted against api/pipecat-turn.ts. That brain no longer answers a
     * single turn — every surface posts to api/kevin now — so the guard was green while saying
     * nothing about whether the caddie the player talks to has ever seen a club tendency.
     * [[grep-guards-cant-see-dead-code]]: a string-presence check passes on unreachable code.
     */
    const ctx = read('services/caddieRequestBody.ts');
    const brain = read('api/kevin.ts');
    // Producer: per-club, not bag-wide. patternDetection pools miss across every club, which is why
    // no individual club ever had a character.
    const derives = /export function clubTendencies/.test(ct) &&
      /export const MIN_SHAPE_SHOTS/.test(ct) && /export const DOMINANT_SHARE/.test(ct);
    // Club identity must go through the normalizer or one club splits into several rows.
    const normalized = /normalize\(s\?\.club \?\? null\)/.test(ct) && /cn\.normalizeClub/.test(ctx);
    // Sent on the ONE payload every surface builds...
    const sent = /club_tendencies: safe/.test(ctx) && /describeBagTendencies/.test(ctx);
    // ...and READ by the brain that actually answers. A producer with no consumer is the exact
    // shape the learning-layer audit found in the Learning Golfer Model: a perfect chain nobody's
    // turn reached.
    // 2026-08-23 — was /How his clubs actually behave/, which pinned a PRONOUN. The prompt moved to
    // they/them (the app never knew the player's gender, so "he" was a guess it had no business
    // making) and this guard failed on a change that improved the very thing it protects. Assert
    // the chain, never the wording: [[guard-the-shape-not-the-file-list]].
    const consumed = /club_tendencies = \[\],/.test(brain) &&
      /clubs actually behave/.test(brain);
    // The SCREEN must read the same pure module as the brain. Two derivations of "what this club
    // does" would eventually disagree, and the player would be shown one thing while the caddie
    // reasoned from another — the exact drift this codebase keeps paying for.
    const fit = read('app/practice/fit-profile.tsx');
    const screenSharesSource = /clubTendencies\(all, \(\) => null, normalizeClub\)/.test(fit) &&
      /from '\.\.\/\.\.\/services\/clubTendency'/.test(fit);
    return derives && normalized && sent && consumed && screenSharesSource;
  })(),
  'club tendencies derive per-club from logged shots, ride the context, reach the system prompt, and the bag screen reads the SAME module');

check('LOCK: NO surface drops a located swing before the evidence for it has arrived',
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    const seg = read('services/swing/swingSegmentation.ts');
    const up = read('services/videoUpload.ts');
    const det = read('services/poseDetection.ts');
    const range = sm.slice(sm.indexOf("if (stopMode === 'range')"), sm.indexOf('if (segsForAnalysis.length > 0)'));
    // ORDER is the whole invariant. The gate previously ran on the video list BEFORE
    // correlateStrikesWithVideo, so a swing the microphone heard was already deleted by the time the
    // acoustic evidence arrived — and 'low' means "couldn't SEE the ball leave" (net / out of frame),
    // not "practice swing", which the locator prompt excludes on its own.
    const iCorrelate = range.indexOf('correlateStrikesWithVideo(');
    const iGate = range.indexOf("filter((s) => s.confidence !== 'low')");
    const gateAfterFusion = iCorrelate > -1 && iGate > iCorrelate;
    const noPreGate = !/const conf = swings\.filter\(\(sw\) => sw\.confidence !== 'low'\)/.test(range);
    // 2026-08-19 — this guard used to be SCOPED TO THE RANGE SLICE while three sibling copies of the
    // same gate lived on (cage, swing-library re-analyze, upload ingest). It proved the instance and
    // said nothing about the class, which is exactly how the other three survived the fix that named
    // them. It now forbids the SHAPE everywhere. [[run-the-second-pass-yourself]]
    //
    // CAGE: adopt on the RAW video count (the gate used to shrink the number the go/no-go compared, so
    // the whole video pass was discarded rather than trimmed), fuse, then gate the fused segments.
    const cage = sm.slice(sm.indexOf("stopMode === 'cage'"), sm.indexOf('// 2026-06-12 (analysis speed) — NEVER send a short clip'));
    const cageNoPreGate = !/const conf = swings\.filter\(\(sw\) => sw\.confidence !== 'low'\)/.test(cage);
    const cageRawCountGate = /if \(swings\.length > segsForAnalysis\.length\)/.test(cage);
    const cageGateAfterFusion = (() => {
      const iF = cage.indexOf('correlateStrikesWithVideo(');
      const iG = cage.indexOf("fused.filter((s) => s.confidence !== 'low')");
      return iF > -1 && iG > iF;
    })();
    const cageNeverReduces = /gated\.length >= acousticCount \? gated : fused/.test(cage);
    const cageLogged = /\[smartmotion\] cage segmentation/.test(cage);
    // VIDEO-ONLY surfaces (library re-analyze + upload ingest): no mic ever arrives, so there is no
    // later evidence to wait for — the gate is removed outright, and the low swing is KEPT and shown
    // as unconfirmed rather than deleted. Both must still log what the locator found.
    const reanalyzeNoGate = !/const confident = swings\.filter\(sw => sw\.confidence !== 'low'\)/.test(sm)
      && /\[smartmotion\] re-analyze segmentation/.test(sm);
    const uploadNoGate = !/const confident = found\.filter\(f => f\.confidence !== 'low'\)/.test(up)
      && /upload-swings-located/.test(up);
    // The honest-maybe surface is what REPLACES deletion, so it is part of this invariant: a low swing
    // becomes confirmed:false and the reel tints that chip with the warning colour.
    const shownAsUnconfirmed = /confirmed: s\.confidence !== 'low'/.test(seg)
      && /const tone = s\.confidence === 'low' \? colors\.warning : colors\.accent/.test(sm);
    // And the reason all of this matters: locateSwings is BINARY. `!== 'low'` is "high only", never a
    // middle grade, so any such filter on locator output is far harsher than it reads.
    const locatorIsBinary = /confidence: \(s\.confidence === 'high' \? 'high' : 'low'\)/.test(det);
    // Fusion must still UPGRADE a matched low swing, or moving the gate changes nothing.
    const fusionUpgrades = /rank\[best\.confidence\] >= rank\[sw\.confidence\] \? best\.confidence : sw\.confidence/.test(seg);
    // All-low keeps all — an empty session is never the answer.
    const allLowKeepsAll = /confirmed\.length >= 1 && dropped > 0/.test(range);
    // And the drop is observable: the old one was silent, so two deleted swings looked exactly like
    // a detection failure. That silence is why it survived to a live range session.
    const logged = /\[smartmotion\] range segmentation/.test(range) && /unconfirmed_dropped/.test(range);
    return gateAfterFusion && noPreGate && fusionUpgrades && allLowKeepsAll && logged
      && cageNoPreGate && cageRawCountGate && cageGateAfterFusion && cageNeverReduces && cageLogged
      && reanalyzeNoGate && uploadNoGate && shownAsUnconfirmed && locatorIsBinary;
  })(),
  'range + cage gate only AFTER fusion and never below the acoustic count; the two video-only surfaces do not gate at all and show the swing as unconfirmed; every surface logs');

check('LOCK: the analysis deck sits BELOW the clip in review, and the eye truly maximizes',
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    // Tim reported this THREE times (2026-07-25, 07-29, 08-19). The first two fixes were cosmetic —
    // make the card translucent, then cap it at 36% with its own scroll — and both left it in the
    // ABSOLUTE layer on top of the clip, so a tall read still covered the golfer head to foot. The
    // invariant is structural, so guard it structurally: in review the deck leaves the absolute layer.
    const inFlowStyle = /bottomPanelInFlow: \{ position: 'relative', zIndex: 0 \}/.test(sm);
    const appliedInReview = /isReview \? \[styles\.bottomPanelInFlow, \{ backgroundColor: colors\.background \}\] : null/.test(sm);
    // It must be a SIBLING of the video container, not a child — a child cannot push it smaller.
    const deckIsSibling = (() => {
      // captureRoot's onLayout opens the video container; the deck must appear AFTER that container
      // has closed (a </View> between them), i.e. as a sibling the flex layout can size against —
      // not nested inside it, where it could only ever float on top.
      const iRoot = sm.indexOf('onLayout={(e) => setRootSize(');
      const iDeck = sm.indexOf('{/* BOTTOM PANEL');
      if (iRoot < 0 || iDeck < iRoot) return false;
      const between = sm.slice(iRoot, iDeck);
      return /\n\s*<\/View>\s*\n\s*$/.test(between);
    })();
    // Every overlay maps through rootSize (captureRoot's own onLayout), which is WHY moving the deck
    // re-letterboxes the clip and the skeleton together. If that measurement ever stops driving them,
    // shrinking the box would misalign the skeleton on the golfer.
    const sharedGeometry = /onLayout=\{\(e\) => setRootSize\(/.test(sm)
      && /const containerAR = rootSize\.w > 0 && rootSize\.h > 0/.test(sm);
    // Nothing in the deck may size off rootSize — captureRoot now shrinks by the deck's height, so
    // measuring against it is a layout feedback loop (pane sizes from box, box sizes from pane). The
    // 2x2 grid is fixed-height by design; only the EXPANDED panel scrolls, and it measures the window.
    const noFeedbackLoop = !/maxHeight: Math\.round\(\(?rootSize\.h/.test(sm)
      && /maxHeight: Math\.round\(windowHeight \* 0\.3\)/.test(sm);
    // And the eye clears the stats too — it cleared every other overlay but not the tallest thing.
    const eyeMaximizes = /\{isReview && showResults \? \(\n\s*<View style=\{styles\.cardGridWrap\}>/.test(sm);
    return inFlowStyle && appliedInReview && deckIsSibling && sharedGeometry && noFeedbackLoop && eyeMaximizes;
  })(),
  'in review the data deck is an in-flow sibling below the video container (never an overlay), sized off the window, and hiding results returns its height to the clip');

check('LOCK: the smarter ball box can only ever improve on the feet proxy, never replace it with nothing',
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    const bd = read('services/swing/ballDeparture.ts');
    const api = read('api/ball-departure.ts');
    // The proxy is applied FIRST and unconditionally; the real locate is fire-and-forget on top.
    const proxyFirst = (() => {
      const iProxy = sm.indexOf("setDraftBall({ x: res.feetCenter.x");
      const iLocate = sm.indexOf('locateBallInSetupFrame');
      return iProxy > -1 && iLocate > iProxy;
    })();
    const oneShot = /if \(!ballLocateTriedRef\.current\) \{\s*\n\s*ballLocateTriedRef\.current = true;/.test(sm);
    // A drag ALWAYS wins — re-checked on arrival, because the call outlives the gesture.
    const dragWins = /if \(found && !cancelled && !userMovedBallRef\.current\)/.test(sm);
    // Client refuses rather than guesses: unconfigured, offline, not found, or out of frame → null.
    const clientHonest = /if \(data\.configured === false \|\| data\.found !== true \|\| !data\.ball_norm\) return null;/.test(bd)
      && /catch \{\s*\n\s*return null; \/\/ offline \/ blocked host — the feet proxy stands/.test(bd);
    // Server refuses rather than guesses, and low confidence is a refusal.
    const serverHonest = /if \(!q\.found \|\| !okConf \|\| !inFrame\) return res\.status\(200\)\.json\(\{ found: false \}\);/.test(api)
      && /A refusal is CORRECT and expected/.test(api);
    return proxyFirst && oneShot && dragWins && clientHonest && serverHonest;
  })(),
  'the ball box keeps its feet-derived placement unless a real ball is confidently seen; a manual drag always wins, and every failure path leaves today behaviour exactly as it was');

check('LOCK: one renderer for the swing read — the library cannot show a thinner swing than the range',
  (() => {
    const hud = read('components/smartmotion/SmartMotionHud.tsx');
    const sm = read('app/swinglab/smartmotion.tsx');
    const detail = read('app/swinglab/swing/[swing_id].tsx');
    // 2026-08-19 (Tim: the SmartMotion read "looks different" in-session vs the swing library). It did:
    // the measured breakdown lived INLINE in smartmotion only, so a saved swing fell back to four icon
    // tiles and a few verdict bullets over the very same numbers. The card is shared now and BOTH
    // screens must build it from the same pure module — asserting both halves, because a producer with
    // one reachable consumer is exactly the shape this codebase keeps re-growing.
    const shared = /export function SwingBreakdownCard\(/.test(hud);
    const inlineGone = !/<Text style=\{\[styles\.insightLabel[\s\S]{0,80}SWING BREAKDOWN<\/Text>/.test(sm);
    const liveUses = /<SwingBreakdownCard read=\{poseRead\} variant="overlay" \/>/.test(sm);
    const libraryUses = /<SwingBreakdownCard read=\{read\} variant="card"/.test(detail)
      && /buildPoseSwingRead\(activeBiomech \?\? null/.test(detail);
    const sameSource = /from '\.\.\/\.\.\/\.\.\/services\/swing\/poseSwingRead'/.test(detail)
      && /buildPoseSwingRead\(biomech, tempo\)/.test(sm);
    return shared && inlineGone && liveUses && libraryUses && sameSource;
  })(),
  'the measured swing breakdown is ONE component fed by ONE pure module, rendered by both the live review and the swing-library detail');

check('LOCK: a match score is never asserted from a sample too thin to average',
  (() => {
    const eng = read('services/swingComparisonEngine.ts');
    const sheet = read('components/swinglab/ComparisonResultSheet.tsx');
    // 2026-08-19 (Tim's 08-18 screenshot: a confident scarlet "0 MATCH"). The guard stopped at ZERO
    // usable metrics while its own comment — "a 0 would render as a confident 0% match… a fabricated
    // negative" — applies just as well to ONE of eight, which is exactly what he was shown.
    const floor = /const MIN_METRICS_FOR_OVERALL = 2;/.test(eng)
      && /if \(usable\.length < MIN_METRICS_FOR_OVERALL\) return null;/.test(eng)
      && !/if \(usable\.length === 0\) return null;/.test(eng);
    // ...and the refusal must be SPECIFIC: name the dimensions that couldn't be read, on which swing.
    const namesGaps = /export function unreadableMetrics\(/.test(eng)
      && /unreadableMetrics\(result\)/.test(sheet)
      && /NOT MEASURED ON/.test(sheet);
    // The ring still never renders a number it doesn't have.
    const noFakeZero = /\{hasMatch \? result\.overall_match : '—'\}/.test(sheet);
    return floor && namesGaps && noFakeZero;
  })(),
  'fewer than two readable dimensions yields null (never 0), and the sheet names which dimensions went unmeasured and on which swing');

check('LOCK: the review read is four fixed cards, not a scrolling stack',
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    // 2026-08-19 (Tim: "it's supposed to be a four-card layout… it shouldn't have to be so much
    // scrolling… we've regressed in terms of the layouts"). The stack is what grew tall enough to
    // cover the clip; containing it was treating the symptom.
    const four = /type ReviewCardKey = 'breakdown' \| 'speed' \| 'body' \| 'contact';/.test(sm);
    const grid = /cardGrid: \{ flexDirection: 'row', flexWrap: 'wrap'/.test(sm)
      && /reviewCards\.map\(\(c\) => \(/.test(sm);
    // Exactly four cards are built — a fifth would silently reflow the 2x2 into a ragged 3 rows.
    const exactlyFour = (() => {
      const i = sm.indexOf('const reviewCards = useMemo(');
      if (i < 0) return false;
      const body = sm.slice(i, sm.indexOf('}, [poseRead, tempo, metrics, bodyItems, ballDeparture]);', i));
      return (body.match(/^\s*key: '/gm) ?? []).length === 4;
    })();
    // A card with nothing behind it shows "—" rather than vanishing, so the grid never reflows.
    const honestEmpty = /\{c\.value \?\? '—'\}/.test(sm);
    // Opening a card can't leave it open over the next swing's numbers.
    const resets = /useEffect\(\(\) => \{ setExpandedCard\(null\); \}, \[phase, selectedSwing\]\);/.test(sm);
    return four && grid && exactlyFour && honestEmpty && resets;
  })(),
  'the review shows four fixed cards in a 2x2 grid with tap-to-expand; an unmeasured card shows a dash instead of disappearing, and the open card resets per swing');

check('LOCK: the glasses consent round trip can actually come home',
  (() => {
    const bridge = read('services/metaWearablesBridge.ts');
    const swift = read('ios-native/MetaWearablesFrameModule.swift');
    const objc = read('ios-native/MetaWearablesFrame.m');
    const plugin = read('plugins/withMetaWearablesDAT.js');
    const layout = read('app/_layout.tsx');
    // 2026-08-19 (Tim — "make sure my glasses are gonna connect the next time"). DAT pairing is a ROUND
    // TRIP: we deeplink to the Meta AI app, the wearer consents, and it calls BACK with a URL that must
    // reach the SDK. Nothing forwarded it, so registration could never leave `.registering` — which is
    // exactly what "I consented and they still don't connect" looks like. Three independent holes, all
    // on the return leg, each of which alone is fatal.
    const swiftHandles = /func handleAppLink\(/.test(swift) && /Wearables\.shared\.handleUrl\(parsed\)/.test(swift);
    const objcExports = /RCT_EXTERN_METHOD\(handleAppLink:/.test(objc);
    const jsForwards = /export async function handleGlassesAppLink/.test(bridge)
      && /export function startGlassesLinkListener/.test(bridge)
      && /Linking\.getInitialURL\(\)/.test(bridge)   // cold start: consent happens in ANOTHER app
      && /Linking\.addEventListener\('url'/.test(bridge);
    const mountedAtRoot = /startGlassesLinkListener\(\)/.test(layout);
    // iOS was hard-disabled at the bridge (`Platform.OS === 'android'`), so the Swift module could
    // never be reached on the platform the glasses build targets.
    const iosReachable = /\(Platform\.OS === 'android' \|\| Platform\.OS === 'ios'\) && _mwHealth\.loaded/.test(bridge);
    // And iOS only routes a universal link into an app that CLAIMS the domain — we served the AASA
    // for a callback iOS would have handed to Safari.
    const claimsDomain = /applinks:api\.smartplaycaddie\.com/.test(plugin)
      && /com\.apple\.developer\.associated-domains/.test(plugin);
    // The custom scheme stays alongside it: replacing a working leg with an unproven one turns one
    // broken flow into two.
    const keepsScheme = /AppLinkURLScheme: 'smartplay'/.test(plugin);
    return swiftHandles && objcExports && jsForwards && mountedAtRoot && iosReachable && claimsDomain && keepsScheme;
  })(),
  'the DAT callback URL reaches the SDK on both cold start and warm launch, iOS can resolve the module at all, and the app claims the universal-link domain Meta is registered against');

check('LOCK: BOTH audio paths are cold-aware and neither can fail silently',
  (() => {
    const pipe = read('hooks/usePipecatVoice.ts');
    const tap = read('hooks/useVoiceCaddie.ts');
    // 2026-08-19 (Tim, testing live: "it's going straight to failure state… I'm also not seeing any
    // text when he talks", then "eventually it did work"). Two audio entries existed and only ONE
    // knew about cold start. The pipecat path ran a flat 20s while the tap path ran 12s warm / 22s
    // cold, and — the part Tim actually saw — every pipecat failure ended in onVoiceStateChange
    // ('idle') with no speech and no text. Silence is the most robotic failure available.
    // 2026-08-20 — was /isConnectionWarmed()/ in both. That single boolean is flipped by the boot
    // ping to /api/kevin, a DIFFERENT Lambda, so a warm kevin handed the first real transcribe the
    // short budget against a function that had never been touched. Both paths must now ask about
    // the function they are actually calling.
    const bothColdAware = /isEndpointWarmed\('\/api\/transcribe'\)/.test(pipe)
      && /isEndpointWarmed\('\/api\/transcribe'\)/.test(tap);
    const pipeUsesGate = /const coldFirstTurn = !isEndpointWarmed\('\/api\/transcribe'\);/.test(pipe)
      && /coldFirstTurn \? PIPECAT_COLD_TRANSCRIBE_MS : PIPECAT_WARM_TRANSCRIBE_MS/.test(pipe);
    const noFlat20s = !/abort\(\), 20_000\)/.test(pipe);
    // A successful transcribe PROVES the host is warm — both paths must say so, or one keeps paying
    // cold costs the other already retired.
    const bothMarkWarm = /markEndpointWarmed\('\/api\/transcribe'\)/.test(pipe)
      && /markEndpointWarmed\('\/api\/transcribe'\)/.test(tap);
    // Every pipecat failure route degrades into a spoken+shown local line instead of going mute.
    const degrades = /const speakDeadEnd = useCallback/.test(pipe)
      && /responder\.deadEndLine\(langSafe\)/.test(pipe)
      && /onKevinSpoke\?\.\(line\)/.test(pipe);           // the TEXT, not just audio
    const allFailuresCovered = /speakDeadEnd\(`transcribe_\$\{transcribeRes\.status\}`\)/.test(pipe)
      && /speakDeadEnd\('empty_transcript'\)/.test(pipe)
      && /speakDeadEnd\(e instanceof Error && e\.name === 'AbortError'/.test(pipe);
    return bothColdAware && pipeUsesGate && noFlat20s && bothMarkWarm && degrades && allFailuresCovered;
  })(),
  'the pipecat audio path uses the same cold/warm transcribe budget as the tap path, marks the connection warm on success, and speaks AND shows a local line on every failure instead of going silent');

check('LOCK: no capture path may discard the player\'s audio on the level meter alone',
  (() => {
    const vc = read('hooks/useVoiceCaddie.ts');
    const vs = read('services/voiceService.ts');
    /**
     * 2026-08-19. Tim, after a round demoing to real golfers: "got ignored most of the round for
     * maybe the first time since I started building the app six months ago" — and the detail that
     * settles it, "TEXT INPUT STILL WORKED when they did not". Text bypasses capture entirely, so the
     * brain, the network and every path downstream were fine. The break was audio capture, alone.
     *
     * His log named the path: five `tap_ended_silent_capture` from `handleMicPress`, durationMs 2493
     * to 4902. Those recordings were thrown away without ever reaching Whisper because a FIXED
     * -30 dBFS meter said no speech — on Android, outdoors, in wind. The shared captureUtterance path
     * in voiceService never had that veto; only this one did, and unifying the avatar and mic routed
     * him through it.
     *
     * The invariant, which is what actually matters and is why this is a LOCK and not a tuned number:
     * the meter may decide when to STOP listening. It may never decide whether words were said.
     * Whisper decides that. A threshold can be wrong on a device, in wind, or with a quiet voice —
     * and when it is wrong, the cost must be one wasted transcribe, never a discarded utterance.
     */
    const vetoGone = !/logVoiceSilentFail\('tap_ended_silent_capture'/.test(vc)
      && !/if \(!micHasSpokenRef\.current\) \{[\s\S]{0,400}?restartFresh = true;/.test(vc);
    // The disagreement is still measured — that is how we learn which devices the meter lies on.
    const measured = /logVoiceSilentFail\('meter_silent_transcribing_anyway'/.test(vc);
    // ...and the audio goes to the transcriber regardless of what the meter concluded.
    const transcribesAnyway = /meter is not the judge/.test(vc) && /await processAudioUri\(uri\);/.test(vc);
    // The OTHER capture path must stay veto-free too: it may skip only on physical impossibility
    // (too short / too small / too large), never on hasSpoken.
    const sharedPathClean = !/if \(!hasSpoken\)[\s\S]{0,120}?return done\(/.test(vs)
      && /return done\('too_short'\)/.test(vs);
    return vetoGone && measured && transcribesAnyway && sharedPathClean;
  })(),
  'a capture of real length always reaches Whisper on every path; the meter endpoints but never vetoes, and when it disagrees with the transcript that disagreement is logged');

check('LOCK: a silent club scan may correct itself but may never overrule the player',
  (() => {
    const sm = read('app/swinglab/smartmotion.tsx');
    /**
     * 2026-08-20 (Tim, after a round: "it's set to down the line and putt, not full swing like it
     * should be in terms of the toggle settings").
     *
     * The silent auto club scan was ADDITIVE by design — a confident putter turned putt mode ON and
     * it never cleared a mode "the user set deliberately". That protection is correct, but the code
     * could not tell a user's choice from its OWN earlier guess, so it protected both. That is a
     * ONE-WAY RATCHET: the scan may SET a mode it is forbidden to UNSET, so one misread of an iron
     * as a putter pins putting mode on and every later full swing is routed to the putt analyzer —
     * silently, because the swing still records fine. The per-recording reset does not save it: the
     * auto scan re-fires after that reset and re-applies its own stale verdict.
     *
     * Invariant: AUTO may override AUTO, only the USER may override the USER. Asserted structurally,
     * because the failure mode is a raw setPuttMode call at some new site quietly bypassing the rule.
     */
    const hasGate = /if \(source === 'auto' && puttModeSourceRef\.current === 'user'\) return;/.test(sm);
    // Auto is symmetric within its own provenance — it can turn putt mode back OFF, which is the
    // whole fix; a one-directional call here would restore the ratchet.
    const autoSymmetric = /applyPuttMode\(res\.club_id === 'PT', auto \? 'auto' : 'user'\)/.test(sm);
    // Provenance clears with the per-recording reset, or a stale 'user' locks the scan out forever.
    const resetClears = /puttModeSourceRef\.current = null;/.test(sm);
    // EVERY other writer goes through applyPuttMode. Exactly two raw calls may survive: the one
    // inside applyPuttMode itself, and the per-recording reset.
    const rawWrites = (sm.match(/setPuttMode\(/g) ?? []).length;
    const noBypass = rawWrites === 2 && /applyPuttMode\(c === 'PT', 'user'\)/.test(sm);
    return hasGate && autoSymmetric && resetClears && noBypass;
  })(),
  'putt mode records WHO set it: a silent auto scan can correct its own earlier verdict in both directions but can never clear a deliberate toggle/pick/voice choice, and every writer routes through the one gate');

check('LOCK: knowing WHERE WE ARE is never gated on which course is selected',
  (() => {
    const pl = read('app/(tabs)/play.tsx');
    /**
     * 2026-08-20 (Tim, Wachusett: "only found local courses in the app… this function is key for
     * launching", with "GPS and location was spotty").
     *
     * refreshLocation is the ONLY writer of userPosition, and every discovery path opens with
     * `if (!userPosition) return` — including the nearby-courses effect and its careful 3-attempt
     * retry, which therefore never STARTED. Two independent things then guaranteed the failure Tim
     * saw:
     *   - the auto-locate effect bailed on `previewCourseId || isRoundActive`, so a player MID-ROUND
     *     — standing on a course, the exact moment discovery matters — never had location requested
     *     at all. A gate meant to protect course SELECTION was suppressing POSITION.
     *   - a single getCurrentPositionAsync with no cached fallback and no retry left userPosition
     *     null for the whole session the moment one fix failed under tree cover.
     *
     * The invariant: position acquisition must be independent of selection state, and must never be
     * left with NOTHING merely because a fresh fix was slow.
     */
    const notGatedOnSelection = (() => {
      const i = pl.indexOf('hasAutoLocatedRef.current = true;');
      if (i < 0) return false;
      // The 400 chars before the latch is where the old bail-out lived.
      return !/if \(previewCourseId \|\| isRoundActive\) return;/.test(pl.slice(Math.max(0, i - 400), i));
    })();
    const cachedFallback = /getLastKnownPositionAsync/.test(pl);
    const bounded = /gps_timeout/.test(pl) && /attempt <= maxAttempts/.test(pl);
    // And the thing all of it exists to feed still runs off it.
    const feedsDiscovery = /locateNearbyCourses\(userPosition\.lat, userPosition\.lng/.test(pl);
    return notGatedOnSelection && cachedFallback && bounded && feedsDiscovery;
  })(),
  'location is acquired regardless of previewCourseId/active round, falls back to the OS cached fix when a fresh one is slow, retries on a bounded schedule, and still feeds nearby-course discovery');

check('SmartFinder: a double-tap magnifies the aim point without stealing reticle drags',
  (() => {
    const ov = read('components/smartfinder/TargetingOverlay.tsx');
    const sf = read('app/smartfinder.tsx');
    /**
     * 2026-08-20 (Tim: "when you move the reticle in smartfinder the yardage should adjust. Should
     * be able to tap or ask to zoom the pin flag and get a tight read. We could be so much more
     * connected and intelligent with the structure we have built.")
     *
     * Both halves already existed and had never been joined: the camera has had continuous zoom, and
     * the reticle has always reported a normalised aim point to the yardage engine. The double-tap
     * is the join.
     *
     * The risk this guard exists for is REGRESSION IN THE PRIMARY GESTURE. Aiming the reticle is the
     * thing players do constantly; zooming is occasional. Detecting the second tap inside the
     * existing PanResponder release — rather than adding a competing recogniser — is what keeps a
     * drag from ever being swallowed by a gesture arbiter, so that mechanism is asserted, not just
     * the feature's presence.
     */
    // Detected in the release handler, with BOTH a time and a distance bound (a time-only rule turns
    // a fast deliberate re-aim across the screen into an accidental zoom).
    const inReleaseHandler = /onPanResponderRelease/.test(ov)
      && /now - prev\.at < 300 && Math\.hypot\(x - prev\.x, y - prev\.y\) < 44/.test(ov);
    // No competing gesture recogniser was introduced on the overlay to do it.
    const noRivalRecogniser = !/Gesture\.Tap\(\)/.test(ov);
    // The single tap still reports the aim point, so yardage follows the FIRST tap as it always has.
    const aimStillReports = /cbRef\.current\.reportPoint\(x, y\);/.test(ov);
    // Parent steps the zoom and returns to 1x at the ceiling, rather than jumping to max — the
    // camera's digital zoom is centre-anchored, so a hard jump throws an off-centre flag out of view.
    const stepsAndResets = /prev >= PRECISION_ZOOM_MAX - 0\.001 \? 0 : Math\.min\(PRECISION_ZOOM_MAX, prev \+ PRECISION_ZOOM_STEP\)/.test(sf);
    // Pinch resumes from wherever the tap left off instead of snapping back.
    const pinchStaysInSync = /baseZoomRef\.current = next; \/\/ keep pinch continuing/.test(sf);
    return inReleaseHandler && noRivalRecogniser && aimStillReports && stepsAndResets && pinchStaysInSync;
  })(),
  'double-tapping the scene steps the camera zoom for a tight read and resets at the ceiling, detected inside the existing pan release so ordinary reticle aiming is never stolen by a gesture arbiter');

check('MIGRATION (temporary): kevin has every behaviour pipecat has, ahead of the shim',
  (() => {
    const kevin = read('api/kevin.ts');
    const pipe = read('api/pipecat-turn.ts');
    /**
     * 2026-08-21. Tim: "we're creating a bunch of guards, gates and such… because we're trying to
     * clean pathways between two different brains." He is right, and this guard is the exception
     * that proves it: IT IS SCAFFOLDING, AND IT GETS DELETED.
     *
     * Two brains exist for one reason — kevin is the original and pipecat (the v15 default) never
     * replaced it. The cost is measurable: _brainTools.ts and _brain.ts (640 lines) exist ONLY to
     * stop them drifting, and both files document drift that already happened. kevin.ts even carries
     * the line "Mirrors api/pipecat-turn.ts exactly" over hand-copied distress logic.
     *
     * The plan is to make pipecat-turn a thin adapter over kevin, so there is ONE implementation and
     * the drift surface goes to zero. Phase 1 is getting kevin to behavioural parity FIRST, while
     * pipecat stays untouched and live. This guard protects that port for exactly as long as the
     * migration takes. When the shim lands, DELETE THIS CHECK — a parity guard over a single
     * implementation is precisely the band-aid Tim is objecting to.
     *
     * A rigorous diff (capability, not variable name — my first pass matched names and overstated
     * the gap) found kevin already had trust/proactivity, brevity, spiral reset and localization.
     * Only two things were genuinely missing, and both are asserted here.
     */
    // 1. A narrated practice round must be framed the same on either brain.
    const simRound = /SIM ROUND ACTIVE/.test(kevin) && /SIM ROUND ACTIVE/.test(pipe)
      && /sim_round = false,/.test(kevin);
    // 2. The get-to-know interview must mute navigation on BOTH. This is Tim's 07-30 complaint —
    //    the caddie opening SwingLab while he describes a fault — and the fix had only ever landed
    //    on the default brain, so the same interview behaved differently on a follow-up turn.
    const interviewMute = /GET-TO-KNOW INTERVIEW MODE/.test(kevin) && /GET-TO-KNOW INTERVIEW MODE/.test(pipe);
    /**
     * 3. And the client actually SENDS it — a server field nothing sets looks exactly like the bug.
     *
     * 2026-08-23 — RE-AIMED off services/conversationalBrain, which no longer hand-lists any field:
     * it (and every other surface) now sends the union from services/caddieRequestBody. Asserting
     * the builder is strictly stronger than asserting one caller, because it covers all of them.
     *
     * WHY THIS GUARD IS STILL HERE, given its own instruction to delete it when the shim lands: no
     * CLIENT reaches api/pipecat-turn any more, but the ROUTE is still deployed and still answers
     * builds in the field that have not taken the OTA. Until that route is deleted, the two
     * implementations can still drift underneath those players, so the parity it protects is real.
     * Delete this the moment api/pipecat-turn.ts goes.
     */
    const clientSends = /sim_round: safe\(\(\) => !!r\.isSimRound/.test(read('services/caddieRequestBody.ts'))
      && /sim_round: useRoundStore\.getState\(\)\.isSimRound/.test(read('hooks/useVoiceCaddie.ts'));
    return simRound && interviewMute && clientSends;
  })(),
  'kevin now carries every behaviour pipecat has (sim round, interview-mode mute) and the clients send it — the parity step before pipecat becomes a shim over one implementation. DELETE THIS GUARD WHEN THE SHIM LANDS.');

check('LOCK: every unprompted voice shares ONE interruption clock',
  (() => {
    const caddie = read('app/(tabs)/caddie.tsx');
    const pk = read('services/proactiveKevin.ts');
    /**
     * 2026-08-21 (silence audit). The caddie has FOUR unprompted voices: the score-streak trigger,
     * the hole-transition trigger, the GPS stop-detection read, and the tee-box auto-brief. The first
     * two go through shouldFireProactive and share its global debounce. The other two never consulted
     * it — they had their own once-per-hole and SETTLE gates and were individually well behaved.
     *
     * That is why it was invisible: every trigger was correct BY ITS OWN RULE, and nothing owned the
     * sum of them. A tee brief could land moments after a streak line, each one defensible, the pair
     * of them exactly the "caddie won't stop talking" experience.
     *
     * The player does not experience four triggers. They experience a caddie that talks. Interruption
     * has a cost, that cost is shared, and it belongs on ONE clock.
     *
     * This is also the substrate the intervention threshold needs: once a single place decides
     * whether to speak, "was that worth interrupting for?" finally has somewhere to live.
     */
    const clockExists = /export function mayInterject/.test(pk) && /export function noteInterjection/.test(pk);
    // Both stragglers must CONSULT it...
    const consults = (caddie.match(/if \(!mayInterject\(trustLevel\)\) return;/g) ?? []).length >= 2;
    // ...and CLAIM it. Consulting without claiming makes a trigger permanently polite — always
    // yielding, never counted — so the next unprompted voice still lands on top of it.
    const claims = (caddie.match(/noteInterjection\(\);/g) ?? []).length >= 2;
    return clockExists && consults && claims;
  })(),
  'the tee brief and the stop-detection read consult AND occupy the same debounce as the named proactive triggers, so four independently-correct voices cannot stack into one talkative caddie');

check('LOCK: the intelligence loop CLOSES — the caddie learns whether its own advice was right',
  (() => {
    const dispatch = read('services/voice/conversationalToolDispatch.ts');
    const tracking = read('services/shotTracking.ts');
    const learn = read('services/adviceOutcome.ts');
    /**
     * 2026-08-23 — this read services/pipecatContext.ts into `ctx` AND NEVER USED IT. A dead read
     * inside a guard: it cost nothing to keep, proved nothing, and made the chain look one hop
     * longer than it was actually asserting. Replaced with the assertion it should have been — that
     * the ONE payload builder every surface uses actually carries the block.
     */
    const builder = read('services/caddieRequestBody.ts');
    const brain = read('api/pipecat-turn.ts');
    /**
     * 2026-08-21. THE defect this whole codebase existed to avoid, found by tracing the loop end to
     * end instead of testing its parts.
     *
     * Every hop was built and tested. Advice was recorded (pendingKevinRec), stamped onto the shot
     * (kevin_rec_club / kevin_adhered), and paired. And then the ONLY consumer in the entire app was
     * recapGenerator, computing an adherence RATE for a post-round summary — a measure of whether
     * the PLAYER OBEYED, not of whether the CALL WAS RIGHT. Nothing fed back. The caddie had been
     * giving advice for months with no path to discover it was wrong.
     *
     * So the player model learned the player while the caddie never learned itself, and the product
     * PERFORMED intelligence rather than accumulating it. Every individual piece passed its tests;
     * the chain was never asserted. That is what this guard is for — it fails if any hop is
     * disconnected, which no per-part test can detect.
     */
    // 1. DECIDE — a spoken club call is captured as advice.
    const recorded = /setPendingKevinRec\(\{ club: a\.club\.trim\(\)/.test(dispatch) && /kind: 'spoken'/.test(dispatch);
    // 2. OBSERVE RESULT — the advice is paired with what was actually played.
    const paired = /kevin_rec_club: resolved\.recClub/.test(tracking) && /kevin_adhered: resolved\.adhered/.test(tracking);
    // 3. LEARN — and ONLY from shots that tested the DECISION. A mis-hit judges the swing, not the
    //    club call; counting it would train the caddie to flatter bad strikes.
    const judgesDecisionNotResult = /const CLEAN_CONTACT = new Set\(\['flush', 'solid', 'pure'\]\)/.test(learn)
      && /if \(!s\.feel \|\| !CLEAN_CONTACT\.has\(s\.feel\)\) continue;/.test(learn)
      && /if \(s\.kevin_adhered !== true\) continue;/.test(learn);
    // 4. UPDATE — the finding is assembled into the ONE context block that both brains read.
    //    It deliberately does NOT live in a structured pipecat field: that would teach turn 1 and
    //    leave turn 2 ignorant, which is precisely how recommend_club went missing on the follow-up
    //    brain. One builder, both brains.
    const cns = read('services/caddieMemoryRetrieval.ts');
    const feedsContext = /ao\.describeAdviceCalibration\(ao\.adviceOutcomes\(/.test(cns)
      && /YOUR OWN CALLING/.test(cns);
    // 5. NEXT DECISION — and actually REACHES BOTH brains. Presence in a payload is not enough:
    //    a field the prompt never renders is a silent dead end, so assert the RENDER on each side.
    const kevinRenders = /\$\{_unifiedContextBlock \? `\\n\$\{_unifiedContextBlock\}` : ''\}/.test(read('api/kevin.ts'));
    // pipecat receives the SAME block under a different field name (`context.memory` → memoryBlock,
    // appended to the system prompt); kevin calls it unified_context_block. Two names for one thing
    // is its own small trap — assert the RENDER on each side rather than a shared spelling.
    const pipecatRenders = /const memoryRaw = context\.memory;/.test(brain)
      && /const memoryBlock =/.test(brain)
      && /systemBase\}`? ?: ?systemBase\) \+ memoryBlock|\+ memoryBlock/.test(brain);
    // The client half of hop 5: the block has to be BUILT into the request before any prompt can
    // render it. One builder, so this cannot be true on one surface and false on another.
    const builderCarries = /unified_context_block,/.test(builder)
      && /mergeMemoryIntoContext\(/.test(builder);
    const reachesBothBrains = kevinRenders && pipecatRenders;
    return recorded && paired && judgesDecisionNotResult && feedsContext && builderCarries && reachesBothBrains;
  })(),
  'a club the caddie called is recorded, paired with what was played, judged ONLY on clean strikes, turned into a calibration finding, and delivered into the next prompt — the full loop, asserted as a chain rather than as parts');

check('LOCK: every mic entry point fails the same way — tap, earbud and text box',
  (() => {
    const vc = read('hooks/useVoiceCaddie.ts');
    const vs = read('services/voiceService.ts');
    const ls = read('services/listeningSession.ts');
    const bar = read('components/caddie/CaddieBottomBar.tsx');
    /**
     * 2026-08-21 (Tim) — "we need to triple check that tapping the caddie, or the caddie mic, or the
     * earbud, or the text box with the mic below works. It needs to all be unified."
     *
     * It was not. There are TWO mic owners: the Caddie tab goes through useVoiceCaddie.handleMicPress,
     * while the EARBUD and the TEXT-BOX MIC both route through listeningSession.toggle() into
     * voiceService.captureUtterance. Today's first-turn work — hedging a second connection instead of
     * waiting out a hung socket — landed on the tap path only. The earbud path was WORSE than the one
     * being fixed: a 25-second first attempt before any retry.
     *
     * So an identical failure produced 4 seconds of delay on one entry point and 25 on another. That
     * is how "it works when I tap but not from my earbuds" gets reported, and no per-path test can
     * see it, because each path passes on its own terms.
     *
     * This asserts the entry points still CONVERGE, and that both owners hedge.
     */
    // The earbud and the text-box mic must keep routing to the shared session, not grow their own.
    const convergent = /subscribeEarbudTap\(\(\) => \{ void toggle\(\); \}\)/.test(ls)
      && /toggleListening\(\)/.test(bar);
    // Both owners race a second connection rather than waiting out the first.
    const tapHedges = /const primary = doTranscribeFetch\(budget\);/.test(vc)
      && /Promise\.any\(\[primary, hedged\]\)/.test(vc);
    const earbudHedges = /const raceOnce = async \(budgetMs: number\)/.test(vs)
      && /Promise\.any\(\[primary, hedged\]\)/.test(vs);
    // And the 25s single-shot that made the earbud the worst path is gone.
    const noLongSingleShot = !/res = await doFetch\(25_000\);/.test(vs);
    return convergent && tapHedges && earbudHedges && noLongSingleShot;
  })(),
  'the earbud and text-box mic still converge on the shared listening session, and both mic owners race a hedged second connection instead of waiting out a hung socket — the same failure now costs the same anywhere');

check('LOCK: every path that uploads audio gets a SECOND attempt before it gives up',
  (() => {
    const vc = read('hooks/useVoiceCaddie.ts');
    const pc = read('hooks/usePipecatVoice.ts');
    const vs = read('services/voiceService.ts');
    /**
     * 2026-08-20 (adversarial audit of the same day's voice work — "check work", assume the fix is
     * FALSE and look for the surface it missed).
     *
     * Three separate places upload recorded audio to /api/transcribe: the tap path
     * (useVoiceCaddie), the earbud/hands-free path (voiceService.captureUtterance) and the pipecat
     * brain path (usePipecatVoice). Two of them retried a failed attempt. The pipecat path fired a
     * SINGLE fetch and, on the first AbortError, went straight to speakDeadEnd('transcribe_timeout')
     * — which is precisely the "goes straight to failure state" Tim reported, on precisely the turn
     * (first, cold) where one attempt is least likely to land.
     *
     * That is the half-fix shape: the probe-veto work fixed the path the field log happened to name
     * and left a sibling with its own way of failing the same first turn. The invariant is a
     * property of the CLASS — any path that can lose a real recording retries before degrading —
     * so it is asserted across all three, and a new uploader has to satisfy it too.
     */
    const tapRetries = /transcribeRes = await doTranscribeFetch\(probeSaysDown \? retryBudgetMs/.test(vc);
    // 2026-08-21 — the earbud path no longer waits 25s to discover a hung socket; it races a hedged
    // second connection and retries the race. Same property (a genuine second attempt), better shape.
    const earbudRetries = /res = await raceOnce\(15_000\);/.test(vs) && /res = await raceOnce\(12_000\);/.test(vs);
    const pipecatRetries = /transcribeRes = await doPipecatFetch\(12_000\);/.test(pc)
      && /first transcribe attempt failed — retrying once before degrading/.test(pc);
    // ...and none of them may be cancelled by anything other than their own budget.
    const noneCancellable = !/externalSignal\s*[?.,)]/.test(vc) && !/externalSignal\s*[?.,)]/.test(pc);
    return tapRetries && earbudRetries && pipecatRetries && noneCancellable;
  })(),
  'the tap, earbud and pipecat upload paths all get a genuine second attempt before degrading, and none can be cancelled by anything but its own timeout');

check('LOCK: nothing but the real request may decide the real request failed',
  (() => {
    const vc = read('hooks/useVoiceCaddie.ts');
    const api = read('services/apiBase.ts');
    /**
     * 2026-08-20. This guard previously locked the WRONG invariant, and Tim's field log is what
     * proved it. It asserted that the reachability guard should trust a no-cold-start CDN probe
     * over two cold Lambdas — i.e. it accepted that a probe may abort a running upload, and only
     * argued about WHICH probe was trustworthy enough to do it. That is a band-aid with a lock
     * around it.
     *
     * The log, four entries, identical to the millisecond:
     *     elapsedMs 11045 · pingOk false pingMs 5018 · getOk false getMs 6016 · first_turn true
     * 5018 + 6016 = 11034. The upload did not fail. The probes timed out and CANCELLED an upload
     * that still had ~11s of its 22s cold budget remaining. Recorded, encoded, discarded — by us —
     * while he was standing on a course with signal.
     *
     * THE REAL INVARIANT, which is why this is now a LOCK and not a tuned probe:
     *
     * 1. NOTHING CANCELS THE REAL UPLOAD. The request itself is the only honest test of
     *    reachability; every probe is a guess about it. A timeout is not a refusal — a rural
     *    tower, a congested cell or a cold Lambda all blow past any budget on a working
     *    connection. This is the meter veto's exact shape: the meter may not decide whether words
     *    were said, and a probe may not decide whether the network works. Both must be observers.
     *
     * 2. PROBES RUN AFTER A FAILURE, NEVER ALONGSIDE THE UPLOAD. Fired concurrently they compete
     *    with the upload for the very DNS/TLS handshake they claim to measure — on a cold first
     *    turn that was four simultaneous connections on the most contended radio moment there is.
     *    They were not observing the problem, they were part of it. After a real failure they cost
     *    the happy path nothing and are pure diagnostics.
     *
     * 3. TRANSPORT IS WARMED BEFORE THE FUNCTION. A first request pays DNS + TCP + TLS *and* the
     *    cold start together; pinging a Lambda pays both and learns which was slow. A static CDN
     *    file needs identical DNS/TLS to the identical host and no cold start, so it buys the
     *    transport and leaves a pooled socket behind. (Warming is legitimate — it only ever makes
     *    the real request faster. It is authority over the request that was the bug.)
     *
     * 4. A SESSION CANNOT BE PINNED COLD. Warm ran once at boot over a fixed window, and the only
     *    other thing that could mark warm was a successful transcribe — the very thing the abort
     *    killed. Cold blocked the success that would clear cold, which is why the log shows
     *    `first_turn: true` on turn 1 AND turn 2 a minute apart. The mic tap re-arms it.
     */
    // 1. No probe-owned controller exists, and the transcribe call site takes NO external signal
    //    (the trailing `);` with no second argument is the whole point — a comma here is the bug).
    const noProbeAbort = !/coldAbort|coldUnreachable|probeAbort/.test(vc);
    // Stronger than "no caller passes a signal": the fetch cannot ACCEPT one. The parameter was the
    // mechanism by which a probe held authority over the real request, so it is gone rather than
    // merely unused — otherwise the next probe author finds a ready-made hook and only a comment
    // standing in the way.
    const takesNoSignal = /const doTranscribeFetch = async \(timeoutMs: number\) =>/.test(vc)
      // Match CODE use only (`externalSignal?:`, `.addEventListener`, `, externalSignal)`), never the
      // prose above it that explains the removal — a bare /externalSignal/ matches its own tombstone.
      && !/externalSignal\s*[?.,)]/.test(vc);
    /**
     * 2026-08-21 — re-aimed. This pinned the literal single-attempt call site, which the escalating
     * retry replaced. The PROPERTY is unchanged and is what gets asserted now: every attempt is
     * given a timeout and NOTHING ELSE, so no probe, guard or signal can cancel a live upload.
     *
     * It also asserts the new shape, because that shape is the fix for the field failure: one long
     * bet on a single socket became THREE escalating attempts on FRESH sockets. A hung connection
     * has to cost seconds to discover, not the whole budget.
     */
    /**
     * 2026-08-21 — now asserts the HEDGE, which is what turned "thought for twenty seconds" into an
     * answer. A hung socket and a slow-but-working one are indistinguishable while you wait, so any
     * fixed timeout is a bet on which you have. Racing a second connection after a short delay stops
     * betting: a healthy turn answers before the hedge ever fires, and a hung one is bypassed in
     * seconds instead of costing a whole attempt budget.
     *
     * Still no signal parameter anywhere — nothing outside the request may cancel it.
     */
    const uncancellable = /const primary = doTranscribeFetch\(budget\);/.test(vc)
      && /transcribeRes = await Promise\.any\(\[primary, hedged\]\);/.test(vc)
      && /const HEDGE_AFTER_MS = 2_500;/.test(vc)
      && !/doTranscribeFetch\([^)]*signal/.test(vc);
    // 2. ORDER, not presence: the diagnostic probes must appear AFTER the real attempt, inside its
    //    catch. If they ever migrate back above it, they are racing the upload again.
    // 2026-08-21 — anchored on the attempt LOOP, not the old single-attempt call site. The property
    // is unchanged (diagnostics may only run after the real request has genuinely failed); only the
    // shape of "the real request" changed when one long bet became three escalating attempts.
    const iAttempt = vc.indexOf('const attemptBudgets = coldFirstTurn');
    const iProbe = vc.indexOf('staticReachable(3000)');
    const probesAfterFailureOnly = iAttempt > -1 && iProbe > iAttempt;
    // 3. Warming still happens, and still buys transport before waking the function.
    const transportFirst = /async function primeTransport/.test(api)
      && /assetlinks\.json/.test(api)
      && (() => {
        const w = api.slice(api.indexOf('export function warmBackendConnection'));
        const iPrime = w.indexOf('await primeTransport()');
        const iPing = w.indexOf('pingHost(');
        return iPrime > -1 && iPing > -1 && iPrime < iPing;
      })();
    // 4. The tap re-arms a session that missed the boot window.
    /**
     * 2026-08-21 — INVERTED, because this assertion was pinning the defect.
     *
     * It required the mic tap to call warmBackendConnection() — "re-arm a cold-pinned session". Tim
     * found what that actually did: tapping the mic fired a CDN prime plus host pings, the player
     * spoke for three to five seconds while those sat in flight, and their upload then queued behind
     * our own housekeeping. The guard was protecting the thing making his first turn slow.
     *
     * The real property is the opposite: NOTHING may be fired at the host on the tap path. Warmth is
     * earned by the real request succeeding (markEndpointWarmed), so nothing needs to race it there.
     */
    // Match the CALL form (`).warmBackendConnection()` — how it was actually invoked), never the
    // word in the prose that records its removal. A bare match hits its own tombstone; that has now
    // caught me three times this week (externalSignal, getOpenerAssetForPersona, and this).
    const noWarmOnTap = !/\)\.warmBackendConnection\(\)/.test(vc)
      && /markEndpointWarmed\('\/api\/transcribe'\)/.test(vc);
    // And the CDN verdict still reaches the log, where it discriminates "our functions were cold"
    // from "this device cannot reach the host" — advising us, deciding nothing.
    const decisiveLog = /cdnOk/.test(vc) && /cdnMs/.test(vc) && /const staticReachable = async/.test(vc);
    return noProbeAbort && takesNoSignal && uncancellable && probesAfterFailureOnly && transportFirst && noWarmOnTap && decisiveLog;
  })(),
  'no probe can cancel the real upload, diagnostics run only after it genuinely fails, transport is warmed before the function, the mic tap fires NOTHING at the host (warmth is earned by the real request succeeding), and the CDN verdict informs the log without holding authority');

check('LOCK: the Fit Profile and the bag recommendation cannot disagree about what a gap IS',
  (() => {
    const fit = read('services/practice/fitProfile.ts');
    const bag = read('services/bagRecommendation.ts');
    /**
     * 2026-08-20 (constant-drift audit). GAP_YARDS was 20 in fitProfile and 25 in bagRecommendation,
     * and BOTH files carried a comment describing it in the same words — "about a club-and-a-half".
     * Not two deliberate thresholds for two questions: one idea that drifted into two numbers. The
     * player met it as two screens disagreeing — a 22-yard gap was a hole in your set on the Fit
     * Profile ladder and was not a hole in the bag recommendation, same bag, same day.
     *
     * One owner now. Asserted structurally so a future edit cannot re-fork it by adding a local
     * const back: fitProfile EXPORTS it, bagRecommendation IMPORTS it, and neither may declare a
     * second local copy.
     */
    const oneOwner = /export const GAP_YARDS = \d+;/.test(fit);
    const imported = /import \{ GAP_YARDS \} from '\.\/practice\/fitProfile';/.test(bag);
    const noLocalRefork = !/^const GAP_YARDS/m.test(bag) && (fit.match(/GAP_YARDS =/g) ?? []).length === 1;
    return oneOwner && imported && noLocalRefork;
  })(),
  'GAP_YARDS has a single owner that both the ladder and the bag recommendation read, so the two surfaces cannot answer "is this a gap?" differently');

// ─── Synthesis ─────────────────────────────────────────────────────────────────

console.log('\n=== SYNTHESIS ===');
// Emitted UNCONDITIONALLY, so this is a standing guard in the suite rather than an error path that
// only exists once something is already broken. Every guard that reads a missing file is asserting
// against an empty string, and any absence-check among them passes without looking at anything.
check(
  'LOCK: every source file the guards read actually exists',
  missingReads.length === 0,
  missingReads.length === 0
    ? `all ${readPaths.size} guard source paths resolved`
    : `UNREADABLE (guards touching these proved nothing): ${missingReads.join(', ')}`,
);
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
