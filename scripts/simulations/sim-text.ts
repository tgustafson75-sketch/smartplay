/**
 * 2026-07-29 (Tim — "so I can run harness sims by type / voice").
 *
 * Text/voice understanding harness. Voice and typed input CONVERGE: on-device a voice utterance is
 * transcribed to text and then runs through the EXACT SAME intent pipeline a typed line does — so
 * feeding text here exercises the shared understanding path for both. (The voice-only layers —
 * transcription + TTS — are covered by the Path-4 diagnostic-marker scenarios in run-sim.ts.)
 *
 * Type an utterance and see EXACTLY how the app understands it, with no device and no cloud. Every
 * line runs through the app's real LOCAL pipeline —
 *   • precheckLocalIntent()  → the deterministic intent + parameters (the on-device fast path)
 *   • lookupFeature()        → which tool/screen an "open X" resolves to
 *   • isAppHelpQuery()       → whether it's an app-help question (gates the heavy KB)
 *   • resolveSpokenCourse()  → which course a "play X" names
 * so you can eyeball routing, catch a misclassification, and confirm fixes (e.g. "end round" → the
 * end_round intent, which now opens the Save/Discard prompt instead of the old auto-save crash path).
 *
 * A precheck MISS is normal + honest — that utterance is conversational and would go to the cloud
 * classifier / brain on-device (shown as "→ cloud brain"), which this offline harness can't run.
 *
 * Run:
 *   npx tsx scripts/simulations/sim-text.ts                       # the default battery
 *   npx tsx scripts/simulations/sim-text.ts --say="end round" --say="open smart tempo"
 */

import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { lookupFeature } from '../../services/knowledgeBase/appCatalog';
import { isAppHelpQuery } from '../../services/knowledgeBase/capabilities';
import { resolveSpokenCourse } from '../../services/courseNameResolver';

const argv = process.argv.slice(2);
const custom = argv.filter(a => a.startsWith('--say=')).map(a => a.slice(6));

// A representative battery across the command surface (rounds, logging, on-course facts, tools,
// app-help, courses). Each has an OPTIONAL expectation so this doubles as a regression check.
interface Case { say: string; expectIntent?: string; expectFeatureRoute?: string; expectHelp?: boolean; expectCourse?: boolean }
// Expectations assert only what is DETERMINISTIC LOCALLY (precheck intents, lookupFeature routes,
// isAppHelpQuery, resolveSpokenCourse on a bare name). Lines that legitimately need the cloud
// classifier (end_round, log_score, log_shot, full-sentence course starts) are shown for routing
// visibility with NO expectation — the harness's job there is to prove they hand off to the brain, not
// to fake a local answer.
const BATTERY: Case[] = custom.length
  ? custom.map(say => ({ say }))
  : [
      { say: 'end round' },                                                  // → cloud classifier → end_round → Save/Discard prompt
      { say: "that's the round" },                                           // → cloud classifier → end_round
      { say: 'coyote creek', expectCourse: true },                           // bare course name resolves locally
      { say: 'I made a 5' },                                                 // → cloud classifier → log_score
      { say: 'log a 7 iron' },                                               // → cloud classifier → log_shot
      { say: 'how far to the pin', expectIntent: 'query_status' },
      { say: "what's the play here", expectIntent: 'query_status' },
      { say: 'take me to smartvision', expectIntent: 'open_tool', expectFeatureRoute: '/smartvision' },
      { say: 'open smart tempo', expectFeatureRoute: '/swinglab/smart-tempo' },
      { say: 'import my arccos numbers', expectFeatureRoute: '/arccos-import' },
      { say: 'scan my bag', expectFeatureRoute: '/bag-scan' },
      { say: 'how do I record my swing', expectHelp: true },
      { say: 'what can you do', expectHelp: true },
      { say: "what's new", expectHelp: true },
      { say: 'read this putt' },
      { say: 'hey Kevin' },
    ];

let checks = 0;
let fails = 0;
function assert(label: string, ok: boolean, detail: string): void {
  checks++;
  if (!ok) { fails++; console.log(`      ✗ ${label} — ${detail}`); }
}

console.log('='.repeat(72));
console.log('TEXT UNDERSTANDING HARNESS — how each typed line routes (local pipeline)');
console.log('='.repeat(72));

for (const c of BATTERY) {
  const intent = precheckLocalIntent(c.say);
  const feature = lookupFeature(c.say);
  const help = isAppHelpQuery(c.say);
  const course = resolveSpokenCourse(c.say);

  const intentStr = intent
    ? `${intent.intent_type}${Object.keys(intent.parameters).length ? ' ' + JSON.stringify(intent.parameters) : ''} [${intent.confidence}]`
    : '→ cloud brain (no local match)';
  const extras: string[] = [];
  if (feature) extras.push(`tool=${feature.name}(${feature.route})`);
  if (help) extras.push('appHelp');
  if (course) extras.push(`course=${course.label}`);

  console.log(`\n"${c.say}"`);
  console.log(`   intent: ${intentStr}`);
  if (extras.length) console.log(`   also:   ${extras.join('  ·  ')}`);

  if (c.expectIntent) assert('intent', intent?.intent_type === c.expectIntent, `expected ${c.expectIntent}, got ${intent?.intent_type ?? 'null'}`);
  if (c.expectFeatureRoute) assert('feature', feature?.route === c.expectFeatureRoute, `expected ${c.expectFeatureRoute}, got ${feature?.route ?? 'null'}`);
  if (c.expectHelp != null) assert('appHelp', help === c.expectHelp, `expected appHelp=${c.expectHelp}, got ${help}`);
  if (c.expectCourse) assert('course', course != null, `expected a course match, got null`);
}

console.log('\n' + '='.repeat(72));
if (custom.length) {
  console.log('Custom lines — no expectations asserted.');
  process.exit(0);
}
console.log(`Expectations: ${checks - fails}/${checks} passed`);
if (fails > 0) { console.log('✗ Some routing expectations failed.'); process.exit(1); }
console.log('✓ All routing expectations passed.');
process.exit(0);
