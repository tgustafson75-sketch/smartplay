/**
 * 2026-10-15 (review) — the guest scorecards (guestCardStore) had two holes:
 *  - scores were cleared only when the COURSE label changed, so the same course next week reopened
 *    last week's guest scores on the new card;
 *  - the scorecard passed the whole COURSE's holes, so a nine at an 18-hole course gave the guest card
 *    18 holes and its net used the full 18-hole handicap allowance on a nine.
 */
import * as fs from 'fs';
import * as path from 'path';
import { useGuestCardStore } from '../../store/guestCardStore';
// Typed loosely so this compiles (and fails on behaviour) against the pre-fix one-argument signature.
const note = (label: string, roundId: string) =>
  (useGuestCardStore.getState().noteCourse as unknown as (l: string, r: string) => void)(label, roundId);

describe('a guest card belongs to one round', () => {
  beforeEach(() => useGuestCardStore.getState().clearAll());

  it('a new round on the SAME course starts the guests\' scores clean, keeping names and Indexes', () => {
    const st = useGuestCardStore.getState();
    note('Echo Hills', 'round-1');
    const card = st.addCard('Mia')!;
    st.setHandicap(card.id, 18);
    st.setScore(card.id, 1, 6);
    note('Echo Hills', 'round-2');
    const after = useGuestCardStore.getState().cards[0];
    expect(after.scores).toEqual({});
    expect(after.name).toBe('Mia');
    expect(after.handicapIndex).toBe(18);
  });

  it('the same round (live, then just finished) keeps them', () => {
    const st = useGuestCardStore.getState();
    note('Echo Hills', 'round-1');
    const card = st.addCard('Mia')!;
    st.setScore(card.id, 1, 6);
    note('Echo Hills', 'round-1');
    expect(useGuestCardStore.getState().cards[0].scores).toEqual({ 1: 6 });
  });

  it('the scorecard hands the guest card the ROUND\'s holes and the round id', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/scorecard.tsx'), 'utf8');
    const block = src.slice(src.indexOf('<AddedPlayerCards'), src.indexOf('/>', src.indexOf('<AddedPlayerCards')));
    expect(block).toMatch(/effectiveNineHoleMode\s*\n?\s*\?\s*viewCourseHoles\.filter/);
    expect(block).toMatch(/roundId=\{viewingRoundId\}/);
  });
});
