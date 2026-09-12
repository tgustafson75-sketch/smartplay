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
    expect(clean).toMatch(/isPartialBag && styles\.bagCardActive/);
    expect(clean).toMatch(/isPartialBag && styles\.bagIconWrapActive/);
    expect(clean).toMatch(/isPartialBag && \{ color: '#00C896' \}/);
  });

  it('reads the CARRIED count and the OWNED count from the store, never a constant', () => {
    expect(clean).toMatch(/const carriedCount = useClubBagStore\(\(st\) => st\.carriedList\(\)\.length\)/);
    expect(clean).toMatch(/const ownedCount = useClubBagStore\(\(st\) => Object\.keys\(st\.clubs\)\.length\)/);
  });
});
