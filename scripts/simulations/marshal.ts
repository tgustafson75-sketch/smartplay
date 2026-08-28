/**
 * THE MARSHAL — a standing F1 score for WIRE INTEGRITY.
 *
 * 2026-08-27 (Tim — "some kind of F1 scoring mechanism, kind of a marshal in terms of the app, that
 * constantly makes sure that we are continuously keeping quality and not having stray code").
 *
 * WHAT IT SCORES, AND WHY THAT AND NOT SOMETHING ELSE.
 *
 * This harness has 800+ guards and they have been wrong in exactly two directions, over and over:
 *
 *   PRECISION failures — a guard that PASSES while proving nothing. The clearest case cost a month:
 *   six sim guards and three jest tests were asserting properties of hooks/useKevin.ts, a file with
 *   no caller since 07-24. All green, all meaningless, and the gap they were supposed to cover
 *   shipped. Same family: a guard reading a path that does not exist (asserting against ""), and a
 *   guard whose pattern matches the doc comment instead of the code.
 *
 *   RECALL failures — a shipped surface no guard reads at all. SmartFinder is 2,639 lines and has
 *   never been swept.
 *
 * One number for each, and the harmonic mean of the two, because they trade off: deleting every
 * weak guard makes precision perfect and recall worse, and guarding every file with a `toBeTruthy`
 * does the reverse. F1 punishes both moves, which is what makes it the right shape for "are we
 * continuously keeping quality" rather than a number that can be gamed in either direction.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not score whether a guard's assertion is CORRECT — no
 * static pass can know that, and a score that implied it would be the same kind of false comfort the
 * dead-file guards gave. It measures whether each guard is pointed at live, readable, reachable code
 * and whether the shipped app is covered. Correctness is what break-testing is for.
 * [[break-test-every-guard-you-write]] [[grep-guards-cant-see-dead-code]]
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../');

/** The shipped app. Tests, scripts and config are the measuring apparatus, not the thing measured. */
const SHIPPED_DIRS = ['services', 'hooks', 'components', 'store', 'lib', 'api', 'app', 'contexts', 'utils'];

/**
 * Entry points own themselves: nothing in the repo imports an expo-router route, a Vercel serverless
 * handler or the root layout — they are invoked by the router and by HTTP. Calling them islands
 * would drown the real signal, and it did on the first run: 55 of the 63 "islands" were api/*.ts
 * handlers, i.e. the marshal's very first output was mostly a false accusation of exactly the kind
 * this file warns about two paragraphs down. An unreferenced api/ handler IS worth knowing about,
 * but the question there is "does vercel.json route to it", which is a different check with a
 * different answer, not this one.
 */
function isEntryPoint(rel: string): boolean {
  return rel.startsWith('app/') || rel.startsWith('api/') || /(^|\/)(index|_layout)\.tsx?$/.test(rel);
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = path.join(dir, e);
    let stat;
    try { stat = fs.statSync(p); } catch { continue; }
    if (stat.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.d\.ts$/.test(e)) out.push(path.relative(ROOT, p));
  }
  return out;
}

/**
 * Every module referenced by an import/require anywhere in the shipped app.
 *
 * Resolution is deliberately forgiving: a specifier is matched to a file by extension-completing the
 * resolved path. An import we cannot resolve contributes nothing rather than being guessed at, so
 * the island list under-reports before it over-reports. A false island accusation would send someone
 * to delete live code, which is a far worse failure than missing one.
 */
export function buildReferencedSet(files: string[]): Set<string> {
  const referenced = new Set<string>();
  const exists = new Set(files);
  const resolve = (fromRel: string, spec: string): string | null => {
    if (!spec.startsWith('.')) return null;
    const base = path.normalize(path.join(path.dirname(fromRel), spec));
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
      if (exists.has(cand)) return cand;
    }
    return null;
  };
  /**
   * PLATFORM VARIANTS ARE REFERENCED BY THE BUNDLER, NOT BY A SPECIFIER. Metro resolves
   * `import '../services/mediaKeyBridge'` to mediaKeyBridge.web.ts on web and mediaKeyBridge.ts
   * everywhere else. No file names the variant, so a plain import-graph walk calls it an island —
   * and the first run of this marshal did exactly that, accusing a live file the app depends on.
   * A resolved base marks every one of its platform siblings referenced too.
   */
  const PLATFORMS = ['web', 'ios', 'android', 'native'];
  const markVariants = (rel: string): void => {
    const m = /^(.*)\.(ts|tsx)$/.exec(rel);
    if (!m) return;
    for (const p of PLATFORMS) {
      for (const ext of ['ts', 'tsx']) {
        const v = `${m[1]}.${p}.${ext}`;
        if (exists.has(v)) referenced.add(v);
      }
    }
  };
  for (const f of files) {
    let src = '';
    try { src = fs.readFileSync(path.join(ROOT, f), 'utf-8'); } catch { continue; }
    // Comments stripped: an import named only in a paragraph is not a reference. This is the same
    // lesson the orphan sweep learned — commented-out imports counted as uses and hid 29 orphans.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');
    for (const m of code.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const hit = resolve(f, m[1]);
      if (hit) { referenced.add(hit); markVariants(hit); }
    }
  }
  return referenced;
}

export interface WireIntegrity {
  precision: number;
  recall: number;
  f1: number;
  guardedFiles: number;
  shippedFiles: number;
  coveredShipped: number;
  /** Guards pointed at a path that does not exist — they assert against an empty string. */
  unreadable: string[];
  /** Guards pointed at a real file that nothing imports — green on code that cannot run. */
  islands: string[];
  /** Assertions satisfied only by a comment. Reported alongside; see the note on scoring below. */
  proseAssertions: number;
}

export function computeWireIntegrity(input: {
  /** Every path the harness read this run. */
  readPaths: Set<string>;
  /** Paths it could not read. */
  missingReads: string[];
  /** Output of findProseAssertions(). */
  proseAssertions: string[];
}): WireIntegrity {
  const shipped = SHIPPED_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const shippedSet = new Set(shipped);
  const referenced = buildReferencedSet(shipped);

  // What the harness guards, restricted to the shipped app — a guard reading a script or a fixture
  // is doing something legitimate, but it is not coverage of the product.
  const guarded = [...input.readPaths].filter((p) => shippedSet.has(p) || input.missingReads.includes(p));

  const unreadable = guarded.filter((p) => input.missingReads.includes(p)).sort();
  const islands = guarded
    .filter((p) => shippedSet.has(p) && !isEntryPoint(p) && !referenced.has(p))
    .sort();

  /**
   * PRECISION — of the files we point guards at, how many are live, readable code?
   *
   * Prose assertions are counted and REPORTED but not subtracted here, and that is a deliberate
   * choice rather than an oversight: they are an assertion-level defect, and mixing an
   * assertion-level count into a file-level ratio would produce a number that means nothing in
   * either unit. They have their own ratchet (PROSE_ASSERTION_BASELINE) which is the stricter
   * control anyway — that one forbids a single new occurrence, where a ratio would absorb it.
   */
  const bad = new Set([...unreadable, ...islands]);
  const precision = guarded.length === 0 ? 0 : (guarded.length - bad.size) / guarded.length;

  // RECALL — of the shipped app, how much does any guard read at all?
  const coveredShipped = shipped.filter((p) => input.readPaths.has(p)).length;
  const recall = shipped.length === 0 ? 0 : coveredShipped / shipped.length;

  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    precision,
    recall,
    f1,
    guardedFiles: guarded.length,
    shippedFiles: shipped.length,
    coveredShipped,
    unreadable,
    islands,
    proseAssertions: input.proseAssertions.length,
  };
}

/**
 * THE RATCHET. Wire integrity may not go DOWN.
 *
 * Set from the measured score at the time the marshal was built. Raise it when a sweep improves the
 * number; never lower it to make a run pass. A drop means one of three specific things happened and
 * all three are worth stopping for: a guard was pointed at a file that does not exist, a guard was
 * pointed at code nothing imports, or the app grew a surface nobody guarded.
 *
 * The tolerance exists because recall moves whenever a file is added — writing one new module before
 * its guard should not fail the build, but a run of them should.
 */
export const MARSHAL_F1_FLOOR = 0.98;
export const MARSHAL_TOLERANCE = 0.01;

/**
 * THE ISLANDS THE FIRST RUN FOUND — frozen, and the actual teeth of this marshal.
 *
 * The F1 is a TREND number and it is honest about being one: three dead-file guards out of 753
 * move it by 0.4%, so a ratio alone would let the useKevin failure (six guards green on a file with
 * no caller, for a month) slide in under any tolerance loose enough not to fire on ordinary churn.
 * The list is what carries the enforcement — a NEW island fails the run on the day it appears, the
 * same shape as ORPHAN_BASELINE and PROSE_ASSERTION_BASELINE.
 *
 * Each entry is a guard pointed at a file nothing imports. They are not failures of the guard's
 * logic; they are guards whose subject cannot run. Resolve one by wiring the file up or deleting it
 * WITH its guards — never by adding a line here. This list may only get shorter.
 */
export const ISLAND_BASELINE: Record<string, string> = {
  // A whole alternate caddie screen. useVoiceCaddie still has comments describing what "reaches the
  // CockpitCaddieScreen advice card"; nothing routes to it. TRIAGE — delete or wire, Tim's call.
  'components/caddie/CockpitCaddieScreen.tsx': 'TRIAGE — cockpit mode screen, no route reaches it',
  'hooks/useLayout.ts': 'TRIAGE — no consumer since the layout freeze',
  'services/swing/poseMotion.ts': 'TRIAGE — motion helpers, superseded by poseAnalysisApi',
};

export function formatWireIntegrity(w: WireIntegrity): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines = [
    `F1 ${pct(w.f1)}  ·  precision ${pct(w.precision)} (${w.guardedFiles - w.unreadable.length - w.islands.length}/${w.guardedFiles} guarded files are live + readable)  ·  recall ${pct(w.recall)} (${w.coveredShipped}/${w.shippedFiles} shipped files guarded)`,
  ];
  if (w.unreadable.length) lines.push(`  UNREADABLE (assert against ""): ${w.unreadable.slice(0, 8).join(', ')}${w.unreadable.length > 8 ? ` +${w.unreadable.length - 8}` : ''}`);
  if (w.islands.length) lines.push(`  ISLANDS (guarded, but nothing imports them): ${w.islands.slice(0, 8).join(', ')}${w.islands.length > 8 ? ` +${w.islands.length - 8}` : ''}`);
  lines.push(`  prose-reading assertions: ${w.proseAssertions} (own ratchet)`);
  return lines.join('\n');
}
