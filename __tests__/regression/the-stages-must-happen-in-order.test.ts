/**
 * 2026-09-06 (Tim) — "just to make sure that those things happen in the order that we know they need
 * to happen. If not, we get fired some diagnostic."
 *
 * The thin version of the orchestrator parked in docs/v1.2-deferred.md. It executes nothing and
 * reorders nothing — it OBSERVES, and says so when an order occurs that cannot be correct. That
 * restraint is why it could ship the same night: an engine that owns the analysis path is not
 * something to write tired; an engine that only watches it cannot break a swing read.
 *
 * The edge it exists for is `frame` having TWO dependents. On 2026-09-06 the roi was wired to the
 * club path and not to pose, because "who gets the crop" was written down nowhere — and an edge with
 * two dependents is exactly the one a per-screen useEffect forgets.
 */
import {
  STAGE_DEPS, STAGE_ORDER, runKeyFor, noteStage, unmetDeps, checkOrder, describeRun,
  __resetPipelineForTest, type Stage,
} from '../../services/swing/analysisPipeline';

const KEY = runKeyFor('file:///clip.mp4', 1000, 4000);

beforeEach(() => __resetPipelineForTest());

describe('the dependency graph says what it means', () => {
  it('club needs BOTH pose and frame — the edge that was missed', () => {
    expect([...STAGE_DEPS.club].sort()).toEqual(['frame', 'pose']);
  });

  it('frame depends on pose, not the reverse', () => {
    // Reads backwards until you remember the crop is derived FROM body bounds we already detected.
    expect(STAGE_DEPS.frame).toEqual(['pose']);
    expect(STAGE_DEPS.pose).not.toContain('frame');
  });

  it('has no cycles, and every dep is a real stage', () => {
    const seen = new Set<Stage>();
    const visiting = new Set<Stage>();
    const walk = (s: Stage) => {
      if (seen.has(s)) return;
      expect(visiting.has(s)).toBe(false);   // a cycle would be a design error
      visiting.add(s);
      for (const d of STAGE_DEPS[s]) {
        expect(STAGE_ORDER).toContain(d);
        walk(d);
      }
      visiting.delete(s);
      seen.add(s);
    };
    for (const s of STAGE_ORDER) walk(s);
    expect(seen.size).toBe(STAGE_ORDER.length);
  });

  it('every dep comes EARLIER in the canonical order', () => {
    for (const s of STAGE_ORDER) {
      for (const d of STAGE_DEPS[s]) {
        expect(STAGE_ORDER.indexOf(d)).toBeLessThan(STAGE_ORDER.indexOf(s));
      }
    }
  });
});

describe('unmet dependencies are detected', () => {
  it('club before anything is fully unmet', () => {
    expect(unmetDeps(KEY, 'club').sort()).toEqual(['frame', 'pose']);
  });

  it('a good pose + frame satisfies club', () => {
    noteStage(KEY, 'locate', 'ok');
    noteStage(KEY, 'pose', 'ok');
    noteStage(KEY, 'frame', 'ok');
    expect(unmetDeps(KEY, 'club')).toEqual([]);
  });

  it('a PARTIAL pose still satisfies its dependents', () => {
    // Deliberate. A half-read pose is exactly when we still want club to try: it may have the
    // frames it needs even with gaps in the skeleton, and refusing would trade a real failure for a
    // self-inflicted one.
    noteStage(KEY, 'pose', 'partial');
    noteStage(KEY, 'frame', 'ok');
    expect(unmetDeps(KEY, 'club')).toEqual([]);
  });

  it('an EMPTY or FAILED pose does not — there is nothing to compute from', () => {
    noteStage(KEY, 'pose', 'empty');
    expect(unmetDeps(KEY, 'frame')).toEqual(['pose']);
    noteStage(KEY, 'pose', 'failed');
    expect(unmetDeps(KEY, 'frame')).toEqual(['pose']);
  });
});

describe('a violation fires a diagnostic, and does not block', () => {
  it('checkOrder RETURNS the problem rather than throwing', () => {
    // Callers proceed anyway on purpose: running early beats not running on a swing Tim is standing
    // over. Tonight's job is to learn whether it happens, not to start refusing work.
    expect(() => checkOrder(KEY, 'club')).not.toThrow();
    expect(checkOrder(KEY, 'club').sort()).toEqual(['frame', 'pose']);
  });

  it('files an issue-log entry naming the stage and what was missing', () => {
    const { useIssueLogStore } = require('../../store/issueLogStore') as typeof import('../../store/issueLogStore');
    const before = useIssueLogStore.getState().entries.length;
    noteStage(KEY, 'pose', 'ok');
    checkOrder(KEY, 'club');            // frame never ran
    const entries = useIssueLogStore.getState().entries;
    expect(entries.length).toBeGreaterThan(before);
    const e = entries[0];
    expect(JSON.stringify(e)).toContain('analysis_stage_out_of_order');
    expect(JSON.stringify(e)).toContain('frame');
  });

  it('says nothing when the order is sound', () => {
    const { useIssueLogStore } = require('../../store/issueLogStore') as typeof import('../../store/issueLogStore');
    noteStage(KEY, 'pose', 'ok');
    noteStage(KEY, 'frame', 'ok');
    const before = useIssueLogStore.getState().entries.length;
    expect(checkOrder(KEY, 'club')).toEqual([]);
    expect(useIssueLogStore.getState().entries.length).toBe(before);
  });
});

describe('a run reads as a sequence', () => {
  it('describeRun renders the stages in canonical order', () => {
    noteStage(KEY, 'pose', 'partial');
    noteStage(KEY, 'locate', 'ok');
    noteStage(KEY, 'club', 'empty');
    // Reported in STAGE_ORDER, not the order they happened to be recorded.
    expect(describeRun(KEY)?.stages).toBe('locate:ok → pose:partial → club:empty');
  });

  it('two screens analysing the same swing share one run', () => {
    // The key is clip + window, the same key the club-arc effect already uses.
    expect(runKeyFor('file:///a.mp4', 1000, 4000)).toBe(runKeyFor('file:///a.mp4', 1000.4, 4000.2));
    expect(runKeyFor('file:///a.mp4', 1000, 4000)).not.toBe(runKeyFor('file:///a.mp4', 1000, 5000));
  });

  it('is bounded — a long session cannot grow it without limit', () => {
    for (let i = 0; i < 40; i++) noteStage(runKeyFor(`file:///c${i}.mp4`, 0, 1), 'pose', 'ok');
    const alive = Array.from({ length: 40 }, (_, i) => describeRun(runKeyFor(`file:///c${i}.mp4`, 0, 1)))
      .filter(Boolean).length;
    expect(alive).toBeLessThanOrEqual(8);
    // ...and it keeps the NEWEST, which is the one still in flight.
    expect(describeRun(runKeyFor('file:///c39.mp4', 0, 1))).not.toBeNull();
  });
});

describe('the call sites report', () => {
  const fs = require('fs'), path = require('path');
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8') as string;

  it('pose reports its own stage and the frame stage it derives', () => {
    const src = read('services/poseAnalysisApi.ts');
    expect(src).toContain("pipe.noteStage(key, 'pose'");
    expect(src).toContain("pipe.noteStage(key, 'frame'");
  });

  it('club checks order BEFORE it runs, and reports after', () => {
    const src = read('app/swinglab/swing/[swing_id].tsx');
    const check = src.indexOf("checkOrder(pipe.runKeyFor(uri, startMs, endMs), 'club')");
    const call = src.indexOf('const r = await detectClubPath(');
    expect(check).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(check);          // checked first, or it proves nothing
    expect(src).toContain("pipe.noteStage(pipe.runKeyFor(uri, startMs, endMs), 'club'");
  });
});
