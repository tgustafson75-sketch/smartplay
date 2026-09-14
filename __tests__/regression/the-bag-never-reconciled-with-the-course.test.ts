/**
 * 2026-09-14 (Tim) — "your bag and the course appropriate bag for your game are supposed to
 * reconcile." And: "we built a function that is supposed to auto adjust by course."
 *
 * We did. services/bagPack does the reasoning and is guarded, and services/bagPackLive's own header
 * names the callers: "the Fit Profile's auto-pack chip today, the Play tab and the caddie's answer
 * next."
 *
 * THE PLAY TAB CALLER WAS NEVER WRITTEN. So the only way the reconciliation ever fired was a button
 * on a screen Tim himself could not find — "can do manual pack, but I don't see that as a button" —
 * which means for every real player it never fired at all. The reasoning shipped; the moment it was
 * meant to happen did not. [[sweep-the-missing-half-not-the-unused-export]]
 *
 * SUGGEST, THEN LET THEM EDIT, which is why this WRITES rather than only displaying: the packed bag
 * is what the caddie clubs off, so a suggestion that is not applied is a label, not a bag.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const PLAY = code('app/(tabs)/play.tsx');

describe('choosing a course reconciles the bag', () => {
  it('the Play tab calls the ONE packer, not a second composition of it', () => {
    expect(PLAY).toMatch(/liveBagPack\(\)/);
    expect(PLAY).not.toMatch(/packBagForCourse\(/);   // the raw pure fn would be a second owner
  });

  it('writes the result, because a suggestion that is not applied is not a bag', () => {
    expect(PLAY).toMatch(/setCarriedToday\(ids/);
  });

  it('respects the USGA cap through the store that owns it', () => {
    expect(PLAY).toMatch(/carryLimitFor\(competition\)/);
  });
});

describe('it never overrides the player', () => {
  it('a bag he packed himself outranks the course', () => {
    expect(PLAY).toMatch(/if \(carriedTodayLen > 0\) return;/);
  });

  it('runs once per course, so editing it down is not undone on the next render', () => {
    expect(PLAY).toMatch(/packedForCourseRef/);
    expect(PLAY).toMatch(/if \(packedForCourseRef\.current === courseId\) return;/);
  });

  it('does nothing mid-round — the bag is in the car by then', () => {
    expect(PLAY).toMatch(/if \(!courseId \|\| isRoundActive\) return;/);
  });

  it('does nothing with an empty bag, and nothing when the pack keeps everything', () => {
    expect(PLAY).toMatch(/if \(ownedForPack === 0\) return;/);
    expect(PLAY).toMatch(/pack\.leave\.length === 0\) return;/);
  });

  it('a failure leaves the FULL bag — the safe side', () => {
    const at = PLAY.indexOf('liveBagPack()');
    expect(PLAY.slice(at, at + 900)).toMatch(/catch/);
  });
});

describe('it says what it did', () => {
  it('the card announces the course it packed for', () => {
    expect(PLAY).toMatch(/packedForCourseName/);
    expect(PLAY).toMatch(/bag_packed_for/);
  });

  it('and tells him it is editable, because it changed his clubs', () => {
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/locales/en.json'), 'utf8')) as
      Record<string, Record<string, Record<string, string>>>;
    expect(en.play.play_tab.bag_packed_for).toMatch(/tap to change/i);
  });

  it('the card still opens the ONE bag editor', () => {
    expect(PLAY).toMatch(/router\.push\('\/practice\/fit-profile' as never\)/);
  });
});
