/**
 * 2026-10-15 (review) — A QUIET VOICE IS NOT SILENCE.
 *
 * The tap mic's no-speech stand-down discarded the recording (no transcribe, no log) whenever metering
 * never crossed a fixed -30 dBFS. On the device the 08-19 note documents — Android, outdoors, arm's
 * length — the meter sits under -30 while the player talks, so the turn vanished. The meter now keeps
 * its veto only on EVIDENCE of silence: readings that never rose off the ambient floor.
 *
 * BEHAVIOURAL: the real tracker over metering traces (100ms samples, 7s like the stand-down).
 */
import { createMeterTracker } from '../../services/micStanddown';

function run(trace: number[]) {
  const t = createMeterTracker();
  for (const m of trace) t.update(m);
  return t;
}
const repeat = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

describe('the stand-down transcribes a voice the -30 threshold missed', () => {
  it('speech peaking at -36 over a -55 ambient (never crosses -30) is NOT silence', () => {
    // 1s quiet, then words: bursts to -36..-38 with drops between them.
    const trace = [...repeat(10, () => -55), ...repeat(60, (i) => (i % 4 === 0 ? -54 : -36 - (i % 3)))];
    expect(Math.max(...trace)).toBeLessThan(-30);
    expect(run(trace).isRealSilence()).toBe(false);
  });

  it('no metering at all proves nothing — transcribe', () => {
    expect(run([]).isRealSilence()).toBe(false);
    expect(run(repeat(70, () => -160)).isRealSilence()).toBe(false);
  });
});

describe('real silence still stands down without a transcribe', () => {
  it('a still room hovering around -52 ± 3 dB', () => {
    expect(run(repeat(70, (i) => -52 + (i % 7) - 3)).isRealSilence()).toBe(true);
  });

  it('steady wind/ambient at -38 with small fluctuation (loud, but nobody speaking)', () => {
    expect(run(repeat(70, (i) => -38 + (i % 5) - 2)).isRealSilence()).toBe(true);
  });

  it('a cold-mic -160 warm-up before a quiet room does not read as a voice', () => {
    expect(run([-160, -160, ...repeat(68, () => -50)]).isRealSilence()).toBe(true);
  });
});
