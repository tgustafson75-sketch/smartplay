/**
 * 2026-08-12 (Tim, driving to a nine-hole league) — "I want you to plan something in the issue log
 * that essentially you can watch this entire round go into the issue log, the entire dialogue,
 * everything I'm trying to do, tick by tick. It's gonna make for a long issue log, but find a way
 * for us to gather some MEANINGFUL diagnostics."
 *
 * A round trace: a dedicated in-memory ring buffer that records what the app actually did, in order,
 * for one round — then mails it as a single document.
 *
 * Three design choices worth locking:
 *   - NOT in issueLogStore, which caps at 100 entries and holds real errors. A round makes hundreds
 *     of events, so tracing there would evict the very evidence the trace exists to gather.
 *   - NOT persisted. A trace describes the round happening now; persisting hundreds of rows per
 *     round would grow storage forever and survive into rounds it doesn't describe.
 *   - SUMMARY FIRST. A raw dump is a haystack, not diagnostics. The email leads with what resolved,
 *     what failed, and how the first voice turn went; the tick-by-tick sits underneath.
 */
import { useRoundTraceStore } from '../../store/roundTraceStore';
import { trace, startRoundTrace, formatRoundTrace } from '../../services/roundTrace';
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

beforeEach(() => useRoundTraceStore.getState().clear());

describe('tracing is inert until a round starts', () => {
  it('records nothing when no round is being traced', () => {
    trace('voice', 'turn_start');
    expect(useRoundTraceStore.getState().rows).toHaveLength(0);
  });

  it('records once started', () => {
    startRoundTrace('Wachusett');
    trace('round', 'start', { course: 'Wachusett' });
    expect(useRoundTraceStore.getState().rows).toHaveLength(1);
    expect(useRoundTraceStore.getState().rows[0].tag).toBe('start');
  });

  it('never throws, whatever it is handed', () => {
    startRoundTrace('x');
    expect(() => trace('voice', 'weird', { a: null, b: 0, c: false })).not.toThrow();
  });
});

describe('the buffer cannot grow without bound', () => {
  it('drops the OLDEST rows when full, keeping the end of the round', () => {
    startRoundTrace('long');
    for (let i = 0; i < 2100; i++) trace('gps', 'fix', { i });
    const rows = useRoundTraceStore.getState().rows;
    expect(rows.length).toBeLessThanOrEqual(2000);
    // The END must survive — that's where a round's problems surface.
    expect(rows[rows.length - 1].data!.i).toBe(2099);
  });
});

describe('the email leads with diagnostics, not a haystack', () => {
  it('summarises what a reader actually needs to know', () => {
    startRoundTrace('Wachusett');
    trace('course', 'geometry', { holes: 18, greens: 18, tees: 18, source: 'osm_holeways' });
    trace('round', 'hole', { hole: 1 });
    trace('voice', 'turn_start');
    trace('voice', 'turn_reply', { text: 'Driver, aim left centre.' });
    trace('watch', 'swing', { hole: 1, tempo: 3.1 });
    const out = formatRoundTrace();
    expect(out).toContain('SUMMARY');
    expect(out).toContain('18 holes, 18 greens, 18 tees (osm_holeways)');
    expect(out).toContain('voice turns       1/1 completed');
    expect(out).toContain('TIMELINE');
  });

  it('calls out the two silent failures that matter most', () => {
    startRoundTrace('bare');
    trace('round', 'hole', { hole: 1 });
    const out = formatRoundTrace();
    // Geometry never building, and the watch never reporting, both look like "nothing happened"
    // rather than an error — so the summary must name them explicitly.
    expect(out).toContain('NEVER BUILT');
    expect(out).toContain('watch never reported');
  });

  it('flags a first turn that started and never finished', () => {
    startRoundTrace('firstturn');
    trace('voice', 'turn_start');
    expect(formatRoundTrace()).toContain('STARTED BUT NEVER COMPLETED');
  });

  it('surfaces errors above the timeline', () => {
    startRoundTrace('err');
    trace('error', 'transcribe_fail', { reason: 'AbortError', elapsedMs: 11042 });
    const out = formatRoundTrace();
    expect(out.indexOf('ERRORS')).toBeLessThan(out.indexOf('TIMELINE'));
    expect(out).toContain('reason=AbortError');
  });
});

describe('it is wired into the round, with zero setup', () => {
  const store = read('store/roundStore.ts');

  it('starts itself when a round starts', () => {
    expect(store).toContain("rt.startRoundTrace(course || 'round')");
  });

  it('records holes, scores and the end', () => {
    expect(store).toContain("trace('round', 'hole', { hole })");
    expect(store).toContain("trace('shot', 'score', { hole, score })");
    expect(store).toContain("rt.trace('round', 'end'");
  });

  it('mails itself at the end, without blocking the round record', () => {
    expect(store).toContain('void rt.sendRoundTrace(');
    expect(store).toContain('tracing never blocks the round record');
  });

  it('captures the whole DIALOGUE at the one chokepoint every path uses', () => {
    // Instrumenting call sites individually is how half of them get missed.
    const cs = read('services/conversationState.ts');
    expect(cs).toContain("trace('voice', 'said'");
    expect(cs).toContain("trace('voice', 'turn_reply'");
  });

  it('captures the things that failed silently today', () => {
    expect(read('hooks/useVoiceCaddie.ts')).toContain("trace('voice', 'turn_start')");
    expect(read('hooks/useVoiceCaddie.ts')).toContain("trace('error', 'transcribe_fail'");
    expect(read('services/watchSwingBridge.ts')).toContain("trace('watch', 'swing'");
    expect(read('services/courseGeometryService.ts')).toContain("trace('course', 'bundled_check'");
  });
});
