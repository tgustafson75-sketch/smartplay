/**
 * 2026-09-14 (Tim) — "When user selects up to 3 home courses, logic should spool those to the play
 * tab for the engine to build… I mean so they cue up as three builds in the users play tab courses."
 * And: "Make profile setup buttons where it can be and only type when needed."
 *
 * `homeCourse` was ONE free-text string, matched by SUBSTRING against the bundled catalog in
 * play.tsx. So a typo missed, a shortened name matched the wrong club at a multi-course facility,
 * and a player with a summer club and a winter club could only name one of them. Nothing was built
 * ahead of time either: the download engine ran on the tap that needed it, so the first tee of a
 * round at his own club waited on an Overpass build.
 */
import fs from 'fs';
import path from 'path';
import {
  usePlayerProfileStore, MAX_HOME_COURSES,
  normalizeHomeCourses, primaryHomeCourseName, homeCourseKey,
} from '../../store/playerProfileStore';

const ROOT = path.resolve(__dirname, '../..');
const code = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const c = (id: string, name: string) => ({ id, name });

describe('the home set', () => {
  beforeEach(() => usePlayerProfileStore.setState({ homeCourses: [] }));

  it('holds three and refuses a fourth rather than evicting one of his', () => {
    const api = usePlayerProfileStore.getState();
    expect(api.toggleHomeCourse(c('a', 'Menifee Lakes'))).toBe(true);
    expect(api.toggleHomeCourse(c('b', 'Soboba Springs'))).toBe(true);
    expect(api.toggleHomeCourse(c('d', 'Echo Hills'))).toBe(true);
    expect(usePlayerProfileStore.getState().homeCourses).toHaveLength(MAX_HOME_COURSES);
    // The fourth is REFUSED — silently dropping his first pick to make room is the app choosing
    // for him, which is the class of bug the 14-club cap hit this same day.
    expect(usePlayerProfileStore.getState().toggleHomeCourse(c('e', 'Cross Creek'))).toBe(false);
    expect(usePlayerProfileStore.getState().homeCourses.map((x) => x.id)).toEqual(['a', 'b', 'd']);
  });

  it('toggles off, and the same course twice is one course', () => {
    const api = usePlayerProfileStore.getState();
    api.toggleHomeCourse(c('a', 'Menifee Lakes'));
    usePlayerProfileStore.getState().toggleHomeCourse(c('a', 'Menifee Lakes'));
    expect(usePlayerProfileStore.getState().homeCourses).toHaveLength(0);
    usePlayerProfileStore.getState().setHomeCourses([c('a', 'Menifee'), c('a', 'Menifee Lakes')]);
    expect(usePlayerProfileStore.getState().homeCourses).toHaveLength(1);
  });

  it('the cap lives in the STORE, so no surface can write four', () => {
    usePlayerProfileStore.getState().setHomeCourses([c('a', 'A'), c('b', 'B'), c('d', 'D'), c('e', 'E')]);
    expect(usePlayerProfileStore.getState().homeCourses).toHaveLength(MAX_HOME_COURSES);
    expect(normalizeHomeCourses([c('', ''), c('a', 'A')])).toEqual([c('a', 'A')]);   // blanks dropped
  });

  it('a name-only entry from the old field still identifies and still reads', () => {
    // The v4→v5 migration cannot resolve a typed name to an id, so it keeps the name alone.
    expect(homeCourseKey({ id: '', name: 'Menifee Lakes' })).toBe('menifee lakes');
    expect(homeCourseKey({ id: 'x', name: 'Menifee Lakes' })).toBe('x');
    expect(primaryHomeCourseName([{ id: '', name: 'Menifee Lakes' }])).toBe('Menifee Lakes');
    expect(primaryHomeCourseName([])).toBe('');
  });
});

describe('the migration off the single typed course', () => {
  const migrate = (usePlayerProfileStore as unknown as {
    persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown } };
  }).persist.getOptions().migrate!;

  it('carries the typed name across rather than losing it', () => {
    const out = migrate({ name: 'Tim', homeCourse: '  Menifee Lakes ' }, 4) as { homeCourses: unknown; homeCourse?: unknown };
    expect(out.homeCourses).toEqual([{ id: '', name: 'Menifee Lakes' }]);
    expect(out.homeCourse).toBeUndefined();
  });

  it('an empty or absent old value becomes an empty set, not a blank entry', () => {
    expect((migrate({ name: 'Tim', homeCourse: '   ' }, 4) as { homeCourses: unknown[] }).homeCourses).toEqual([]);
    expect((migrate({ name: 'Tim' }, 4) as { homeCourses: unknown[] }).homeCourses).toEqual([]);
  });

  it('survives a blob that is not an object — a throwing migrate is a white screen', () => {
    // Caught by no-migration-can-wipe-a-player: assigning a property to a string throws, and a
    // migration that throws takes rehydration (and the app) down with it.
    expect(() => migrate('a string where an object should be', 4)).not.toThrow();
    expect(() => migrate(null, 4)).not.toThrow();
  });
});

describe('the three cue up as builds on the Play tab', () => {
  const play = code('app/(tabs)/play.tsx');

  it('runs the download engine for each home course, not just the one you tap', () => {
    const spool = play.slice(play.indexOf('const spooledHomeRef'), play.indexOf('const runSearch'));
    expect(spool).toMatch(/homeCourses/);
    expect(spool).toMatch(/downloadCourse/);
    // Once per SET, not once per render — three ids must not re-queue on every state change.
    expect(spool).toMatch(/spooledHomeRef\.current === key/);
    // An entry with no id is skipped: guessing which course a typed name meant is the old bug.
    expect(spool).toMatch(/filter\(\(id\) => !!id\)/);
  });

  it('the picker is on the tab that has the course list, and it is a button', () => {
    expect(play).toMatch(/toggleHomeCourse/);
    expect(play).toMatch(/star-outline/);
    // Settings shows the set and removes from it, but declares no second course list.
    const settings = code('app/settings.tsx');
    expect(settings).toMatch(/homeCourses/);
    expect(settings).not.toMatch(/setHomeCourse\b/);
    expect(settings).not.toMatch(/onChangeText=\{setEditHomeCourse\}/);
  });

  it('nothing reads the retired single field any more', () => {
    for (const f of ['app/(tabs)/play.tsx', 'app/settings.tsx', 'app/smartvision.tsx',
                     'services/contextSynthesizer.ts', 'services/setupGaps.ts',
                     'hooks/useVoiceCaddie.ts', 'components/caddie/L1HolePreview.tsx']) {
      expect(code(f)).not.toMatch(/\.homeCourse\b/);
    }
  });
});
