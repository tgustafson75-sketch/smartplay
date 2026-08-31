/**
 * 2026-08-31 — TPC SAWGRASS WAS NEVER MISSING FROM GOOGLE. WE DISCARDED IT.
 *
 * A player standing on the Stadium Course was offered Sawgrass Country Club — a different club
 * 2.6km away — and would have played the round on another club's card and yardages. Not "no course
 * found": a confidently wrong one, with nothing looking broken.
 *
 * For six days this was attributed to Google's coverage and parked behind a Google Cloud Console
 * change. Echoing what the endpoint threw away settled it in one request: `TPC Sawgrass` and
 * `TPC Sawgrass - Dye's Valley Course` were both in the rows every time, and isGolfPlace rejected
 * them — Google files the Stadium Course as `restaurant,food,lodging` (the clubhouse restaurant is
 * the business record) and the name contains no word the old name-regex knew.
 *
 * Every row below is REAL: captured verbatim from api/course-locate with `debug: true` at
 * 30.1985,-81.3944 on 2026-08-31, types included. That is the point of this test — the previous
 * belief about this bug was wrong twice, and reasoning is what was wrong both times.
 */
import { isGolfPlace, type Located } from '../../api/course-locate';

const row = (name: string, types: string[]): Located => ({
  name, types, place_id: null, lat: 30.19, lng: -81.39,
  vicinity: null, rating: null, open_now: null, closed_permanently: false,
});

describe('the course you are standing on survives the golf filter', () => {
  it('KEEPS TPC Sawgrass, which Google files as a restaurant', () => {
    // The whole defect, in one assertion.
    expect(isGolfPlace(row('TPC Sawgrass', ['restaurant', 'food', 'lodging', 'point_of_interest', 'establishment']))).toBe(true);
  });

  it('KEEPS the second course on the same property', () => {
    expect(isGolfPlace(row("TPC Sawgrass - Dye's Valley Course", ['point_of_interest', 'establishment']))).toBe(true);
  });

  it('KEEPS the plainly-named clubs that already worked — no recall traded away', () => {
    for (const [n, t] of [
      ['Sawgrass Country Club', ['point_of_interest', 'establishment']],
      ['Marsh Landing Country Club', ['point_of_interest', 'establishment']],
      ['Windsor Parke Golf Club', ['point_of_interest', 'establishment']],
    ] as const) {
      expect([n, isGolfPlace(row(n, [...t]))]).toEqual([n, true]);
    }
  });

  it('KEEPS a course Google DID type, whatever its name says', () => {
    expect(isGolfPlace(row('Pebble Beach', ['golf_course', 'establishment']))).toBe(true);
  });

  it('DROPS the hotel on the golf property — it has "Golf" in its name and is not somewhere you play', () => {
    // This one was being offered as the NEAREST course at 1.1km, ahead of every real club.
    expect(isGolfPlace(row('Sawgrass Marriott Golf Resort & Spa', ['lodging', 'point_of_interest', 'establishment']))).toBe(false);
  });

  it('DROPS the ordinary businesses the broad sweep also returns', () => {
    for (const [n, t] of [
      ['Walgreens', ['drugstore', 'convenience_store', 'store']],
      ['The UPS Store', ['finance', 'store', 'point_of_interest', 'establishment']],
      ['Ruth’s Chris Steak House', ['restaurant', 'food', 'point_of_interest', 'establishment']],
      ['Gagaoudakis Mike DDS', ['dentist', 'health', 'point_of_interest', 'establishment']],
      ['Palmer Catholic Academy', ['primary_school', 'school', 'point_of_interest', 'establishment']],
      ['Jacksonville', ['locality', 'political']],
      ['The Lodge & Club', ['spa', 'lodging', 'point_of_interest', 'establishment']],
      ['THE PLAYERS Championship', ['point_of_interest', 'establishment']],
    ] as const) {
      expect([n, isGolfPlace(row(n, [...t]))]).toEqual([n, false]);
    }
  });

  it('still DROPS the adjacent-but-not-a-course businesses the exclusions exist for', () => {
    for (const n of ['Topgolf Jacksonville', 'Sawgrass Driving Range', 'Ponte Vedra Mini Golf', 'The Golf Shop', 'Indoor Golf Simulator Co']) {
      expect([n, isGolfPlace(row(n, ['establishment']))]).toEqual([n, false]);
    }
  });
});

/**
 * 2026-08-31 (adversarial audit A) — A WORSE BUG THAN THE ONE ABOVE, found by seeding a CITY.
 *
 * Manhattan returned NINETEEN "courses", every one an indoor simulator bay or a mini-golf bar.
 * Google tags them `indoor_golf_course` AND `golf_course`, so the type check accepted them outright,
 * and no name list could ever have caught "Five Iron Golf" or "Puttery".
 *
 * TPC Sawgrass affected players on one property. This hands EVERY city player a simulator bay as
 * somewhere to play eighteen. Rows below are REAL, captured from production with types verbatim.
 */
describe('a simulator bay is not somewhere you play eighteen', () => {
  it('DROPS indoor golf even when Google ALSO tags it golf_course', () => {
    for (const [n, t] of [
      ['Five Iron Golf', ['indoor_golf_course', 'golf_course', 'sports_bar', 'sports_school']],
      ['GOLFZON Social - Brooklyn NY', ['indoor_golf_course', 'golf_course', 'sports_bar', 'restaurant']],
      ['iGolf By Space NYC | Trackman & Golf VX Simulators', ['indoor_golf_course', 'golf_course', 'sports_school']],
      ['Hudson Golf', ['indoor_golf_course', 'banquet_hall', 'golf_course', 'athletic_field']],
      ['Powerhouse Golf Club', ['indoor_golf_course', 'golf_course', 'athletic_field', 'sports_club']],
      ['Ready Golf Club', ['indoor_golf_course', 'golf_course', 'athletic_field', 'establishment']],
      ['Fitness Factory Health Club', ['fitness_center', 'indoor_golf_course', 'golf_course', 'gym']],
      ['The Ryder Cup Room', ['indoor_golf_course', 'golf_course', 'athletic_field', 'establishment']],
    ] as const) {
      expect([n, isGolfPlace(row(n, [...t]))]).toEqual([n, false]);
    }
  });

  it('DROPS a mini-golf cocktail bar tagged golf_course', () => {
    expect(isGolfPlace(row('Puttery', ['miniature_golf_course', 'indoor_golf_course', 'golf_course', 'cocktail_bar']))).toBe(false);
  });

  it('and the real outdoor courses in the SAME queries still survive', () => {
    for (const [n, t] of [
      ['TPC Scottsdale PGA', ['golf_course', 'establishment']],
      ['Winged Foot Golf Club', ['point_of_interest', 'establishment']],
      ['Riviera Country Club', ['point_of_interest', 'establishment']],
    ] as const) {
      expect([n, isGolfPlace(row(n, [...t]))]).toEqual([n, true]);
    }
  });
});
