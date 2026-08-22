import { relaxedQueries, rankByDroppedTokens } from '../../services/golfCourseApi';

/**
 * 2026-08-22 — from building Sharp Park (Pacifica) the way a player would. The upstream API
 * substring-matches the course NAME only, so "Sharp Park Pacifica" — the most natural thing to
 * type — returned nothing while "Sharp Park" returned the course with all 18 holes of geometry.
 * These are pure functions on purpose: the behaviour is locked without touching the network.
 */
describe('over-specified queries still find the course', () => {
  it('drops the town, which is never in the course name', () => {
    const qs = relaxedQueries('Sharp Park Pacifica');
    expect(qs[0]).toBe('Sharp Park Pacifica');
    expect(qs).toContain('sharp park');
  });

  it('survives the spelled-out name when the record is abbreviated', () => {
    // The record says "Sharp Park Gc". "Golf Course" matches nothing at all.
    expect(relaxedQueries('Sharp Park Golf Course')).toContain('sharp park');
  });

  it('handles punctuation the way people type it', () => {
    expect(relaxedQueries('Sharp Park, Pacifica, CA')).toContain('sharp park');
  });

  it('tries the verbatim query FIRST — relaxing is a fallback, not the default', () => {
    for (const q of ['Pebble Beach', 'Torrey Pines South', 'Sharp Park Pacifica CA']) {
      expect(relaxedQueries(q)[0]).toBe(q);
    }
  });

  it('never relaxes into a one-word query that returns a wall of courses', () => {
    // "Pines" would match dozens. Two tokens is the floor for a multi-word name.
    const qs = relaxedQueries('Torrey Pines South Course San Diego California');
    for (const q of qs) expect(q.split(/\s+/).length).toBeGreaterThanOrEqual(2);
  });

  it('is bounded — a long query cannot fan out into unlimited requests', () => {
    expect(relaxedQueries('a very long course name in some town in some state usa').length).toBeLessThanOrEqual(4);
  });

  it('does not emit duplicates when there is nothing to strip', () => {
    const qs = relaxedQueries('Pebble Beach');
    expect(new Set(qs.map(q => q.toLowerCase())).size).toBe(qs.length);
  });
});

describe('the dropped words decide WHICH course you meant', () => {
  const sharpCA = { id: '1', club_name: 'Sharp Park Gc', course_name: 'Sharp Park Gc', location: 'Pacifica, CA' };
  const sharpMI = { id: '2', club_name: 'Ella Sharp Park Gc', course_name: 'Ella Sharp Park Gc', location: 'Jackson, MI' };

  it('puts the course in the town you named first', () => {
    // API order is CA, MI. Someone who typed "Michigan" means the OTHER one.
    const ranked = rankByDroppedTokens([sharpCA, sharpMI], 'Sharp Park Michigan', 'sharp park');
    expect(ranked[0].id).toBe('2');
  });

  it('keeps the local course on top when the town matches it', () => {
    const ranked = rankByDroppedTokens([sharpCA, sharpMI], 'Sharp Park Pacifica', 'sharp park');
    expect(ranked[0].id).toBe('1');
  });

  it('matches on the state code too', () => {
    expect(rankByDroppedTokens([sharpCA, sharpMI], 'sharp park mi', 'sharp park')[0].id).toBe('2');
  });

  it('leaves the API ordering alone when nothing was dropped', () => {
    const ranked = rankByDroppedTokens([sharpCA, sharpMI], 'sharp park', 'sharp park');
    expect(ranked.map(r => r.id)).toEqual(['1', '2']);
  });

  it('does not reorder on generic golf words — every course has them', () => {
    const ranked = rankByDroppedTokens([sharpCA, sharpMI], 'Sharp Park Golf Club', 'sharp park');
    expect(ranked.map(r => r.id)).toEqual(['1', '2']);
  });

  it('matches a spelled-out state against a stored code', () => {
    // People type "California"; the records say "CA". This was the one token guaranteed to miss.
    const sharpCA = { id: '1', club_name: 'Sharp Park Gc', course_name: 'Sharp Park Gc', location: 'Pacifica, CA' };
    const sharpMI = { id: '2', club_name: 'Ella Sharp Park Gc', course_name: 'Ella Sharp Park Gc', location: 'Jackson, MI' };
    expect(rankByDroppedTokens([sharpMI, sharpCA], 'Sharp Park California', 'sharp park')[0].id).toBe('1');
    expect(rankByDroppedTokens([sharpCA, sharpMI], 'Sharp Park Michigan', 'sharp park')[0].id).toBe('2');
  });

  it('is stable for equal scores rather than shuffling results under the player', () => {
    const a = { id: 'a', club_name: 'X', course_name: 'X', location: 'Reno, NV' };
    const b = { id: 'b', club_name: 'Y', course_name: 'Y', location: 'Reno, NV' };
    expect(rankByDroppedTokens([a, b], 'X Reno', 'x').map(r => r.id)).toEqual(['a', 'b']);
  });
});
