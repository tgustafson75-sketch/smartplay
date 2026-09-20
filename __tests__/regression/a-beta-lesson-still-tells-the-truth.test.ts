/**
 * 2026-09-20 (Tim) — "Take a look at Coach Caddie and see if we can release a strong beta version."
 *
 * It can, and it now ships badged BETA. These lock the properties that made the answer yes, because
 * "beta" is a promise about POLISH, never about honesty — a lesson that invents a number is not a
 * rough edge, it is a coach telling a student something untrue about their swing.
 *
 * The engine already has 47 tests across coachLesson / coachSession / coachKnowledge. The FLOW SHELL
 * had none, which is where every one of these properties lives.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const code = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

const LESSON = 'app/swinglab/coach-lesson.tsx';

describe('the lesson measures the swing rather than guessing where it was', () => {
  /**
   * THE ONE THAT MATTERED. Before 2026-09-01 this passed neither a window nor an impact time, so the
   * pose sampler took its medium-clip branch and placed P1/P4/P6/P10 at fixed FRACTIONS of a ten
   * second recording — P6_impact at 0.65. Every number the coach spoke was measured at whatever the
   * body happened to be doing there, confidently, with nothing on screen to suggest a problem.
   */
  it('locates the real swing on device and passes it to the analyzer', () => {
    const c = code(LESSON);
    expect(c).toMatch(/locateSwingWindowOnDevice/);
    expect(c).toMatch(/analyzeSwingFromVideo\(uri, WINDOW_SEC \* 1000, null, false, window, impactMs/);
  });

  it('a failed locate degrades to coarse, never to invented', () => {
    // locate is wrapped so a throw leaves window/impactMs null — the previous honest behaviour.
    const c = code(LESSON);
    expect(c).toMatch(/let window:[^=]*= null;/);
    expect(c).toMatch(/let impactMs:[^=]*= null;/);
  });
});

describe('the loop cannot strand or nag the player', () => {
  it('an unreadable window re-prompts softly and keeps watching', () => {
    const c = code(LESSON);
    expect(c).toMatch(/if \(!m\) \{[\s\S]{0,320}scheduleRearm\(focusRep, REARM_MS\)/);
  });

  it('a camera that will not start falls back to the picker', () => {
    expect(code(LESSON)).toMatch(/captureViaPicker/);
  });

  it('a CANCELLED picker re-arms instead of silently killing the lesson', () => {
    // The failure that ends a session with no error and no next rep is the worst kind: the screen
    // just sits there and the player assumes the feature is broken.
    expect(code(LESSON)).toMatch(/else scheduleRearm\(focusRep, REARM_MS\)/);
  });

  it('a rep that finishes after a pause or an end is discarded, not spoken', () => {
    // Speaking feedback over a paused lesson is the "talked at me after I stopped" bug.
    const c = code(LESSON);
    expect(c).toMatch(/gen !== loopGenRef\.current \|\| !sessionLiveRef\.current \|\| pausedRef\.current/);
  });
});

describe('beta is a promise about polish, not about honesty', () => {
  it('handedness is resolved so a lefty is not read as a mirrored righty', () => {
    expect(code(LESSON)).toMatch(/resolveSwingerHandedness\(\)/);
  });

  it('the screen composes only the tested pure engine, not its own coaching opinions', () => {
    // If the shell grew its own thresholds, the 47 engine tests would stop covering what is spoken.
    const c = code(LESSON);
    expect(c).toMatch(/composeFocusFeedback/);
    expect(c).toMatch(/from '\.\.\/\.\.\/services\/coachLesson'/);
    expect(c).toMatch(/from '\.\.\/\.\.\/services\/coachSession'/);
  });
});
