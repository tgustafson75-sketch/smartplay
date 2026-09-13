import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useRoundStore } from '../../store/roundStore';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import { computePracticeImpact } from '../../services/practice/practiceImpact';

/**
 * 2026-09-12 (Tim) — "there seems to be a trend where I have a sharp uptick in practice and my
 * scores go up… then I stop practicing and play, and it slowly starts to translate. They cross each
 * other, and I wanna be able to just check. I think he can see that context, but I want you to
 * check."
 *
 * He could not. services/practice/practiceImpact has paired practice volume against scoring since
 * 2026-06-14 and its only consumer was app/(tabs)/dashboard.tsx, so the crossing was drawn on the
 * dashboard and unaskable one screen away. The nearest thing the caddie carried was
 * playerHistoryBlock, whose practice half is an all-time session COUNT with no dates in it — a
 * number that cannot be trended even in principle. [[unconnected-halves-not-broken-code]]
 */

const WEEK = 7 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/** Practice climbing and scores coming down over the six-week window the module reads. */
const setUpAClimb = () => {
  const now = Date.now();
  usePracticeSessionStore.setState({
    history: [
      { startedAt: now - 5 * WEEK, swingCount: 20, swings: [] },
      { startedAt: now - 4 * WEEK, swingCount: 20, swings: [] },
      { startedAt: now - 2 * WEEK, swingCount: 120, swings: [] },
      { startedAt: now - 1 * WEEK, swingCount: 140, swings: [] },
    ],
  } as never);
  useRoundStore.setState({
    roundHistory: [
      { endedAt: now - 5 * WEEK, startedAt: now - 5 * WEEK, scoreVsPar: 18 },
      { endedAt: now - 4 * WEEK, startedAt: now - 4 * WEEK, scoreVsPar: 16 },
      { endedAt: now - 2 * WEEK, startedAt: now - 2 * WEEK, scoreVsPar: 11 },
      { endedAt: now - 1 * DAY, startedAt: now - 1 * DAY, scoreVsPar: 9 },
    ],
  } as never);
};

describe('the caddie can see the practice-to-scoring crossing', () => {
  it('sends the measured direction of both lines', () => {
    setUpAClimb();
    const block = buildCaddieRequestBody({ message: 'is my practice showing up?', language: 'en' })
      .practiceImpactBlock as string | null;
    expect(typeof block).toBe('string');
    expect(block).toMatch(/PRACTICE-TO-SCORING CONNECTION/);
    expect(block).toMatch(/— UP\./);
    expect(block).toMatch(/— IMPROVING\./);
    // The honesty framing rides with it, the same way routineImpactBlock's does.
    expect(block).toMatch(/association, not cause/);
  });

  /**
   * 2026-09-12 (Tim — "we don't wanna just fall silent, that is an unnatural response") — this
   * asserted `toBeNull()`. The gate is unchanged and still honest; what changed is that below it the
   * caddie now says what is in the books and what would make a comparison real, instead of nothing.
   * The invariant — never claim a trend from too little — is asserted below and still holds.
   */
  it('says what it still needs instead of going silent', () => {
    usePracticeSessionStore.setState({ history: [] } as never);
    useRoundStore.setState({ roundHistory: [] } as never);
    const block = buildCaddieRequestBody({ message: 'x', language: 'en' }).practiceImpactBlock as string;
    expect(block).not.toBeNull();
    expect(block).toMatch(/NOT MEASURABLE YET/);
    expect(block).toMatch(/0 logged practice sessions and 0 completed rounds/);
    expect(block).toMatch(/more session|more round/);
    // THE INVARIANT: no direction claimed from nothing.
    expect(block).not.toMatch(/practice volume \d+ balls/);
    expect(block).not.toMatch(/IMPROVING|getting worse/);
  });

  it('does not trend a narrated SIM round as real play', () => {
    setUpAClimb();
    const real = buildCaddieRequestBody({ message: 'x', language: 'en' }).practiceImpactBlock as string;
    const now = Date.now();
    useRoundStore.setState({
      roundHistory: [
        ...(useRoundStore.getState().roundHistory as never[]),
        // A demo round shot at level par would flatten the improvement if it counted.
        { endedAt: now, startedAt: now, scoreVsPar: 0, simulated: true },
      ],
    } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).practiceImpactBlock).toBe(real);
  });

  /**
   * The dashboard headline and the caddie's block must not be able to disagree about which way the
   * lines are going — the headline is now derived from the same `connection` the block reads.
   */
  it('gives the graph and the caddie one owner of the direction', () => {
    const now = Date.now();
    const out = computePracticeImpact({
      sessions: [
        { startedAt: now - 5 * WEEK, balls: 20 },
        { startedAt: now - 4 * WEEK, balls: 20 },
        { startedAt: now - 2 * WEEK, balls: 120 },
        { startedAt: now - 1 * WEEK, balls: 140 },
      ],
      rounds: [
        { endedAt: now - 5 * WEEK, scoreVsPar: 18 },
        { endedAt: now - 4 * WEEK, scoreVsPar: 16 },
        { endedAt: now - 2 * WEEK, scoreVsPar: 11 },
        { endedAt: now - 1 * DAY, scoreVsPar: 9 },
      ],
      nowMs: now,
    });
    expect(out.connection).not.toBeNull();
    expect(out.connection!.practiceUp).toBe(true);
    expect(out.connection!.scoreImproving).toBe(true);
    expect(out.headline).toMatch(/showing up on the course/);
  });

  it('reports no direction while there is not enough', () => {
    const now = Date.now();
    const out = computePracticeImpact({ sessions: [], rounds: [], nowMs: now });
    expect(out.hasEnough).toBe(false);
    expect(out.connection).toBeNull();
  });
});
