/**
 * 2026-08-25 (Tim's screenshot: the header read "pebble beach") — COURSE NAMES ARE PROPER NOUNS.
 *
 * `roundStore.activeCourse` holds whatever string started the round, and that can be a spoken or
 * typed phrase ("open pebble beach"), so the name reaches the screen in whatever case the player
 * used. On a submission build that is what a reviewer screenshots.
 *
 * Normalising at DISPLAY rather than chasing every writer is deliberate: there are several ways a
 * round can start, and a missed one would put the bug straight back. This is presentation only —
 * nothing stored, matched or sent to the brain changes, so no lookup can break on it.
 *
 * Golf names are full of things Title Case would ruin, so they are preserved explicitly:
 * acronyms (TPC, PGA, GC, CC), Scottish/Irish prefixes (McKenzie), and the small joining words
 * that a real card lowercases mid-name ("Pines at Bay Hill").
 */

const ACRONYMS = new Set(['TPC', 'PGA', 'GC', 'CC', 'AT&T', 'US', 'USA', 'NJ', 'CA', 'FL', 'MA', 'II', 'III']);
/** Lowercase mid-name, capitalised when they lead. */
const MINOR = new Set(['at', 'of', 'the', 'on', 'in', 'by', 'and', 'de', 'del', 'la', 'le']);

export function courseDisplayName(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  // Already mixed case with at least one capital? The writer meant it — leave it alone. This is the
  // common path (a bundled club_name, an API name) and must not be "corrected".
  if (/[A-Z]/.test(s) && !/^[A-Z\s'&.-]+$/.test(s)) return s;

  return s
    .split(/\s+/)
    .map((word, i) => {
      const bare = word.replace(/[^A-Za-z&]/g, '');
      if (ACRONYMS.has(bare.toUpperCase())) return word.toUpperCase();
      const lower = word.toLowerCase();
      if (i > 0 && MINOR.has(lower)) return lower;
      // Handle hyphens and apostrophes: each part gets its own capital (Jones-Smith, O'Hara).
      return lower.replace(/(^|[-'])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
    })
    .join(' ');
}
