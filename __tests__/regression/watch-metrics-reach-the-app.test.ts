/**
 * 2026-08-12 (Tim) — "why the hell doesn't the watch work correctly? I've been saying this forever,
 * and I've noticed I don't get any metrics out of it… now that I have yardage on it, I actually
 * wear it while I swing."
 *
 * The watch works. Nothing was reading it.
 *
 * The IMU bridge boots at launch and writes every detected swing into watchStore.sessionSwings. The
 * data has been landing all along. Two files each believed the OTHER had done the wiring:
 *
 *   watchSwingBridge header:  "From there swingMetricsService.ts already promotes club speed /
 *                              tempo / smash to the truth-grade 'watch' source tier — no further
 *                              wiring needed in the analysis layer."
 *   swingMetricsService:      "'watch' — Galaxy Watch IMU peak wrist speed … SmartMotion plumbing
 *                              is the missing piece per the metric-provenance audit."
 *
 * One says done, one says missing, and the one claiming "already" was wrong. Nobody built the join,
 * so a real sensor on Tim's wrist fed a store nothing consumed.
 *
 * TEMPO is wired now, because it is the honest thing to take from a wrist: backswing and downswing
 * are TIMES, measured directly, needing no conversion. A 3:1 tempo is 3:1 whether a camera or an
 * IMU measured it. It fills in only when the camera couldn't produce one — the camera read carries
 * the kinematic sequence too, so the wrist is a fallback, not an override.
 *
 * CLUB SPEED gets an estimator (Tim: "there is such a thing as things we can extrapolate… this is a
 * mid-to-high handicap, not a Trackman") — but deliberately NOT routed through
 * synthesizeSwingMetrics.measuredClubSpeedMph, whose own comment defines that input as "truth-grade
 * — no `~` prefix, no range, can reach 'high'". Pushing an estimate through a measured input is
 * precisely how a guess hardens into a claim.
 */
import { estimateClubSpeedMph, calibrateFromMeasured } from '../../services/watchWristInterpretation';
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

describe('the watch estimator is useful without pretending to be a launch monitor', () => {
  it('produces a believable driver number for a mid-handicapper', () => {
    const e = estimateClubSpeedMph(22, 'driver', 'lead');
    expect(e).not.toBeNull();
    expect(e!.mph).toBeGreaterThan(70);
    expect(e!.mph).toBeLessThan(110);
  });

  it('always labels itself an estimate — never a measurement', () => {
    expect(estimateClubSpeedMph(22, 'driver')!.kind).toBe('estimate');
  });

  it('a wedge separates less from the wrist than a driver does', () => {
    // Shorter club, clubhead closer to the hands, smaller multiple. Same wrist speed, lower number.
    expect(estimateClubSpeedMph(22, 'sw')!.mph).toBeLessThan(estimateClubSpeedMph(22, 'driver')!.mph);
  });

  it('trail wrist is flagged rougher than lead', () => {
    expect(estimateClubSpeedMph(22, 'driver', 'trail')!.confidence).toBe('rough');
    expect(estimateClubSpeedMph(22, 'driver', 'lead')!.confidence).toBe('estimate');
  });

  it('says nothing rather than something silly', () => {
    expect(estimateClubSpeedMph(0, 'driver')).toBeNull();     // no swing
    expect(estimateClubSpeedMph(1, 'driver')).toBeNull();     // a waggle
    expect(estimateClubSpeedMph(200, 'driver')).toBeNull();   // not a golf swing
  });

  it('learns from a real measurement and says so', () => {
    const before = estimateClubSpeedMph(20, 'driver')!;
    expect(before.calibrated).toBe(false);
    calibrateFromMeasured(100, 20); // a genuine 100mph paired with a 20mph wrist → ratio 5
    const after = estimateClubSpeedMph(20, 'driver')!;
    expect(after.calibrated).toBe(true);
    expect(after.mph).toBeGreaterThan(before.mph);
  });

  it('refuses to learn from an implausible pair', () => {
    // Same discipline as the club-distance plausibility band: one bad sample must not poison it.
    const baseline = estimateClubSpeedMph(20, 'driver')!.mph;
    calibrateFromMeasured(300, 2);   // ratio 150 — nonsense
    calibrateFromMeasured(10, 20);   // ratio 0.5 — nonsense
    expect(estimateClubSpeedMph(20, 'driver')!.mph).toBe(baseline);
  });
});

describe('the watch finally reaches the swing read', () => {
  const sm = read('app/swinglab/smartmotion.tsx');

  it('SmartMotion reads the watch swing store — the join nobody built', () => {
    expect(sm).toContain("require('../../store/watchStore')");
    expect(sm).toContain('sessionSwings');
  });

  it('tempo only fills in when the camera could not produce one', () => {
    expect(sm).toContain('if (t.ratio == null) {');
  });

  /**
   * 2026-08-17 — this test used to assert the exact broken expression:
   *
   *   expect(sm).toContain('Date.now() - ((last as { at?: number }).at as number) < 90_000');
   *
   * which pinned a guard that never ran. `last` is a SwingMetrics and watchStore stamps
   * `timestamp`; there is no `at` field anywhere, so the typeof test in front of that comparison
   * was always false and the ternary always took its permissive `: true` branch. The window never
   * applied — the newest watch swing in the session attached to a strike no matter how old.
   *
   * The test was green the whole time, because it checked that the SOURCE TEXT was present rather
   * than that the behavior held. A test that pins an expression can only ever confirm the
   * expression is still there. Assert the property instead: it reads the real, required field
   * (so a rename is a compile error), and no permissive fallback remains.
   * [[grep-guards-cant-see-dead-code]]
   */
  it('ignores a stale swing from an earlier session', () => {
    const code = sm.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).toContain('Date.now() - last.timestamp < WATCH_TEMPO_MAX_AGE_MS');
    // The field it compares against must actually exist on the stored swing.
    expect(read('store/watchStore.ts')).toMatch(/^\s*timestamp: number;/m);
    // No phantom-field cast, and no `: true` escape hatch, left in the freshness expression.
    expect(code).not.toMatch(/\(\s*last\s+as\s+\{\s*at\?/);
    expect(code).not.toMatch(/const fresh = [\s\S]{0,200}?:\s*true;/);
  });

  it('does NOT push the estimate through the truth-grade measured input', () => {
    // synthesizeSwingMetrics defines measuredClubSpeedMph as truth-grade, no `~`, can reach 'high'.
    expect(sm).not.toContain('measuredClubSpeedMph: last.peakWristSpeed');
    expect(read('services/swingMetricsService.ts')).toContain("source is 'watch'");
  });
});
