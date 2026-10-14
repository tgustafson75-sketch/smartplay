/**
 * 2026-10-13 (course-engine audit #9) — detectCourseInText was a raw substring match on ids AND names,
 * and a match injects that course's par/yardage into the caddie as VERIFIED data.
 */
import { detectCourseInText } from '../../services/holeContextResolver';

describe('a course is named, not substring-matched', () => {
  it('THE BUG: "Twentynine Palms" is not Menifee Lakes Palms', () => {
    expect(detectCourseInText('What club on Twentynine Palms hole 4?')).toBeNull();
  });
  it('ids and generic words never match', () => {
    expect(detectCourseInText('it determines the line')).toBeNull();          // "mines"
    expect(detectCourseInText('the lakes are in play')).toBeNull();           // "lakes"
    expect(detectCourseInText('that is my legacy, honestly')).toBeNull();     // "Legacy"
    expect(detectCourseInText('we can chat mines later')).toBeNull();         // "at mines" inside "chat"
  });
  it('real names still match, longest first', () => {
    expect(detectCourseInText('playing Menifee Lakes Palms tomorrow, hole 7')).toBe('palms');
    expect(detectCourseInText('how does hole 3 at Green Hill play?')).toBe('greenhill');
    expect(detectCourseInText('Echo Hills hole 2')).toBe('echo-hills');
    expect(detectCourseInText('Mines golf course hole 5')).toBe('mines-gc');
    expect(detectCourseInText('playing Legacy this weekend')).toBe('legacy-springfield');
  });
});
