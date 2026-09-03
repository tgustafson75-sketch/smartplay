/**
 * 2026-09-03 — referral rewards ADD to a comp; they do not replace it.
 *
 * grantPromo sets promo_expires_at to `now + days`, which is correct for a one-off grant and wrong
 * for a reward that can arrive more than once. A player who earns a second 30 days while 20 remain
 * would have been reset to 30 — silently losing 20 days they had already been given, with no error
 * anywhere and no way for them to notice except by counting.
 *
 * extendPromo is the version that can be called repeatedly. These pin the two cases that differ:
 * stacking onto live days, and restarting cleanly from an expired one (never back-dating).
 */
import { usePlayerProfileStore } from '../../store/playerProfileStore';

const DAY = 24 * 60 * 60 * 1000;

describe('extendPromo', () => {
  beforeEach(() => {
    usePlayerProfileStore.setState({ promo_expires_at: null, subscription_status: 'free' });
  });

  it('adds to the days already banked instead of overwriting them', () => {
    const now = Date.now();
    // 20 days still to run.
    usePlayerProfileStore.setState({ promo_expires_at: now + 20 * DAY });
    usePlayerProfileStore.getState().extendPromo(30);
    const after = usePlayerProfileStore.getState().promo_expires_at!;
    // 50 days out, not 30 — the old grantPromo behaviour would have produced ~30.
    expect(Math.round((after - now) / DAY)).toBe(50);
  });

  it('stacks repeatedly, so a run of referrals all count', () => {
    const now = Date.now();
    const s = usePlayerProfileStore.getState();
    s.extendPromo(30);
    s.extendPromo(30);
    s.extendPromo(30);
    const after = usePlayerProfileStore.getState().promo_expires_at!;
    expect(Math.round((after - now) / DAY)).toBe(90);
  });

  it('restarts from NOW when the previous comp already expired — never back-dates', () => {
    const now = Date.now();
    usePlayerProfileStore.setState({ promo_expires_at: now - 10 * DAY });
    usePlayerProfileStore.getState().extendPromo(30);
    const after = usePlayerProfileStore.getState().promo_expires_at!;
    // Extending from the stale expiry would have produced 20 days, a fifth of it already spent.
    expect(Math.round((after - now) / DAY)).toBe(30);
  });

  it('unlocks the app, because a comp the ladder cannot see buys nothing', () => {
    usePlayerProfileStore.getState().extendPromo(30);
    expect(usePlayerProfileStore.getState().subscription_status).toBe('active');
  });

  it('refuses to shrink a comp with a zero or negative grant', () => {
    const now = Date.now();
    usePlayerProfileStore.setState({ promo_expires_at: now + 20 * DAY });
    usePlayerProfileStore.getState().extendPromo(0);
    const after = usePlayerProfileStore.getState().promo_expires_at!;
    expect(after).toBeGreaterThan(now + 20 * DAY);
  });
});
