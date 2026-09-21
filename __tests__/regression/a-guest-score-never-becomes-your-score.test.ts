/**
 * 2026-09-20 (Tim) — "OG version had tabs at the top and I could edit names and we could add putting
 * the players hdcp and an export button but we dont inject the data from that card to the primary
 * user data."
 *
 * That last clause is the requirement this guards. A guest's score must never become the owner's
 * score, and the structural reason it cannot is that the two live in different stores:
 * roundStore.scores is Record<hole, strokes> for ONE person and feeds handicap posting, the recap,
 * the caddie payload and round history. guestCardStore is separate and is read by nothing else.
 *
 * Keeping them apart at the STORE is what makes this true by construction rather than by care.
 * [[two-owners-is-the-root-cause]]
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  useGuestCardStore, grossTotal, netTotal, holesPlayed, MAX_GUEST_CARDS,
} from '../../store/guestCardStore';
import { NEVER_SYNC_STORE_KEYS } from '../../services/cloudSync/neverSyncKeys';
import { NOT_BACKED_UP_STORE_KEYS, BACKED_UP_STORE_KEYS } from '../../services/cloudSync/snapshot';

const ROOT = path.join(__dirname, '../..');
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const store = strip(fs.readFileSync(path.join(ROOT, 'store/guestCardStore.ts'), 'utf8'));
const card = strip(fs.readFileSync(path.join(ROOT, 'components/scorecard/AddedPlayerCards.tsx'), 'utf8'));

beforeEach(() => useGuestCardStore.getState().clearAll());

describe('a guest score never becomes your score', () => {
  it('the guest store never touches the round store', () => {
    expect(store).not.toMatch(/roundStore/);
    expect(store).not.toMatch(/playerProfileStore/);
  });

  it('the card component never writes to the round or the profile', () => {
    // It may READ the owner's scores for the export; it must never set them.
    expect(card).not.toMatch(/setScore\s*\(\s*hole/);
    expect(card).not.toMatch(/useRoundStore/);
    expect(card).not.toMatch(/setHandicapIndex|setRoundScore|usePlayerProfileStore/);
  });

  it('a guest handicap is typed, never borrowed from the owner', () => {
    const { addCard, setHandicap } = useGuestCardStore.getState();
    const g = addCard('Lily')!;
    expect(g.handicapIndex).toBeNull();          // unknown until someone types it
    setHandicap(g.id, 21.4);
    expect(useGuestCardStore.getState().cards[0].handicapIndex).toBe(21.4);
  });

  it('net is null without an Index — no invented handicap to fill a column', () => {
    const { addCard, setScore } = useGuestCardStore.getState();
    const g = addCard('Lily')!;
    setScore(g.id, 1, 6);
    const fresh = () => useGuestCardStore.getState().cards[0];
    expect(netTotal(fresh())).toBeNull();
    useGuestCardStore.getState().setHandicap(g.id, 18);
    expect(netTotal(fresh())).not.toBeNull();
  });

  it('scores round-trip, and zero means not played', () => {
    const { addCard, setScore, bumpScore } = useGuestCardStore.getState();
    const g = addCard('Lily')!;
    setScore(g.id, 1, 5);
    setScore(g.id, 2, 4);
    const fresh = () => useGuestCardStore.getState().cards[0];
    expect(grossTotal(fresh())).toBe(9);
    expect(holesPlayed(fresh())).toBe(2);
    setScore(g.id, 2, 0);                        // emptied
    expect(holesPlayed(fresh())).toBe(1);
    expect(fresh().scores[2]).toBeUndefined();   // absence, not a stored zero
    bumpScore(g.id, 1, -10);                     // cannot go negative
    expect(holesPlayed(fresh())).toBe(0);
  });

  it('a fat-fingered handicap cannot produce a nonsense net', () => {
    const { addCard, setHandicap } = useGuestCardStore.getState();
    const g = addCard('Lily')!;
    setHandicap(g.id, 500);
    expect(useGuestCardStore.getState().cards[0].handicapIndex).toBe(54);
    setHandicap(g.id, -99);
    expect(useGuestCardStore.getState().cards[0].handicapIndex).toBe(-10);
  });

  it('caps the added players', () => {
    const { addCard } = useGuestCardStore.getState();
    for (let i = 0; i < MAX_GUEST_CARDS; i++) expect(addCard(`P${i}`)).not.toBeNull();
    expect(addCard('one too many')).toBeNull();
  });

  it('the app actually CALLS noteCourse — the store function alone is not the feature', () => {
    /**
     * 2026-09-20 (adversarial pass) — it did not. The store function existed, the test below called
     * it directly and passed, and nothing in the app ever invoked it, so scores carried from one
     * course to the next. A test that drives a function the product never calls proves the function
     * works, not that the behaviour happens. [[grep-guards-cant-see-dead-code]]
     */
    const src = fs.readFileSync(path.join(ROOT, 'components/scorecard/AddedPlayerCards.tsx'), 'utf8');
    expect(src).toMatch(/useGuestCardStore\(\(s\) => s\.noteCourse\)/);
    expect(src).toMatch(/useEffect\(\(\) => \{ noteCourse\(courseName\); \}, \[courseName, noteCourse\]\)/);
  });

  it('a new course clears the scores rather than carrying them over', () => {
    const { addCard, setScore, noteCourse } = useGuestCardStore.getState();
    const g = addCard('Lily')!;
    noteCourse('Echo Hills');
    setScore(g.id, 1, 5);
    noteCourse('Menifee Lakes Palms');
    expect(holesPlayed(useGuestCardStore.getState().cards[0])).toBe(0);
  });

  it('a half-typed handicap cannot land on the wrong player', () => {
    /**
     * 2026-09-20 (triple-check of my own code) — `hcpDraft` was a bare string. Typing an Index for
     * one player and switching tabs before the field blurred rendered that draft in the NEXT
     * player's field and committed it to THEM, because the blur handler closes over whatever
     * `active` is by then. One person's handicap silently landed on another's card.
     */
    const src = fs.readFileSync(path.join(ROOT, 'components/scorecard/AddedPlayerCards.tsx'), 'utf8');
    expect(src).toMatch(/useState<\{ id: string; text: string \} \| null>\(null\)/);
    expect(src).toMatch(/hcpDraft\?\.id === active\.id \? hcpDraft\.text/);
    expect(src).toMatch(/if \(hcpDraft && hcpDraft\.id === active\.id\)/);
    expect(src).toMatch(/setHcpDraft\(null\); setEditingName\(null\); setActiveTab/);
    // ...and the Index field must not key its display off the NAME editor
    expect(src).not.toMatch(/hcpDraft !== null && editingName === null/);
  });

  it('other people’s scores never leave the device', () => {
    expect(NEVER_SYNC_STORE_KEYS).toContain('guest-cards-v1');
    expect(NOT_BACKED_UP_STORE_KEYS).toContain('guest-cards-v1');
    expect(BACKED_UP_STORE_KEYS).not.toContain('guest-cards-v1');
  });
});
