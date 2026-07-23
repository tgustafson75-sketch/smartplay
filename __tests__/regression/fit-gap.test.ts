/**
 * Fit Gap (Bag Vision Phase 2) — cross-references the OWNED bag against distance gaps so the
 * advice is honest about ownership: dial-in vs buy, fillable vs unfilled, redundant. Pinned here.
 */
import { composeFitGap, type OwnedClub } from '../../services/practice/fitGap';
import type { FitGap, FitOverlap } from '../../services/practice/fitProfile';

const CLUB_ORDER = [
  'Driver', '3W', '5W', '7W', '2H', '3H', '4H',
  '3I', '4I', '5I', '6I', '7I', '8I', '9I',
  'PW', 'GW', 'SW', 'LW', 'Putter',
] as const;

const owned = (club_id: string, name: string | null, extra: Partial<OwnedClub> = {}): OwnedClub => ({ club_id, name, ...extra });

describe('composeFitGap', () => {
  it('flags an owned but undialed club', () => {
    const r = composeFitGap({
      owned: [owned('7I', '7I', { brand: 'Ping', model: 'i230' })],
      gaps: [], overlaps: [],
      hasDistance: () => false,
      clubOrder: CLUB_ORDER,
    });
    const f = r.findings.find((x) => x.kind === 'undialed');
    expect(f).toBeTruthy();
    expect(f!.title).toContain('Ping i230');
    expect(r.dialedCount).toBe(0);
    expect(r.ownedCount).toBe(1);
  });

  it('calls a gap FILLABLE when an owned club sits between the bounds', () => {
    // Gap between 4I and 6I; player owns a 5I (undialed) that sits between them.
    const gaps: FitGap[] = [{ lower: '6I', upper: '4I', gapYards: 30, centerYards: 180 }];
    const r = composeFitGap({
      owned: [owned('4I', '4I'), owned('5I', '5I'), owned('6I', '6I')],
      gaps, overlaps: [],
      hasDistance: (n) => n === '4I' || n === '6I', // 5I undialed
      clubOrder: CLUB_ORDER,
    });
    const f = r.findings.find((x) => x.kind === 'fillable_gap');
    expect(f).toBeTruthy();
    expect(f!.detail).toContain('5I');
  });

  it('calls a gap UNFILLED when nothing owned sits between the bounds', () => {
    const gaps: FitGap[] = [{ lower: '6I', upper: '4I', gapYards: 30, centerYards: 180 }];
    const r = composeFitGap({
      owned: [owned('4I', '4I'), owned('6I', '6I')], // no 5I owned
      gaps, overlaps: [],
      hasDistance: () => true,
      clubOrder: CLUB_ORDER,
    });
    expect(r.findings.some((x) => x.kind === 'unfilled_gap')).toBe(true);
    expect(r.findings.some((x) => x.kind === 'fillable_gap')).toBe(false);
  });

  it('flags redundancy only when BOTH overlapping clubs are owned', () => {
    const overlaps: FitOverlap[] = [{ shorter: 'GW', longer: 'PW', gapYards: 6 }];
    const both = composeFitGap({
      owned: [owned('PW', 'PW'), owned('GW', 'GW')],
      gaps: [], overlaps,
      hasDistance: () => true,
      clubOrder: CLUB_ORDER,
    });
    expect(both.findings.some((x) => x.kind === 'redundant')).toBe(true);

    const one = composeFitGap({
      owned: [owned('PW', 'PW')], // only one of the pair owned
      gaps: [], overlaps,
      hasDistance: () => true,
      clubOrder: CLUB_ORDER,
    });
    expect(one.findings.some((x) => x.kind === 'redundant')).toBe(false);
  });

  it('excludes the putter from full-swing counts', () => {
    const r = composeFitGap({
      owned: [owned('PT', null), owned('7I', '7I')],
      gaps: [], overlaps: [],
      hasDistance: () => true,
      clubOrder: CLUB_ORDER,
    });
    expect(r.ownedCount).toBe(1);
  });
});
