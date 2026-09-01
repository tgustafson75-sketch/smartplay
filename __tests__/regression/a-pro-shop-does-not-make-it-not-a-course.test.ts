/**
 * 2026-09-01 (Tim, from the field at Menifee: "all other Menifee Lakes listing only pull up Palms").
 *
 * On 08-31 the golf guard gained `golf_shop` and `sporting_goods_store` as outright disqualifying
 * TYPES, to kill simulator bars that Google tags `golf_course` (Five Iron Golf, Puttery). A live
 * sweep of Tim's own area the next day showed what that cost:
 *
 *   The Golf Club at Rancho California   DROPPED  <- sporting_goods_store
 *   Canyon Lake Golf & Country Club      DROPPED  <- sporting_goods_store
 *
 * Both are real 18-hole courses that carry a retail type because THEY HAVE A PRO SHOP — which is
 * true of most decent clubs. A rule aimed at simulator bars was silently deleting the good half of
 * the list, and it took a player standing in Menifee to notice. [[overstrict-gate-lens]]
 */
import { isGolfPlace } from '../../api/course-locate';

const place = (name: string, types: string[]) =>
  ({ name, types, place_id: 'x', lat: 0, lng: 0, vicinity: null, rating: null, open_now: null, closed_permanently: false }) as never;

describe('a pro shop does not make it not a course', () => {
  it('THE REPORT: the two real courses dropped in Tim’s area come back', () => {
    // Types verbatim from the live debug echo on 2026-09-01.
    expect(isGolfPlace(place('The Golf Club at Rancho California',
      ['golf_course', 'sporting_goods_store', 'point_of_interest', 'establishment']))).toBe(true);
    expect(isGolfPlace(place('Canyon Lake Golf & Country Club',
      ['breakfast_restaurant', 'golf_course', 'sporting_goods_store', 'store', 'restaurant', 'food', 'point_of_interest', 'establishment']))).toBe(true);
  });

  it('and Menifee Lakes itself is still kept', () => {
    expect(isGolfPlace(place('Menifee Lakes Country Club',
      ['golf_course', 'athletic_field', 'point_of_interest', 'establishment']))).toBe(true);
  });

  it('a course with a pro shop is kept whatever the retail tag', () => {
    for (const t of ['golf_shop', 'sporting_goods_store']) {
      expect(isGolfPlace(place('Pebble Beach Golf Links', ['golf_course', t, 'lodging']))).toBe(true);
      expect(isGolfPlace(place('PGA West', ['golf_course', t]))).toBe(true);
    }
  });
});

describe('the places the rule was written for are still rejected', () => {
  it('simulator bars and putt-putt stay out — those types are still hard disqualifiers', () => {
    expect(isGolfPlace(place('Five Iron Golf', ['indoor_golf_course', 'golf_course', 'bar']))).toBe(false);
    expect(isGolfPlace(place('Puttery', ['indoor_golf_course', 'golf_course', 'bar']))).toBe(false);
    expect(isGolfPlace(place('Canyon Lake Tee Box', ['indoor_golf_course', 'golf_course', 'miniature_golf_course']))).toBe(false);
    expect(isGolfPlace(place('Asterisk Sport Co.', ['indoor_golf_course', 'golf_course']))).toBe(false);
    expect(isGolfPlace(place('The Clubhouse Indoor Golf World', ['indoor_golf_course', 'golf_course']))).toBe(false);
  });

  it('an actual shop is still rejected — retail types bind when the name claims no course', () => {
    expect(isGolfPlace(place('Golf Galaxy', ['sporting_goods_store', 'golf_shop', 'store']))).toBe(false);
    expect(isGolfPlace(place('Roger Dunn Golf Shops', ['golf_shop', 'sporting_goods_store', 'store']))).toBe(false);
    // A bare "golf" in the name must NOT buy an exemption — every golf shop has that word.
    expect(isGolfPlace(place('Bob’s Golf Outlet', ['sporting_goods_store', 'store']))).toBe(false);
  });

  it('the exemption needs a course noun or the TPC/PGA tokens, nothing looser', () => {
    expect(isGolfPlace(place('Something Golf Course', ['sporting_goods_store']))).toBe(true);
    expect(isGolfPlace(place('Somewhere Country Club', ['sporting_goods_store']))).toBe(true);
    expect(isGolfPlace(place('Just Golf', ['sporting_goods_store']))).toBe(false);
  });
});
