/**
 * 2026-09-17 (Tim) — "my daughter is actually using 18Birdies for one reason and one reason only.
 * And that's on their rest screen. She can still see the yardage."
 *
 * The rest overlay paints pure black over every screen to save the OLED, and the one number the
 * player wants went with it — while GPS, the round and the yardage resolver all kept running
 * underneath. The number was being computed and then covered up.
 *
 * Two things have to hold, and the second is the one that will break quietly:
 *
 *  1. ONE OWNER. app/(tabs)/caddie.tsx resolves the yardage; the overlay mirrors what it published.
 *     If the overlay ever computes its own, the player gets two answers to "how far is it" and the
 *     rest screen can contradict the strip he just looked at. [[two-owners-is-the-root-cause]]
 *  2. STALE IS NOT SHOWN. The publisher is a SCREEN, and rest engages on ANY route after a minute
 *     idle — including routes reached without ever opening the caddie tab. A yardage from three
 *     holes ago, displayed with nothing else on screen to contradict it, is not a stale number. It
 *     is a wrong one, shown at the moment the player is most likely to trust it.
 *
 * freshReadout is pure and tested directly because the REFUSALS are the point, and a render test is
 * worst at reaching exactly those cases. [[a-read-cannot-outlive-its-shot]]
 */

import {
  freshReadout,
  REST_READOUT_STALE_MS,
  useRestReadoutStore,
} from '../../store/restReadoutStore';

const NOW = 1_700_000_000_000;
const at = (ageMs: number) => NOW - ageMs;

describe('the rest screen shows a live yardage, or it shows nothing', () => {
  beforeEach(() => useRestReadoutStore.getState().clear());

  it('shows a number the caddie screen published moments ago', () => {
    const r = freshReadout({ yardage: 147, playsLike: 152, hole: 7, updatedAt: at(3_000) }, NOW);
    expect(r?.yardage).toBe(147);
    expect(r?.playsLike).toBe(152);
  });

  it('refuses a reading older than the stale window', () => {
    // The walk-to-the-next-tee case, and the never-opened-the-caddie-tab case.
    expect(freshReadout({ yardage: 147, playsLike: null, hole: 7, updatedAt: at(REST_READOUT_STALE_MS + 1) }, NOW)).toBeNull();
  });

  it('holds a reading that is old but still inside the window', () => {
    expect(freshReadout({ yardage: 147, playsLike: null, hole: 7, updatedAt: at(REST_READOUT_STALE_MS - 1) }, NOW)).not.toBeNull();
  });

  it('refuses when nothing has ever been published — updatedAt 0 is not "the epoch"', () => {
    // The trap: `now - 0` is enormous, so a naive comparison happens to work. Make it explicit, so
    // it keeps working if the window is ever widened.
    expect(freshReadout({ yardage: 147, playsLike: null, hole: 7, updatedAt: 0 }, NOW)).toBeNull();
  });

  it('refuses when the round is live but there is no number yet', () => {
    // Pre-first-fix. "—" is the strip's business; the rest screen simply says nothing.
    expect(freshReadout({ yardage: null, playsLike: null, hole: 1, updatedAt: at(1_000) }, NOW)).toBeNull();
  });

  it('publish stamps the time, so a freshness check has something to read', () => {
    const before = Date.now();
    useRestReadoutStore.getState().publish({ yardage: 210, playsLike: 205, hole: 3 });
    const s = useRestReadoutStore.getState();
    expect(s.yardage).toBe(210);
    expect(s.updatedAt).toBeGreaterThanOrEqual(before);
    expect(freshReadout(s)).not.toBeNull();
  });

  it('clear wipes the stamp, not just the number — ending a round must not leave a fresh null', () => {
    useRestReadoutStore.getState().publish({ yardage: 210, playsLike: null, hole: 3 });
    useRestReadoutStore.getState().clear();
    const s = useRestReadoutStore.getState();
    expect(s.updatedAt).toBe(0);
    expect(freshReadout(s)).toBeNull();
  });
});

describe('the caddie screen stays the only place a yardage is worked out', () => {
  it('the rest overlay never calls a yardage resolver of its own', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../components/round/RestModeOverlay.tsx'), 'utf8',
    );
    // Not a style rule: any of these appearing here means a SECOND answer to "how far is it" now
    // exists, on the one screen where the player has nothing to check it against.
    for (const forbidden of ['resolveYardage', 'getGreenYardagesSync', 'caddieDecision', 'yardageSource', 'decideShot']) {
      expect(src).not.toContain(forbidden);
    }
  });
});
