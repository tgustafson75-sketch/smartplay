/**
 * The narrative between a golfer and his caddie.
 *
 * 2026-08-21. Tim, on a failure he has hit live on course more than once:
 *
 *   "I'm hitting everything left today." And it'll give me some advice about WHY. But no — it's
 *   contextual. THAT'S WHERE I'M GONNA HIT. We gotta say okay, we're gonna aim a little the other
 *   direction now, and take wind into account. And maybe some corrective — just slow down a little.
 *
 * And the nuance that makes it a narrative rather than a setting:
 *
 *   "It's gonna EVOLVE even over the course of a round, or even one hole, and that needs to be smart
 *   and grows and the caddie knows what to do."
 *
 * So: record it as truth, aim around it, and read the ARC — because "now I'm blocking it right"
 * after "I'm pulling everything" is an OVERCORRECTION, and treating it as a fresh fault is how a
 * caddie makes a bad round worse.
 */
import { usePlayingConditionStore, playingConditionPromptLine } from '../../store/playingConditionStore';

beforeEach(() => { usePlayingConditionStore.getState().clearCondition(); });

describe('a stated condition is treated as fact, not a fault', () => {
  it('tells the caddie to aim around it and NOT to diagnose', () => {
    usePlayingConditionStore.getState().setCondition({ stated: 'hitting everything left today', kind: 'ball_flight', compensate: 'right' });
    const line = playingConditionPromptLine()!;
    expect(line).toMatch(/TREAT THIS AS FACT/);
    expect(line).toMatch(/Favour the right side/);
    expect(line).toMatch(/factor the wind/i);
    // The whole complaint: it explains WHY instead of moving the aim.
    expect(line).toMatch(/Do NOT explain why/);
    expect(line).toMatch(/never instead of the club call/);
  });

  it('outranks the learned tendency while it is live', () => {
    // clubTendency may have learned he misses right. Today he is pulling everything. Today wins.
    usePlayingConditionStore.getState().setCondition({ stated: 'pulling everything', kind: 'ball_flight', compensate: 'right' });
    expect(playingConditionPromptLine()).toMatch(/OUTRANKS his learned tendency/);
  });

  it('allows exactly one corrective cue — a lesson mid-round is the failure mode', () => {
    usePlayingConditionStore.getState().setCondition({ stated: 'coming over the top', kind: 'feel' });
    const line = playingConditionPromptLine()!;
    expect(line).toMatch(/At most ONE short corrective cue/);
    expect(line).toMatch(/never twice in a row/);
  });
});

describe('the arc — it evolves over a round', () => {
  it('reads an OVERCORRECTION rather than a new problem', () => {
    const s = usePlayingConditionStore.getState();
    s.setCondition({ stated: 'hitting everything left', kind: 'ball_flight', compensate: 'right' });
    s.setCondition({ stated: 'now I am blocking it right', kind: 'ball_flight', compensate: 'left' });
    const line = playingConditionPromptLine()!;
    expect(line).toMatch(/HOW TODAY HAS GONE/);
    expect(line).toMatch(/hitting everything left.*→.*blocking it right/);
    // The instruction that stops the caddie chasing the new miss with another adjustment.
    expect(line).toMatch(/he has overcorrected/);
    expect(line).toMatch(/settle him down/);
  });

  it('does not pad the arc when he repeats himself', () => {
    const s = usePlayingConditionStore.getState();
    s.setCondition({ stated: 'still going left', kind: 'ball_flight' });
    s.setCondition({ stated: 'Still going left', kind: 'ball_flight' });
    expect(usePlayingConditionStore.getState().conditionArc()).toHaveLength(1);
  });

  it('stays silent with no arc — one statement is not a story', () => {
    usePlayingConditionStore.getState().setCondition({ stated: 'hitting it left', kind: 'ball_flight' });
    expect(playingConditionPromptLine()).not.toMatch(/HOW TODAY HAS GONE/);
  });

  it('expires, because it is true today and wrong tomorrow', () => {
    usePlayingConditionStore.getState().setCondition({ stated: 'hitting it left', kind: 'ball_flight' });
    const tomorrow = Date.now() + 7 * 60 * 60 * 1000;
    expect(playingConditionPromptLine(tomorrow)).toBeNull();
  });
});
