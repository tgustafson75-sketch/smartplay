/**
 * 2026-08-12 (Tim, an hour from teeing off) — "Where the hell did Wachusett go????? It's still not
 * showing. I have the latest APK."
 *
 * It was never the API and never the build. The Play tab appended the optional City/State hint
 * directly to the search QUERY:
 *
 *     const effective = loc ? `${trimmed} ${loc}` : trimmed;
 *
 * The upstream course DB does a literal NAME match, not a fielded search, so the hint doesn't
 * sharpen anything — it makes the name wrong. Measured against the live API:
 *
 *     q="Wachusett"                  → 1 hit
 *     q="Wachusett MA"               → 0 hits
 *     q="Wachusett West Boylston MA" → 0 hits
 *
 * So any player with a location hint set could not find a course that plainly exists — and the app
 * showed an empty result, which reads as "this course isn't in the app" rather than "we asked
 * badly". A feature added to help was silently deleting real courses.
 *
 * The hint is genuinely useful for choosing BETWEEN several courses of the same name. That is a
 * filter over results, not a change to the question.
 */
import fs from 'fs';
import path from 'path';

const play = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/play.tsx'), 'utf8');

describe('the location hint can never erase a real course', () => {
  it('the literal course-DB search gets the bare name', () => {
    expect(play).toContain('const effective = trimmed;');
    // The exact line that caused it.
    expect(play).not.toContain('const effective = loc ? `${trimmed} ${loc}` : trimmed;');
  });

  it('the hint RANKS results instead of restricting the query', () => {
    expect(play).toContain('const locLower = loc.toLowerCase();');
    expect(play).toContain('a.location.toLowerCase().includes(locLower) ? 0 : 1');
  });

  it('a hint that matches nothing still shows every result', () => {
    // sort() reorders; it must never filter. A non-matching hint costs the player nothing.
    const i = play.indexOf('const ranked = locLower');
    const block = play.slice(i, i + 420);
    expect(block).toContain('.sort(');
    expect(block).not.toContain('.filter(');
  });

  it('the AI identifier still receives the hint — it reasons over context', () => {
    // The split is the point: literal matcher gets the name, the LLM gets the name plus place.
    expect(play).toContain('aiSearchCourse(loc ? `${effective} ${loc}` : effective)');
  });
});
