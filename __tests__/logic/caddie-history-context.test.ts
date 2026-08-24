/**
 * 2026-08-24 (orphan sweep) — the caddie can answer questions about the player's OWN GOLF.
 *
 * services/caddieHistoryContext.historyPromptBlock() was written 07-04 and given a
 * sim-contamination fix 07-30, and for seven weeks NOTHING called it. The payload carried
 * `priorRoundsHere`, which filters to the CURRENT course, so a player asking "how was my last
 * round" or "what courses have I played" got a caddie offering to go and look it up.
 *
 * The sim guard asserts the wiring chain by source. These cases assert the BEHAVIOUR: that the block
 * actually says something useful from real store state, and — the part that matters most — that it
 * still refuses to recite a simulated round as real play.
 */
import { historyPromptBlock } from '../../services/caddieHistoryContext';
import { useRoundStore } from '../../store/roundStore';
import { usePracticePointsStore } from '../../store/practicePointsStore';

const round = (over: Record<string, unknown>) => ({
  id: String(Math.random()), startedAt: 1, endedAt: 1_700_000_000_000,
  totalScore: 88, scoreVsPar: 16, holesPlayed: 18, courseName: 'Sharp Park',
  ...over,
});

const seed = (rounds: unknown[], byDrill: Record<string, unknown> = {}) => {
  useRoundStore.setState({ roundHistory: rounds } as never);
  usePracticePointsStore.setState({ byDrill } as never);
};

describe('historyPromptBlock — the caddie knows the player\'s own golf', () => {
  it('is empty when there is nothing to say, so it never pads the prompt', () => {
    seed([]);
    expect(historyPromptBlock()).toBe('');
  });

  it('names the recent rounds, the score and the course', () => {
    seed([round({ totalScore: 88, scoreVsPar: 16, courseName: 'Sharp Park' })]);
    const out = historyPromptBlock();
    expect(out).toContain('88');
    expect(out).toContain('+16');
    expect(out).toContain('Sharp Park');
  });

  it('lists the courses played — the "what courses have I played" answer', () => {
    seed([
      round({ courseName: 'Sharp Park' }),
      round({ courseName: 'Poplar Creek' }),
    ]);
    const out = historyPromptBlock();
    expect(out).toContain('Courses played:');
    expect(out).toContain('Sharp Park');
    expect(out).toContain('Poplar Creek');
  });

  it('NEVER recites a simulated round as real play — the 07-30 fix, now actually reachable', () => {
    seed([round({ courseName: 'Demo Valley', simulated: true })]);
    expect(historyPromptBlock()).not.toContain('Demo Valley');
  });

  it('surfaces what they have been working on, by session count', () => {
    seed([], { weight_shift: { label: 'weight shift', sessions: 4 } });
    const out = historyPromptBlock();
    expect(out).toContain('practice focus');
    expect(out).toContain('weight shift');
    expect(out).toContain('4');
  });

  it('omits a drill with zero sessions rather than claiming practice that never happened', () => {
    seed([], { putting: { label: 'putting', sessions: 0 } });
    expect(historyPromptBlock()).toBe('');
  });

  it('newest round first — "how was my last round" must get the LAST one', () => {
    seed([
      round({ totalScore: 95, courseName: 'Old Round' }),
      round({ totalScore: 82, courseName: 'Newest Round' }),
    ]);
    const out = historyPromptBlock();
    expect(out.indexOf('Newest Round')).toBeLessThan(out.indexOf('Old Round'));
  });
});
