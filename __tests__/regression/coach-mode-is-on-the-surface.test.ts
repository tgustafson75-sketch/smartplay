/**
 * 2026-09-20 (Tim) — "We need to review for completeness and surface the coach card in SwingLab for
 * users. I am going to be showing to Golf Coaches this week."
 *
 * Coach Mode came off SHELVED_ROUTES. It had NO dedicated test, which for the one screen a coach
 * audience will actually be shown is the wrong place to have none. These lock what the review
 * checked by hand, so the demo cannot quietly rot between now and the meeting.
 *
 * NOT asserted here: the two honest deferrals in its header (multi-swing voice walkthrough,
 * voice-to-text coach notes). They are absent on purpose and absence is not a defect.
 */
import { isShelved, isBeta, SHELVED_ROUTES } from '../../services/releaseSurface';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('Coach Mode is on the player surface', () => {
  it('is NOT shelved, so the hub card and the caddie both offer it', () => {
    expect(isShelved('/swinglab/coach-mode')).toBe(false);
  });

  /**
   * 2026-09-20, LATER THE SAME DAY — this asserted that Coach Caddie stays shelved, on Tim's
   * "surface when totally ready". He then asked: "Take a look at Coach Caddie and see if we can
   * release a strong beta version." The review said yes, so it ships wearing the word BETA.
   *
   * The PREMISE moved, not the code — which is the one honest reason to rewrite an assertion.
   * What the test protects is unchanged and still worth protecting: surfacing one coach card must
   * not silently drag the other out with it, and a half-ready screen must never reach players
   * unlabelled. Both are asserted below, harder than before.
   */
  it('Coach Caddie ships as a labelled BETA, not silently', () => {
    expect(isShelved('/swinglab/coach-lesson')).toBe(false);   // players can reach it
    expect(SHELVED_ROUTES.has('/swinglab/coach-lesson')).toBe(false);
    expect(isBeta('/swinglab/coach-lesson')).toBe(true);       // ...and it says what it is
  });

  it('Coach MODE is not mislabelled as beta — it is finished work', () => {
    expect(isBeta('/swinglab/coach-mode')).toBe(false);
  });

  it('the hub renders the beta badge, in every card layout it has', () => {
    const hub = code('app/(tabs)/swinglab.tsx');
    const badged = hub.match(/isBeta\(spec\.route\) \? BETA_BADGE/g) ?? [];
    // Three layouts render a card (hero, standard, compact). A badge wired into one of them is the
    // classic "fixed it on the screen I was looking at" miss.
    expect(badged.length).toBe(3);
  });
});

describe('every door Coach Mode opens leads somewhere that ships', () => {
  /**
   * The screen is a router: pick a student, then send the coach to capture, to the player library,
   * or to a past swing. A dead destination is invisible until someone taps it — which, this week,
   * would be a coach.
   */
  const DESTINATIONS: [string, string][] = [
    ['/swinglab/smartmotion', 'app/swinglab/smartmotion.tsx'],
    ['/swinglab/player-library', 'app/swinglab/player-library/[player_id].tsx'],
    ['/swinglab/swing', 'app/swinglab/swing/[swing_id].tsx'],
  ];

  it.each(DESTINATIONS)('%s exists as a real screen', (_route, file) => {
    expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
  });

  it.each(DESTINATIONS)('%s is not itself shelved', (route) => {
    expect(isShelved(route)).toBe(false);
  });

  it('does not route to quick-record, which was retired', () => {
    // The header described `/swinglab/quick-record` long after that screen was retired into
    // SmartMotion. The CODE was already right; the prose was the stale part.
    expect(code('app/swinglab/coach-mode.tsx')).not.toMatch(/router\.push\([^)]*quick-record/);
  });
});

describe('the claim Coach Mode rests on', () => {
  /**
   * THE WHOLE SCREEN IS THIS ONE SENTENCE: "Coach Mode merely sets active_member_id; the existing
   * capture pipes do the rest." If that is not true, a coach captures a student's swing and it
   * lands on the coach's own record — which is worse than the feature not existing, because the
   * data is then wrong and nobody is told. Verified against the consumers, not the comment.
   */
  it('sets the active member, which is how a capture gets attributed', () => {
    expect(code('app/swinglab/coach-mode.tsx')).toMatch(/setActiveMember|active_member_id/);
  });

  it.each([
    ['services/mediaCapture.ts', 'the capture path'],
    ['services/videoUpload.ts', 'the upload/ingest path'],
    ['services/swingerHandedness.ts', 'handedness resolution'],
  ])('%s reads active_member_id at ingest (%s)', (file) => {
    expect(code(file)).toMatch(/active_member_id/);
  });

  it('a student\'s swings are matched by ID first, not by name', () => {
    // A name-only match loses a student's whole history the moment the coach corrects a spelling.
    const c = code('app/swinglab/coach-mode.tsx');
    expect(c).toMatch(/sess\.player_id === targetId/);
    expect(c).toMatch(/upload\?\.swinger/);          // the legacy fallback is kept, not relied on
  });
});
