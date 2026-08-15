/**
 * 2026-08-14 — watch-confirmed shots. Tim: "a swing is confirmatory of that final stopping spot as
 * well as timing, but not messing up the logic."
 *
 * The last clause is the one under test as hard as the matching: this must never change the shots.
 */
import {
  confirmShotsWithSwings, confirmationSummary, CONFIRM_WINDOW_MS,
} from '../../services/round/shotSwingConfirm';

const T = 1_700_000_000_000;
const shot = (t: number, hole = 1, club: string | null = '7 iron') => ({ timestamp: t, hole, club });
const swing = (t: number, hole: number | null = 1, club: string | null = '7 iron', tempoRatio = 3.0) =>
  ({ timestamp: t, hole, club, tempoRatio });

describe('watch swings confirm GPS shots', () => {
  it('confirms a shot when a swing sits beside it in time', () => {
    const [c] = confirmShotsWithSwings([shot(T)], [swing(T - 20_000)]);
    expect(c.confirmed).toBe(true);
    expect(c.deltaMs).toBe(20_000);
    expect(c.tempoRatio).toBe(3.0);
  });

  it('does NOT confirm a cart stop — a stop with no swing near it stays unconfirmed', () => {
    const [c] = confirmShotsWithSwings([shot(T)], [swing(T - 10 * 60_000)]);
    expect(c.confirmed).toBe(false);
    expect(c.deltaMs).toBeNull();
  });

  it('never lets two shots claim the SAME swing', () => {
    // Two stops seconds apart (GPS jitter) with only one real swing between them.
    const res = confirmShotsWithSwings([shot(T), shot(T + 5_000)], [swing(T)]);
    expect(res.filter((c) => c.confirmed)).toHaveLength(1);
  });

  it('respects the hole tag over mere closeness in time', () => {
    // A swing stamped on hole 2 cannot confirm a hole 1 shot, however close.
    const [c] = confirmShotsWithSwings([shot(T, 1)], [swing(T, 2)]);
    expect(c.confirmed).toBe(false);
  });

  it('an untagged swing (off-round capture) can still match on time', () => {
    const [c] = confirmShotsWithSwings([shot(T, 1)], [swing(T, null)]);
    expect(c.confirmed).toBe(true);
  });

  it('picks the NEAREST swing, not the first one in range', () => {
    const [c] = confirmShotsWithSwings([shot(T)], [swing(T - 80_000), swing(T - 3_000)]);
    expect(c.deltaMs).toBe(3_000);
  });

  it('surfaces the club the WATCH saw, which can differ from the logged club', () => {
    const [c] = confirmShotsWithSwings([shot(T, 1, '7 iron')], [swing(T, 1, '8 iron')]);
    expect(c.swingClub).toBe('8 iron');
  });

  it('is NON-DESTRUCTIVE: one entry per shot, same order, nothing added or dropped', () => {
    const shots = [shot(T), shot(T + 200_000), shot(T + 400_000)];
    const res = confirmShotsWithSwings(shots, [swing(T + 200_000)]);
    expect(res).toHaveLength(shots.length);
    expect(res.map((c) => c.shotIndex)).toEqual([0, 1, 2]);
    expect(res[1].confirmed).toBe(true);
    expect(res[0].confirmed).toBe(false);
    expect(res[2].confirmed).toBe(false);
  });

  it('no swings at all (watch off) leaves every shot untouched and unconfirmed', () => {
    const res = confirmShotsWithSwings([shot(T), shot(T + 1000)], []);
    expect(res.every((c) => !c.confirmed)).toBe(true);
    expect(confirmationSummary(res)).toBeNull();
  });

  it('the window boundary is inclusive, and beyond it is not', () => {
    expect(confirmShotsWithSwings([shot(T)], [swing(T - CONFIRM_WINDOW_MS)])[0].confirmed).toBe(true);
    expect(confirmShotsWithSwings([shot(T)], [swing(T - CONFIRM_WINDOW_MS - 1)])[0].confirmed).toBe(false);
  });

  it('summarises honestly, and says nothing when nothing was confirmed', () => {
    const res = confirmShotsWithSwings([shot(T), shot(T + 300_000)], [swing(T)]);
    expect(confirmationSummary(res)).toBe('1 of 2 shots confirmed by your watch');
  });
});
