/**
 * 2026-10-15 (review) — two cockpit stepper defects, mounted for real.
 *
 *  1. PUTTS LANDED ON THE NEXT HOLE. The SHOTS stepper commits 1.6s after the last tap and the first
 *     score auto-advances; PUTTS wrote to currentHole at tap time. Score 5, pause, tap putts → hole 6.
 *  2. A SETTLING SCORE WAS LOST. End Round inside the 1.6s window ran endRound first; the commit then
 *     saw the round inactive and dropped it. The cockpit never registered with pendingScoreFlush (the
 *     registry held ONE holder), and had no background commit.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { AppState } from 'react-native';

jest.mock('../../components/caddie/cockpit/BrandHeader', () => ({ BrandHeader: () => null }));
jest.mock('../../components/caddie/cockpit/DistanceCard', () => ({ DistanceCard: () => null }));
jest.mock('../../components/caddie/cockpit/SmartToolsRow', () => ({ SmartToolsRow: () => null }));
jest.mock('../../components/caddie/cockpit/AskCaddieButton', () => ({ AskCaddieButton: () => null }));
jest.mock('../../components/caddie/cockpit/ShotResultRow', () => ({ ShotResultRow: () => null }));
jest.mock('../../services/smartFinderService', () => ({
  subscribeFixChange: () => () => undefined,
  holeData: () => ({ par: 4, distance: 380 }),
}));
jest.mock('../../services/yardageResolver', () => ({ resolveYardage: () => null, resolvedToFmb: () => null }));

import CockpitCaddieScreen from '../../components/caddie/CockpitCaddieScreen';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';

const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 }));

function startRound() {
  useRoundStore.setState({ roundHistory: [] } as never);
  useRoundStore.getState().startRound('Cockpit GC', card as never, {
    nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: null,
  } as never);
  useSettingsStore.setState({ autoHoleAdvance: true } as never);
}
const mount = () => render(<CockpitCaddieScreen voiceState={'idle' as never} caddieResponse="" onMicPress={() => undefined} />);
// StepperPair cells, in order: HOLE, SHOTS, PUTTS — each has a "Decrease …" and "Increase …" button.
const plus = (r: ReturnType<typeof mount>, i: number) => r.getAllByLabelText(/^Increase /)[i];

describe('cockpit: putts follow the score', () => {
  beforeEach(() => { jest.useFakeTimers(); startRound(); });
  afterEach(() => jest.useRealTimers());

  it('putts tapped after the score committed and auto-advanced land on the SCORED hole', () => {
    const r = mount();
    for (let i = 0; i < 5; i++) fireEvent.press(plus(r, 1)); // SHOTS 5 on hole 1
    act(() => { jest.advanceTimersByTime(1700); });           // commit + auto-advance to 2
    expect(useRoundStore.getState().scores[1]).toBe(5);
    expect(useRoundStore.getState().currentHole).toBe(2);
    fireEvent.press(plus(r, 2)); fireEvent.press(plus(r, 2)); // PUTTS 2
    expect(useRoundStore.getState().putts[1]).toBe(2);
    expect(useRoundStore.getState().putts[2]).toBeUndefined();
  });

  it('putts tapped while the score is still settling land on that score\'s hole', () => {
    const r = mount();
    for (let i = 0; i < 4; i++) fireEvent.press(plus(r, 1));
    fireEvent.press(plus(r, 2));
    act(() => { jest.advanceTimersByTime(1700); });
    expect(useRoundStore.getState().putts[1]).toBe(1);
    expect(useRoundStore.getState().putts[2]).toBeUndefined();
  });
});

describe('cockpit: a settling score is part of the round', () => {
  beforeEach(() => { jest.useFakeTimers(); startRound(); });
  afterEach(() => jest.useRealTimers());

  it('End Round inside the settle window writes it into the saved record', () => {
    const r = mount();
    for (let i = 0; i < 6; i++) fireEvent.press(plus(r, 1));
    let id = '';
    act(() => { id = useRoundStore.getState().endRound(); });
    const rec = useRoundStore.getState().roundHistory.find((x) => x.id === id);
    expect(rec?.scores[1]).toBe(6);
  });

  it('going to the background commits it', () => {
    const r = mount();
    for (let i = 0; i < 3; i++) fireEvent.press(plus(r, 1));
    const calls = (AppState.addEventListener as unknown as jest.Mock).mock?.calls ?? [];
    act(() => { for (const c of calls) if (c[0] === 'change') c[1]('background'); });
    expect(useRoundStore.getState().scores[1]).toBe(3);
  });
});
