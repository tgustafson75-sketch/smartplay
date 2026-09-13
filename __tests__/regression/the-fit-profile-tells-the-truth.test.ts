/**
 * 2026-09-13 (Tim, reviewing the Fit Profile) — "Pretty messy and feels disjointed."
 *
 * It was, and underneath the mess two of the numbers were wrong in a way that produced confident
 * equipment advice.
 *
 * 1. THE READ-SIDE HEALING REACHED ONE READER AND NOT THE OTHER.
 *    clubStatsStore has a plausibility band (0.55×–1.45× of expected) that exists because a bad row
 *    once wrote GW = 164y and inferClub then legitimately picked a gap wedge for a 164-yard shot. It
 *    was applied at INGEST and at READ in inferClub — but NOT in ownCarry, which is what `carryFor`
 *    returns and therefore what the entire Fit Profile reads: the ladder, the gaps, the overlaps,
 *    the shaft flex and the ball fit.
 *
 *    Tim's bag showed it. GW read 38 yards with a green "tracked from your shots" dot. The chart
 *    expects 98, so the floor is 53.9 and today's ingest would reject that sample outright — it was
 *    a legacy value from before the gate shipped. The screen then told him he had "32 yd between
 *    your LW and GW" and to go fill a gap that does not exist.
 *
 *    Tim also caught ME here: I first read three woods at exactly 181 as a fabricated fallback. They
 *    are not — the green dot is hasCarry, a real measured carry, and three woods bunching at one
 *    number is exactly the overlap this screen exists to surface. Checking beat assuming.
 *
 * 2. TWO STORES EACH HELD HALF OF "YOUR BAG".
 *    "No clubs registered yet" rendered directly beneath "13 tracked", on a screen that then named
 *    his Driver, 7I, LW and GW. Both true: clubBagStore is what you told us you carry, clubStatsStore
 *    is what we measured. And because caddieRequestBody sends `bagClubs` from carriedList(), a player
 *    who never opened the bag scanner handed the caddie an EMPTY bag while the app had thirteen
 *    measured clubs — and club selection and plays-like read from that.
 *
 * [[sweep-the-missing-half-not-the-unused-export]] [[two-owners-is-the-root-cause]]
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('an out-of-band carry is not served as a tracked one', () => {
  it('ownCarry filters the measured ladder through the same band ingest uses', () => {
    const s = code('store/clubStatsStore.ts');
    expect(s).toMatch(/function ownCarry[\s\S]{0,400}isPlausibleForClub\(club, c\.avgYards, 'carry'/);
    expect(s).toMatch(/function ownCarry[\s\S]{0,600}isPlausibleForClub\(club, t\.avgYards, 'total'/);
  });

  it('a STATED number is never filtered — the player said it', () => {
    // expectedYards is built FROM manual, so filtering it would be circular and would delete a
    // deliberate My Bag entry the moment it differed from the chart.
    expect(code('store/clubStatsStore.ts'))
      .toMatch(/function ownCarry[\s\S]{0,500}if \(g\.manual\[club\] != null\) return g\.manual\[club\]!;/);
  });

  it('the dot agrees with the number — hasCarry filters too, or the row wears a false badge', () => {
    expect(code('store/clubStatsStore.ts'))
      .toMatch(/hasCarry: \(club\) => \{[\s\S]{0,400}isPlausibleForClub/);
  });

  it('hasDistance answers from the same place the number comes from', () => {
    expect(code('store/clubStatsStore.ts')).toMatch(/hasDistance: \(club\) => ownCarry\(get\(\), club\) != null/);
  });
});

describe('one bag', () => {
  it('measured clubs stand in when nothing has been registered', () => {
    const s = code('store/clubBagStore.ts');
    expect(s).toMatch(/bagList: \(\) => \{[\s\S]{0,200}registered\.length > 0/);
    expect(s).toMatch(/hasDistance\(c\)/);
    expect(s).toMatch(/source: 'measured'/);
  });

  it('a real registration always wins over the stand-in', () => {
    expect(code('store/clubBagStore.ts'))
      .toMatch(/const registered = Object\.values\(get\(\)\.clubs\);\s*if \(registered\.length > 0\)/);
  });

  it('the stand-in is labelled, so no surface mistakes it for a scanned club', () => {
    expect(code('store/clubBagStore.ts')).toMatch(/'camera' \| 'voice' \| 'manual' \| 'measured'/);
  });
});

describe('the screen reads like a pro shop, not a spreadsheet', () => {
  const s = code('app/practice/fit-profile.tsx');

  it('the bag is racked by section, each with its own data line', () => {
    expect(s).toMatch(/BAG_SECTIONS/);
    for (const rack of ['WOODS', 'HYBRIDS', 'IRONS', 'WEDGES']) expect(s).toContain(rack);
    expect(s).toMatch(/tracked}\/\{rows\.length\} tracked|\/\$\{rows\.length\}|rows\.length\} tracked/);
  });

  it('the analysis comes before the setup actions it used to hide behind', () => {
    // Anchor on CODE, not on the {/* SECTION */} comments — code() strips those, so the first
    // version of this looked for markers that were no longer in the string it searched.
    const ladderAt = s.indexOf('BAG_SECTIONS.map');
    const gapsAt = s.indexOf('gaps_to_fill');
    const setupAt = s.indexOf('set_up_your_bag');  // the heading is localized, not a literal
    const scanAt = s.indexOf("router.push('/bag-scan'");
    expect(ladderAt).toBeGreaterThan(-1);
    expect(ladderAt).toBeLessThan(gapsAt);
    expect(gapsAt).toBeLessThan(setupAt);
    expect(setupAt).toBeLessThan(scanAt);
  });

  it('there is ONE legend, and it is the one built from dotStyleFor', () => {
    expect(s).toMatch(/dotStyleFor\(m, st\)/);
    // the second legend used a diamond for the state the key draws as a cyan dot
    expect(s).not.toMatch(/tracked_from_your_shots_you/);
  });

  it('cyan stays the "you set it" swatch and is not also a card heading', () => {
    const cyan = [...s.matchAll(/#22d3ee/g)].length;
    expect(cyan).toBeLessThanOrEqual(2); // both inside dotStyleFor
  });

  it('the whole screen is sectioned, not just the racks', () => {
    /**
     * 2026-09-13 (Tim) — "you focused on the clubs and I think lost track of the rest." The racks
     * were sectioned and everything below them was still a stack of differently-coloured cards.
     * Walk of the screen: what is in the bag → what the set is missing → your specs → your reps →
     * setup, in that order.
     */
    const order = ['your_bag_tap_a_club', 'fit_findings_heading', 'specs_heading', 'practice_volume', 'set_up_your_bag']
      .map((k) => s.indexOf(k));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the key documents every marker a row can show', () => {
    // The amber ! and the overlap glyph appear on rows; both were in no legend at all.
    expect(s).toMatch(/practice_fit_profile\.key\.gap/);
    expect(s).toMatch(/practice_fit_profile\.key\.overlap/);
  });

  it('the header does not imply a twenty-club bag', () => {
    // 20 is every SLOT the app models; the USGA limit is 14. "of 20 clubs" read as his bag size.
    expect(s).not.toMatch(/totalCount: profile\.totalCount/);
    const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n/locales/en.json'), 'utf8'));
    expect(en.practice_fit_profile.fit_profile_screen.tracked_you_set_of_clubs).not.toMatch(/totalCount/);
  });

  it('colour carries meaning — amber is a gap, and nothing else competes with it', () => {
    // was: green scan, sky Arccos, amber gaps, cyan flex + sky ball — four accents, no hierarchy.
    // Sky survives ONLY on the Arccos import, where it is a third-party brand cue, and that lives in
    // the setup section at the bottom. Anywhere above it and it is competing with the analysis.
    const setupAt = s.indexOf('set_up_your_bag');
    for (const m of s.matchAll(/accent_sky/g)) expect(m.index).toBeGreaterThan(setupAt);
  });

  it('overlaps are ranked and capped rather than listed nine deep', () => {
    expect(s).toMatch(/sort\(\(a, b\) => a\.gapYards - b\.gapYards\)/);
    expect(s).toMatch(/\.slice\(0, 4\)/);
  });
});
