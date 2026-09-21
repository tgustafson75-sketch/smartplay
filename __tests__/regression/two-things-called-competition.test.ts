/**
 * 2026-09-20 (Tim, from Echo Hills) — "I put in competetion thinking that would allow me to add a
 * scorecard for my daughter but that did not work. Nothing is more irratating than missing items I
 * have worked on multiple times."
 *
 * HE WAS NOT GUESSING — THE APP TAUGHT HIM THAT. Two different things were called competition:
 *
 *   - services/knowledgeBase/appCatalog lists 'competition' as an ALIAS of Tournament Mode and
 *     blurbed it "Competition scoring with playing partners / guests" — the multiplayer tool.
 *   - app/(tabs)/play.tsx has a chip labelled "Competition" sitting one chip away from it, which
 *     only sets a flag that tells the brain to be conservative and badges the scorecard.
 *
 * He tapped the one the app's own knowledge base defines as the multiplayer one. It does not even
 * change the bag: carryLimitFor ignores its argument and always returns fourteen.
 *
 * And the caddie could not rescue him: there was NO how-to for scoring another person, so asking
 * would have returned nothing.
 *
 * What is NOT claimed here, deliberately: per-player scorecards inside a normal GPS round still do
 * not exist. Tournament is a parallel flow. This guards the NAMING and the DISCOVERABILITY — that
 * the one surface which does score other people is findable and the other one stops pretending to.
 */
import * as fs from 'fs';
import * as path from 'path';
import { HOW_TO } from '../../services/knowledgeBase/howTo';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const en = JSON.parse(read('i18n/locales/en.json'));
const catalog = read('services/knowledgeBase/appCatalog.ts');
const bag = read('store/clubBagStore.ts');

describe('two things were called competition', () => {
  it('the chip that adds people says so on its face', () => {
    // "Tournament" is what the destination is called; it is not what a parent looking for their
    // daughter's scorecard searches for.
    expect(en.play.tournament).toMatch(/player/i);
  });

  it('the chip that does NOT add people says what it actually does', () => {
    const label = en.play.accessibility_label.competition_round_conservative as string;
    expect(label).toMatch(/conservativ/i);
    // ...and points at the one that does, because that is the whole failure.
    expect(label).toMatch(/add players/i);
  });

  it('the catalog blurb leads with players, not the word that collided', () => {
    const entry = catalog.slice(catalog.indexOf("id: 'tournament'"));
    const blurb = entry.slice(0, entry.indexOf('},'));
    expect(blurb).toMatch(/blurb: '[^']*player/i);
    expect(blurb).not.toMatch(/blurb: 'Competition scoring/);
  });

  it('the caddie can answer "add a scorecard for my daughter"', () => {
    const entry = HOW_TO.find((h) => h.id === 'score-another-player');
    expect(entry).toBeDefined();
    const asks = entry!.asks.map((a) => a.toLowerCase());
    expect(asks.some((a) => a.includes('daughter'))).toBe(true);
    expect(asks.some((a) => a.includes('add a player'))).toBe(true);
    // The answer must separate the two, or it repeats the confusion it exists to fix.
    expect(entry!.steps).toMatch(/Add Players/);
    expect(entry!.steps.toLowerCase()).toMatch(/competition chip is a different thing|does not add/);
  });

  it('the 14-club claim is not made anywhere, because the code does not make it', () => {
    // carryLimitFor takes the flag and ignores it. Any label promising a club cap would be false.
    expect(bag).toMatch(/carryLimitFor\(_isCompetition: boolean\): number \{\s*\n?\s*return USGA_CLUB_LIMIT;/);
    const label = en.play.accessibility_label.competition_round_conservative as string;
    expect(label).not.toMatch(/14|fourteen|club limit/i);
  });
});
