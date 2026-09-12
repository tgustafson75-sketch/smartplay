/**
 * 2026-09-11 (Tim) — "Each club, part of its characteristics is if you need to do work on that
 * club. If it's a strong club or something you're consistently making errors [with], you need to
 * kinda specifically work around your mindset and approach to that club."
 *
 * The app knew what a club DID (clubTendency: draws, misses right) and, separately, how well it was
 * struck (the shot log's `feel`) and what it cost (`outcome` / `penalty_strokes`). Nothing joined
 * them, so a ladder row could tell you your 5 wood draws and never that you are fat with it half
 * the time. A shape is not a verdict.
 */
import {
  clubWorkStatuses, clubsNeedingWork, strongClubs, describeClubWork,
  MIN_WORK_SHOTS, POOR_STRIKE, GOOD_STRIKE, COSTLY_PENALTY_RATE, type WorkShot,
} from '../../services/clubWork';

const id = (c: string | null | undefined) => c ?? null;
const shots = (club: string, feels: WorkShot['feel'][], extra: Partial<WorkShot> = {}): WorkShot[] =>
  feels.map((feel) => ({ club, feel, ...extra }));

describe('the honesty bar', () => {
  it('refuses to judge a club off a handful of swings', () => {
    const [w] = clubWorkStatuses({ shots: shots('3I', ['fat', 'fat', 'thin']), normalize: id });
    expect(w.n).toBeLessThan(MIN_WORK_SHOTS);
    expect(w.status).toBe('unproven');
    expect(w.practice).toBeNull();
    expect(w.mindset).toBeNull();
    expect(w.line).toContain('not enough');
  });

  it('gives an owned-but-unswung club an honest empty row rather than dropping it', () => {
    const out = clubWorkStatuses({ shots: [], normalize: id, clubs: ['5W'] });
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('unproven');
    expect(out[0].n).toBe(0);
    expect(out[0].line).toContain('no swings logged');
  });

  it('says nothing at all when nothing is proven', () => {
    expect(describeClubWork(clubWorkStatuses({ shots: shots('3I', ['fat', 'fat']), normalize: id }))).toBeNull();
  });
});

describe('a club struck badly is a PRACTICE problem', () => {
  const out = clubWorkStatuses({
    shots: shots('5W', ['fat', 'thin', 'fat', 'solid', 'topped', 'fat', 'thin', 'flush']),
    normalize: id,
  });
  const w = out[0];

  it('is called out', () => {
    expect(w.status).toBe('needs_work');
    expect(w.strikeRate).toBeLessThan(POOR_STRIKE);
  });

  it('gets strike practice, because the mis-hits are fat and thin', () => {
    expect(w.practice).toContain('Strike work');
    expect(w.practice).toContain('low point');
  });

  it('gets a mindset, not just a diagnosis — that was the whole ask', () => {
    expect(w.mindset).toContain('Three-quarter');
  });
});

describe('and a club that keeps finding trouble is NOT', () => {
  const out = clubWorkStatuses({
    shots: [
      ...shots('Driver', ['flush', 'flush', 'solid', 'flush'], {}),
      ...shots('Driver', ['flush', 'solid'], { outcome: 'ob' }),
      ...shots('Driver', ['flush'], { outcome: 'water' }),
      ...shots('Driver', ['solid'], { penalty_strokes: 1 }),
    ],
    normalize: id,
  });
  const w = out[0];

  it('is called out even though he strikes it beautifully', () => {
    expect(w.strikeRate).toBe(1);
    expect(w.penaltyRate).toBeGreaterThanOrEqual(COSTLY_PENALTY_RATE);
    expect(w.status).toBe('needs_work');
  });

  it('is told it is not a swing fault — telling him to go hit balls would be the wrong advice', () => {
    expect(w.practice).toContain('Not a swing fault');
    expect(w.practice).not.toContain('Strike work');
  });

  it('gets a decision to make on the course, not a drill', () => {
    expect(w.mindset).toContain('where a bad one goes');
  });
});

describe('a strong club', () => {
  const out = clubWorkStatuses({
    shots: shots('7I', ['flush', 'flush', 'solid', 'pure', 'flush', 'thin', 'solid', 'flush']),
    normalize: id,
  });
  const w = out[0];

  it('is named', () => {
    expect(w.strikeRate).toBeGreaterThanOrEqual(GOOD_STRIKE);
    expect(w.status).toBe('strong');
    expect(w.practice).toBeNull();
  });

  it('still gets a mindset — the mistake with a good club is not using it', () => {
    expect(w.mindset).toContain('Trust it');
    expect(w.mindset).toContain('7I');
  });
});

describe('what the shot log does and does not count', () => {
  it('an absent outcome is NOT a penalty — every pre-migration shot lacks one', () => {
    // If absence read as trouble, the whole bag of every long-standing user would have gone red on
    // the day this shipped. The store's own migration note treats an absent outcome as clean.
    const [w] = clubWorkStatuses({ shots: shots('8I', ['flush', 'flush', 'solid', 'flush', 'solid', 'pure']), normalize: id });
    expect(w.penaltyRate).toBe(0);
  });

  it('an ungraded feel lowers nothing — it is silence, not a mis-hit', () => {
    const [w] = clubWorkStatuses({
      shots: [...shots('8I', ['flush', 'flush', 'solid']), ...shots('8I', [null, null, null])],
      normalize: id,
    });
    expect(w.strikeN).toBe(3);
    expect(w.strikeRate).toBe(1);
  });

  it('aggregates one club logged three different ways through the normalizer', () => {
    const norm = (c: string | null | undefined) => (c ? c.toLowerCase().replace(/[^a-z0-9]/g, '') : null);
    const out = clubWorkStatuses({
      shots: [
        ...shots('Driver', ['flush', 'flush']),
        ...shots('driver', ['solid', 'flush']),
        ...shots('DRIVER', ['flush', 'solid']),
      ],
      normalize: norm,
    });
    expect(out).toHaveLength(1);
    expect(out[0].n).toBe(6);
  });
});

describe('the lists the surfaces read', () => {
  const all = clubWorkStatuses({
    shots: [
      ...shots('7I', ['flush', 'flush', 'solid', 'pure', 'flush', 'flush']),
      ...shots('5W', ['fat', 'thin', 'fat', 'topped', 'fat', 'solid']),
      ...shots('9I', ['flush', 'solid', 'thin', 'solid', 'flush', 'thin']),
    ],
    normalize: id,
  });

  it('separates them', () => {
    expect(strongClubs(all).map((w) => w.club)).toEqual(['7I']);
    expect(clubsNeedingWork(all).map((w) => w.club)).toEqual(['5W']);
    expect(all.find((w) => w.club === '9I')?.status).toBe('steady');
  });

  it('summarises both halves in one line', () => {
    const line = describeClubWork(all);
    expect(line).toContain('7I');
    expect(line).toContain('5W');
  });
});
