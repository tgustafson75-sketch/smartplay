/**
 * 2026-08-26 (Tim — "make sure the caddie has full context of everything in the app").
 *
 * WHAT IS IN THE BAG never reached a brain. clubBagStore is written by the Smart Motion camera club
 * scan, by Bag Vision, and by the caddie's OWN `register_bag` tool — so the caddie registered a bag
 * it could not read back. Its accessor is even annotated "for display + brain context"; it reached
 * the dashboard and two services and no brain.
 *
 * The consequence was not cosmetic. The club lookup reads `clubDistances`, which holds only clubs
 * with a MEASURED carry, so a club the player told us they carry but has not logged a shot with was
 * invisible — and nothing stopped the caddie naming a club they no longer carry but still have
 * history for.
 */
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useClubBagStore } from '../../store/clubBagStore';

describe('the registered bag reaches the caddie', () => {
  beforeEach(() => { useClubBagStore.getState().clearBag(); });

  it('emits the key even with an empty bag, so "this path forgot to send it" is not expressible', () => {
    const body = buildCaddieRequestBody({ message: 'what club', language: 'en' }) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, 'bagClubs')).toBe(true);
    expect(body.bagClubs).toEqual([]);
  });

  it('carries every registered club', () => {
    useClubBagStore.getState().registerClub('7I', { source: 'camera' });
    useClubBagStore.getState().registerClub('DR', { source: 'camera' });
    const body = buildCaddieRequestBody({ message: 'what club', language: 'en' }) as Record<string, unknown>;
    /**
     * 2026-09-17 — NAMES, not ids, and this assertion moving is the point rather than a casualty.
     *
     * api/kevin.ts sets bagClubs against clubDistances to decide which clubs have no measured carry
     * and which were left at home. clubDistances is keyed by ClubName, so sending ClubIds meant the
     * driver — the only club whose id and name differ — was reported to the caddie as BOTH
     * unmeasured and left at home, on every question, for every player carrying one. The prompt
     * then forbids recommending a club that is not in the bag, so the driver was barred from every
     * tee shot. The wire now carries one vocabulary.
     */
    expect(body.bagClubs).toEqual(expect.arrayContaining(['7I', 'Driver']));
    expect(body.bagClubs).not.toContain('DR');
  });

  it('and the putter is named, not left as a raw id', () => {
    // clubIdToClubName returns null for PT by design; a display name is a third, separate question.
    useClubBagStore.getState().registerClub('PT', { source: 'camera' });
    const body = buildCaddieRequestBody({ message: 'what club', language: 'en' }) as Record<string, unknown>;
    expect(body.bagClubs).toContain('Putter');
  });

  it('is a bag, not a distance table — a club with no measured carry still appears', () => {
    // The whole point: clubDistances only knows clubs with data. A freshly scanned club has none,
    // and must still be visible to the caddie as something the player carries.
    useClubBagStore.getState().registerClub('4H', { source: 'camera' });
    const body = buildCaddieRequestBody({ message: 'what club', language: 'en' }) as Record<string, unknown>;
    expect(body.bagClubs).toContain('4H');
    expect(Object.keys(body.clubDistances as Record<string, number>)).not.toContain('4H');
  });

  it('the server reads the key and renders it — a payload field nothing consumes is the bug, not the fix', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const kevin = fs.readFileSync(path.resolve(__dirname, '../../api/kevin.ts'), 'utf-8');
    expect(kevin).toMatch(/bagClubs = \[\],/);                       // destructured from the body
    expect(kevin).toMatch(/\[CLUBS IN THE BAG\]/);                   // rendered into the prompt
    expect(kevin).toMatch(/\$\{bagClubsBlock\}/);                    // and actually concatenated in
    // and it must never invent a yardage for an unmeasured club
    expect(kevin).toMatch(/never invent a yardage/);
  });
});
