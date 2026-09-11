/**
 * 2026-09-10 — the field report has to find the round that started all this.
 *
 * Tim played Hemet with a course whose greens were never populated, a yardage that flapped between
 * tiers, hole advance that never fired, and Auto Shot Detection silently discarding every detection
 * in cart mode. The app traced none of those DECISIONS, so the round was un-diagnosable after the
 * fact and the defects survived into a live OTA.
 *
 * These cases feed the analyser a trace shaped like that round and require it to name each defect.
 * A guard that only asserts "the analyser returns an array" would have passed on the old code, so
 * every assertion here is on a specific finding code with specific evidence.
 * [[break-test-every-guard-you-write]]
 */
import { analyseRoundTrace, formatFieldReport, type Finding } from '../../services/roundFieldReport';
import type { TraceRow } from '../../store/roundTraceStore';

const row = (event: TraceRow['event'], tag: string, data?: TraceRow['data']): TraceRow =>
  ({ t: 0, event, tag, data });

const codes = (f: Finding[]) => f.map(x => x.code);

describe('field report — the Hemet round', () => {
  test('a hole whose green never resolved is reported, and names the hole', () => {
    const rows: TraceRow[] = [
      ...Array.from({ length: 40 }, () => row('gps', 'green_tier', { hole: 7, source: 'none', hasMiddle: false })),
      ...Array.from({ length: 10 }, () => row('gps', 'green_tier', { hole: 8, source: 'courseHoles', hasMiddle: true })),
    ];
    const found = analyseRoundTrace(rows);
    expect(codes(found)).toContain('green.never_resolved');
    const f = found.find(x => x.code === 'green.never_resolved')!;
    expect(f.severity).toBe('ISSUE');
    // It must name hole 7 and must NOT accuse hole 8, which resolved fine.
    expect(f.evidence).toContain('7');
    expect(f.title).toContain('1 hole');
  });

  test('a green that always resolves produces no green finding', () => {
    const rows = Array.from({ length: 40 }, () =>
      row('gps', 'green_tier', { hole: 3, source: 'truth', hasMiddle: true }));
    expect(codes(analyseRoundTrace(rows))).not.toContain('green.never_resolved');
  });

  test('the yardage flap is caught as tier changes inside holes', () => {
    // Alternating live/static on one hole — exactly the 10-second flap.
    const rows: TraceRow[] = [];
    for (let i = 0; i < 12; i++) {
      rows.push(row('gps', 'yardage_tier', {
        hole: 4,
        value: 150,
        source: i % 2 === 0 ? 'gps_live' : 'static_card',
        confidence: 'med',
        fallback: i % 2 === 1,
      }));
    }
    expect(codes(analyseRoundTrace(rows))).toContain('yardage.tier_flapping');
  });

  test('a stable yardage tier is not reported as flapping', () => {
    const rows = Array.from({ length: 12 }, () =>
      row('gps', 'yardage_tier', { hole: 4, value: 150, source: 'gps_live', confidence: 'high', fallback: false }));
    expect(codes(analyseRoundTrace(rows))).not.toContain('yardage.tier_flapping');
  });

  test('hole advance that never fired is reported with its dominant hold reason', () => {
    const rows = Array.from({ length: 60 }, () => row('gps', 'hole_detect', {
      from: 7, to: 7, advance: false, confidence: 'low', reason: 'no current-hole green geometry',
    }));
    const f = analyseRoundTrace(rows).find(x => x.code === 'hole.never_advanced');
    expect(f).toBeDefined();
    expect(f!.evidence).toContain('no current-hole green geometry');
    // The action must point at the real root cause, not at a generic "check the gates".
    expect(f!.action).toContain('green');
  });

  test('detected shots that are all dropped are reported, naming the gate', () => {
    const rows: TraceRow[] = [];
    for (let i = 0; i < 8; i++) {
      rows.push(row('shot', 'auto_detected', { yards: 210, state: 'idle' }));
      rows.push(row('shot', 'auto_dropped', { why: 'cart_mode' }));
    }
    const f = analyseRoundTrace(rows).find(x => x.code === 'shot.mostly_dropped');
    expect(f).toBeDefined();
    expect(f!.evidence).toContain('cart_mode');
  });

  test('silently logged cart shots are an OPPORTUNITY, not an error', () => {
    const rows: TraceRow[] = [];
    for (let i = 0; i < 5; i++) {
      rows.push(row('shot', 'auto_detected', { yards: 200, state: 'idle' }));
      rows.push(row('shot', 'auto_logged_silent', { hole: i + 1, why: 'cart_mode' }));
    }
    const f = analyseRoundTrace(rows).find(x => x.code === 'shot.silent_logged');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('OPPORTUNITY');
  });

  test('findings are ordered ERROR, then ISSUE, then OPPORTUNITY', () => {
    const rows: TraceRow[] = [
      row('error', 'crash', { where: 'x' }),
      ...Array.from({ length: 40 }, () => row('gps', 'green_tier', { hole: 2, source: 'none', hasMiddle: false })),
      ...Array.from({ length: 5 }, () => row('gps', 'green_tier', { hole: 3, source: 'derived', hasMiddle: true })),
    ];
    const sevs = analyseRoundTrace(rows).map(f => f.severity);
    const rank = { ERROR: 0, ISSUE: 1, OPPORTUNITY: 2 } as const;
    for (let i = 1; i < sevs.length; i++) {
      expect(rank[sevs[i]]).toBeGreaterThanOrEqual(rank[sevs[i - 1]]);
    }
  });

  test('an empty trace produces no findings rather than inventing one', () => {
    expect(analyseRoundTrace([])).toEqual([]);
  });

  test('every finding cites evidence — a claim with no number is a guess', () => {
    const rows: TraceRow[] = [
      ...Array.from({ length: 40 }, () => row('gps', 'green_tier', { hole: 7, source: 'none', hasMiddle: false })),
      ...Array.from({ length: 60 }, () => row('gps', 'hole_detect', { from: 7, to: 7, advance: false, confidence: 'low', reason: 'no current-hole green geometry' })),
      row('error', 'boom', {}),
    ];
    const found = analyseRoundTrace(rows);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      expect(typeof f.evidence).toBe('string');
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(/\d/.test(f.evidence)).toBe(true);
    }
  });

  test('the formatted report leads with the findings, not the timeline', () => {
    const rows = Array.from({ length: 40 }, () =>
      row('gps', 'green_tier', { hole: 7, source: 'none', hasMiddle: false }));
    const text = formatFieldReport(rows);
    expect(text).toContain('FIELD REPORT');
    expect(text).toContain('[ISSUE]');
    expect(text.indexOf('[ISSUE]')).toBeLessThan(text.length);
  });
});
