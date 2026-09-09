/**
 * 2026-09-09 (Tim: "locate and anchor are fundamental though") — AND HE WAS RIGHT.
 *
 * I had left both unreported and called the key circular: a run is `(clipUri, startMs, endMs)` and
 * locate is the stage that PRODUCES startMs/endMs. That was a real observation and the wrong
 * conclusion. It is not circularity, it is SCOPE — locate searches a whole clip and finds the
 * window(s) once, for every swing in it; everything after it runs per window. Modelling that
 * (STAGE_SCOPE) makes locate reportable against the clip alone, with no window needed.
 *
 * Leaving it unreported was the worst possible gap to accept. If locate returns the wrong seconds,
 * every stage after it measures the wrong part of the swing and reports a confident, clean,
 * completely wrong read — indistinguishable from "the model is bad" from outside. Same for anchor:
 * an unanchored sampler spreads its dense band into the follow-through (the 09-01 "arc looks like
 * it's behind the user"), which arrived looking exactly like a clubhead the model could not see.
 *
 * The reporting lives on the MECHANISMS, not their call sites: there are eight locate call sites
 * across four files, and a hand-list has been wrong twice this sprint.
 * [[no-half-fixes-enforce-every-surface]] [[two-owners-is-the-root-cause]]
 */
import fs from 'fs';
import path from 'path';
import {
  STAGE_SCOPE, STAGE_DEPS, clipKeyOf, runKeyFor, noteStage, noteLocate,
  unmetDeps, describeRun, checkOrder, __resetPipelineForTest,
} from '../../services/swing/analysisPipeline';
import { useIssueLogStore } from '../../store/issueLogStore';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

beforeEach(() => __resetPipelineForTest());

describe('scope, not circularity', () => {
  it('locate is clip-scoped and every other stage is window-scoped', () => {
    expect(STAGE_SCOPE.locate).toBe('clip');
    for (const s of Object.keys(STAGE_SCOPE) as (keyof typeof STAGE_SCOPE)[]) {
      if (s !== 'locate') expect(STAGE_SCOPE[s]).toBe('window');
    }
  });

  it('a locate reported with NO window still satisfies a window-scoped dependent', () => {
    // This is the whole point: the locate happens before any window exists.
    noteLocate('file:///a.mp4', 'ok', { via: 'range', found: 3 });
    noteStage(runKeyFor('file:///a.mp4', 1200, 4300), 'pose', 'ok');
    expect(unmetDeps(runKeyFor('file:///a.mp4', 1200, 4300), 'anchor')).toEqual([]);
    expect(unmetDeps(runKeyFor('file:///a.mp4', 1200, 4300), 'pose')).toEqual([]);
  });

  it('every swing in one clip shares the single locate — it is not re-reported per window', () => {
    noteLocate('file:///a.mp4', 'ok');
    for (const w of [[0, 3000], [3000, 6000], [6000, 9000]]) {
      expect(unmetDeps(runKeyFor('file:///a.mp4', w[0], w[1]), 'pose')).toEqual([]);
    }
    // ...and a DIFFERENT clip is not covered by it.
    expect(unmetDeps(runKeyFor('file:///b.mp4', 0, 3000), 'pose')).toEqual(['locate']);
  });

  it('a FAILED or EMPTY locate does not satisfy its dependents', () => {
    noteLocate('file:///a.mp4', 'failed');
    expect(unmetDeps(runKeyFor('file:///a.mp4', 0, 3000), 'pose')).toEqual(['locate']);
  });

  it('clipKeyOf strips the window and survives a uri containing pipes', () => {
    expect(clipKeyOf(runKeyFor('file:///a.mp4', 1200, 4300))).toBe(runKeyFor('file:///a.mp4', 0, 0));
    expect(clipKeyOf(runKeyFor('file:///a|b.mp4', 5, 9))).toBe(runKeyFor('file:///a|b.mp4', 0, 0));
  });

  it('a run READS as one sequence, with the clip-scoped stage merged in', () => {
    const k = runKeyFor('file:///a.mp4', 1200, 4300);
    noteLocate('file:///a.mp4', 'ok');
    noteStage(k, 'anchor', 'ok');
    noteStage(k, 'pose', 'ok');
    noteStage(k, 'club', 'empty');
    expect(describeRun(k)?.stages).toBe('locate:ok → anchor:ok → pose:ok → club:empty');
  });

  it('the out-of-order diagnostic NAMES the locate — it is built through describeRun', () => {
    // 2026-09-09 triple-check: checkOrder built its own sequence from runs.get(key), so the moment
    // locate became clip-scoped it silently vanished from every diagnostic that exists to explain a
    // bad read. Two readers of the same data; only one was updated.
    const k = runKeyFor('file:///a.mp4', 1200, 4300);
    noteLocate('file:///a.mp4', 'ok');
    noteStage(k, 'pose', 'empty');
    const before = useIssueLogStore.getState().entries.length;
    checkOrder(k, 'club');
    const entries = useIssueLogStore.getState().entries;
    expect(entries.length).toBeGreaterThan(before);
    expect(JSON.stringify(entries[0])).toContain('locate:ok');
  });

  it('the graph still hangs everything off locate — the premise of this file', () => {
    expect(STAGE_DEPS.anchor).toContain('locate');
    expect(STAGE_DEPS.pose).toContain('locate');
  });
});

describe('every locate mechanism reports itself', () => {
  /** DERIVED: an exported locate function must report, wherever it lives. */
  const MECHANISMS = [
    ['services/swing/onDeviceLocate.ts', 'locateSwingWindowOnDevice'],
    ['services/poseDetection.ts', 'locateSwingWindow'],
    ['services/poseDetection.ts', 'locateSwings'],
  ] as const;

  it.each(MECHANISMS)('%s → %s reports on ok, empty and throw', (rel, fn) => {
    const src = read(rel);
    expect(src).toMatch(new RegExp(`export async function ${fn}\\(`));
    // The implementation is split out and the wrapper is the reporting surface.
    expect(src).toMatch(new RegExp(`async function ${fn}Impl\\(`));
    const wrapper = src.slice(src.indexOf(`export async function ${fn}(`), src.indexOf(`async function ${fn}Impl(`));
    expect(wrapper).toContain('noteLocate');
    expect(wrapper).toContain("'failed'");   // the throw path reports too
    expect(wrapper).toContain("'empty'");    // a locate that found nothing is not the same as no locate
  });

  it('no exported locate is left unwrapped — the set is scanned, not listed', () => {
    for (const rel of ['services/swing/onDeviceLocate.ts', 'services/poseDetection.ts']) {
      const src = read(rel);
      for (const m of src.matchAll(/export async function (locate[A-Za-z0-9_]*)\(/g)) {
        expect(MECHANISMS.some(([, fn]) => fn === m[1])).toBe(true);
      }
    }
  });
});

describe('every anchor decision reports itself', () => {
  /** DERIVED: any shipped file that DECIDES an anchor must note the stage. */
  const anchorDeciders = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '__tests__') continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(e.name)) continue;
        const rel = path.relative(root, full);
        // The helper that DEFINES the rule, and the sim harness that exercises it, are not deciders.
        if (rel === 'services/swing/clubPathWindow.ts' || rel.startsWith('services/harness/')) continue;
        /**
         * COMMENTS STRIPPED. The first version of this scan flagged services/swing/clubPath.ts,
         * which only NAMES impactAnchorMs in prose ("…impactAnchorMs (a heard strike, else…")" —
         * matched because the prose happens to put a space before a bracket. run-sim.ts learned this
         * exact lesson on 08-31: a file's account of itself is not the file doing the thing. Third
         * time this sprint. [[a-stale-header-is-a-source-someone-trusts]]
         */
        const src = fs.readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');
        if (/\b(impactAnchorMs|anchorToleranceMs)\s*\(/.test(src)) out.push(rel);
      }
    };
    for (const d of ['app', 'components', 'services', 'store']) {
      const abs = path.join(root, d);
      if (fs.existsSync(abs)) walk(abs);
    }
    return out.sort();
  };

  const deciders = anchorDeciders();

  it('finds the anchor deciders at all (a scan that finds nothing passes vacuously)', () => {
    expect(deciders.length).toBeGreaterThanOrEqual(2);
  });

  it.each(deciders)('%s notes the anchor stage', (rel) => {
    expect(read(rel)).toMatch(/noteStage\((?:[\s\S]{0,120}?)'anchor'/);
  });
});
