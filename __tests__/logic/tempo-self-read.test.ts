/**
 * 2026-08-25 — the Tempo Trainer must train against the player's OWN swing, and must say "I don't
 * know yet" rather than invent a number. These pin both halves.
 */
import { readOwnTempo, MIN_SAMPLES } from '../../services/practice/tempoSelfRead';

const FULL = [
  { key: 'learn', label: 'Learning', back: 1000, down: 333 },
  { key: 'smooth', label: 'Smooth', back: 900, down: 300 },
  { key: 'standard', label: 'Standard', back: 800, down: 267 },
  { key: 'quick', label: 'Quick', back: 700, down: 233 },
] as const;

describe('the trainer reads the player rather than guessing', () => {
  it('says it does not know yet instead of showing a number', () => {
    const r = readOwnTempo({ tempoAvg: 3.1, tempoSamples: MIN_SAMPLES - 1, backswingAvgMs: 850 }, FULL, 3);
    expect(r.known).toBe(false);
    expect(r.ratio).toBeNull();
    expect(r.line).toMatch(/Record 1 more swing\b/);
    expect(r.line).not.toMatch(/3\.1/);          // the number must not leak out early
  });

  it('handles a profile that has never recorded a swing', () => {
    const r = readOwnTempo(null, FULL, 3);
    expect(r.known).toBe(false);
    expect(r.line).toMatch(/Record a few swings/);
  });

  it('picks the preset from BACKSWING SPEED, not from the ratio', () => {
    // Every full preset is 3:1, so only the backswing duration can choose between them.
    expect(readOwnTempo({ tempoAvg: 3.0, tempoSamples: 40, backswingAvgMs: 980 }, FULL, 3).suggestedPresetKey).toBe('learn');
    expect(readOwnTempo({ tempoAvg: 3.0, tempoSamples: 40, backswingAvgMs: 710 }, FULL, 3).suggestedPresetKey).toBe('quick');
    expect(readOwnTempo({ tempoAvg: 3.0, tempoSamples: 40, backswingAvgMs: 805 }, FULL, 3).suggestedPresetKey).toBe('standard');
  });

  it('leaves the preset alone when backswing duration was never measured', () => {
    const r = readOwnTempo({ tempoAvg: 3.0, tempoSamples: 40, backswingAvgMs: null }, FULL, 3);
    expect(r.known).toBe(true);
    expect(r.suggestedPresetKey).toBeNull();
  });

  it('calls a quick transition quick — and still targets 3:1, never 2:1', () => {
    const r = readOwnTempo({ tempoAvg: 2.2, tempoSamples: 30, backswingAvgMs: 800 }, FULL, 3);
    expect(r.line).toMatch(/quicker into the strike/);
    expect(r.line).toMatch(/3\.0:1 target/);
    // The short-game ratio must never be offered as a consolation target.
    expect(r.line).not.toMatch(/2:1 target|train at 2/i);
  });

  it('calls a long backswing long, and an on-target swing on-target', () => {
    expect(readOwnTempo({ tempoAvg: 3.6, tempoSamples: 30, backswingAvgMs: 900 }, FULL, 3).line).toMatch(/runs long/);
    expect(readOwnTempo({ tempoAvg: 3.05, tempoSamples: 30, backswingAvgMs: 800 }, FULL, 3).line).toMatch(/right on the/);
  });
});
