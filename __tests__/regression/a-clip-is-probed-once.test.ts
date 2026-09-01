/**
 * 2026-08-31 (Tim: "make it as rapid as reasonable — hard to show a wow factor when you have to wait
 * probably more than a minute").
 *
 * A CLIP'S DURATION CANNOT CHANGE, AND IT WAS BEING PROBED THREE TIMES IN ONE ANALYSIS: once by the
 * locate pass, once inside extractKeyFrames when the caller had no duration to hand, and a third
 * time by the pose warm added earlier the same day. Each probe carries an 8-SECOND ceiling and every
 * one runs through `serializeMediaRead` — the global media chain — so they do not merely repeat,
 * they QUEUE, behind each other and behind every frame decode in flight.
 *
 * This pins the two properties that make the fix real: the result is remembered, and CONCURRENT
 * callers share one probe rather than racing. The second matters more than it looks — the warm and
 * the extract start at almost the same moment, which is exactly the pair a naive result-only cache
 * would miss.
 */
import * as fs from 'fs';
import * as path from 'path';
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'services/poseDetection.ts'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('a clip is probed once, not once per caller', () => {
  it('remembers the result', () => {
    expect(code).toMatch(/durationCache\.get\(clipUri\)/);
    expect(code).toMatch(/durationCache\.set\(clipUri, ms\)/);
  });

  it('shares the IN-FLIGHT probe — the case a result-only cache misses', () => {
    expect(code).toMatch(/durationInflight\.get\(clipUri\)/);
    expect(code).toMatch(/if \(pending\) return pending;/);
    expect(code).toMatch(/durationInflight\.set\(clipUri, run\)/);
    // ...and it must be released whatever happens, or one failure wedges the clip forever.
    expect(code).toMatch(/\.finally\(\(\) => \{ durationInflight\.delete\(clipUri\); \}\)/);
  });

  it('never remembers a FAILED probe — 0 means "could not read", not "zero long"', () => {
    expect(code).toMatch(/if \(ms > 0\) \{/);
  });

  it('is bounded, so a long library session cannot grow it forever', () => {
    expect(code).toMatch(/DURATION_CACHE_MAX/);
    expect(code).toMatch(/durationCache\.size >= DURATION_CACHE_MAX/);
  });

  it('the FAST path no longer re-probes: a caller with boundaries still gets a duration', () => {
    // probedDurMs is 0 whenever boundaries were supplied, so this used to pass undefined and
    // extractKeyFrames probed all over again — on the path that was supposed to be the quick one.
    expect(code).toMatch(/const durForExtract = probedDurMs \|\| \(await probeDurationMs\(clipUri\)/);
    expect(code).not.toMatch(/extractKeyFrames\(clipUri, effectiveBoundaries, quickTier, probedDurMs \|\| undefined\)/);
  });
});

describe('the analysis says where its time went', () => {
  it('emits one breadcrumb per successful analysis, as diag', () => {
    expect(code).toMatch(/logAnalysisTiming\(\{/);
    expect(code).toMatch(/'swing_analysis_timing'/);
    expect(code).toMatch(/'diag'/);
  });

  it('names every stage, and which branch ran — a total alone identifies nothing', () => {
    for (const field of ['probe_ms', 'locate_ms', 'extract_ms', 'request_ms', 'total_ms', 'bounded', 'frames', 'tier']) {
      expect([field, code.includes(field)]).toEqual([field, true]);
    }
  });

  it('telemetry can never break an analysis', () => {
    expect(code).toMatch(/catch \{ \/\* telemetry is never allowed to break an analysis \*\/ \}|logAnalysisTiming[\s\S]{0,400}?catch/);
  });
});
