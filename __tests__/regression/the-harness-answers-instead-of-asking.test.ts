/**
 * 2026-09-01 (Tim): "anything you'd otherwise ask me to verify should go in the harness, so the SIM
 * can run on the phone and the issue log carries the result."
 *
 * The on-device harness has always PRINTED its rows on screen, which means a result only existed
 * while someone was looking at it — so verifying anything still meant me writing "please open X and
 * check Y", and him reading rows back. That is the delegation his standing rule forbids, dressed as
 * a test suite.
 *
 * A failing scenario now writes itself into the issue log he already emails with one tap. And the
 * things a DESKTOP sim structurally cannot answer — is the native pose module linked in this build,
 * does the anchor maths hold on this device's clock — are now scenarios instead of questions.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('a harness failure survives the screen it printed on', () => {
  const assertSrc = read('services/harness/assert.ts');
  const runner = read('app/harness.tsx');

  it('there is a logger, and it writes to the issue log', () => {
    expect(assertSrc).toMatch(/export function logScenarioToIssueLog/);
    expect(assertSrc).toMatch(/addAppEvent\(/);
    expect(assertSrc).toMatch(/harness_fail:\$\{report\.id\}/);
  });

  it('only FAILURES are logged — a log full of green buries what matters', () => {
    expect(assertSrc).toMatch(/if \(report\.status !== 'fail'\) return;/);
  });

  it('it carries the failing check LABELS — the labels are the diagnosis', () => {
    expect(assertSrc).toMatch(/checks: failed\.slice\(0, 8\)/);
  });

  it('telemetry can never break a run', () => {
    expect(assertSrc).toMatch(/catch \{ \/\* telemetry must never break a harness run \*\/ \}/);
  });

  it('BOTH runner paths log — including the one where the scenario threw', () => {
    expect((runner.match(/logScenarioToIssueLog\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(runner).toMatch(/logScenarioToIssueLog\(fallback\)/);
  });
});

describe('the device answers what the desktop sim cannot', () => {
  const scen = read('services/harness/scenarios.ts');

  it('a scenario checks whether on-device pose is actually linked in THIS build', () => {
    // The desktop sim can prove the code is wired; only a handset can prove the native module is there.
    expect(scen).toMatch(/getMediaPipeStatus/);
    expect(scen).toMatch(/on-device pose is available in this build/);
  });

  it('and that the anchor maths holds on this device', () => {
    expect(scen).toMatch(/deriveSwingAnchors/);
    expect(scen).toMatch(/impact lands on the downswing/);
  });

  it('it is registered — a scenario nothing runs is a comment', () => {
    expect(scen).toMatch(/SCEN_21,/);
    expect(scen).toMatch(/id: 'C21'/);
    expect(scen).toMatch(/category: 'critical'/);
  });
});

describe('the harness can see time, not just correctness', () => {
  const assertSrc = read('services/harness/assert.ts');
  const scen = read('services/harness/scenarios.ts');

  it('every check carries WHEN it ran and, when measured, how long it took', () => {
    expect(assertSrc).toMatch(/ms\?: number;/);
    expect(assertSrc).toMatch(/atMs\?: number;/);
    expect(assertSrc).toMatch(/atMs: Date\.now\(\) - this\.startedAt/);
  });

  it('THE BOTTLENECK DETECTOR: a budget is part of the assertion', () => {
    // A step that still returns the right answer in nine seconds passes every correctness check in
    // the suite. Tim's complaint was never that the read was wrong.
    expect(assertSrc).toMatch(/async within<T>\(label: string, budgetMs: number/);
    expect(assertSrc).toMatch(/took <= budgetMs/);
    expect(assertSrc).toMatch(/\$\{took\}ms \(budget \$\{budgetMs\}ms\)/);
  });

  it('a step that THREW is reported as a failure with its elapsed time, not swallowed', () => {
    expect(assertSrc).toMatch(/threw after \$\{took\}ms/);
  });

  it('notes record context without a pass/fail opinion', () => {
    expect(assertSrc).toMatch(/note\(label: string, detail: string\)/);
  });
});

describe('one log tells the whole story', () => {
  const assertSrc = read('services/harness/assert.ts');
  const runner = read('app/harness.tsx');
  const scen = read('services/harness/scenarios.ts');

  it('a run summary is logged EVERY run — it is the context, not the alarm', () => {
    expect(assertSrc).toMatch(/export async function logRunSummaryToIssueLog/);
    expect(assertSrc).toMatch(/'harness_run'/);
    expect(runner).toMatch(/logRunSummaryToIssueLog\(collected\)/);
  });

  // 2026-09-02 — the device facts moved to services/harness/report.ts (collectRunEnv) so the mailed
  // summary and the shared export cannot drift. The guard follows the code: it asserts the facts are
  // still gathered AND that the summary still calls the one gatherer — an invariant that fails if
  // either half is dropped, rather than one that passes because it is pointed at an island.
  // [[three-ways-a-guard-is-worthless]]
  it('it names the device, the build and whether pose is linked', () => {
    const reportSrc = read('services/harness/report.ts');
    for (const k of ['env.os', 'env.runtime', 'env.updateId', 'env.poseAvailable', 'env.apiBase']) {
      expect(reportSrc).toContain(k);
    }
    expect(reportSrc).toMatch(/export async function collectRunEnv/);
    expect(assertSrc).toMatch(/collectRunEnv\(\)/);
  });

  /**
   * 2026-09-02 (Tim: "we didn't export the findings from the harness so that I can share it with
   * you"). The log only carries FAILURES; a green-but-slow run is a finding with no way off the
   * phone. The Export button is that way off, and it must stay wired to the real run.
   */
  it('the whole run can leave the device, not just the failures', () => {
    const reportSrc = read('services/harness/report.ts');
    expect(reportSrc).toMatch(/export function formatRunReport/);
    // a partial run must never read as a clean sweep
    expect(reportSrc).toMatch(/NOT RUN/);
    // and a slow PASS has to survive into the export
    expect(reportSrc).toMatch(/SLOWEST STEPS/);
    expect(runner).toMatch(/formatRunReport\(ran, env, notRun\)/);
    expect(runner).toMatch(/Share\.share\(/);
    expect(runner).toMatch(/onPress=\{exportRun\}/);
  });

  it('and where the time went, pass or fail', () => {
    expect(assertSrc).toMatch(/slowestSteps/);
    expect(assertSrc).toMatch(/slowestScenario/);
    // sorted by cost regardless of status — a slow PASS is the finding
    expect(assertSrc).toMatch(/\.sort\(\(a, b\) => \(b\.ms \?\? 0\) - \(a\.ms \?\? 0\)\)/);
  });

  it('the speed scenario budgets the real path and self-tests the log channel', () => {
    expect(scen).toMatch(/id: 'C22'/);
    expect(scen).toMatch(/health probe answers quickly/);
    expect(scen).toMatch(/on-device pose is linked/);
    expect(scen).toMatch(/anchor derivation is instant/);
    // if the log itself is broken, every other finding dies with it
    expect(scen).toMatch(/the issue log accepts entries/);
  });
});

describe('the device re-proves the honesty gates with real state', () => {
  const scen = read('services/harness/scenarios.ts');

  it('SCEN_23 exists and is critical', () => {
    expect(scen).toMatch(/id: 'C23'/);
    expect(scen).toMatch(/Honesty: a placeholder strike is never treated as a measurement/);
  });

  it('it refuses the 0.6*duration placeholder and accepts a heard strike', () => {
    expect(scen).toMatch(/a manual shot offset is refused as an anchor/);
    expect(scen).toMatch(/a heard strike anchors the window/);
  });

  it('it covers the SECOND consumer of the overloaded flag — the one with no visible symptom', () => {
    // Frame extraction treats a non-synthesized strike as ACOUSTIC. Getting this wrong shows nothing
    // on screen, which is exactly why it needs a check rather than an eye.
    expect(scen).toMatch(/a synthesized strike is not an acoustic anchor/);
    expect(scen).toMatch(/a real strike IS an acoustic anchor/);
  });

  it('and the drill surface a player reads as "it worked"', () => {
    expect(scen).toMatch(/a fat rep is never graded got_it/);
  });

  it('the different-clock case is covered — it is what makes a bad window self-detecting', () => {
    expect(scen).toMatch(/a pose impact on a different clock is refused/);
  });
});
