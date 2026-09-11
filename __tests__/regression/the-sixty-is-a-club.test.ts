/**
 * 2026-09-11 — "THE 60" IS A CLUB. "60 OUT" IS A YARDAGE.
 *
 * Tim: "Please make sure Caddie knows 60 and lob wedge are the same thing — 60 degree wedge, that
 * is — so it doesn't catch 60 as yardage like it sometimes likes to do with numbers. I'm asking you
 * to make Pinocchio caddie a real boy."
 *
 * services/clubNormalize has mapped lofts to wedges for a long time, but ONLY when handed a club
 * field. Its own comment says the phrase parser deliberately does not, "since a bare number in a
 * sentence is far more likely a yardage" — true in general, and exactly why the caddie heard "hit
 * the 60" as sixty yards.
 *
 * THE NUMBER IS NOT THE DISCRIMINATOR. THE GRAMMAR IS. A golfer says "the 60", "my 56", "a 52" for a
 * club and "60 out", "from 60", "I'm 60" for a distance, and never mixes them up. A determiner in
 * front, or "degree" behind, is a club every time.
 *
 * It was broken in three places at once, which is why it kept happening: the offline precheck wanted
 * a club WORD, the brain's club_change tool had never been told, and the server's CLUB_PATTERNS —
 * which records which club the CADDIE recommended — knew every wedge by name and none by loft, so
 * "I'd go with the 60" stamped no club at all.
 */
import { clubFromLoftPhrase, normalizeClub } from '../../services/clubNormalize';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('the lofts a golfer actually says', () => {
  it.each([
    ['the 60', 'LW'], ['my 60', 'LW'], ['a 64', 'LW'], ['the 58', 'LW'],
    ['the 56', 'SW'], ['my 54', 'SW'],
    ['the 52', 'GW'], ['a 50', 'GW'],
    ['the 48', 'PW'], ['my 46', 'PW'],
  ])('%s is the %s', (phrase, club) => {
    expect(clubFromLoftPhrase(phrase)).toBe(club);
  });

  it('reads it with the degree said out loud', () => {
    expect(clubFromLoftPhrase('60 degree')).toBe('LW');
    expect(clubFromLoftPhrase('56 deg wedge')).toBe('SW');
    expect(clubFromLoftPhrase('52°')).toBe('GW');
  });

  it('reads it spoken as words, the way speech-to-text returns it', () => {
    expect(clubFromLoftPhrase('the sixty')).toBe('LW');
    expect(clubFromLoftPhrase('my fifty six')).toBe('SW');
  });

  it('works inside a whole sentence', () => {
    expect(clubFromLoftPhrase("let's hit the 60 here")).toBe('LW');
    expect(clubFromLoftPhrase('how far do I hit my 60')).toBe('LW');
    expect(clubFromLoftPhrase("I'd go with the 56")).toBe('SW');
  });
});

describe('and the sentences that are still yardages', () => {
  /**
   * The half that matters more. Claiming these as clubs would break the number the caddie clubs
   * from, which is worse than the bug being fixed.
   */
  it.each([
    "I'm 60 out",
    'from 60',
    '60 yards',
    'the 60 yards to the pin',
    'about 60 to the flag',
    'hit it 60',
    '60 away',
    'the 60 to the pin',
  ])('%s stays a distance', (phrase) => {
    expect(clubFromLoftPhrase(phrase)).toBeNull();
  });

  /**
   * "the 60 is short" was in the yardage list in my first draft and it is NOT a yardage — a golfer
   * saying it means the WEDGE will not reach. My expectation was wrong, not the code.
   */
  it('"the 60 is short" is the club not reaching, which is how a golfer says it', () => {
    expect(clubFromLoftPhrase('the 60 is short')).toBe('LW');
  });

  it('a number outside the wedge range is never a club here', () => {
    // "the 7" could be an iron or a wood; guessing would corrupt a real club's learned data.
    expect(clubFromLoftPhrase('the 7')).toBeNull();
    expect(clubFromLoftPhrase('the 70')).toBeNull();
    expect(clubFromLoftPhrase('the 30')).toBeNull();
  });

  it('a bare number with no determiner is left alone', () => {
    expect(clubFromLoftPhrase('60')).toBeNull();
    expect(clubFromLoftPhrase('playing 56 today')).toBeNull();
  });

  it('and nothing at all is null, not a wedge', () => {
    expect(clubFromLoftPhrase('')).toBeNull();
    expect(clubFromLoftPhrase(null)).toBeNull();
    expect(clubFromLoftPhrase('what should I hit')).toBeNull();
  });
});

describe('the club field itself was already right — this did not change it', () => {
  it('normalizeClub still reads a bare loft as a club, because a club field is a club', () => {
    expect(normalizeClub('60')).toBe('LW');
    expect(normalizeClub('56')).toBe('SW');
    expect(normalizeClub('lob wedge')).toBe('LW');
  });
});

describe('all three paths that heard it wrong', () => {
  it('the offline precheck accepts a loft as a club phrase', () => {
    const src = read('services/localIntentPrecheck.ts');
    expect(src).toMatch(/clubFromLoftPhrase\(clubPhrase\)/);
    expect(src).toMatch(/if \(loftClub \|\|/);
  });

  it("the brain's club_change tool is told a loft is a club, not a distance", () => {
    const t = read('api/_brainTools.ts');
    expect(t).toMatch(/WEDGES ARE NAMED BY LOFT/);
    expect(t).toMatch(/"60 out" \/ "from 60" \/ "I\\'m 60" ARE yardages/);
  });

  it('and state_yardage is told the other side of it', () => {
    expect(read('api/_brainTools.ts')).toMatch(/NOT a wedge loft/);
  });

  it("the server records the club when the CADDIE says a loft", () => {
    // "I'd go with the 60" stamped no club at all, so advice and outcome were never paired.
    const b = read('api/_brain.ts');
    expect(b).toMatch(/loftRx\('58\|59\|60\|61\|62\|63\|64'\), 'lob wedge'/);
    expect(b).toMatch(/loftRx\('54\|55\|56\|57'\), 'sand wedge'/);
    expect(b).toMatch(/loftRx\('50\|51\|52\|53'\), 'gap wedge'/);
    expect(b).toMatch(/loftRx\('46\|47\|48\|49'\), 'pitching wedge'/);
  });

  it('and the server pattern is guarded the same way, so it cannot eat a yardage', () => {
    const b = read('api/_brain.ts');
    const at = b.indexOf('const LOFT_CUE');
    const line = b.slice(at, at + 240);
    expect(line).toMatch(/the\|my\|a\|an\|his\|her\|your\|our/);
    expect(line).toMatch(/degree/);
  });
});
