// ── CRITICAL PATH MARKER GUARD ───────────────────────────────────────────────
//
// 2026-08-19 critical-path audit.
//
// CLAUDE.md gates every phase on the paths in docs/critical-paths.md, and the
// MIN VERIFY for each path is "grep logcat for the path marker". That gate is
// only real if the markers are actually emitted. Three of the four were not:
//
//   Path 1 ONBOARD — 7 markers documented, 1 existed anywhere in the app, and it
//                    was in contextSynthesizer, not on the onboarding flow. The
//                    documented `app/onboarding/` subtree had been deleted in
//                    May. So the grep returned nothing on a healthy run and
//                    nothing on a broken one, for three months, while CLAUDE.md
//                    cited it as a gate.
//   Path 3 CAGE    — documented `[path3:cage] <stage>`; the code emits
//                    `[path3:cage:<stage>]`. A grep for the documented literal
//                    matched zero of 61 live call sites.
//   Path 4 VOICE   — `filler_start`/`filler_end` documented; code emits
//                    `earcon_start`/`earcon_end`.
//
// A gate that cannot fail is not a gate. This test makes the doc answerable to
// the code: every marker the doc tells Tim to grep for must exist in a source
// file, and every path must have a non-trivial number of them.
//
// It deliberately does NOT check the reverse direction (every logged marker is
// documented). Extra instrumentation is not a defect, and requiring the doc to
// enumerate all 61 cage stages would make it unmaintainable — that catalogue
// lives in docs/cage-telemetry-map.md.
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');

/** Every .ts/.tsx under the app's own source roots (never node_modules). */
function sourceFiles(): string[] {
  const roots = ['app', 'services', 'store', 'hooks', 'components', 'api', 'utils', 'lib'];
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        walk(full);
      } else if (/\.tsx?$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  for (const r of roots) walk(path.join(ROOT, r));
  return out;
}

const ALL_SOURCE = sourceFiles().map(f => fs.readFileSync(f, 'utf8')).join('\n');
const DOC = fs.readFileSync(path.join(ROOT, 'docs', 'critical-paths.md'), 'utf8');

/**
 * Marker prefixes, and the minimum number of DISTINCT markers each path must
 * emit for its MIN VERIFY to trace anything useful. The floors are deliberately
 * modest — this guard exists to catch "zero", not to police marker counts.
 */
const PATHS: Array<{ prefix: string; minMarkers: number; note: string }> = [
  { prefix: 'path1:onboard',   minMarkers: 3, note: 'route decision, welcome shown, complete' },
  { prefix: 'path2:round',     minMarkers: 6, note: 'start, transitions, shots, anchors, end' },
  { prefix: 'path3:cage',      minMarkers: 5, note: 'emitted as [path3:cage:STAGE] via cageLog()' },
  { prefix: 'path4:voice',     minMarkers: 6, note: 'tap, capture, intent, response, close' },
  { prefix: 'path5:gps',       minMarkers: 3, note: 'permission, watch_started, first_fix' },
  { prefix: 'path6:scorecard', minMarkers: 2, note: 'score_write, round_persisted' },
];

describe('every critical path is actually instrumented', () => {
  it.each(PATHS)('$prefix emits at least $minMarkers distinct markers ($note)', ({ prefix, minMarkers }) => {
    // Match both bracket styles: `[path2:round] name` and `[path3:cage:name]`.
    const bracketed = new RegExp(`\\[${prefix}\\]\\s*([a-z_]+)`, 'g');
    const colonised = new RegExp(`\\[${prefix}:([a-z-]+)\\]`, 'g');
    const found = new Set<string>();
    for (const m of ALL_SOURCE.matchAll(bracketed)) found.add(m[1]);
    for (const m of ALL_SOURCE.matchAll(colonised)) found.add(m[1]);
    // cageLog(stage) builds its marker at runtime, so the literal never appears
    // in source — count the call sites' stage arguments instead.
    if (prefix === 'path3:cage') {
      for (const m of ALL_SOURCE.matchAll(/cageLog\('([a-z-]+)'/g)) found.add(m[1]);
    }
    expect(found.size).toBeGreaterThanOrEqual(minMarkers);
  });

  it('every path in the doc is one this guard covers', () => {
    // Stops a seventh path being added to the doc with no instrumentation and no
    // guard — the exact way Path 1 rotted unnoticed.
    const documented = [...DOC.matchAll(/^## Path (\d+) — /gm)].map(m => Number(m[1]));
    const guarded = PATHS.map((_, i) => i + 1);
    expect(documented.sort()).toEqual(guarded.sort());
  });
});

describe('the doc does not tell you to grep for a marker that is never logged', () => {
  // The Path 1 and Path 4 failures in one assertion: pull every marker the doc
  // presents as greppable and confirm the app can actually emit it.
  it('every marker named in docs/critical-paths.md exists in source', () => {
    // Blockquoted lines (`> …`) are the "here is what this section used to say
    // and why it was wrong" notes. They quote dead markers ON PURPOSE — that is
    // the record of the defect. Only live instructions are held to the contract.
    const liveDoc = DOC.split('\n').filter(l => !l.trimStart().startsWith('>')).join('\n');
    const claimed = new Set<string>();
    for (const m of liveDoc.matchAll(/`\[(path\d:[a-z]+)\]\s+([a-z_]+)/g)) {
      claimed.add(`${m[1]}|${m[2]}`);
    }
    const missing = [...claimed].filter(c => {
      const [prefix, name] = c.split('|');
      return !new RegExp(`\\[${prefix}\\]\\s*${name}`).test(ALL_SOURCE);
    });
    expect(missing).toEqual([]);
  });

  // Path 3's specific trap: the doc told you to grep `[path3:cage]`, which cannot
  // match, because the stage name lives inside the brackets.
  it('does not present the un-matchable [path3:cage] literal as a grep string', () => {
    const badGrepInstruction = /grep\s+`\[path3:cage\]`/.test(DOC);
    expect(badGrepInstruction).toBe(false);
  });
});
