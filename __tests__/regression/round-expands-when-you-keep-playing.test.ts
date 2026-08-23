import { useRoundStore } from '../../store/roundStore';

const holes18 = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 }));

/**
 * 2026-08-23 (Tim — "it's easy to forget setting that, just like it's easy to forget when you start a
 * round doing nine or eighteen holes").
 *
 * Same class as the cart setting: a declaration made on the first tee, silently wrong for the rest of
 * the round. A player who said "nine" and walks onto the 10th tee has told us by PLAYING it that this
 * is an eighteen — but the clamp dragged them back to 9 and every hole after went unrecorded.
 */
describe('a nine-hole round expands when you keep playing', () => {
  beforeEach(() => {
    useRoundStore.setState({
      nineHoleMode: true, roundStartHole: 1, isRoundActive: true,
      courseHoles: holes18 as never, activeCourseId: 'test', currentHole: 9, scores: {},
    } as never);
  });

  it('walking onto the 10th tee makes it an eighteen', () => {
    useRoundStore.getState().setCurrentHole(10);
    expect(useRoundStore.getState().nineHoleMode).toBe(false);
    expect(useRoundStore.getState().currentHole).toBe(10);
  });

  it('and keeps counting all the way to 18 instead of stalling at 9', () => {
    useRoundStore.getState().setCurrentHole(10);
    useRoundStore.getState().setCurrentHole(18);
    expect(useRoundStore.getState().currentHole).toBe(18);
  });

  it('never expands onto holes the course does not have', () => {
    useRoundStore.setState({ courseHoles: holes18.slice(0, 9) } as never);
    useRoundStore.getState().setCurrentHole(10);
    // A real 9-hole course: still nine, still clamped.
    expect(useRoundStore.getState().nineHoleMode).toBe(true);
    expect(useRoundStore.getState().currentHole).toBe(9);
  });

  it('never SHRINKS a round — stopping is not evidence of anything', () => {
    useRoundStore.setState({ nineHoleMode: false, currentHole: 9 } as never);
    useRoundStore.getState().setCurrentHole(9);
    expect(useRoundStore.getState().nineHoleMode).toBe(false);
  });

  it('leaves a normal eighteen completely alone', () => {
    useRoundStore.setState({ nineHoleMode: false, currentHole: 4 } as never);
    useRoundStore.getState().setCurrentHole(5);
    expect(useRoundStore.getState().currentHole).toBe(5);
    expect(useRoundStore.getState().nineHoleMode).toBe(false);
  });
});
