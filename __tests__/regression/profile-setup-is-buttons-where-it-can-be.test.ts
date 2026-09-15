/**
 * 2026-09-14 (Tim) — "Make profile setup buttons where it can be and only type when needed to for
 * ease of use for the user."
 *
 * GOAL and PHYSICAL NOTE were free-text boxes, and both are questions with a handful of real
 * answers. Typing them is worse than slow: `goal` is handed to the brain verbatim, so "brek 90",
 * "Break 90!" and "break ninety" are three different goals to anything that wants to group or
 * compare them.
 *
 * The rule this pins: a profile field with a known set of answers is a PillRow; a text input is
 * allowed only for the genuinely open ones (name, email, GHIN, home-course search) and behind an
 * explicit "Other".
 */
import fs from 'fs';
import path from 'path';

/**
 * 2026-09-14 — the profile form moved out of app/settings.tsx into
   * components/profile/ProfileForm, rendered by app/profile.tsx, so the screen called Profile
   * actually holds the profile. The guard follows the code; what it protects is unchanged.
 */
const SETTINGS = fs.readFileSync(path.resolve(__dirname, '../../components/profile/ProfileForm.tsx'), 'utf8');
const code = SETTINGS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the answers that are a known set are buttons', () => {
  it.each([
    ['settings.text.goal', 'goal'],
    ['settings.text.physical_note', 'physical note'],
    ['settings.label.preferred_tee', 'preferred tee'],
    ['settings.label.typical_miss', 'typical miss'],
    ['settings.label.where_you_re_at', 'experience'],
    ['settings.label.how_you_cover_a_number', 'distance control'],
    ['settings.label.default_round_mode', 'default mode'],
  ])('%s is offered as a PillRow', (key) => {
    // The label must appear on a PillRow, not on a bare TextInput.
    const onPill = new RegExp(`<PillRow[\\s\\S]{0,200}?${key.replace(/\./g, '\\.')}`);
    expect(onPill.test(code)).toBe(true);
  });

  it('goal and physical note no longer lead with a keyboard', () => {
    // The text field survives ONLY behind the Other branch — never as the primary control.
    expect(code).not.toMatch(/settings\.text\.goal'\)\}<\/Text>\s*<TextInput/);
    expect(code).not.toMatch(/settings\.text\.physical_note'\)\}<\/Text>\s*<TextInput/);
    expect(code).toMatch(/goalIsPreset/);
    expect(code).toMatch(/limitationIsPreset/);
  });

  it('Other is still reachable — a list with no escape hatch is a worse form, not a better one', () => {
    expect(code).toMatch(/\bOTHER\b/);
    expect(code).toMatch(/goalOtherOpen/);
    expect(code).toMatch(/limitationOtherOpen/);
  });

  it('the sentinels never reach the store — it stores his words, not a magic string', () => {
    // setEditGoal is given '' for Other, never the sentinel itself.
    expect(code).toMatch(/setEditGoal\(v === OTHER \? '' : v\)/);
    expect(code).toMatch(/setEditLimitation\(v === OTHER \|\| v === NONE \? '' : v\)/);
  });

  it('the fields that genuinely need a keyboard still have one', () => {
    // Name, email and GHIN are open-ended; forcing them into a list would be the opposite mistake.
    for (const k of ['settings.placeholder.you_email_com']) expect(code).toContain(k);
    expect(code).toMatch(/TextInput/);
  });
});
