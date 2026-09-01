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
