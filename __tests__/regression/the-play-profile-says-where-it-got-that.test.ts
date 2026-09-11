/**
 * 2026-09-11 (Tim) — THE PLAY PROFILE, AND THE LINE BETWEEN A PRIOR AND AN OBSERVATION.
 *
 * "We need to make sure we have an engine for the strengths and weaknesses, a play profile… that's
 * good for beginners by level. We don't need three rounds to kinda prove this point."
 *
 * He is right that a profile which stays silent until it has earned an opinion is useless exactly
 * when a new player needs it. So the profile is SEEDED from the player's stated level and sharpened
 * by data as it arrives.
 *
 * That is only honest if the two never blur. A seeded claim is a statement about players at that
 * level; a measured one is a statement about THIS player. Say the second when you only have the
 * first and you are fabricating — the thing this codebase keeps having to remove.
 * [[illustration-data-points]]
 *
 * And the lens: smart bogey golf. "Seventeen bogeys and one par and you break ninety." The budget is
 * stated as shots IN HAND, because a double is not a disaster when the target absorbs it.
 */
import { composePlayProfile, bogeyBudgetLine, cuesFor } from '../../services/playProfile';

describe('the play profile says where it got that', () => {
  it('a brand-new player still gets real guidance, labelled as a prior', () => {
    const p = composePlayProfile({ level: 'simple', goal: 'break_100' });
    expect(p.weaknesses.length).toBeGreaterThan(0);
    expect(p.confidence).toBe('seeded');
    expect(p.weaknesses.every(w => w.source === 'seeded')).toBe(true);
  });

  it('never claims a seeded prior as something it measured', () => {
    const p = composePlayProfile({ level: 'simple', goal: 'break_100' });
    expect(p.weaknesses.some(w => w.source === 'measured')).toBe(false);
  });

  it('a real observation outranks the prior and is labelled measured', () => {
    const p = composePlayProfile({
      level: 'simple', goal: 'break_100', roundsPlayed: 6, penaltiesPerRound: 4,
    });
    const pen = p.weaknesses.find(w => /Penalties/.test(w.text));
    expect(pen?.source).toBe('measured');
    expect(p.confidence).not.toBe('seeded');
  });

  it('will not measure anything from a single round', () => {
    const p = composePlayProfile({
      level: 'simple', goal: 'break_100', roundsPlayed: 1, penaltiesPerRound: 4, puttsPerRound: 40,
    });
    expect(p.weaknesses.some(w => /Penalties|Putting/.test(w.text))).toBe(false);
  });

  it('carries the full-swing trait as a real weakness, not a prior', () => {
    const p = composePlayProfile({ level: 'standard', distanceControl: 'full_swings' });
    const f = p.weaknesses.find(w => /In-between/.test(w.text));
    expect(f?.source).toBe('measured');
  });
});

describe('smart bogey golf is the lens', () => {
  it('break 90 on a par 72 is a 17-shot budget', () => {
    const p = composePlayProfile({ level: 'standard', goal: 'break_90', coursePar: 72 });
    expect(p.targetScore).toBe(89);
    expect(p.strokeBudget).toBe(17);
  });

  it('free play invents no target', () => {
    const p = composePlayProfile({ level: 'standard', goal: 'free_play' });
    expect(p.targetScore).toBeNull();
    expect(p.strokeBudget).toBeNull();
    expect(bogeyBudgetLine(p, 5, 6)).toBeNull();
  });

  it('states the budget as shots IN HAND, not as a deficit', () => {
    const p = composePlayProfile({ level: 'standard', goal: 'break_90', coursePar: 72 });
    const line = bogeyBudgetLine(p, 6, 6);   // +6 through 6
    expect(line).toMatch(/11 shots in hand for 12 holes/);
  });

  it('is honest when the player is past the pace, without scolding', () => {
    const p = composePlayProfile({ level: 'standard', goal: 'break_90', coursePar: 72 });
    const line = bogeyBudgetLine(p, 20, 12);
    expect(line).toMatch(/3 over the 89 pace/);
    expect(line).toMatch(/you're back/);
  });
});

describe('cues do not nag', () => {
  it('a beginner gets the chip cue', () => {
    const p = composePlayProfile({ level: 'simple' });
    expect(cuesFor(p)[0].text).toMatch(/decelerat/i);
  });

  it('an advanced player is never told not to decelerate', () => {
    const p = composePlayProfile({ level: 'advanced' });
    expect(p.cues.some(c => /decelerat/i.test(c.text))).toBe(false);
  });

  it('a cue already said twice stays quiet', () => {
    const p = composePlayProfile({ level: 'simple' });
    const first = cuesFor(p)[0];
    const after = cuesFor(p, { [first.text]: 2 });
    expect(after.some(c => c.text === first.text)).toBe(false);
  });

  it('says one thing at a time by default', () => {
    const p = composePlayProfile({ level: 'simple' });
    expect(cuesFor(p)).toHaveLength(1);
  });
});
