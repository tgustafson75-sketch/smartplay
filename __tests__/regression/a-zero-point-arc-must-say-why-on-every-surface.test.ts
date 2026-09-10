/**
 * 2026-09-09 — A ZERO-POINT ARC MUST SAY WHY, ON EVERY SURFACE THAT READS ONE.
 *
 * `f44f06d` (09-06) added `rejected` / `detected` / `gate` to detectClubPath so that a sparse arc
 * would name its own cause: `too_few` sends you to the CAMERA, `cluster` / `scatter` send you to the
 * PROMPT, and `points: 0` alone cannot tell them apart. The 09-08 close-out then asked for one field
 * report carrying those fields to settle whether the private copy was the ONLY cause of a sparse arc.
 *
 * That report was unobtainable, and the reason was in the code: f44f06d wired the diagnostic into the
 * SWING-DETAIL screen only. SmartMotion — the screen swings are actually recorded on — dropped every
 * empty result silently, and the analysis pass in videoUpload still logged the bare `points: 0` the
 * commit set out to replace. Two of the three surfaces could not answer the question they were asked.
 *
 * So this gate does NOT hand-list the surfaces. The 09-09 triple-check learned that lesson twice over
 * ("the gate no longer trusts a hand-written list, because that list was wrong twice"): it DERIVES
 * the set by scanning for callers of detectClubPath, and every one must either report the rejection
 * reason or carry a named allowance. A fourth surface added later fails this test until it does.
 *
 * [[missing-log-entry-is-the-evidence]] [[no-half-fixes-enforce-every-surface]]
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const SEARCH_DIRS = ['app', 'components', 'services', 'store', 'utils'];

/** Callers are DERIVED, never listed. */
function callersOfDetectClubPath(): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '__tests__') continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(e.name)) continue;
      const src = fs.readFileSync(full, 'utf8');
      // The definition itself is not a caller, and neither is a file that merely names it in prose.
      if (!/\bdetectClubPath\s*\(/.test(src)) continue;
      if (/export\s+(async\s+)?function\s+detectClubPath/.test(src)) continue;
      hits.push(path.relative(root, full));
    }
  };
  for (const d of SEARCH_DIRS) {
    const abs = path.join(root, d);
    if (fs.existsSync(abs)) walk(abs);
  }
  return hits.sort();
}

/**
 * A surface may be excused ONLY with a reason recorded here. Empty today on purpose: all three known
 * callers report. Anything added here should say why the rejection reason is worthless on that path.
 */
const ALLOWED: Record<string, string> = {};

describe('a zero-point arc must say why on every surface', () => {
  const callers = callersOfDetectClubPath();

  it('finds the arc-reading surfaces at all (a scan that finds nothing would pass vacuously)', () => {
    expect(callers.length).toBeGreaterThanOrEqual(3);
  });

  it.each(callers)('%s reports the rejection reason, not just a point count', (rel) => {
    if (ALLOWED[rel]) return;
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    // The three fields that separate a capture problem from a mis-detection.
    expect(src).toMatch(/rejected:\s*\w+\??\.?(\w+)?\??\.?rejected\?\.reason/);
    expect(src).toMatch(/detected:\s*/);
    expect(src).toMatch(/gate:\s*/);
  });

  it('both review screens name which screen the event came from', () => {
    for (const rel of callers.filter((c) => c.startsWith('app/'))) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(src).toMatch(/screen:\s*'/);
    }
  });
});
