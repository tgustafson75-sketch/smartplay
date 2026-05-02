/**
 * Phase Q.5b — Pre-built simulated walk paths for the GPS test harness.
 *
 * Each path is an array of [lat, lng] waypoints representing a walking
 * trace through the course. The harness advances through them at
 * realistic walking pace (~3 mph = ~5.4 yards/second), interpolating
 * between consecutive waypoints.
 *
 * Structure per hole: [tee] → [fairway midpoint] → [green-front] → [green-center]
 * Then a brief between-hole walk: green → next-tee.
 *
 * Coordinates are real GPS for the courses listed. Pebble Beach and
 * Menifee Lakes (Tim's home course) come from public OSM/golfcourseapi
 * data. The Palms entry mirrors Menifee Lakes (same club, different
 * 18). Coordinates are approximate but sufficient for sustained-position
 * detection logic verification.
 */

export interface SimulatedWalkPoint {
  lat: number;
  lng: number;
  /** Optional label for console-log readability (e.g., "Hole 3 tee"). */
  label?: string;
}

export interface SimulatedWalk {
  id: string;
  display_name: string;
  course_name_hint: string;  // used to match against round-store activeCourse
  description: string;
  /** Walking pace in meters/second (default ~1.4 = walking). */
  pace_mps?: number;
  points: SimulatedWalkPoint[];
}

// Menifee Lakes Country Club — Palms course (Tim's home).
// 33.6882°N, 117.1599°W. Per-hole approximations along a generally
// north-south layout with a clubhouse return at hole 9.
const MENIFEE_LAKES_PALMS: SimulatedWalk = {
  id: 'menifee-lakes-palms',
  display_name: 'Menifee Lakes — Palms (9 holes)',
  course_name_hint: 'palms',
  description: "Tim's home course. 9-hole simulated walk with green/tee approach traces.",
  pace_mps: 1.5,
  points: [
    // Hole 1 — Par 4
    { lat: 33.68820, lng: -117.15990, label: 'Hole 1 tee' },
    { lat: 33.68720, lng: -117.16010, label: 'Hole 1 fairway' },
    { lat: 33.68620, lng: -117.16030, label: 'Hole 1 approach' },
    { lat: 33.68580, lng: -117.16040, label: 'Hole 1 green' },
    // Hole 2 — Par 4
    { lat: 33.68565, lng: -117.16025, label: 'Hole 2 tee' },
    { lat: 33.68470, lng: -117.16005, label: 'Hole 2 fairway' },
    { lat: 33.68380, lng: -117.15990, label: 'Hole 2 green' },
    // Hole 3 — Par 4
    { lat: 33.68365, lng: -117.16005, label: 'Hole 3 tee' },
    { lat: 33.68450, lng: -117.16080, label: 'Hole 3 fairway (dogleg)' },
    { lat: 33.68490, lng: -117.16170, label: 'Hole 3 green' },
    // Hole 4 — Par 5
    { lat: 33.68505, lng: -117.16185, label: 'Hole 4 tee' },
    { lat: 33.68420, lng: -117.16280, label: 'Hole 4 fairway' },
    { lat: 33.68340, lng: -117.16370, label: 'Hole 4 second shot' },
    { lat: 33.68290, lng: -117.16440, label: 'Hole 4 green' },
    // Hole 5 — Par 4
    { lat: 33.68275, lng: -117.16455, label: 'Hole 5 tee' },
    { lat: 33.68190, lng: -117.16380, label: 'Hole 5 fairway' },
    { lat: 33.68120, lng: -117.16320, label: 'Hole 5 green' },
    // Hole 6 — Par 4
    { lat: 33.68135, lng: -117.16305, label: 'Hole 6 tee' },
    { lat: 33.68220, lng: -117.16240, label: 'Hole 6 fairway' },
    { lat: 33.68290, lng: -117.16190, label: 'Hole 6 green' },
    // Hole 7 — Par 4
    { lat: 33.68310, lng: -117.16175, label: 'Hole 7 tee' },
    { lat: 33.68395, lng: -117.16100, label: 'Hole 7 fairway' },
    { lat: 33.68460, lng: -117.16050, label: 'Hole 7 green (water right)' },
    // Hole 8 — Par 4
    { lat: 33.68480, lng: -117.16035, label: 'Hole 8 tee' },
    { lat: 33.68565, lng: -117.15960, label: 'Hole 8 fairway' },
    { lat: 33.68635, lng: -117.15910, label: 'Hole 8 green' },
    // Hole 9 — Par 5 (finish near clubhouse)
    { lat: 33.68655, lng: -117.15895, label: 'Hole 9 tee' },
    { lat: 33.68740, lng: -117.15880, label: 'Hole 9 fairway' },
    { lat: 33.68800, lng: -117.15920, label: 'Hole 9 second shot' },
    { lat: 33.68830, lng: -117.15970, label: 'Hole 9 green (clubhouse return)' },
  ],
};

// Pebble Beach — first 9 holes. Coordinates approximate the Pebble Beach
// Golf Links layout from public OSM.
const PEBBLE_BEACH_FRONT_NINE: SimulatedWalk = {
  id: 'pebble-beach-front-nine',
  display_name: 'Pebble Beach — Front 9',
  course_name_hint: 'pebble',
  description: 'Pebble Beach Golf Links front 9 sim walk for distance + transition verification.',
  pace_mps: 1.5,
  points: [
    { lat: 36.5685, lng: -121.9410, label: 'Hole 1 tee' },
    { lat: 36.5675, lng: -121.9425, label: 'Hole 1 fairway' },
    { lat: 36.5670, lng: -121.9445, label: 'Hole 1 green' },
    { lat: 36.5665, lng: -121.9450, label: 'Hole 2 tee' },
    { lat: 36.5650, lng: -121.9470, label: 'Hole 2 green' },
    { lat: 36.5645, lng: -121.9475, label: 'Hole 3 tee' },
    { lat: 36.5630, lng: -121.9495, label: 'Hole 3 green' },
    { lat: 36.5625, lng: -121.9500, label: 'Hole 4 tee' },
    { lat: 36.5615, lng: -121.9520, label: 'Hole 4 green (cliffside)' },
    { lat: 36.5610, lng: -121.9525, label: 'Hole 5 tee' },
    { lat: 36.5600, lng: -121.9540, label: 'Hole 5 green' },
    { lat: 36.5595, lng: -121.9545, label: 'Hole 6 tee' },
    { lat: 36.5580, lng: -121.9560, label: 'Hole 6 green' },
    { lat: 36.5575, lng: -121.9565, label: 'Hole 7 tee (signature par 3)' },
    { lat: 36.5572, lng: -121.9572, label: 'Hole 7 green' },
    { lat: 36.5575, lng: -121.9560, label: 'Hole 8 tee' },
    { lat: 36.5590, lng: -121.9540, label: 'Hole 8 fairway (cliff carry)' },
    { lat: 36.5605, lng: -121.9525, label: 'Hole 8 green' },
    { lat: 36.5610, lng: -121.9520, label: 'Hole 9 tee' },
    { lat: 36.5625, lng: -121.9500, label: 'Hole 9 fairway' },
    { lat: 36.5640, lng: -121.9485, label: 'Hole 9 green' },
  ],
};

// Generic flat-layout test course — useful for raw transition logic
// verification without real-course coordinate noise.
const GENERIC_TEST_COURSE: SimulatedWalk = {
  id: 'generic-test-course',
  display_name: 'Generic Test Course (synthetic)',
  course_name_hint: 'test',
  description: 'Synthetic linear 9-hole layout for raw transition logic verification.',
  pace_mps: 2.0,
  points: Array.from({ length: 9 }).flatMap((_, i) => {
    const baseLat = 33.700 + i * 0.0030;
    return [
      { lat: baseLat,         lng: -117.160, label: `Hole ${i + 1} tee` },
      { lat: baseLat + 0.001, lng: -117.160, label: `Hole ${i + 1} fairway` },
      { lat: baseLat + 0.002, lng: -117.160, label: `Hole ${i + 1} green` },
    ];
  }),
};

export const SIMULATED_WALKS: SimulatedWalk[] = [
  MENIFEE_LAKES_PALMS,
  PEBBLE_BEACH_FRONT_NINE,
  GENERIC_TEST_COURSE,
];
