/**
 * 2026-07-29 (Tim — Arccos Air trial) — the Arccos screenshot → bag mapping is where a mis-read or a
 * wrong UNIT would silently corrupt the learned bag (a tee→rest TOTAL stored as a CARRY the player
 * must fly a hazard). These lock the honest boundary: canonical clubs only, no Putter, sane yardages,
 * one entry per club, and the unit resolved correctly (Arccos's default average is a TOTAL).
 */
import {
  arccosRowsToBagUpdates,
  parseArccosApiResponse,
  type ArccosRow,
} from '../../services/arccosImport';

const rows = (...r: Array<[string, number]>): ArccosRow[] =>
  r.map(([club_id, yards]) => ({ club_id, yards, confidence: 'high' as const }));

describe('arccosRowsToBagUpdates — unit resolution', () => {
  it('carry kind → carry unit', () => {
    expect(arccosRowsToBagUpdates(rows(['7I', 150]), 'carry')[0].unit).toBe('carry');
  });
  it('total kind → total unit', () => {
    expect(arccosRowsToBagUpdates(rows(['7I', 150]), 'total')[0].unit).toBe('total');
  });
  it('unknown kind defaults to total (Arccos default average includes roll)', () => {
    expect(arccosRowsToBagUpdates(rows(['7I', 150]), 'unknown')[0].unit).toBe('total');
  });
  it('unitOverride wins over the detected kind', () => {
    expect(arccosRowsToBagUpdates(rows(['7I', 150]), 'total', 'carry')[0].unit).toBe('carry');
  });
});

describe('arccosRowsToBagUpdates — canonical clubs + honesty', () => {
  it('normalizes catalog ids to ClubName', () => {
    const out = arccosRowsToBagUpdates(rows(['DR', 265], ['7I', 150], ['GW', 95]), 'total');
    expect(out.map((u) => u.club)).toEqual(['Driver', '7I', 'GW']);
  });
  it('drops the Putter (no full-shot distance)', () => {
    expect(arccosRowsToBagUpdates(rows(['PT', 20], ['7I', 150]), 'total').map((u) => u.club)).toEqual(['7I']);
  });
  it('drops unresolvable club ids', () => {
    expect(arccosRowsToBagUpdates(rows(['XYZ', 150], ['7I', 150]), 'total').map((u) => u.club)).toEqual(['7I']);
  });
  it('dedupes by club — first legible read wins', () => {
    const out = arccosRowsToBagUpdates(rows(['7I', 150], ['7I', 148]), 'total');
    expect(out).toHaveLength(1);
    expect(out[0].yards).toBe(150);
  });
  it('rejects implausible yardages (0, negative, absurd)', () => {
    const out = arccosRowsToBagUpdates(rows(['Driver', 0], ['3W', -5], ['5I', 999], ['7I', 150]), 'total');
    expect(out.map((u) => u.club)).toEqual(['7I']);
  });
  it('rounds fractional yards', () => {
    expect(arccosRowsToBagUpdates(rows(['7I', 150.6]), 'total')[0].yards).toBe(151);
  });
});

describe('parseArccosApiResponse — tolerant parsing', () => {
  it('parses a well-formed body', () => {
    const r = parseArccosApiResponse({ distance_kind: 'total', clubs: [{ club_id: '7I', yards: 150, confidence: 'high' }] });
    expect(r.distance_kind).toBe('total');
    expect(r.rows).toEqual([{ club_id: '7I', yards: 150, confidence: 'high' }]);
  });
  it('falls back to unknown kind + empty rows on junk', () => {
    expect(parseArccosApiResponse(null)).toEqual({ distance_kind: 'unknown', rows: [] });
    expect(parseArccosApiResponse({ distance_kind: 'nonsense', clubs: 'x' })).toEqual({ distance_kind: 'unknown', rows: [] });
  });
  it('drops rows with no legible yardage', () => {
    const r = parseArccosApiResponse({ distance_kind: 'carry', clubs: [{ club_id: '7I', yards: 0 }, { club_id: '8I', yards: 138 }] });
    expect(r.rows.map((x) => x.club_id)).toEqual(['8I']);
  });
});
