/**
 * 2026-10-16 — Lily's 4075 clip showed ONE fault at four times: "FAULT MOMENT 0:06" (the raw stored read
 * time, absolute clip seconds), "THIS SWING · Early Extension 0:04" (the swing WINDOW START, printed where
 * a moment reads), "Analyze the swing at 0:07" and "Position: 7.0s" (absolute playhead) — under a
 * transport clock reading "0:02 / 0:03", which counts from the window start.
 *
 * Now: one fault time (faultMoment — the instant the replay stops on) and one clock (the transport's,
 * services/swing/swingClock).
 */
import fs from 'fs';
import path from 'path';
import { swingClock, swingClockSec } from '../../services/swing/swingClock';

describe('the swing clock', () => {
  it('counts from the located swing window, like the transport deck', () => {
    // Window opens at 4.24s; Lily's impact at 6.04s reads 0:01 on the deck, not 0:06.
    expect(swingClock(6.04, 4.24)).toBe('0:01');
    expect(swingClockSec(7.0, 4.24)).toBeCloseTo(2.76, 2);
  });
  it('no window: the clip clock; never negative', () => {
    expect(swingClock(6.04, 0)).toBe('0:06');
    expect(swingClockSec(3, 4.24)).toBe(0);
  });
});

describe('every time label on the swing screen uses the one fault time and the one clock', () => {
  const sd = fs.readFileSync(path.join(__dirname, '../../app/swinglab/swing/[swing_id].tsx'), 'utf8');
  it('FAULT MOMENT shows the stop the replay makes, on the swing clock', () => {
    expect(sd).toMatch(/\(faultMoment \? \[faultMoment\.sec\] : issueTimestamps\)\.map/);
    expect(sd).toMatch(/\{swingClock\(ts, winStartSec\)\}/);
    // the old absolute print of the raw stored read time is gone
    expect(sd).not.toMatch(/\{Math\.floor\(ts \/ 60\)\}:\{Math\.floor\(ts % 60\)/);
  });
  it('THIS SWING shows the fault moment, not the window start, for a single swing', () => {
    expect(sd).toMatch(/session\.shots\.length === 1\s*\?\s*\(faultMoment \? swingClock\(faultMoment\.sec, winStartSec\) : null\)/);
  });
  it('Analyze-at and Position read the swing clock', () => {
    expect(sd).not.toMatch(/pad_start: Math\.floor\(position\)/);
    expect((sd.match(/pad_start: Math\.floor\(swingClockSec\(position, winStartSec\)\)/g) ?? []).length).toBe(2);
    expect(sd).toMatch(/position: swingClockSec\(position, winStartSec\)\.toFixed\(1\)/);
  });
});
