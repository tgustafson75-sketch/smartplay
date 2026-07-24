/**
 * 2026-07-24 (final QA — "find courses cleanly" + "start a round at <course>"). quickRoundHandler
 * used to keep its own stale 9-course list, so "start a round at Highland / Miccosukee / Killian /
 * Redlands / Green Hill / Spessard / Webster / Pembroke / Doral" all missed it and fell through to
 * the network (dead-end offline, wrong-course risk online). It now uses resolveSpokenCourse — the
 * SAME resolver "take me to <course>" uses. These lock that EVERY bundled course resolves offline,
 * and that the generic-word / non-course guards still hold.
 */
import { resolveSpokenCourse } from '../../services/courseNameResolver';

describe('resolveSpokenCourse covers every bundled course (offline, unified with quick-round)', () => {
  const cases: [string, string][] = [
    ['Highland', 'local:highland-links'],
    ['Miccosukee', 'local:miccosukee'],
    ['Killian Greens', 'local:killian-greens'],
    ['Redlands', 'local:redlands-cc'],
    ['Green Hill', 'local:greenhill'],       // canonical name has a SPACE — used to miss
    ['Spessard', 'local:spessard-holland'],
    ['Webster Dudley', 'local:webster-dudley'],
    ['Pembroke', 'local:pembroke-pines'],
    ['Sunnyvale', 'local:sunnyvale'],
    ['Crystal Springs', 'local:crystal-springs'],
  ];
  it.each(cases)('resolves "%s" → %s', (spoken, expected) => {
    expect(resolveSpokenCourse(spoken)?.previewId).toBe(expected);
  });

  it('still rejects generic golf words + non-course phrases (no round hijack)', () => {
    expect(resolveSpokenCourse('the green')).toBeNull();
    expect(resolveSpokenCourse('the point')).toBeNull();
    expect(resolveSpokenCourse('the range')).toBeNull();
    expect(resolveSpokenCourse('a song')).toBeNull();
    expect(resolveSpokenCourse('hole five')).toBeNull();
  });
});
