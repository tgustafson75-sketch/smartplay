/**
 * Voice course-open resolver. resolveSpokenCourse() is the safety gate for the "take me to <course>"
 * voice command: the precheck ONLY claims the intent when a spoken name resolves to a bundled course,
 * so this test locks both halves — real course names resolve, and non-course phrases return null (so
 * they can't hijack "play a song" / "go to hole five" / "take me to the range").
 */
import { resolveSpokenCourse } from '../../services/courseNameResolver';
import { COURSES } from '../../data/courses';

// A couple of bundled ids we rely on (fail loudly if the data changes out from under the feature).
const HIGHLAND = COURSES.find((c) => c.id === 'highland-links');

describe('resolveSpokenCourse — real course names resolve', () => {
  it('resolves an exact bundled name to local:<id>', () => {
    expect(HIGHLAND).toBeTruthy();
    expect(resolveSpokenCourse('Highland Links')).toEqual({ previewId: 'local:highland-links', label: HIGHLAND!.name });
  });

  it('tolerates a trailing "in <place>" clause', () => {
    expect(resolveSpokenCourse('Highland Links in Truro')).toMatchObject({ previewId: 'local:highland-links' });
  });

  it('resolves a solid partial ("highland" → Highland Links)', () => {
    expect(resolveSpokenCourse('highland')).toMatchObject({ previewId: 'local:highland-links' });
  });

  it('strips filler words and the article', () => {
    expect(resolveSpokenCourse('the Highland Links course')).toMatchObject({ previewId: 'local:highland-links' });
  });

  // 2026-07-28 (audit — VOICE-F1) — parenthesized multi-course names must resolve by their spoken
  // qualifier. "Coyote Creek (Tournament)" / "(Valley)" previously failed every match branch.
  it('resolves a parenthesized course by its qualifier ("coyote creek valley" → Valley)', () => {
    expect(resolveSpokenCourse('coyote creek valley')).toMatchObject({ previewId: 'local:coyote-creek-valley' });
    expect(resolveSpokenCourse('coyote creek tournament')).toMatchObject({ previewId: 'local:coyote-creek-tournament' });
  });
  it('resolves "coyote creek golf club" to a bundled Coyote Creek (not null)', () => {
    expect(resolveSpokenCourse('coyote creek golf club')).toMatchObject({ previewId: expect.stringMatching(/^local:coyote-creek-/) });
  });
  it('bare "coyote creek" resolves to a bundled course rather than null', () => {
    expect(resolveSpokenCourse('coyote creek')).toMatchObject({ previewId: expect.stringMatching(/^local:coyote-creek-/) });
  });
  it('resolves Pruneridge', () => {
    expect(resolveSpokenCourse('pruneridge')).toMatchObject({ previewId: 'local:pruneridge' });
  });
});

describe('resolveSpokenCourseCandidates — bare name surfaces both interleaved courses', () => {
  it('"coyote creek" returns both the Tournament and Valley 18s', () => {
    const { resolveSpokenCourseCandidates } = require('../../services/courseNameResolver');
    const ids = resolveSpokenCourseCandidates('coyote creek').map((c: { previewId: string }) => c.previewId).sort();
    expect(ids).toEqual(['local:coyote-creek-tournament', 'local:coyote-creek-valley']);
  });
});

describe('resolveSpokenCourse — non-courses stay null (no false positives)', () => {
  it.each([
    'the range',
    'a song',
    'hole five',
    'the pin',       // must NOT false-match a course by a 3-letter fragment
    // 2026-07-24 audit — generic on-course words that are SUBSTRINGS of bundled course names.
    // These previously hijacked the round ("green" ⊂ "Killian Greens", etc.).
    'the green',
    'green',
    'the greens',
    'the lakes',
    'the point',
    'the hills',
    'the front',
    'the back',
    'my ball',
    'home',
    'x',
  ])('returns null for %p', (phrase) => {
    expect(resolveSpokenCourse(phrase)).toBeNull();
  });

  it('returns null for empty / whitespace', () => {
    expect(resolveSpokenCourse('')).toBeNull();
    expect(resolveSpokenCourse('   ')).toBeNull();
  });
});
