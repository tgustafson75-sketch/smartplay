/**
 * 2026-08-24 (Tim, after a real round — "I got a briefing on a hole twice").
 *
 * The tee brief and the proactive stop-read each remembered "already said this on this hole" in a
 * component useRef inside app/(tabs)/caddie.tsx. Two things were wrong with that:
 *
 *   1. a ref does not survive a REMOUNT of the tab, and
 *   2. the reset effect guarding it was keyed `[isRoundActive]` — and effects run on MOUNT too, so
 *      every remount during an active round ACTIVELY CLEARED the memory.
 *
 * Switch to the Play tab and back on the same hole and the brief re-armed. "Has the caddie briefed
 * hole 7 this round" is a fact about the ROUND, so it now lives with the round — persisted, so even
 * an app restart mid-round cannot repeat a line.
 */
import { useRoundStore } from '../../store/roundStore';

const st = () => useRoundStore.getState();

describe('the caddie says a thing once per hole, per round', () => {
  beforeEach(() => { useRoundStore.setState({ spokenHoleEvents: {} } as never); });

  it('remembers a line was spoken on a hole', () => {
    expect(st().hasSpokenOnHole('tee_brief', 7)).toBe(false);
    st().markSpokenOnHole('tee_brief', 7);
    expect(st().hasSpokenOnHole('tee_brief', 7)).toBe(true);
  });

  it('survives what a component ref could not — the state is not component-scoped', () => {
    st().markSpokenOnHole('tee_brief', 7);
    // Whatever the UI does — unmount, remount, navigate — the round still knows.
    expect(useRoundStore.getState().hasSpokenOnHole('tee_brief', 7)).toBe(true);
  });

  it('keeps the two proactive voices independent — a brief is not a stop-read', () => {
    st().markSpokenOnHole('tee_brief', 7);
    expect(st().hasSpokenOnHole('proactive_read', 7)).toBe(false);
  });

  it('is per hole — hole 8 has not been briefed because hole 7 was', () => {
    st().markSpokenOnHole('tee_brief', 7);
    expect(st().hasSpokenOnHole('tee_brief', 8)).toBe(false);
  });

  it('is idempotent — marking twice does not change the state object', () => {
    st().markSpokenOnHole('tee_brief', 7);
    const first = useRoundStore.getState().spokenHoleEvents;
    st().markSpokenOnHole('tee_brief', 7);
    expect(useRoundStore.getState().spokenHoleEvents).toBe(first);   // same reference: no re-render
  });

  it('a NEW ROUND starts silent — round 2 must not inherit round 1 on the same hole numbers', () => {
    st().markSpokenOnHole('tee_brief', 7);
    st().startRound('Test GC', [{ hole: 1, par: 4, distance: 380 }] as never,
      { nineHole: false, isCompetition: false, notes: '', goal: null } as never);
    expect(useRoundStore.getState().hasSpokenOnHole('tee_brief', 7)).toBe(false);
  });

  it('is persisted with the round, so an app restart mid-round cannot repeat a line', () => {
    // The persist partialize must carry it; otherwise a crash re-briefs every hole already played.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../store/roundStore.ts'), 'utf8');
    expect(src).toContain('spokenHoleEvents: s.spokenHoleEvents,');
  });
});
