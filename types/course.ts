export interface Course {
  id: string; // golfcourseapi course_id as string
  club_name: string;
  course_name: string;
  location: {
    city: string;
    state: string;
    country: string;
    latitude?: number;
    longitude?: number;
  };
  tees: TeeBox[];
  cached_at: number; // unix ms
}

export interface TeeBox {
  tee_name: string; // e.g. "Blue", "White", "Red"
  total_yards: number;
  course_rating: number | null;
  slope_rating: number | null;
  par_total: number;
  holes: Hole[];
  /**
   * 2026-08-21 — WHOSE RATING THIS IS, and it is not cosmetic.
   *
   * Found building Sharp Park (Pacifica) through the real user path. golfcourseapi returns
   * `{ female: [...], male: [...] }`, and extractTees was flattening BOTH into one list while
   * discarding the gender key. Sharp Park then presents as EIGHT tees that are really four:
   *
   *     Blue  6416y — 77.5/135 (women's)  AND  71.2/125 (men's)
   *     White 6165y — 76.1/132            AND  70.0/124
   *
   * Identical yardages, two rating sets. pickTeeSet orders by yardage alone, so a tie resolves to
   * whichever came first — the women's set, because the API lists it first. The HOLES were right;
   * the RATING AND SLOPE were the wrong player's.
   *
   * That is not a display nit. Course handicap is (Index × Slope/113) + (Rating − Par), so a man
   * playing Sharp Park off the Blues was being handed a course handicap computed from a 77.5/135
   * instead of 71.2/125 — wrong net scores, and wrong posting.
   */
  gender?: 'male' | 'female' | null;
}

export interface Hole {
  hole_number: number;
  par: number;
  yardage: number;
  handicap: number | null;
  gps: { lat: number; lng: number } | null;
  hazards: string[];
}
