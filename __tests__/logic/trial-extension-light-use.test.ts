/**
 * Tim 2026-09-03: "in the free period, where a user has not used it 3 times in that period, they are
 * offered a 7 day extension to play more."
 *
 * A trial that expires unused is a missed trial, not a rejection — golf is weather, daylight and a
 * tee time you could not get. These pin the rule that decides who gets another week, because every
 * one of its edges is a real person: the player who got out twice, the one who came back a fortnight
 * after it lapsed, and the one who already took the extension and still did not play.
 */
import {
  planTrialExtension,
  countActiveDays,
  describeTrialExtension,
  LIGHT_USE_DAY_THRESHOLD,
  TRIAL_EXTENSION_DAYS,
  OFFER_WINDOW_MS,
  LAPSED_GRACE_MS,
} from '../../services/billing/trialUsage';

const DAY = 24 * 60 * 60 * 1000;
const TRIAL = 14 * DAY;
const START = new Date('2026-06-01T09:00:00').getTime();
const ENDS = START + TRIAL;

/** A day inside the trial, at 9am local so it never straddles a date boundary. */
const day = (n: number) => START + n * DAY;

const base = {
  status: 'trial' as const,
  trialStartedAt: START,
  trialDurationMs: TRIAL,
  activityTimestamps: [] as number[],
  extensionGrantedAt: null as number | null,
  // Day 13 — inside the two-day offer window.
  now: ENDS - DAY,
};

describe('countActiveDays', () => {
  it('collapses several sessions on one day into one day of use', () => {
    const morning = new Date('2026-06-03T08:00:00').getTime();
    const noon = new Date('2026-06-03T12:30:00').getTime();
    const evening = new Date('2026-06-03T19:45:00').getTime();
    expect(countActiveDays([morning, noon, evening], START, ENDS)).toBe(1);
  });

  it('counts separate calendar days separately even when hours apart', () => {
    const satNight = new Date('2026-06-06T22:00:00').getTime();
    const sunMorning = new Date('2026-06-07T07:00:00').getTime();
    expect(countActiveDays([satNight, sunMorning], START, ENDS)).toBe(2);
  });

  it('ignores activity outside the trial window rather than clamping it', () => {
    // Rounds played BEFORE the trial began are not trial usage. Counting them would disqualify
    // exactly the returning player this feature exists for.
    expect(countActiveDays([START - 5 * DAY, START - DAY], START, ENDS)).toBe(0);
    expect(countActiveDays([ENDS + 2 * DAY], START, ENDS)).toBe(0);
  });

  it('discards junk timestamps instead of counting them as a day', () => {
    expect(countActiveDays([NaN, Infinity, -1], START, ENDS)).toBe(0);
  });
});

describe('planTrialExtension', () => {
  it('offers the week to a player who never got out', () => {
    const r = planTrialExtension(base);
    expect(r.eligible).toBe(true);
    expect(r.activeDays).toBe(0);
  });

  it('offers it to a player who got out twice — under the bar is under the bar', () => {
    const r = planTrialExtension({ ...base, activityTimestamps: [day(2), day(9)] });
    expect(r.eligible).toBe(true);
    expect(r.activeDays).toBe(2);
  });

  it('does NOT offer it once they have used it three days', () => {
    const r = planTrialExtension({ ...base, activityTimestamps: [day(1), day(5), day(11)] });
    expect(r.eligible).toBe(false);
    expect(r.activeDays).toBe(LIGHT_USE_DAY_THRESHOLD);
    expect(r.blockedBy).toBe('used_enough');
  });

  it('counts three rounds in one day as ONE day, so that player still qualifies', () => {
    // "Used it 3 times" asks whether they got out with it, not how many times they tapped.
    const d = day(4);
    const r = planTrialExtension({ ...base, activityTimestamps: [d, d + 3600_000, d + 7200_000] });
    expect(r.eligible).toBe(true);
    expect(r.activeDays).toBe(1);
  });

  it('stays quiet in the middle of the trial — day 3 with no rounds is just day 3', () => {
    const r = planTrialExtension({ ...base, now: START + 3 * DAY });
    expect(r.eligible).toBe(false);
    expect(r.blockedBy).toBe('too_early');
  });

  it('opens exactly at the offer window and not before', () => {
    expect(planTrialExtension({ ...base, now: ENDS - OFFER_WINDOW_MS - 1 }).blockedBy).toBe('too_early');
    expect(planTrialExtension({ ...base, now: ENDS - OFFER_WINDOW_MS }).eligible).toBe(true);
  });

  it('still meets the lapsed player when they come back', () => {
    // The return after an unused trial is the best moment this feature has; a paywall wastes it.
    const r = planTrialExtension({ ...base, status: 'expired', now: ENDS + 10 * DAY });
    expect(r.eligible).toBe(true);
  });

  it('stops being an extension a month after it lapsed', () => {
    expect(planTrialExtension({ ...base, status: 'expired', now: ENDS + LAPSED_GRACE_MS }).eligible).toBe(true);
    expect(planTrialExtension({ ...base, status: 'expired', now: ENDS + LAPSED_GRACE_MS + 1 }).blockedBy).toBe('too_late');
  });

  it('is a one-time gesture, not a standing discount', () => {
    const r = planTrialExtension({ ...base, extensionGrantedAt: ENDS - 2 * DAY });
    expect(r.eligible).toBe(false);
    expect(r.blockedBy).toBe('already_granted');
  });

  it('never fires for someone who is already paying or already unlocked', () => {
    for (const status of ['active', 'lifetime', 'free'] as const) {
      expect(planTrialExtension({ ...base, status }).blockedBy).toBe('not_on_trial');
    }
  });

  it('needs a trial clock to reason about', () => {
    expect(planTrialExtension({ ...base, trialStartedAt: null }).blockedBy).toBe('no_trial_clock');
  });

  it('checks already-granted BEFORE status, so a comp cannot re-open the offer', () => {
    // grantTrialExtension sets status 'active'. If status were checked first this would report
    // not_on_trial, which is true but hides the real reason from the debug screen.
    const r = planTrialExtension({ ...base, status: 'active', extensionGrantedAt: ENDS });
    expect(r.blockedBy).toBe('already_granted');
  });
});

describe('describeTrialExtension', () => {
  it('says what the player actually did, without scolding them', () => {
    expect(describeTrialExtension(0)).toBe(
      `Your free trial is up, but you haven't had a chance to get out with it yet. Here's another ${TRIAL_EXTENSION_DAYS} days on us — go play.`,
    );
    expect(describeTrialExtension(1)).toContain('you only got out once');
    expect(describeTrialExtension(2)).toContain('you only got out 2 times');
  });
});
