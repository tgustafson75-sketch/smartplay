/**
 * 2026-10-15 (review) — on a twice-around round (a nine played twice) the player reads the hole off
 * the SIGN. Standing on round hole 12 (the second pass of hole 3), "five on hole 3" overwrote the
 * front-nine hole 3 on every voice path. roundStore.roundHoleForSpoken is now the one mapping, used by
 * the voice intents and the brain's tool dispatch.
 */
import { useRoundStore } from '../../store/roundStore';
// Runtime lookup so this compiles (and fails on behaviour) against the pre-fix store.
const roundHoleForSpoken = (s: unknown, h: number): number =>
  (require('../../store/roundStore') as Record<string, (s: unknown, h: number) => number>).roundHoleForSpoken(s, h);
import { logScoreHandler } from '../../services/intents/logScoreHandler';
import { logPuttsHandler } from '../../services/intents/logPuttsHandler';
import { dispatchConversationalToolActions } from '../../services/voice/conversationalToolDispatch';

const nine = Array.from({ length: 9 }, (_, i) => ({ hole: i + 1, par: 4, distance: 350 }));
const expanded = [...nine, ...nine.map((h) => ({ ...h, hole: h.hole + 9 }))];

function secondLoop(twiceAround: boolean) {
  useRoundStore.setState({ roundHistory: [] } as never);
  useRoundStore.getState().startRound('Echo Hills', expanded as never, {
    nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: 'echo', twiceAround,
  } as never);
  for (let h = 1; h <= 11; h++) useRoundStore.getState().logScore(h, 4);
  useRoundStore.setState({ currentHole: 12 } as never);
}

describe('the hole on the sign is the hole on this loop', () => {
  it('the mapping: second loop, spoken 1-9 → 10-18; otherwise unchanged', () => {
    expect(roundHoleForSpoken({ twiceAround: true, currentHole: 12 }, 3)).toBe(12);
    expect(roundHoleForSpoken({ twiceAround: true, currentHole: 12 }, 14)).toBe(14);
    expect(roundHoleForSpoken({ twiceAround: true, currentHole: 4 }, 3)).toBe(3);
    expect(roundHoleForSpoken({ twiceAround: false, currentHole: 12 }, 3)).toBe(3);
  });

  it('voice intent: "five on hole 3" on round hole 12 scores hole 12, front nine untouched', async () => {
    secondLoop(true);
    await logScoreHandler.execute({ intent_type: 'log_score', parameters: { strokes: 5, hole_number: 3 }, raw_text: 'five on hole 3', confidence: 'high' } as never, {} as never);
    expect(useRoundStore.getState().scores[12]).toBe(5);
    expect(useRoundStore.getState().scores[3]).toBe(4);
  });

  it('voice putts on "hole 3" land on hole 12 as well', async () => {
    secondLoop(true);
    await logPuttsHandler.execute({ intent_type: 'log_putts', parameters: { num_putts: 2, hole_number: 3 }, raw_text: 'two putts on 3', confidence: 'high' } as never, {} as never);
    expect(useRoundStore.getState().putts[12]).toBe(2);
    expect(useRoundStore.getState().putts[3]).toBeUndefined();
  });

  it('brain tool log_score { hole: 3 } on round hole 12 scores hole 12', () => {
    secondLoop(true);
    dispatchConversationalToolActions([{ type: 'log_score', hole: 3, score: 6 } as never]);
    expect(useRoundStore.getState().scores[12]).toBe(6);
    expect(useRoundStore.getState().scores[3]).toBe(4);
  });

  it('a real 18 is untouched: "hole 3" means hole 3', async () => {
    secondLoop(false);
    await logScoreHandler.execute({ intent_type: 'log_score', parameters: { strokes: 5, hole_number: 3 }, raw_text: 'five on hole 3', confidence: 'high' } as never, {} as never);
    expect(useRoundStore.getState().scores[3]).toBe(5);
  });
});
