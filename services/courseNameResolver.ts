/**
 * 2026-07-23 (Tim — "we need to be able to tell the Caddie what course and where and the caddie pulls
 * it up in the play tab"). Pure resolver: a spoken course phrase → a bundled course. Kept dependency-
 * free (imports only the static COURSES data) so it's unit-testable and safe to call from the offline-
 * first intent precheck.
 *
 * Direction-correct + conservative: it matches when the spoken name equals a bundled course, when the
 * spoken phrase CONTAINS a full course name, or when a solid (>=5 char) spoken fragment is a substring
 * of a course name. It tolerates a trailing "in <place>" clause and filler words. Returns null when
 * nothing bundled clearly matches — the caller then defers to the brain / a live search rather than
 * guessing (this is what stops "take me to the range" or "play a song" from hijacking a real command).
 */
import { COURSES } from '../data/courses';

// 2026-07-24 (audit — false-positive fix) — common on-course / golf words that ALSO appear inside
// bundled course names ("green" ⊂ "Killian Greens", "lakes" ⊂ "Menifee Lakes", "point" ⊂ "Mariners
// Point", "hills" ⊂ "Echo Hills"). Without this, "take me to the green" / "go to the point" would
// resolve to a course and yank the player out of their round. If the whole spoken name is just one of
// these, it's NOT a course request.
const GENERIC_GOLF_WORDS = new Set([
  'green', 'greens', 'lake', 'lakes', 'point', 'hill', 'hills', 'pin', 'flag', 'cup', 'tee', 'tees',
  'hole', 'fairway', 'rough', 'bunker', 'sand', 'water', 'range', 'front', 'back', 'middle', 'ridge',
  'creek', 'river', 'valley', 'park', 'links', 'national', 'country', 'ball', 'cart', 'putt',
]);

export function resolveSpokenCourse(spoken: string): { previewId: string; label: string } | null {
  const s = (spoken ?? '').toLowerCase().trim();
  if (s.length < 3) return null;
  // Strip filler + a trailing "in <place>" location clause ("highland links in truro" → "highland links").
  const cleaned = s
    .replace(/\b(the|a|to|golf\s+course|course|club|please|now|for\s+me|let'?s)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const namePart = cleaned.replace(/\s+in\s+[a-z0-9 .,'’-]+$/i, '').trim() || cleaned;
  if (namePart.length < 3) return null;
  // A bare generic golf/course word is never a course request (kills "the green", "the point", …).
  if (GENERIC_GOLF_WORDS.has(namePart)) return null;

  const hit = (c: { id: string; name: string }) => ({ previewId: `local:${c.id}`, label: c.name });

  // 1. Exact name.
  for (const c of COURSES) {
    const cn = c.name.toLowerCase();
    if (cn === namePart || cn === cleaned) return hit(c);
  }
  // 2. The spoken phrase contains a FULL course name ("take me to pebble beach golf links today").
  for (const c of COURSES) {
    const cn = c.name.toLowerCase();
    if (cn.length >= 4 && namePart.includes(cn)) return hit(c);
  }
  // 3. A solid spoken fragment is a PREFIX of a course name ("highland" → "Highland Links",
  //    "pebble beach" → "Pebble Beach Golf Links"). Prefix-only (not substring-anywhere) so a word
  //    buried inside a name can't match — that's what let "green" hit "Killian Greens". >=5 chars, and
  //    the reverse (course name is a prefix of the spoken fragment) covers trailing filler.
  if (namePart.length >= 5) {
    for (const c of COURSES) {
      const cn = c.name.toLowerCase();
      if (cn.startsWith(namePart) || namePart.startsWith(cn)) return hit(c);
    }
  }
  return null;
}
