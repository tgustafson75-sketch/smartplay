/**
 * 2026-09-14 (Tim) — "double check user profile set up that it has all the data we need, I dont
 * think it has level or experience, just handicap."
 *
 * He was right about the SCREEN and wrong about the data, and both halves matter.
 *
 * The data was fine: `experienceContext` has existed, been editable and reached the brain since
 * 2026-09-10, and `api/kevin` maps it to coaching depth. What was wrong is that `app/profile.tsx` —
 * the screen you reach by tapping the profile card on the Dashboard — showed name, handicap index,
 * GHIN, goal and a rounds count, then pointed at Settings for everything else. Its own header said
 * so: the detailed fields "still live in Settings, so we don't fork the edit form."
 *
 * That instinct was right and the resting place was wrong. The form could not move because its only
 * control, `PillRow`, was declared INSIDE the Settings component and closed over that screen's
 * colours and styles — a component that cannot be imported keeps its form where it is.
 *
 * So: PillRow came out, the form came out, and Profile renders it. ONE form. Settings keeps a slim
 * card and a link.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const FORM = 'components/profile/ProfileForm.tsx';

describe('the profile lives on the Profile screen', () => {
  it('Profile renders the form', () => {
    expect(code('app/profile.tsx')).toMatch(/<ProfileForm \/>/);
  });

  it('and Settings does not keep a second copy of it', () => {
    const s = code('app/settings.tsx');
    // The fields that moved. Any of these reappearing here means the form was forked, which is the
    // exact failure the old header was trying to avoid by leaving it in one place.
    for (const marker of [
      'where_you_re_at', 'how_you_cover_a_number', 'typical_miss', 'preferred_tee',
      'default_round_mode', 'course_rating_set', 'handicap_index_usga', 'ghin_number',
      'personal_best', 'longest_drive_yards', 'longest_putt_feet', 'save_profile',
    ]) {
      expect(s).not.toContain(marker);
    }
    expect(s).toMatch(/router\.push\('\/profile'/);
  });

  it('every field Tim could not find is on the form', () => {
    const f = code(FORM);
    for (const marker of [
      'where_you_re_at',            // experience / level — the one he reported missing
      'how_you_cover_a_number', 'typical_miss', 'dominant_miss', 'handedness',
      'preferred_tee', 'default_round_mode', 'course_rating_set', 'home_courses',
      'handicap_index_usga', 'ghin_number', 'personal_best',
      'longest_drive_yards', 'longest_putt_feet', 'account_email', 'physical_note',
    ]) {
      expect(f).toContain(marker);
    }
  });

  it('PillRow is shared, not redeclared per screen', () => {
    expect(fs.existsSync(path.join(ROOT, 'components/PillRow.tsx'))).toBe(true);
    for (const f of ['app/settings.tsx', FORM]) {
      expect(code(f)).toMatch(/from '\.\.?\/(\.\.\/)?components\/PillRow'|from '\.\.\/PillRow'/);
      expect(code(f)).not.toMatch(/const PillRow = \(/);   // the local copy that trapped the form
    }
  });

  it('the text inputs are declared at module level, so typing does not close the keyboard', () => {
    /**
     * A component declared INSIDE the render function is a new type on every render, so React
     * unmounts and remounts it — the keyboard dismisses after each character. Caught in review of
     * this very change, before it shipped.
     */
    const f = code(FORM);
    const inner = f.slice(f.indexOf('export function ProfileForm'));
    expect(inner).not.toMatch(/const Field = \(/);
    expect(f).toMatch(/^function Field\(/m);
  });
});

/**
 * 2026-09-14 (evening) — THE BAG ENTRY CAME BACK, because moving the form deleted it.
 *
 * A "Your Bag" row was added to Settings on 2026-09-13 in answer to Tim asking "shouldn't The Bag
 * be populated originally in the Profile?" — its note recorded that until then the bag was
 * "reachable from neither onboarding nor here". The profile-form move lifted that whole section out
 * of Settings and took the row with it, so the bag would have been hard to find again the next
 * morning: the only remaining path was SwingLab → Fit Profile → scroll to the bottom.
 *
 * Found by checking that the two things he said he would do first — update his profile and scan his
 * bag — were REACHABLE, not merely present. [[built-is-not-reachable]]
 */
describe('the bag is reachable from the profile', () => {
  it('the Profile screen links to the bag', () => {
    const src = code('app/profile.tsx');
    expect(src).toMatch(/router\.push\('\/bag-scan'/);
    expect(src).toMatch(/profile\.bag\.title/);
  });

  it('and there is still more than one way in', () => {
    // Fit Profile keeps its own entry; losing BOTH is how it became unfindable the first time.
    expect(code('app/practice/fit-profile.tsx')).toMatch(/router\.push\('\/bag-scan'/);
  });
});
