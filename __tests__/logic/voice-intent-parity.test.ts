// ── VOICE VOCABULARY PARITY GUARD ────────────────────────────────────────────
//
// 2026-08-19 reconciliation pass. The voice stack keeps four vocabularies that
// have to agree, and nothing enforced that agreement until this file:
//
//   1. api/voice-intent.ts INTENT_TYPE_ENUM  — what the cloud classifier may emit
//   2. services/intents/*.ts intent_type      — what the app can actually handle
//   3. api/_brainTools.ts BRAIN_TOOLS         — what the brain may call
//   4. services/voice/conversationalToolDispatch.ts — what the client can dispatch
//
// Three of them had drifted when this guard was written. All three drifts were
// silent: no crash, no error log, just a caddie that chatted pleasantly instead
// of doing the thing.
//
// THIS GUARD FORBIDS THE SHAPE, NOT THE INSTANCES.
// -----------------------------------------------
// Every previous fix in this area patched the specific intent that was broken —
// `undo`/`find_my_data`/`open_course` in July, `correct_last_shot` in August —
// and the NEXT one broke the same way, because the hole was structural. So none
// of the assertions below name a tool or an intent. They are set relations. A
// new intent or tool added tomorrow is covered on the day it lands.
//
// Two of these assertions are deliberately about SOURCE TEXT (does an endpoint
// declare its own tool array?). That is not the usual grep-guard smell, where a
// string's presence is used as a proxy for behavior a test could not otherwise
// see. Here the source text IS the contract being protected: the defect was
// literally "a second copy of this array exists".
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Intents the cloud classifier is allowed to return. */
function classifierEnum(): string[] {
  const src = read('api/voice-intent.ts');
  const m = src.match(/const INTENT_TYPE_ENUM = \[([\s\S]*?)\] as const;/);
  if (!m) throw new Error('INTENT_TYPE_ENUM not found — did api/voice-intent.ts get restructured?');
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
}

/** Intents that have a registered handler under services/intents/. */
function handlerIntents(): string[] {
  const dir = path.join(ROOT, 'services', 'intents');
  const found = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/intent_type:\s*'([a-z_]+)'/g)) found.add(m[1]);
  }
  return [...found];
}

describe('classifier enum ↔ intent handlers', () => {
  // The recurring defect, generalised. A handler with no enum entry is only
  // reachable through whatever narrow precheck regex shipped alongside it; every
  // phrasing the regex author did not imagine becomes small talk.
  it('every handled intent is emittable by the cloud classifier', () => {
    const orphans = handlerIntents().filter(i => !classifierEnum().includes(i) && i !== 'unknown');
    expect(orphans).toEqual([]);
  });

  // The reverse hole: the classifier confidently emits an intent that lands on
  // nothing. Two entries are legitimately handler-less — they are routing
  // sentinels, not actions. `conversational` hands the turn to the brain;
  // `unknown` is the parser's "I could not tell" fallback
  // (services/voiceCommandParser.ts), which the routers treat the same way.
  it('every classifiable intent has a handler (or is a routing sentinel)', () => {
    const HANDLED_BY_BRAIN = ['conversational', 'unknown'];
    const dead = classifierEnum().filter(
      i => !handlerIntents().includes(i) && !HANDLED_BY_BRAIN.includes(i),
    );
    expect(dead).toEqual([]);
  });

  // An enum entry with no prompt guidance is emittable in theory and near-dead in
  // practice — the model has nothing telling it when to choose that intent.
  it('every classifiable intent has prompt guidance beyond the enum line', () => {
    const src = read('api/voice-intent.ts');
    const withoutEnum = src.replace(/const INTENT_TYPE_ENUM = \[[\s\S]*?\] as const;/, '');
    const unguided = classifierEnum().filter(
      i => (withoutEnum.match(new RegExp(`\\b${i}\\b`, 'g')) || []).length === 0,
    );
    expect(unguided).toEqual([]);
  });
});

describe('brain tool contract has exactly one owner', () => {
  /**
   * 2026-08-24 — ONE. api/pipecat-turn's 744-line implementation was replaced by a pass-through to
   * kevin, so it has no tool contract to own. The case below asserts it stays that way; keeping it
   * in this list would assert the opposite.
   */
  const BRAINS = ['api/kevin.ts'];

  it('api/pipecat-turn.ts is GONE — a pass-through with no callers is not a route', () => {
    /**
     * 2026-09-01 — this used to assert the route had no brain of its own. It no longer has anything
     * of its own: nothing had called it since 08-23, so it and api/_brainShim (373 lines between
     * them) were deleted. The strongest form of "it is only a pass-through" is that it is not there.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsm = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pth = require('path') as typeof import('path');
    expect(fsm.existsSync(pth.resolve(__dirname, '../../api/pipecat-turn.ts'))).toBe(false);
    expect(fsm.existsSync(pth.resolve(__dirname, '../../api/_brainShim.ts'))).toBe(false);
  });

  // The 2026-08-19 defect in one assertion. Both brains hand-maintained their own
  // copy of the tool array; the copies diverged by two whole tools and ~255 lines
  // of description. Since kevin.ts owns the FOLLOW-UP turn, turn 1 and turn 2 of
  // one conversation ran different tool sets.
  it.each(BRAINS)('%s declares no tool array of its own', (file) => {
    const src = read(file);
    // A tool declaration in these files looks like `name: 'log_shot',` followed by
    // a `description:`. Importing BRAIN_TOOLS produces neither.
    const localDecls = [...src.matchAll(/name:\s*'([a-z_]+)',\s*\n\s*description:/g)].map(m => m[1]);
    expect(localDecls).toEqual([]);
  });

  it.each(BRAINS)('%s sources its tools from api/_brainTools.ts', (file) => {
    expect(read(file)).toMatch(/import \{[^}]*BRAIN_TOOLS[^}]*\} from '\.\/_brainTools'/);
  });

  // A tool the client cannot dispatch is a tool the caddie will claim to have used.
  it('every UI tool has a client dispatch case', () => {
    const tools = read('api/_brainTools.ts');
    const uiSet = tools.match(/export const UI_TOOLS = new Set\(\[([\s\S]*?)\]\);/);
    if (!uiSet) throw new Error('UI_TOOLS not found in api/_brainTools.ts');
    const uiTools = [...uiSet[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);

    const dispatch = read('services/voice/conversationalToolDispatch.ts');
    const undispatchable = uiTools.filter(t => !new RegExp(`case '${t}'`).test(dispatch));
    expect(undispatchable).toEqual([]);
  });

  // Every declared tool must be routed somewhere: executed on the server, or
  // forwarded to the client. A tool in neither set silently returns a dummy ack.
  it('every declared tool is classified as either server-executed or client-dispatched', () => {
    const tools = read('api/_brainTools.ts');
    const declared = [...tools.matchAll(/^ {4}name: '([a-z_]+)'/gm)].map(m => m[1]);
    const setNames = (n: string) => {
      const m = tools.match(new RegExp(`export const ${n} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
      return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]) : [];
    };
    const routed = new Set([...setNames('UI_TOOLS'), ...setNames('SERVER_TOOLS')]);
    expect(declared.filter(t => !routed.has(t))).toEqual([]);
  });
});

describe('no vocabulary doc points at a deleted file', () => {
  // The 11 Expo Router dev twins were deleted on 2026-08-13 (commit 59281f61).
  // api/voice-intent.ts kept an 8-line header telling readers to diff against one
  // of them, and docs/VOICE-INTENT-REGISTRY.md still gave "add to the intent_type
  // union in app/api/voice-intent+api.ts" as step 1 of adding an intent. Stale
  // instructions cost more than missing ones: they are followed.
  const SOURCES = [
    'api/voice-intent.ts',
    'api/kevin.ts',
    'api/_brainTools.ts',
    'docs/VOICE-INTENT-REGISTRY.md',
    'docs/voice-intent-parity.md',
  ];

  it.each(SOURCES)('%s does not instruct the reader to edit app/api/*+api.ts', (file) => {
    const lines = read(file).split('\n');
    // The deleted twins may be NAMED in history/rationale prose. What is forbidden
    // is presenting one as a live edit target.
    const offenders = lines.filter(l => {
      if (!/app\/api\/[a-z-]*\+api\.ts/.test(l)) return false;
      return /\b(add to|edit|update|change|diff|MUST be made in|keep|sync)\b/i.test(l);
    });
    expect(offenders).toEqual([]);
  });

  it('the app/api dev-twin directory is still gone', () => {
    const dir = path.join(ROOT, 'app', 'api');
    const twins = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('+api.ts')) : [];
    expect(twins).toEqual([]);
  });
});
