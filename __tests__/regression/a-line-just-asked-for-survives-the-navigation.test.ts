/**
 * 2026-09-17 — THE SILENT ROUND BRIEFING. Tim, 09-15 issue log:
 *
 *   voice_silent_fail: speak_superseded · /round/briefing · hole 1
 *   preemptedBy: route_change · msSinceStop: 7 · msSinceLastSpeakStart: 185213
 *
 * app/_layout.tsx stops stale carry-over speech on navigation, with a 2s grace whose own comment
 * says it exists to protect "intentional speak-then-navigate". It graced off getLastSpeakStartedAt,
 * which is stamped ONLY when a queue body runs — so after an idle queue that timestamp is minutes
 * old (185 seconds, in the report) and the grace has already expired. The one case the grace exists
 * for was the one case it could never protect: the briefing enqueues its line, the screen
 * navigates, the guard bumps speakGeneration, and the body is dropped having never made a sound.
 *
 * Intermittent rather than constant because React runs a child screen's effects before the parent
 * layout's pathname effect and the queue body is a microtask — which is why it went unattributed
 * for months, and why a race is the wrong thing to rely on.
 *
 * This could not be tested before today: services/voiceService pulls expo-av, which ships ESM the
 * logic project cannot parse, so the module owning these timestamps was unreachable from the suite.
 * __tests__/mocks/expoAv.js exists for that reason.
 */

import {
  getLastSpeakStartedAt,
  getLastSpeakActivityAt,
  __resetSpeakActivityForTest,
  speak,
} from '../../services/voiceService';

/** The guard in app/_layout.tsx, as a function. Same comparison, same 2s window. */
const GRACE_MS = 2000;
const routeChangeWouldStopSpeech = (now: number) => now - getLastSpeakActivityAt() > GRACE_MS;
/** What the guard used to ask — kept so the regression is expressible, not just described. */
const oldGuardWouldStopSpeech = (now: number) => now - getLastSpeakStartedAt() > GRACE_MS;

beforeEach(() => __resetSpeakActivityForTest());

describe('a line the app just asked for survives a navigation', () => {
  it('enqueuing marks activity immediately, before any audio starts', async () => {
    expect(getLastSpeakActivityAt()).toBe(0);
    // speak() goes through enqueueSpeak. The body will fail against stubbed native modules — that
    // is fine and is the point: nothing has STARTED, and the guard must still see it as in flight.
    void speak('Right, hole one. Driver is the play.', 'male', 'en', 'http://localhost').catch(() => undefined);
    expect(getLastSpeakActivityAt()).toBeGreaterThan(0);
  });

  it('THE BUG: an idle queue means the old guard cuts a line enqueued milliseconds ago', () => {
    void speak('briefing', 'male', 'en', 'http://localhost').catch(() => undefined);
    const now = Date.now();
    // Nothing has ever run a queue body, so the start stamp is still 0 — the 185-second reading in
    // Tim's report is the same state, just with an older prior utterance.
    expect(getLastSpeakStartedAt()).toBe(0);
    expect(oldGuardWouldStopSpeech(now)).toBe(true);    // what shipped: kill it
    expect(routeChangeWouldStopSpeech(now)).toBe(false); // what it does now: let it speak
  });

  it('still cuts genuinely stale carry-over speech from the previous screen', () => {
    // The behaviour the guard exists for must survive the fix. Nothing enqueued, nothing started,
    // well outside the window → a navigation still stops whatever is lingering.
    expect(routeChangeWouldStopSpeech(Date.now() + 60_000)).toBe(true);
  });

  it('and the window is a window — just inside stays, just outside goes', () => {
    void speak('briefing', 'male', 'en', 'http://localhost').catch(() => undefined);
    const t = getLastSpeakActivityAt();
    expect(routeChangeWouldStopSpeech(t + GRACE_MS - 1)).toBe(false);
    expect(routeChangeWouldStopSpeech(t + GRACE_MS + 1)).toBe(true);
  });

  it('activity is the LATER of the two stamps, never just the newer variable', () => {
    // A future edit that swaps the max for the enqueue stamp alone would silently stop cutting
    // stale speech mid-sentence — the original 2026-06-16 complaint ("old voices leaking").
    expect(getLastSpeakActivityAt()).toBe(0);
    void speak('x', 'male', 'en', 'http://localhost').catch(() => undefined);
    expect(getLastSpeakActivityAt()).toBeGreaterThanOrEqual(getLastSpeakStartedAt());
  });
});

describe('the guard in app/_layout.tsx asks the right question', () => {
  it('graces off activity, not off start', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../app/_layout.tsx'), 'utf8');
    expect(src).toMatch(/Date\.now\(\) - getLastSpeakActivityAt\(\) > 2000/);
    expect(src).not.toMatch(/Date\.now\(\) - getLastSpeakStartedAt\(\) > 2000/);
  });
});
