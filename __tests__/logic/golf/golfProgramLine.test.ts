import { golfProgramLine, GOLF_PROGRAM_LINE_MAX } from '../../../services/golf/golfProgramLine';
import { buildPrescription } from '../../../services/golf/swingRx';
import type { LoggedSetEvent } from '../../../services/golf/sessionTypes';

const NOW = Date.UTC(2026, 10, 1, 9, 0, 0);
const rx = buildPrescription('early_extension', {}, NOW);

const set = (exerciseId: string, at: number): LoggedSetEvent => ({
  type: 'set.complete',
  timestamp: new Date(at).toISOString(),
  payload: { exerciseId, weight: 0, reps: 10 },
});

describe('golfProgramLine', () => {
  it('is null with no active Swing Rx, so Kevin is never told about a program that does not exist', () => {
    expect(golfProgramLine(null, [])).toBeNull();
  });

  it('names the active Rx and counts only sets logged since the import', () => {
    const line = golfProgramLine(rx, [set('hipThrust', NOW + 1000), set('hipThrust', NOW - 1000)]);
    expect(line).toMatch(/Swing Rx for Early Extension/);
    expect(line).toMatch(/1 of \d+ Rx sets logged since the import/);
  });

  it('stays under the cap so the context tail is not what gets cut', () => {
    const line = golfProgramLine(rx, []);
    expect(line!.length).toBeLessThanOrEqual(GOLF_PROGRAM_LINE_MAX);
  });
});
