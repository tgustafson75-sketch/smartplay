/**
 * 2026-10-15 (review G3a, finding 9) — THE SPOKEN SUMMARY COUNTS THE SCORE STILL BEING TAPPED IN.
 *
 * promptEndRound's "Save & end" snapshotted scores/totals, THEN called endRound() — which flushes a
 * strip score still inside its 2.5s settle (services/round/pendingScoreFlush). The saved round had
 * the last hole; the summary the caddie spoke did not. The flush now runs before the snapshot.
 */
jest.mock('expo-haptics', () => ({
  notificationAsync: async () => undefined,
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

const state: { scores: Record<number, number>; ended: boolean } = { scores: {}, ended: false };
jest.mock('../../store/roundStore', () => {
  const getState = () => ({
    isRoundActive: true,
    scores: { ...state.scores },
    courseHoles: [{ hole: 1, par: 4 }, { hole: 2, par: 4 }],
    activeCourse: 'Test GC',
    getTotalScore: () => Object.values(state.scores).reduce((a, b) => a + b, 0),
    getScoreVsPar: () => null,
    getHolesPlayed: () => Object.keys(state.scores).length,
    endRound: () => { state.ended = true; return 'r1'; },
    discardRound: () => undefined,
  });
  return { useRoundStore: { getState } };
});
jest.mock('../../store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ voiceEnabled: false, voiceGender: 'male', language: 'en' }) },
}));
jest.mock('../../store/toastStore', () => ({ useToastStore: { getState: () => ({ show: () => undefined }) } }));
const summaryInputs: Array<{ total: number; played: number; scores: Record<number, number> }> = [];
jest.mock('../../services/roundEndSummary', () => ({
  buildRoundEndSummary: (i: { total: number; played: number; scores: Record<number, number> }) => {
    summaryInputs.push(i);
    return 'summary';
  },
}));

import { Alert } from 'react-native';
import { promptEndRound } from '../../services/round/endRoundFlow';
import { registerPendingScoreFlush } from '../../services/round/pendingScoreFlush';

describe('Save & end flushes a settling strip score before it summarizes', () => {
  it('the last hole tapped on the strip is in the spoken summary', async () => {
    state.scores = { 1: 5 };
    // The strip holds hole 2's "4" in its settle window; flushing writes it.
    const unregister = registerPendingScoreFlush(() => { state.scores = { ...state.scores, 2: 4 }; });
    let buttons: Array<{ text: string; onPress?: () => unknown }> = [];
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(((_t: string, _m: string, b: typeof buttons) => { buttons = b; }) as never);
    try {
      expect(promptEndRound()).toBe('prompted');
      const save = buttons.find((b) => b.text === 'Save & end');
      await save!.onPress!();
      expect(state.ended).toBe(true);
      expect(summaryInputs).toHaveLength(1);
      expect(summaryInputs[0].scores).toEqual({ 1: 5, 2: 4 });
      expect(summaryInputs[0].total).toBe(9);
      expect(summaryInputs[0].played).toBe(2);
    } finally {
      spy.mockRestore();
      unregister();
    }
  });
});
