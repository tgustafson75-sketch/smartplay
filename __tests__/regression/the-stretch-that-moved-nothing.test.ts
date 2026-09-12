/**
 * 2026-09-11 (full-app audit, finding 8) — LOGGING A STRETCH MOVED NOTHING.
 *
 * The dashboard's practice-impact memo READ `warmupEvents` and did not list it as a dependency.
 * warmupEvents draws on workoutHistory as well as practiceHistory, and a pre-round STRETCH is a
 * workoutHistory entry (`source === 'preround_warmup'`) that never touches practiceHistory. So
 * logging a stretch changed warmupEvents, the memo did not recompute, and the warm-up markers on the
 * practice line plus the warmed-vs-cold scoring split stayed stale until a practice session or a
 * round happened to land.
 *
 * Exactly the thing Tim said he wanted to see — "definitely some differences on whether I stretch
 * before I play". He would have logged one, opened the dashboard, and watched nothing move.
 *
 * THIS GUARD EXISTS BECAUSE react-hooks/exhaustive-deps IS NOT ONE OF THE FOUR GATES. The lint found
 * it; nothing in tsc / jest / sim / user-sim would, so without this test it could return silently.
 * [[exhaustive-deps-finds-half-wired-fixes]]
 */
import fs from 'fs';
import path from 'path';

const dash = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/dashboard.tsx'), 'utf8');

/** The dependency array of the useMemo that builds practiceImpact. */
const practiceImpactDeps = (() => {
  const at = dash.indexOf('const practiceImpact = useMemo(');
  if (at < 0) return null;
  const close = dash.indexOf('  );', at);
  const body = dash.slice(at, close);
  const m = body.match(/\n\s*\[([^\]]*)\],\s*$/);
  return m ? m[1] : null;
})();

describe('the practice-impact memo', () => {
  it('was located at all — a null here means this guard is asserting nothing', () => {
    expect(practiceImpactDeps).not.toBeNull();
    expect(practiceImpactDeps!.length).toBeGreaterThan(10);
  });

  it('depends on warmupEvents, which it reads', () => {
    expect(practiceImpactDeps).toMatch(/warmupEvents/);
  });

  it('still depends on the two it always did', () => {
    expect(practiceImpactDeps).toMatch(/practiceHistory/);
    expect(practiceImpactDeps).toMatch(/realRounds/);
  });

  it('and it really does read warmupEvents — otherwise the dependency is pointless', () => {
    const at = dash.indexOf('const practiceImpact = useMemo(');
    const body = dash.slice(at, dash.indexOf('  );', at));
    expect(body).toMatch(/warmups: warmupEvents\.map/);
  });
});

describe('why a stretch can change warmupEvents without touching practiceHistory', () => {
  it('warmupEvents unions practiceHistory AND workoutHistory', () => {
    const at = dash.indexOf('const warmupEvents = useMemo(');
    expect(at).toBeGreaterThan(-1);
    const body = dash.slice(at, at + 520);
    expect(body).toMatch(/practiceHistory/);
    expect(body).toMatch(/workoutHistory/);
    expect(body).toMatch(/preround_warmup/);
  });
});

/**
 * 2026-09-11 (full-app audit, finding 5) — filed here rather than in its own file because it is one
 * assertion, and an audit finding with no guard at all is how the same error comes back.
 *
 * app/smartvision carried a comment for four months saying the pre-round plan "persists in
 * roundStore.plans and flows into the active round when startRound fires". There is no `plans` field
 * on roundStore and there never was a save-plan action in that screen: the sentence described a
 * mechanism that did not exist, sitting next to code that works. What actually persists is the
 * tee/pin drag, through courseTeeOverrides / courseGreenOverrides, which smartFinderService reads.
 */
describe('SmartVision does not claim a mechanism that does not exist', () => {
  const sv = fs.readFileSync(path.join(__dirname, '../../app/smartvision.tsx'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../../store/roundStore.ts'), 'utf8');

  it('roundStore still has no `plans` field — if one is ever added, revisit this deliberately', () => {
    expect(store).not.toMatch(/^\s{2}plans[?]?:/m);
  });

  it('the correction is still there, stating plainly that no such field exists', () => {
    /**
     * NOT `not.toMatch(/roundStore\.plans/)` — the correcting comment necessarily QUOTES the false
     * claim in order to refute it, so asserting absence fails on the fix itself. Fourth time today
     * my own prose defeated my own guard.
     *
     * So pin the REFUTATION. If someone deletes it and re-asserts that the plan persists there, this
     * fails. [[my-own-comment-defeats-my-own-guard]]
     */
    expect(sv).toMatch(/There is no `plans` field on roundStore/);
    expect(sv).toMatch(/this used to claim/);
  });

  it('the real mechanism is named instead, so the next reader is pointed somewhere true', () => {
    expect(sv).toMatch(/setTeeOverride/);
    expect(sv).toMatch(/setGreenOverride/);
  });
});
