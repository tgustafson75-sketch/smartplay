/**
 * 2026-09-23 (Tim — "We shouldn't have old bundled courses.") — the Play tab listed all 38 surveyed
 * courses to every player. "Your courses" is now only what is his; a surveyed course joins on the
 * same terms as a database one, and is still found by search.
 */
import { composeYourCourses, yourCoursePicks } from '../../services/yourCourses';
import * as fs from 'fs';
import * as path from 'path';

const row = (id: string) => ({ id });
const SURVEYED = ['local:palms', 'local:lakes', 'local:mines-gc'].map(row);

describe('Your courses are the player\'s courses', () => {
  it('a new player sees none of the surveyed catalog', () => {
    expect(composeYourCourses({ custom: [], recent: [], surveyed: SURVEYED, downloaded: [], ownedIds: [] })).toEqual([]);
  });

  it('a surveyed course joins once it is his — downloaded or home — and only that one', () => {
    const out = composeYourCourses({ custom: [], recent: [], surveyed: SURVEYED, downloaded: [], ownedIds: ['local:lakes'] });
    expect(out.map((c) => c.id)).toEqual(['local:lakes']);
  });

  it('one row per course, the richest source first', () => {
    const recent = [{ id: 'local:palms', from: 'recent' }];
    const out = composeYourCourses({
      custom: [{ id: 'custom:1', from: 'custom' }], recent, surveyed: SURVEYED.map((s) => ({ ...s, from: 'surveyed' })),
      downloaded: [{ id: 'abc', from: 'dl' }, { id: 'custom:1', from: 'dl' }], ownedIds: ['local:palms', 'abc'],
    });
    expect(out).toEqual([{ id: 'custom:1', from: 'custom' }, { id: 'local:palms', from: 'recent' }, { id: 'abc', from: 'dl' }]);
  });

  it('the Play tab builds its list through this rule and never spreads the catalog into it', () => {
    const play = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/play.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const memo = play.slice(play.indexOf('const closestLocal'), play.indexOf('const distanceLabelById'));
    expect(memo).toMatch(/composeYourCourses/);
    expect(play).not.toMatch(/\.\.\.SURVEYED_COURSES\b/);
    expect(play).not.toMatch(/SURVEYED_COURSES\[0\]/);
  });

  it('a local id with no surveyed card opens its database record, not an invented Par 72 card', () => {
    const play = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/play.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(play).toMatch(/isLocal: getBundledHoles\(raw\.id\)\.length > 0/);
    const sel = play.slice(play.indexOf('const selectSummary = useCallback'), play.indexOf('const onTapInfo'));
    expect(sel).toMatch(/startsWith\('local:'\)\) \{\s*const apiId = await resolveLocalCourseId\(/);
  });

  it('a searched course that IS a surveyed course opens as that surveyed card on the Play tab too', () => {
    const play = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/play.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const sel = play.slice(play.indexOf('const selectSummary = useCallback'), play.indexOf('const onTapInfo'));
    expect(sel).toMatch(/const twin = c \? surveyedTwinOf\(c\) : null;[\s\S]*?if \(twinRow\) \{\s*openSurveyed\(twinRow\);\s*return;/);
  });

  it('the round-setup picker lists his courses, never a fixed four, and never a nameless id', () => {
    const none = yourCoursePicks({ custom: [], recentIds: [], recentMeta: {}, home: [], surveyedName: () => 'X' });
    expect(none).toEqual([]);
    const out = yourCoursePicks({
      custom: [{ id: 'custom:1', name: 'My Muni' }],
      recentIds: ['abc', 'local:palms', 'nameless'],
      recentMeta: { abc: { club_name: 'Wachusett CC' } },
      home: [{ id: 'local:palms', name: 'Palms' }, { id: 'h9', name: 'Home Nine' }],
      surveyedName: (id) => (id === 'local:palms' ? 'Menifee Lakes — Palms' : null),
    });
    expect(out.map((c) => [c.id, c.name, c.isLocal])).toEqual([
      ['abc', 'Wachusett CC', false], ['local:palms', 'Menifee Lakes — Palms', true],
      ['h9', 'Home Nine', false], ['custom:1', 'My Muni', true],
    ]);
  });

  it('the picker has no hard-coded course list', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../components/CoursePicker.tsx'), 'utf8');
    expect(src).not.toMatch(/id: 'local:/);
    expect(src).toMatch(/myCourses\.map\(/);
  });
});
