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
