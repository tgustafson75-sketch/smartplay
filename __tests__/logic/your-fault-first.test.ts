/**
 * 2026-08-25 — the Drills grid must lead with the player's OWN most frequent fault, and must stay
 * silent rather than guess. SmartMotion records CanonicalIssue ids, the same ids the drill catalog
 * is keyed by, so this is a lookup — never a mapping from ball flight onto a swing fault.
 */
import { yourFaultFirst, MIN_FAULTS } from '../../services/practice/yourFaultFirst';

const IDS = ['over_the_top', 'club_face_open', 'early_extension'];
const title = (id: string) => ({ over_the_top: 'Over the Top', club_face_open: 'Open Clubface', early_extension: 'Early Extension' } as Record<string, string>)[id] ?? null;

describe('the drills grid leads with the player\'s own fault', () => {
  it('stays silent until there are enough reads to mean something', () => {
    const faults = Array(MIN_FAULTS - 1).fill('over_the_top');
    expect(yourFaultFirst({ dominantMiss: 'over_the_top', recentFaults: faults }, IDS, title)).toBeNull();
  });

  it('says nothing for a player who has never recorded a fault', () => {
    expect(yourFaultFirst(null, IDS, title)).toBeNull();
    expect(yourFaultFirst({ dominantMiss: null, recentFaults: [] }, IDS, title)).toBeNull();
  });

  it('names the dominant fault with a real frequency', () => {
    const r = yourFaultFirst(
      { dominantMiss: 'over_the_top', recentFaults: ['over_the_top', 'club_face_open', 'over_the_top', 'over_the_top'] },
      IDS, title,
    );
    expect(r?.id).toBe('over_the_top');
    expect(r?.count).toBe(3);
    expect(r?.total).toBe(4);
    expect(r?.line).toMatch(/3 of your last 4 reads/);
  });

  it('refuses a fault the catalog has no drill for, rather than pointing at nothing', () => {
    const r = yourFaultFirst(
      { dominantMiss: 'some_fault_with_no_card', recentFaults: ['some_fault_with_no_card', 'some_fault_with_no_card', 'some_fault_with_no_card'] },
      IDS, title,
    );
    expect(r).toBeNull();
  });
});
