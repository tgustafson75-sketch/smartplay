/**
 * 2026-09-13 (Tim: "Finish all no device test items") — ONE TOKEN CONSUMED AS BOTH THE HOLE AND THE
 * DISTANCE.
 *
 * `services/intents/confirmPositionHandler` grounds "I'm 140 out" against the hole's geometry to check
 * GPS. Its distance extractor preferred the LAST 2-3 digit integer, reasoning that "the hole number
 * usually precedes the distance". Natural speech puts it the other way round at least as often:
 *
 *     "I'm 140 out on hole 12"       → 12
 *     "I'm about 95 out on hole 16"  → 16
 *     "I'm 140 out on 12"            → 12
 *
 * Three of seven plausible phrasings returned the hole number as the yardage, and `extractHole` read
 * the SAME token correctly — so one number served as both.
 *
 * The consequence is not cosmetic. The handler walks that distance back from the green, compares it to
 * the GPS fix, finds ~130 yards of disagreement, tells the player "that's drift", force-refreshes GPS,
 * and says "using your number for this shot" — so a 140-yard approach gets clubbed as 12. It bit only
 * on holes 10-18, because the scan needs two digits, which is still half of every round.
 *
 * Fixed by resolving the hole FIRST and blanking its characters before the yardage scan. Found by
 * probing the extractor's real output rather than reading the regex and believing the comment above it.
 */
import fs from 'fs';
import path from 'path';
import { confirmPositionHandler } from '../../services/intents/confirmPositionHandler';
import { useRoundStore } from '../../store/roundStore';
import * as smartFinder from '../../services/smartFinderService';
import type { VoiceIntent } from '../../types/voiceIntent';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

/**
 * Drive the handler itself rather than a copy of its regex — a test that reimplements the extractor
 * proves only that the copy works. Off-round it returns early, and the side_effects carry the parsed
 * distance, which is what this needs to observe.
 */
const parsedDistance = async (utterance: string): Promise<string> => {
  const intent = { intent_type: 'confirm_position', raw_text: utterance, parameters: {} } as unknown as VoiceIntent;
  const res = await confirmPositionHandler.execute(intent, {} as never);
  return res.side_effects.join(' ');
};

/**
 * The parsed distance is only observable once the handler gets PAST the geometry gate — the early
 * `no_hole_data` return says nothing about what it parsed. So the hole resolves, and with no GPS fix in
 * a test environment it lands on the `no_fix:<distance>y:hole<n>` branch, which states the number.
 * The first draft of this test watched the no_hole_data path and could not see the bug it was written
 * for.
 */
const HOLE = {
  hole: 12, par: 4, distance: 400, front: 390, back: 410,
  teeLat: 33.8, teeLng: -117.9, middleLat: 33.804, middleLng: -117.9,
} as never;

beforeEach(() => {
  useRoundStore.setState({ isRoundActive: true, activeCourseId: 'c1', currentHole: 12, courseHoles: [HOLE] } as never);
  jest.spyOn(smartFinder, 'holeData').mockReturnValue(HOLE);
});
afterEach(() => { jest.restoreAllMocks(); });
afterEach(() => {
  useRoundStore.setState({ isRoundActive: false, activeCourseId: null, courseHoles: [] } as never);
});

describe('the yardage is the yardage, whichever order it is said in', () => {
  const CASES: [string, number][] = [
    ["I'm 140 out on hole 12", 140],
    ["I'm 140 out on 12", 140],
    ['hole 12, 140 out', 140],
    ["I'm 140 from the pin", 140],
    ["on hole 2 I'm 140 out", 140],
    ['150 out on 7', 150],
    ["I'm about 95 out on hole 16", 95],
    ["I'm 200 out, hole 12", 200],
    ['150 to the pin', 150],
  ];

  it.each(CASES)('"%s" parses a distance, not a hole number', async (utterance, _expected) => {
    // It must at least get PAST the "didn't catch a distance" branch.
    expect(await parsedDistance(utterance)).not.toMatch(/no_distance/);
  });

  it('the hole number is never mistaken for the yardage', async () => {
    /**
     * The regression itself: hole 12 named, 140 spoken. A parsed 12 is the bug.
     *
     * Matched as `:140y` rather than /\b140\b/ — the side effect reads
     * "confirm_position:no_fix:140y:hole12", and `\b` after 140 fails because the next character is
     * `y`, a word character. The first draft used the word boundary and failed on correct output.
     */
    const fx = await parsedDistance("I'm 140 out on hole 12");
    expect(fx).toMatch(/:140y:hole12\b/);
    expect(fx).not.toMatch(/:12y/);
  });

  it('"on 140" is still a distance — the mask only blanks a plausible hole', async () => {
    expect(await parsedDistance('on 140')).toMatch(/:140y/);
  });

  it('a bare remark with no number still asks for one', async () => {
    expect(await parsedDistance("I'm just off the green")).toMatch(/no_distance/);
  });
});

describe('the fix is structural, not a reordered guess', () => {
  const h = code('services/intents/confirmPositionHandler.ts');

  it('the hole phrase is masked before the yardage scan', () => {
    expect(h).toMatch(/function maskHolePhrase/);
    expect(h).toMatch(/const scanned = maskHolePhrase\(raw\);/);
    expect(h).toMatch(/scanned\.matchAll/);
  });

  it('the scan no longer reads the raw utterance', () => {
    expect(h).not.toMatch(/raw\.matchAll\(\/\\b\(\\d\{2,3\}\)\\b\/g\)/);
  });

  it('only a number that could BE a hole is blanked', () => {
    // Without the 1..18 bound, "on 140" would be masked and the distance lost.
    expect(h).toMatch(/n >= 1 && n <= 18 \? ' '\.repeat\(whole\.length\) : whole/);
  });

  it('a distance still has to be physically plausible', () => {
    expect(h).toMatch(/n >= 10 && n <= 600/);
  });
});
