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
  // 3. A solid spoken fragment is a substring of a course name ("highland" → "highland links").
  //    Require >=5 chars so a short word ("pin") can't false-match ("pinehurst").
  if (namePart.length >= 5) {
    for (const c of COURSES) {
      if (c.name.toLowerCase().includes(namePart)) return hit(c);
    }
  }
  return null;
}
