/**
 * 2026-09-14 — the v1 → v2 bag migration, verified by RUNNING it rather than by reading it.
 *
 * APP-BUILD-RULES B1: there is no install base to protect, but "persisted-state migrations still
 * matter for Tim's own device". His phone holds a `club-bag-v1` blob in the OLD shape — flat brand /
 * model / loft on each slot. If the migration drops them, his bag silently loses every spec the
 * scan ever read, and the failure looks exactly like the bug this whole session is about.
 *
 * The STORE KEY stays `club-bag-v1` deliberately (renaming it strands the blob); only the `version`
 * field moves to 2.
 */
import { useClubBagStore, specsOf, inPlayVariant } from '../../store/clubBagStore';

/** The migrate function as the persist middleware will call it. */
const migrate = (useClubBagStore as unknown as {
  persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown } };
}).persist.getOptions().migrate!;

describe('a v1 bag survives the move to variants', () => {
  const V1 = {
    clubs: {
      DR: { club_id: 'DR', registered_at: 111, source: 'camera', brand: 'TaylorMade', model: 'Stealth 2', loft: '10.5°' },
      '7I': { club_id: '7I', registered_at: 222, source: 'voice' },                 // known club, no specs
      SW:  { club_id: 'SW', registered_at: 333, source: 'camera', loft: '56°', note: 'bent 1° strong' },
    },
    carriedToday: ['DR', '7I'],
  };

  it('turns flat specs into the slot\'s first variant, and loses nothing', () => {
    const out = migrate(JSON.parse(JSON.stringify(V1)), 1) as typeof useClubBagStore extends never ? never
      : { clubs: Record<string, Parameters<typeof specsOf>[0]>; carriedToday: string[] };

    const dr = out.clubs.DR!;
    expect(specsOf(dr)).toMatchObject({ brand: 'TaylorMade', model: 'Stealth 2', loft: '10.5°' });
    expect(inPlayVariant(dr)?.label).toBe('Stealth 2');
    expect(dr.registered_at).toBe(111);              // provenance preserved, not restamped to now
    expect(dr.source).toBe('camera');

    // A club that knew nothing keeps knowing nothing — it does NOT gain a blank variant.
    expect(out.clubs['7I']!.variants).toHaveLength(0);
    expect(inPlayVariant(out.clubs['7I']!)).toBeNull();

    // Loft-only survives, and the note is NOT swallowed into the variant.
    expect(specsOf(out.clubs.SW!).loft).toBe('56°');
    expect(out.clubs.SW!.note).toBe('bent 1° strong');

    // The Sunday bag is untouched.
    expect(out.carriedToday).toEqual(['DR', '7I']);
  });

  it('is idempotent — a v2 blob passes through unchanged', () => {
    const v2 = migrate(JSON.parse(JSON.stringify(V1)), 1) as { clubs: Record<string, unknown> };
    const again = migrate(JSON.parse(JSON.stringify(v2)), 2) as { clubs: Record<string, unknown> };
    expect(again.clubs).toEqual(v2.clubs);
  });

  it('keeps the persisted key — renaming it would strand every club on the device', () => {
    const opts = (useClubBagStore as unknown as { persist: { getOptions: () => { name: string; version: number } } })
      .persist.getOptions();
    expect(opts.name).toBe('club-bag-v1');
    expect(opts.version).toBe(2);
  });
});
