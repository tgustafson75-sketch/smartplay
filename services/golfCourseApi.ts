import * as FileSystem from 'expo-file-system/legacy';
import type { Course, TeeBox, Hole } from '../types/course';
import type { CourseHole } from '../store/roundStore';

// ─── Config ───────────────────────────────────────────────────────────────────

const CACHE_DIR = (FileSystem.documentDirectory ?? '') + 'course_cache/';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function proxyUrl(params: Record<string, string>): string {
  const base = (process.env.EXPO_PUBLIC_API_URL ?? '') + '/api/course-proxy';
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${base}?${qs}`;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

async function ensureCacheDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
}

async function readCachedCourse(course_id: string): Promise<Course | null> {
  try {
    await ensureCacheDir();
    const path = CACHE_DIR + course_id + '.json';
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    return JSON.parse(raw) as Course;
  } catch {
    return null;
  }
}

async function writeCachedCourse(course: Course): Promise<void> {
  try {
    await ensureCacheDir();
    const path = CACHE_DIR + course.id + '.json';
    await FileSystem.writeAsStringAsync(path, JSON.stringify(course));
  } catch (e) {
    console.warn('[golfcourseapi] cache write failed:', e);
  }
}

function isCacheStale(cached_at: number): boolean {
  return Date.now() - cached_at > CACHE_TTL_MS;
}

export async function clearCourseCache(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(CACHE_DIR);
    if (info.exists) await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
  } catch (e) {
    console.warn('[golfcourseapi] cache clear failed:', e);
  }
}

// ─── Response normalization ───────────────────────────────────────────────────

// golfcourseapi.com response shapes vary — normalize defensively.

type RawHole = {
  hole_number?: number;
  number?: number;
  par?: number;
  yardage?: number;
  yards?: number;
  handicap?: number;
  handicap_index?: number;
  lat?: number | null;
  lng?: number | null;
  note?: string;
  notes?: string;
  description?: string;
  desc?: string;
  features?: string[] | string;
  tee_description?: string;
  hole_description?: string;
  hazards?: string[] | string;
  comments?: string;
};

type RawTee = {
  tee_name?: string;
  name?: string;
  total_yards?: number;
  yardage?: number;
  course_rating?: number | null;
  rating?: number | null;
  slope_rating?: number | null;
  slope?: number | null;
  par_total?: number;
  par?: number;
  holes?: RawHole[];
};

type RawCourse = {
  id?: number | string;
  club_name?: string;
  course_name?: string;
  name?: string;
  city?: string;
  state_code?: string;
  state?: string;
  country?: string;
  tees?: RawTee[] | { male?: RawTee[]; female?: RawTee[] } | Record<string, RawTee[]>;
};

const HAZARD_KEYWORDS = [
  'bunker', 'sand', 'water', 'hazard', 'ob', 'out of bounds',
  'pond', 'creek', 'lake', 'stream', 'trees', 'woods', 'rough',
  'fescue', 'waste', 'marsh', 'fairway bunker', 'greenside',
];

function extractHazardsFromRawHole(raw: RawHole): string[] {
  const candidateStrings: string[] = [];

  const stringFields = [
    raw.note, raw.notes, raw.description, raw.desc,
    raw.tee_description, raw.hole_description, raw.comments,
  ];
  for (const field of stringFields) {
    if (typeof field === 'string' && field.trim()) {
      candidateStrings.push(field.trim());
    }
  }

  for (const field of [raw.features, raw.hazards]) {
    if (Array.isArray(field)) {
      candidateStrings.push(...field.filter((s): s is string => typeof s === 'string' && s.trim().length > 0));
    } else if (typeof field === 'string' && field.trim()) {
      candidateStrings.push(field.trim());
    }
  }

  const hazardStrings = candidateStrings.filter(s => {
    const lower = s.toLowerCase();
    return HAZARD_KEYWORDS.some(keyword => lower.includes(keyword));
  });

  return [...new Set(hazardStrings)];
}

function normalizeHole(raw: RawHole): Hole {
  return {
    hole_number: raw.hole_number ?? raw.number ?? 0,
    par: raw.par ?? 4,
    yardage: raw.yardage ?? raw.yards ?? 0,
    handicap: raw.handicap ?? raw.handicap_index ?? null,
    gps: (raw.lat != null && raw.lng != null) ? { lat: raw.lat, lng: raw.lng } : null,
    hazards: extractHazardsFromRawHole(raw),
  };
}

function normalizeTee(raw: RawTee): TeeBox {
  const holes: RawHole[] = raw.holes ?? [];
  return {
    tee_name: raw.tee_name ?? raw.name ?? 'Default',
    total_yards: raw.total_yards ?? raw.yardage ?? 0,
    course_rating: raw.course_rating ?? raw.rating ?? null,
    slope_rating: raw.slope_rating ?? raw.slope ?? null,
    par_total: raw.par_total ?? raw.par ?? 72,
    holes: holes.map(normalizeHole),
  };
}

function extractTees(raw: RawCourse): TeeBox[] {
  if (!raw.tees) return [];

  // Shape 1: array directly
  if (Array.isArray(raw.tees)) {
    return raw.tees.map(normalizeTee);
  }

  // Shape 2: { male: [...], female: [...] }
  const teesObj = raw.tees as Record<string, RawTee[]>;
  const allTees: TeeBox[] = [];
  for (const [key, arr] of Object.entries(teesObj)) {
    if (Array.isArray(arr)) {
      arr.forEach(t => allTees.push(normalizeTee({ ...t, tee_name: t.tee_name ?? key })));
    }
  }
  return allTees;
}

function normalizeCourse(raw: RawCourse, cachedAt = Date.now()): Course {
  const id = String(raw.id ?? '');
  const tees = extractTees(raw);
  console.log(`[golfcourseapi] normalized course "${raw.club_name ?? raw.name}" id=${id} tees=${tees.length} (${tees.map(t => t.tee_name).join(', ')})`);
  return {
    id,
    club_name: raw.club_name ?? raw.name ?? 'Unknown Club',
    course_name: raw.course_name ?? raw.name ?? 'Unknown Course',
    location: {
      city: raw.city ?? '',
      state: raw.state_code ?? raw.state ?? '',
      country: raw.country ?? 'US',
    },
    tees,
    cached_at: cachedAt,
  };
}

type RawSearchResult = {
  id?: number | string;
  club_name?: string;
  course_name?: string;
  name?: string;
  city?: string;
  state_code?: string;
  state?: string;
  country?: string;
};

function normalizeSearchResult(raw: RawSearchResult): { id: string; club_name: string; course_name: string; location: string } {
  return {
    id: String(raw.id ?? ''),
    club_name: raw.club_name ?? raw.name ?? 'Unknown',
    course_name: raw.course_name ?? raw.name ?? 'Unknown',
    location: [raw.city, raw.state_code ?? raw.state, raw.country].filter(Boolean).join(', '),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function searchCourses(
  query: string,
): Promise<{ id: string; club_name: string; course_name: string; location: string; _error?: string }[]> {
  console.log('[golfcourseapi] searchCourses:', query);
  try {
    const res = await fetch(proxyUrl({ action: 'search', q: query }), {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      console.error('[golfcourseapi] search error:', res.status, err);
      // Surface API errors as a sentinel result so UI can show a meaningful message
      return [{ id: '', club_name: '', course_name: '', location: '', _error: err.error ?? `Search unavailable (${res.status})` }];
    }
    const data = await res.json() as Record<string, unknown>;
    console.log('[golfcourseapi] search raw keys:', Object.keys(data));

    // Handle various shapes: { courses: [...] } | { data: [...] } | [...]
    const list: RawSearchResult[] =
      (data.courses as RawSearchResult[] | undefined) ??
      (data.data as RawSearchResult[] | undefined) ??
      (Array.isArray(data) ? data as RawSearchResult[] : []);

    return list.slice(0, 10).map(normalizeSearchResult);
  } catch (e) {
    console.error('[golfcourseapi] searchCourses exception:', e);
    return [{ id: '', club_name: '', course_name: '', location: '', _error: 'Course search unavailable — check connection' }];
  }
}

export async function getCourse(course_id: string): Promise<Course | null> {
  // Check cache first
  const cached = await readCachedCourse(course_id);
  if (cached && !isCacheStale(cached.cached_at)) {
    console.log('[golfcourseapi] cache hit:', course_id);
    return cached;
  }

  console.log('[golfcourseapi] getCourse fetch:', course_id);
  try {
    const res = await fetch(proxyUrl({ action: 'detail', id: course_id }), {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      console.error('[golfcourseapi] detail error:', res.status, err);
      return cached; // Return stale cache rather than null if available
    }
    const data = await res.json() as Record<string, unknown>;
    console.log('[golfcourseapi] detail raw keys:', Object.keys(data));

    // Handle various shapes: { course: {...} } | { data: {...} } | { id: ..., ... }
    const raw: RawCourse =
      (data.course as RawCourse | undefined) ??
      (data.data as RawCourse | undefined) ??
      (data as RawCourse);

    const course = normalizeCourse(raw);
    if (course.id && course.tees.length > 0) {
      await writeCachedCourse(course);
    }
    return course;
  } catch (e) {
    console.error('[golfcourseapi] getCourse exception:', e);
    return cached ?? null;
  }
}

// ─── Conversion helpers ───────────────────────────────────────────────────────

export function courseToHoles(course: Course, teeName?: string): CourseHole[] {
  const tee = teeName
    ? (course.tees.find((t) => t.tee_name.toLowerCase() === teeName.toLowerCase()) ?? course.tees[0])
    : course.tees[0];
  if (!tee) return [];
  return tee.holes.map((h) => ({
    hole: h.hole_number,
    par: h.par,
    distance: h.yardage,
    front: h.yardage,
    back: h.yardage,
    teeLat: h.gps?.lat ?? 0,
    teeLng: h.gps?.lng ?? 0,
    middleLat: 0,
    middleLng: 0,
    frontLat: 0,
    frontLng: 0,
    backLat: 0,
    backLng: 0,
    note: '',
    estimated: false,
  }));
}

export function courseSummaryForContext(course: Course): string {
  const tee = course.tees[0];
  if (!tee) return `${course.club_name} — no tee data available`;
  const holeList = tee.holes
    .map((h) => {
      const hazardStr = h.hazards.length > 0 ? ` [${h.hazards.join('; ')}]` : '';
      return `H${h.hole_number} par${h.par} ${h.yardage}y${hazardStr}`;
    })
    .join(' · ');
  return (
    `Course: ${course.club_name} — ${course.location.city}, ${course.location.state}\n` +
    `Tee: ${tee.tee_name} ${tee.total_yards}yds par${tee.par_total}` +
    (tee.course_rating ? ` rating ${tee.course_rating}/${tee.slope_rating}` : '') +
    `\nHoles: ${holeList}`
  );
}
