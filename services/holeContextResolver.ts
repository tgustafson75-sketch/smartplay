/**
 * 2026-06-06 — Hole-aware brain context.
 *
 * Tim's ask: when the caddie talks about a specific known hole
 * (e.g., "Palms hole 1, how would I attack it?"), it should reason
 * from REAL hole characteristics — par, yardage, bunkers, trees,
 * water — not theorize from generic golf knowledge.
 *
 * Source of truth:
 *   - data/courses.ts COURSES — par, yardage, F/M/B per hole for the
 *     10 bundled local courses
 *   - data/landmarks/<course>.json — per-hole landmarks (currently
 *     Palms only; expandable by dropping a new JSON in)
 *
 * Consumers: api/kevin.ts + api/brain.ts inject the resolved text
 * into the system prompt. ON-COURSE always for the current hole.
 * OFF-COURSE when the most-recent user message mentions a known
 * course (substring match against course id / name) AND optionally
 * a hole number (regex "hole N").
 *
 * Defensive: every resolver returns null on miss, never throws.
 * The brain prompt rebuild treats null as "no hole context to inject"
 * and falls back to its generic on-course / off-course block.
 */

import { COURSES } from '../data/courses';
import palmsLandmarks from '../data/landmarks/palms.json';

type Landmark = {
  hole_number: number;
  name: string;
  description: string;
  side: string;
  type: string;
};

// Course-id (without 'local:' prefix) → landmarks array.
// Add more entries here as additional courses get landmark JSON.
const LANDMARK_BY_COURSE: Record<string, Landmark[]> = {
  palms: palmsLandmarks as Landmark[],
};

/** Strip the 'local:' courseId prefix used in roundStore. */
function normalizeCourseId(courseId: string | null | undefined): string | null {
  if (!courseId || typeof courseId !== 'string') return null;
  return courseId.startsWith('local:') ? courseId.slice('local:'.length) : courseId;
}

/**
 * Formatted landmark list for a specific hole on a specific course.
 * Returns null when no landmark data exists for that (course, hole).
 */
export function getHoleLandmarksText(courseId: string | null | undefined, holeNumber: number): string | null {
  const slug = normalizeCourseId(courseId);
  if (!slug) return null;
  const all = LANDMARK_BY_COURSE[slug];
  if (!all) return null;
  const features = all.filter(f => f.hole_number === holeNumber);
  if (features.length === 0) return null;
  return features.map(f => `- ${f.name} (${f.side} side, ${f.type}): ${f.description}`).join('\n');
}

/**
 * Complete hole context block: par + yardage + landmarks (when known).
 * Suitable for direct injection into the brain system prompt. Returns
 * null when the course or hole isn't in the bundled COURSES catalog.
 */
export function getHoleContextBlock(courseId: string | null | undefined, holeNumber: number): string | null {
  const slug = normalizeCourseId(courseId);
  if (!slug) return null;
  const course = COURSES.find(c => c.id === slug);
  if (!course) return null;
  const hole = course.holes.find(h => h.hole === holeNumber);
  if (!hole) return null;
  let block = `HOLE ${holeNumber} on ${course.fullName}: par ${hole.par}, ${hole.distance} yards (front ${hole.front}, back ${hole.back})`;
  const landmarks = getHoleLandmarksText(courseId, holeNumber);
  if (landmarks) {
    block += `\nKey features:\n${landmarks}`;
  }
  return block;
}

/**
 * Compact one-line summary of every bundled local course (id, name,
 * par, hole count). Used off-course so the brain knows WHICH courses
 * it has detailed data for vs which it has to theorize about.
 * Cheap and bounded (~10 courses × ~80 chars = ~800 chars).
 */
export function getKnownCoursesBlock(): string {
  return COURSES.map(c => {
    const hasLandmarks = LANDMARK_BY_COURSE[c.id] ? ' [layout details available]' : '';
    return `- ${c.name} (id: ${c.id}, par ${c.par}, ${c.holes.length} holes)${hasLandmarks}`;
  }).join('\n');
}

/**
 * Detect a known course reference in free text (case-insensitive
 * substring match against COURSES id + name). Returns the course id
 * (without 'local:' prefix) or null.
 */
export function detectCourseInText(text: string): string | null {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  for (const c of COURSES) {
    if (lower.includes(c.id.toLowerCase())) return c.id;
    if (lower.includes(c.name.toLowerCase())) return c.id;
  }
  return null;
}

/**
 * Detect a hole number reference in free text. Matches "hole 1",
 * "hole one" (1-9), "hole 18", etc. Returns the integer or null.
 * Conservative: only matches when "hole" precedes the number to avoid
 * false positives on "I shot 4" or "back nine."
 */
export function detectHoleInText(text: string): number | null {
  if (!text || typeof text !== 'string') return null;
  const numericMatch = text.toLowerCase().match(/\bhole\s+(\d{1,2})\b/);
  if (numericMatch) {
    const n = parseInt(numericMatch[1], 10);
    if (n >= 1 && n <= 18) return n;
  }
  const wordMap: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18,
  };
  for (const [word, n] of Object.entries(wordMap)) {
    if (new RegExp(`\\bhole\\s+${word}\\b`, 'i').test(text)) return n;
  }
  return null;
}
