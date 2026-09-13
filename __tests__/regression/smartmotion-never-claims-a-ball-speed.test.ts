import * as fs from 'fs';
import * as path from 'path';

const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');

/**
 * 2026-09-12 (Tim) — "Make sure that adding the point of what cage mode does not reintroduce factors
 * to SmartMotion that cause issues."
 *
 * It had not — the cage/bullseye work was docs plus properly gated additions — but the SPEC had drifted
 * into contradicting itself, and a spec is how a defect gets reintroduced a week later by someone
 * reading it as instruction. Two commits fourteen minutes apart said opposite things: `c5bd40ce`
 * ("ball speed stays radar-or-nothing and is never shown at any confidence") and `e18b7520` ("BALL
 * SPEED is measurable across a known distance and now sits in the gated-by-factor column").
 *
 * Both were right about different situations. The measurement is a known DISTANCE over a counted TIME:
 * real in a rig whose target is a measured 15 feet away, impossible on a range where the ball leaves
 * frame and no distance is known. This gate holds the line the doc now states.
 * [[smartmotion-metrics-honesty]] [[honesty-ethos-came-from-the-backyard-net]]
 */
describe('SmartMotion never claims a measured ball speed', () => {
  const metrics = read('services/swingMetricsService.ts');

  /**
   * 2026-09-12 — I FIRST ASSERTED HERE THAT NO CALLER PASSED IT, because the comment in
   * swingMetricsService said so ("No SmartMotion caller passes this today; 1B will wire it"). The
   * comment was stale: smartmotion.tsx passes it from the acoustic detector. This gate now asserts
   * what actually keeps it honest, which is not absence but three guards.
   * [[a-stale-header-is-a-source-someone-trusts]]
   */
  it('the acoustic read is wired, and the comment no longer claims otherwise', () => {
    expect(read('app/swinglab/smartmotion.tsx')).toMatch(/measuredBallSpeedMph/);
    expect(metrics).not.toMatch(/No SmartMotion caller passes\s*\n?\s*\/\/ this today/);
  });

  /** GUARD 1 — the server refuses rather than faking a calibration it does not have. */
  it('returns no speed at all when the club is unknown', () => {
    const api = read('api/acoustic-detect.ts');
    expect(api).toMatch(/ball_speed_mph: number \| null/);
    expect(api).toMatch(/won't fake a 7I calibration/);
  });

  /** GUARD 2 — acoustic is not truth-grade, so smash can never reach its high-confidence branch. */
  it('never treats an acoustic ball speed as truth-grade', () => {
    const truth = metrics.slice(metrics.indexOf('TRUTH_GRADE_SOURCES'), metrics.indexOf('TRUTH_GRADE_SOURCES') + 300);
    expect(truth).not.toMatch(/'acoustic'/);
    expect(metrics).toMatch(/Acoustic is no longer truth-grade/);
  });

  /** GUARD 3 — and its confidence is ceilinged, so it reads as an estimate. */
  it('ceilings the acoustic confidence below truth', () => {
    expect(metrics).toMatch(/confidence: 0\.65/);
    expect(metrics).toMatch(/acoustic \(single-mic impact, club-typical\)/);
  });

  /**
   * Ball speed may only ever be derived from club speed × an ASSUMED smash ratio, and the confidence
   * caps are what keep it reading as an estimate rather than a reading.
   */
  it('derives ball speed only from an assumed ratio, confidence-capped', () => {
    expect(metrics).toMatch(/club speed × typical smash/);
    expect(metrics).toMatch(/knownRatio != null \? 0\.45 : 0\.30/);
  });

  /** Smash factor is ball ÷ club, so against an assumed ratio it is the constant handed back. */
  it('keeps smash factor suppressed when a parent is low or assumed', () => {
    expect(metrics).toMatch(/eitherLow/);
    expect(metrics).toMatch(/club speed × typical smash/);
  });

  /** Carry must never be derived from ball speed — 15 feet says nothing about 250 yards. */
  it('never derives carry from ball speed', () => {
    const block = metrics.slice(metrics.indexOf('let ballSpeed'), metrics.indexOf('let ballSpeed') + 4000);
    expect(block).not.toMatch(/carry\s*=\s*.*ballSpeed/);
  });

  /**
   * THE SPEC MUST CARRY THE CONDITION, not just the conclusion. Without it, "ball speed comes off the
   * never-list" is an instruction to wire a number that has no distance behind it.
   */
  it('the spec states the known-distance condition, not a bare permission', () => {
    const doc = read('docs/FUTURE-2.0-FITTING-SESSION.md');
    expect(doc).toMatch(/READ THE CONDITION BEFORE WIRING ANYTHING/);
    expect(doc).toMatch(/IN A RIG WITH A KNOWN TARGET DISTANCE, AND NOWHERE ELSE/);
    // The doc must describe the WIRED reality and the guards, not claim it is unwired.
    expect(doc).toMatch(/DOES pass `measuredBallSpeedMph`/);
    expect(doc).toMatch(/is NOT in `TRUTH_GRADE_SOURCES`/);
    // The never-list must still name the three that are genuinely radar-or-nothing.
    expect(doc).toMatch(/\| Spin, launch angle, spin axis \| measured \| \*\*never\. Radar or nothing\.\*\* \|/);
  });

  /**
   * And the cage's "the camera can see it, so never ask" rule must not leak onto the range, where the
   * player IS the only sensor — nor the range's "ask him" rule into the cage, where a tap would
   * override something measurable. sim IS the indoor/cage mode since the 09-01 unification.
   */
  it('the report-your-shot tap is offered off the rig and withheld on it', () => {
    const sm = read('app/swinglab/smartmotion.tsx');
    expect(sm).toMatch(/onReportShot=\{effectiveMode === 'sim' \? undefined : reportShotDistance\}/);
  });
});
