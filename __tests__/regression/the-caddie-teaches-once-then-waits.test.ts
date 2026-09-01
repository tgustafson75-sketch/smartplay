/**
 * 2026-08-31 (Tim, after an on-course session: "we still have that canned speech when you hit stop
 * recording — it says do you want to run it back, yada") — THE SECOND ATTEMPT AT THIS.
 *
 * On 2026-08-24 the single hardcoded sentence was replaced with five variants through the dialog
 * engine. It still read as canned, and the reason is the interesting part: all five are the same
 * SHAPE — a menu recited aloud, "say run it back and I'll start it, or name a club". Five phrasings
 * of one instruction manual is still an instruction manual. Varying the words cannot fix a line
 * whose problem is that it is TEACHING someone who already knows.
 *
 * So the manual plays only while it is genuinely news, and after that the caddie says a few words
 * and waits with the mic open.
 */
import { useVoiceHintsStore } from '../../store/voiceHintsStore';
import { _allCoachTemplates } from '../../constants/dialogTemplates/coachTemplates';
const COACH_TEMPLATES = _allCoachTemplates();
import * as fs from 'fs';
import * as path from 'path';
const read = (r: string) => fs.readFileSync(path.join(__dirname, '..', '..', r), 'utf8');

describe('the go-again line is taught, not repeated', () => {
  it('the teaching pool still explains the commands — a new player has to learn them somewhere', () => {
    const pool = COACH_TEMPLATES.session_done;
    expect(pool.length).toBeGreaterThan(2);
    for (const line of pool) expect(line.toLowerCase()).toContain('run it back');
  });

  it('the BRIEF pool teaches nothing — it is a person waiting, not a menu', () => {
    const brief = COACH_TEMPLATES.session_done_brief;
    expect(brief.length).toBeGreaterThan(2);
    for (const line of brief) {
      // No command instruction, and short enough that it cannot become one.
      expect([line, /run it back|name a club|tell me a club|say .*and i'?ll set/i.test(line)]).toEqual([line, false]);
      expect([line, line.length <= 32]).toEqual([line, true]);
    }
  });

  it('the two pools are genuinely different lines, not the same list twice', () => {
    const a = new Set(COACH_TEMPLATES.session_done as readonly string[]);
    for (const line of COACH_TEMPLATES.session_done_brief) expect(a.has(line)).toBe(false);
  });

  it('the screen teaches at most twice, then switches — and counts only when it taught', () => {
    const src = read('app/(tabs)/caddie.tsx');
    expect(src).toMatch(/go_again_taught_count \?\? 0\) < 2/);
    expect(src).toMatch(/if \(teaching\) hints\.noteGoAgainTaught\(\)/);
    expect(src).toMatch(/teaching \? 'session_done' : 'session_done_brief'/);
  });

  it('the SUMMARY is spoken either way — that half is the player\'s own data', () => {
    expect(read('app/(tabs)/caddie.tsx')).toMatch(/\$\{event\.summary\} \$\{invite\}/);
  });

  it('the counter persists, so a restart does not restart the lecture', () => {
    const store = read('store/voiceHintsStore.ts');
    expect(store).toMatch(/go_again_taught_count: number/);
    expect(store).toMatch(/go_again_taught_count: 0,/);
    expect(store).toMatch(/noteGoAgainTaught: \(\) => set/);
    // voiceHintsStore is a persisted store — that is the whole reason this lives there.
    expect(store).toMatch(/persist\(/);
  });
});

/**
 * 2026-08-31, second pass — A NEW FIELD DEFAULTS TO ZERO FOR EVERYONE, INCLUDING PEOPLE WHO HAVE
 * ALREADY HEARD IT A HUNDRED TIMES.
 *
 * `go_again_taught_count` shipped defaulting to 0, which is right for a new install and wrong for
 * every existing player: they would have been taught the menu twice MORE before it went quiet. Tim
 * reported still hearing it; hearing it twice more is not a fix.
 *
 * A persisted voice-hints blob only exists for someone who has already used the app, so its presence
 * is the evidence. This is the same shape as the customCaddieGender migration earlier today —
 * deleting or adding a persisted field is never just a default.
 */
describe('an existing player is not re-taught what they already know', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const migrate = (useVoiceHintsStore as any).persist.getOptions().migrate as (s: unknown, v: number) => Record<string, unknown>;

  it('seeds an existing blob straight to the short form', () => {
    const out = migrate({ meet_kevin_completed: true, first_tee_shown: true }, 1);
    expect(out.go_again_taught_count).toBe(2);
  });

  it('never overwrites a count that is already there', () => {
    expect(migrate({ go_again_taught_count: 0 }, 1).go_again_taught_count).toBe(0);
    expect(migrate({ go_again_taught_count: 1 }, 1).go_again_taught_count).toBe(1);
  });

  it('survives a hostile blob rather than wiping the player', () => {
    for (const bad of [null, undefined, 'x', 0, []]) {
      expect(() => migrate(bad, 1)).not.toThrow();
    }
  });

  it('a NEW install still gets taught — migrate never runs for it', () => {
    // No persisted blob means no migrate call, so the store default stands.
    expect((useVoiceHintsStore.getState() as { go_again_taught_count?: number }).go_again_taught_count).toBe(0);
  });
});
