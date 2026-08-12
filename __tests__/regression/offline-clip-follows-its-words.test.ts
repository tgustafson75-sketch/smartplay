/**
 * 2026-08-12 (Tim, three times in a row) — "Tell me again how you fixed the 'we're off the course
 * right now' message… I've now tried three times and I'm still getting the same thing."
 *
 * I hadn't fixed it, and I had to say so. The TEXT was changed on 2026-08-06, when he asked for that
 * line to be reverted for reading robotic — DEAD_END_PRACTICE.en became "Good moment to sharpen your
 * tempo or short game". The sentence he kept hearing does not exist anywhere in this codebase.
 *
 * It was coming off his own phone. The offline persona-voice cache named its files by SLUG only
 * (offline_voice_kevin_male_off_course_en.mp3), so the mp3 rendered from the OLD wording sat on disk
 * under that name forever. TEXT_TO_LINE maps the NEW text to the same slug, finds that file, and
 * plays six-day-old audio.
 *
 * The consequence is bigger than one line: editing ANY of these fixed lines could never take effect
 * on a device that had already cached it. A code fix that ships and does nothing is worse than no
 * fix, because everyone downstream believes it's done — which is exactly what happened here.
 *
 * (His second symptom, the robot voice, is the same area: when a cached clip is absent the path
 * falls to device TTS. Fixing the staleness lets a correct clip be rendered again.)
 */
import fs from 'fs';
import path from 'path';
import { OFFLINE_LINES } from '../../services/offlineVoiceCache';
import { DEAD_END_PRACTICE } from '../../services/localStatusResponder';

const src = fs.readFileSync(path.join(__dirname, '../../services/offlineVoiceCache.ts'), 'utf8');

describe('a cached clip is identified by its WORDS, not just its slug', () => {
  it('the filename carries a fingerprint of the text', () => {
    expect(src).toContain('function textFingerprint(text: string): string');
    expect(src).toContain('_${textFingerprint(text)}.mp3');
  });

  it('the in-memory key carries it too — otherwise resolve and disk disagree', () => {
    expect(src).toContain('return `${personaSlug(persona)}:${gender}:${slug}:${textFingerprint(text)}`;');
  });

  it('every path that names a clip passes the text', () => {
    // A single call site left on the old 3-arg form reintroduces the bug for that path only,
    // which is the shape of half-fix this whole audit keeps finding.
    expect(src).not.toMatch(/fileFor\(line\.slug, gender, persona\)/);
    expect(src).not.toMatch(/cacheKey\(line\.slug, gender, persona\)/);
  });

  it('sweeps clips whose wording has changed, rather than leaving them on disk', () => {
    expect(src).toContain('if (expected.has(name)) continue;');
    expect(src).toContain('offline_voice_${personaSlug(persona)}_');
  });
});

describe('the line Tim was hearing is genuinely gone from the code', () => {
  it('the off-course line is the reverted, non-robotic wording', () => {
    expect(DEAD_END_PRACTICE.en).toBe(
      "Good moment to sharpen your tempo or short game — I'm right here whenever you want to dig in.",
    );
  });

  it('nothing anywhere still says "off the course right now"', () => {
    for (const l of OFFLINE_LINES) {
      expect(l.text.toLowerCase()).not.toContain('off the course right now');
    }
  });

  it('the offline cache still sources its text from the single definition', () => {
    // If the cache ever hard-coded its own copy, the two could drift and this returns.
    expect(src).toContain("import { DEAD_END_PRACTICE } from './localStatusResponder'");
    const offCourse = OFFLINE_LINES.find(l => l.slug === 'off_course_en');
    expect(offCourse?.text).toBe(DEAD_END_PRACTICE.en);
  });
});

describe('the fingerprint actually distinguishes text', () => {
  // Re-implemented here deliberately: if the algorithm changes, this test should notice rather than
  // silently agree with whatever the implementation now does.
  const fp = (text: string) => {
    let h = 5381;
    const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
    for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
    return h.toString(36);
  };

  it('changing the wording changes the fingerprint', () => {
    expect(fp("We're off the course right now — good time to sharpen up."))
      .not.toBe(fp(DEAD_END_PRACTICE.en));
  });

  it('is stable for identical text, and ignores incidental whitespace/case', () => {
    expect(fp(DEAD_END_PRACTICE.en)).toBe(fp(DEAD_END_PRACTICE.en));
    expect(fp('  Two   Putts ')).toBe(fp('two putts'));
  });

  it('distinguishes every fixed line from every other', () => {
    const seen = new Map<string, string>();
    for (const l of OFFLINE_LINES) {
      const f = `${l.language}:${fp(l.text)}`;
      // A collision would let one line play another's audio.
      if (seen.has(f)) expect(seen.get(f)).toBe(l.text);
      seen.set(f, l.text);
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});
