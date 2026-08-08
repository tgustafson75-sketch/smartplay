/**
 * 2026-08-08 (Tim — photographed the OFFICIAL Berlin CC scorecard after playing it twice; "the briefing
 * was good but missing… use the tools we have available").
 *
 * BUNDLED course-book seeds: real, card-sourced local knowledge (per-hole OB walls, local rules, official
 * par/yardage) anchored into the CNS course book (caddieMemoryStore.saveCourseBook). The book is what the
 * caddie's brief actually reads (caddieMemoryRetrieval → "Hole notes (course book)"), so this puts the
 * card's intel — "OB stone wall right", the No. 9 brook lift-clean-place — into every Berlin briefing,
 * offline, from hole 1.
 *
 * Honest source: transcribed from the printed card (Bench Craft, 6/26). No fabricated hazards.
 * saveCourseBook is additive-merge, so richer server content can layer on later without being wiped.
 */

import { useCaddieMemoryStore } from '../store/caddieMemoryStore';

interface SeedHole { hole: number; par: number; yardage: number; note?: string; hazards?: string[] }
interface Seed { course_id: string; name: string; tips: string[]; about?: string; holes: SeedHole[] }

const SEEDS: Seed[] = [
  {
    course_id: 'local:berlin-cc',
    name: 'Berlin Country Club',
    about:
      'Berlin Country Club — Berlin, MA. 9-hole par 33, 2233y from the men’s tees (rating 62.4 / slope 98). ' +
      'Stone walls line much of the course and play as out-of-bounds.',
    tips: [
      'Yardage discs: red = 100, white = 150.',
      'Stone walls are out-of-bounds (white stakes OB, yellow water, red lateral, blue free lift).',
      'On 9, wave groups on after reaching the green.',
    ],
    holes: [
      { hole: 1, par: 4, yardage: 312, note: 'OB stone wall right and beyond the green.', hazards: ['OB wall right', 'OB beyond green'] },
      { hole: 2, par: 4, yardage: 326, note: 'OB stone wall to the right.', hazards: ['OB wall right'] },
      { hole: 3, par: 4, yardage: 332, note: 'OB stone walls both left and right.', hazards: ['OB wall left', 'OB wall right'] },
      { hole: 4, par: 3, yardage: 127, note: 'OB stone wall beyond the green; woods on the right.', hazards: ['OB beyond green', 'woods right'] },
      { hole: 5, par: 4, yardage: 264, note: 'OB stone wall to the right.', hazards: ['OB wall right'] },
      { hole: 6, par: 4, yardage: 349, note: 'OB stone wall both left and right. #1 handicap hole.', hazards: ['OB wall left', 'OB wall right'] },
      { hole: 7, par: 3, yardage: 108, note: 'Short par 3 — easiest hole on the card (17 handicap).' },
      { hole: 8, par: 4, yardage: 282, note: 'OB stone wall to the right.', hazards: ['OB wall right'] },
      { hole: 9, par: 3, yardage: 133, note: 'Brook short of the green: from brook to front fringe, lift-clean-and-place (no penalty) or use the drop zone. OB wall right.', hazards: ['brook short of green', 'OB wall right'] },
    ],
  },
];

let seeded = false;

/**
 * Anchor all bundled seeds into the course book. Idempotent per process; additive-merge in the store, so
 * calling on every boot is safe and later server content still layers on. Best-effort — never throws.
 */
export function seedBundledCourseBooks(): void {
  if (seeded) return;
  seeded = true;
  try {
    const store = useCaddieMemoryStore.getState();
    for (const s of SEEDS) {
      store.saveCourseBook({
        course_id: s.course_id,
        name: s.name,
        about: s.about ?? null,
        tips: s.tips,
        holes: s.holes.map(h => ({
          hole: h.hole, par: h.par, yardage: h.yardage,
          note: h.note ?? null, hazards: h.hazards ?? [],
        })),
        nowMs: Date.now(),
      });
    }
    console.log(`[courseBookSeeds] anchored ${SEEDS.length} bundled course book(s)`);
  } catch (e) {
    console.log('[courseBookSeeds] seed failed (non-fatal):', e);
  }
}
