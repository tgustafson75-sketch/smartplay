/**
 * features/courses/data/courseGPS.ts
 *
 * GPS bounding circles for every course in COURSE_DB.
 * id must match COURSE_DB[n].id.
 *
 * radius is in metres. 500 m covers most course entrances without
 * triggering false positives while driving past on the highway.
 *
 * bookingUrl is the tee-time page opened in-app via WebView.
 */

export interface CourseGPSEntry {
  // Must match the id field in COURSE_DB
  id:         string;
  name:       string;
  lat:        number;
  lng:        number;
  /** Detection radius in metres */
  radius:     number;
  bookingUrl: string;
}

export const COURSE_GPS: CourseGPSEntry[] = [
  {
    id:         'menifee_lakes_palms',
    name:       'Menifee Lakes — Palms',
    lat:        33.7015,
    lng:        -117.1820,
    radius:     500,
    bookingUrl: 'https://menifeelakes.com/tee-times',
  },
  {
    id:         'menifee_lakes_lakes',
    name:       'Menifee Lakes — Lakes',
    lat:        33.7040,
    lng:        -117.1845,
    radius:     500,
    bookingUrl: 'https://menifeelakes.com/tee-times',
  },
  // ── Add more courses here ──────────────────────────────────────────────────
];
