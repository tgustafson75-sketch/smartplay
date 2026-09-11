/**
 * 2026-09-11 — THE WARM-UP WAS MEASURED, SHOWN, AND ABSENT FROM THE FIRST TEE.
 *
 * Tim: "Same way we are handling pre round stretch and warmup drills data."
 *
 * It had exactly the gap the post-round answers had. services/practice/warmupPerformance measures
 * whether warming up helps this player — a paired comparison in strokes, gated at three rounds each
 * side, association never causation. app/(tabs)/dashboard renders it. And
 * services/caddieRequestBody had ZERO references to it, so the caddie standing with him on the first
 * tee, having watched him walk straight off the car park, knew nothing about it.
 *
 * Measured, displayed, and missing from the one moment it could change anything.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('it reuses the owners rather than re-deriving them', () => {
  const brain = code('services/caddieDecision.ts');

  it('asks the existing engine whether this round was warmed', () => {
    expect(brain).toMatch(/wasRoundWarmed\(/);
  });

  it('and the existing engine what warming up has been worth', () => {
    expect(brain).toMatch(/computeWarmupPerformance\(/);
  });

  /**
   * Rebuilding either would be the two-owners bug that had the dashboard's OWN two warm-up cards
   * disagreeing this morning — different events, different windows, different anchors.
   */
  it('does not declare a second warm-up window or its own comparison', () => {
    expect(brain).not.toMatch(/WARMUP_WINDOW_MS\s*=/);
    expect(brain).not.toMatch(/withWarmup|withoutWarmup/);
  });

  it('builds the SAME union of events the dashboard builds — a warm-up is a warm-up', () => {
    expect(brain).toMatch(/'preround'/);
    expect(brain).toMatch(/'preround_warmup'/);
  });
});

describe('and it only speaks when it can change something', () => {
  const brain = code('services/caddieDecision.ts');

  it('says nothing to a man who DID warm up', () => {
    // Telling someone who warmed up that warming up is good is noise.
    expect(brain).toMatch(/!warmedToday && typeof worth === 'number'/);
  });

  it('says nothing until his own record clears the honesty bar', () => {
    // perf.enough is warmupPerformance's own three-rounds-each-side gate.
    expect(brain).toMatch(/perf\?\.enough \? \(perf\.deltaStrokes \?\? null\) : null/);
    expect(brain).toMatch(/worth >= 1/);
  });

  it('says nothing off the course', () => {
    expect(brain).toMatch(/if \(!r\.isRoundActive\) return null;/);
  });

  it('and frames it as expectation, not scolding', () => {
    expect(brain).toMatch(/expectation rather than a scolding/);
    expect(brain).toMatch(/not a lecture/);
    expect(brain).toMatch(/Say it ONCE/);
  });
});

describe('it reaches the caddie, which is the whole point', () => {
  it('the payload carries it', () => {
    expect(code('services/caddieRequestBody.ts')).toMatch(/warmup: d\.warmup\?\.line \?\? null/);
  });

  it('the brain renders it', () => {
    expect(code('api/kevin.ts')).toMatch(/if \(rc\.warmup\) lines\.push\(rc\.warmup\)/);
  });

  it('and the dashboard still shows what it always showed', () => {
    // The capture and the chart were never the problem. Only the reach was.
    expect(code('app/(tabs)/dashboard.tsx')).toMatch(/computeWarmupPerformance\(/);
  });
});
