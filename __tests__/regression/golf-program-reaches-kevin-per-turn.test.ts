/**
 * 2026-11-01 — THE GOLF PROGRAM LINE REACHES KEVIN'S REQUEST, AND ONLY WHEN THERE IS A PROGRAM.
 *
 * golfProgramLine's own tests prove the helper. This proves the wiring: the line is in the request the
 * brain receives, in the per-turn unified_context_block, and absent when there is no active Swing Rx.
 * Break-tested: removing the golf line from the tail fails the first assertion.
 */
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useGolfWorkoutStore } from '../../store/golfWorkoutStore';
import { buildPrescription } from '../../services/golf/swingRx';

const NOW = Date.UTC(2026, 10, 1, 9, 0, 0);

function contextOf(): string {
  const body = buildCaddieRequestBody({} as never) as { unified_context_block?: string | null };
  return body.unified_context_block ?? '';
}

describe('the golf program reaches the per-turn request', () => {
  beforeEach(() => {
    useGolfWorkoutStore.setState({ prescriptions: [], loggedSets: [] });
  });

  it('is in unified_context_block when there is an active Swing Rx', () => {
    useGolfWorkoutStore.getState().addPrescription(buildPrescription('early_extension', {}, NOW));
    expect(contextOf()).toMatch(/GOLF PROGRAM: active Swing Rx for Early Extension/);
  });

  it('is absent when there is no Swing Rx, so Kevin is never told about a program that does not exist', () => {
    expect(contextOf()).not.toMatch(/GOLF PROGRAM/);
  });
});
