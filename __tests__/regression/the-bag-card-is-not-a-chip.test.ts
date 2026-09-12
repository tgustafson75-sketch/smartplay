/**
 * 2026-09-11 (Tim) — "That location and look for set your bag is awful. Gets lost on non-related
 * factors. Give it its own slim card."
 *
 * It first shipped as a chip in the round-format row, beside Competition, Front/Back nine,
 * Tournament and Challenge. The problem is structural rather than cosmetic: everything else in that
 * row is a TOGGLE or a flow you open, and this is a STATE WITH A VALUE — how many clubs are going
 * out with you. A value placed in a row of toggles reads as a toggle, and disappears.
 *
 * It is also the one setting that makes a wrong club call impossible to explain away, so it has to
 * be legible at a glance before the first tee.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/play.tsx'), 'utf8');
const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('the bag has its own card', () => {
  it('renders through bagCard, not the shared chip style', () => {
    expect(clean).toMatch(/style=\{\[styles\.bagCard, isPartialBag && styles\.bagCardActive\]\}/);
  });

  it('the bag text no longer appears inside a chip', () => {
    // The failure mode is someone "tidying" it back into the factorRow.
    const chipUses = [...clean.matchAll(/styles\.chipText[^\n]*play\.play_tab\.(bag_|set_your_bag|your_bag)/g)];
    expect(chipUses).toHaveLength(0);
  });

  it('sits OUTSIDE the format chip row — after it closes, before GETTING AROUND', () => {
    const compAt = clean.indexOf("t('play.competition')");
    const cardAt = clean.indexOf('styles.bagCard,');
    const gettingAt = clean.indexOf("play.getting_around");
    expect(compAt).toBeGreaterThan(-1);
    expect(cardAt).toBeGreaterThan(compAt);      // after the format choices
    expect(gettingAt).toBeGreaterThan(cardAt);   // and before the next section
  });

  it('is SLIM — one value line, not the two-line factorCard', () => {
    const at = src.indexOf('  bagCard: {');
    expect(at).toBeGreaterThan(-1);
    const style = src.slice(at, at + 420);
    expect(style).toMatch(/flexDirection: 'row'/);
    const pv = Number(/paddingVertical: (\d+)/.exec(style)![1]);
    expect(pv).toBeLessThanOrEqual(12);          // slim: a status row, not a settings card
  });

  it('but carries enough WEIGHT not to be skipped — it must not wear the chips\' own chrome', () => {
    /**
     * The first version used c.surface + c.border, which is exactly what the chips above it use, so
     * a card meant to be its own thing looked like more of the row it had been taken out of.
     * Tim: "needs to stand out a bit more so it doesn't get skipped."
     */
    const at = src.indexOf('  bagCard: {');
    const style = src.slice(at, at + 420);
    expect(style).toMatch(/borderLeftWidth: 3/);                 // a persistent vertical cue
    expect(style).toMatch(/borderLeftColor: c\.accent/);
    expect(style).toMatch(/backgroundColor: c\.surface_elevated/); // lifts off the flat chips
    expect(style).not.toMatch(/backgroundColor: c\.surface,/);     // never back to chip chrome
  });
});

describe('what the card actually says', () => {
  it('leads with the COUNT, which is the fact checked before the first tee', () => {
    expect(clean).toMatch(/t\('play\.play_tab\.bag_count', \{ count: carriedCount \}\)/);
  });

  it('shows carried-of-owned when he has pared the bag down', () => {
    expect(clean).toMatch(/bag_of_owned', \{ packed: carriedCount, owned: ownedCount \}/);
  });

  it('says so plainly when no clubs are registered, rather than showing a zero', () => {
    expect(clean).toMatch(/ownedCount === 0/);
    expect(clean).toMatch(/play\.play_tab\.bag_not_set/);
  });

  it('the partial-bag state ESCALATES the styling rather than being the only accent', () => {
    // 2026-09-11 second pass: the card now carries a permanent accent left edge so it is not
    // skipped. The partial state still adds the full accent border and an accent value on top, so
    // "you have pared this down" still reads as a change rather than as ambient colour.
    // 2026-09-11 — the icon's tinted badge went when Tim asked for the badge treatment off: it was
    // a second ring around art whose own ring had just been stripped for legibility. The escalation
    // now runs through the CARD and the VALUE, which is where it was always most visible.
    expect(clean).toMatch(/isPartialBag && styles\.bagCardActive/);
    expect(clean).toMatch(/isPartialBag && \{ color: '#00C896' \}/);
    expect(clean).not.toMatch(/bagIconWrap/);   // the badge must not come back
  });

  it('reads the CARRIED count and the OWNED count from the store, never a constant', () => {
    expect(clean).toMatch(/const carriedCount = useClubBagStore\(\(st\) => st\.carriedList\(\)\.length\)/);
    expect(clean).toMatch(/const ownedCount = useClubBagStore\(\(st\) => Object\.keys\(st\.clubs\)\.length\)/);
  });
});

/**
 * 2026-09-11 (Tim) — "needs a slightly bigger icon that clearly says golf bag."
 *
 * It was Ionicons `golf` — a flag and a ball. On the Play tab that says GOLF, which is the one thing
 * every icon on the screen already says, so it carried no information and the eye had nothing to
 * catch. No installed icon family has a literal golf bag (checked all five); the nearest true
 * silhouette is MaterialCommunityIcons `bag-personal`, a tall upright bag with a shoulder strap.
 */
describe('the icon says BAG, not just golf', () => {
  /**
   * 2026-09-11, twice. First it was Ionicons `golf` — a flag and a ball, which on the Play tab says
   * GOLF, the one thing every icon there already says. Then MaterialCommunityIcons `bag-personal`,
   * which Tim called correctly: "that looks like a fucking suitcase." It is luggage.
   *
   * No icon family ships a golf bag. So one was PRODUCED to the Smart Motion style lock and lives in
   * assets/icons/play — a golf bag with clubs fanning out of the top, which is the only version of
   * this that actually reads.
   */
  it('uses the branded golf-bag asset, not a stock glyph', () => {
    expect(clean).toMatch(/bag: require\('\.\.\/\.\.\/assets\/icons\/play\/sec-your-bag\.png'\)/);
    expect(clean).toMatch(/<Image source=\{SEC_ICON\.bag\}/);
  });

  it('neither stock stand-in can come back to this card', () => {
    const at = clean.indexOf('source={SEC_ICON.bag}');
    const block = clean.slice(Math.max(0, at - 300), at + 300);
    expect(block).not.toMatch(/name="golf"/);
    expect(block).not.toMatch(/bag-personal/);
  });

  it('the asset exists on disk — a missing require is a red box at runtime', () => {
    const p = require('path').join(__dirname, '../../assets/icons/play/sec-your-bag.png');
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.statSync(p).size).toBeGreaterThan(2000);
  });

  it('is tinted from the theme, so it cannot wash out in light mode', () => {
    // The raw brand lime does not hold up on a white field; accent_lime already resolves per mode.
    expect(clean).toMatch(/source=\{SEC_ICON\.bag\}[^/]*tintColor=\{colors\.accent_lime\}/);
  });

  it('and the unused icon family went with the glyph it was added for', () => {
    // Comments stripped first: the note explaining the REMOVAL names the thing removed, so a raw
    // match fails on the explanation. Fifth time today. [[strip-comments-before-a-guard-matches]]
    const wrapper = fs.readFileSync(path.join(__dirname, '../../components/AppIcon.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(wrapper).not.toMatch(/MaterialCommunityIcons/);
  });
});
