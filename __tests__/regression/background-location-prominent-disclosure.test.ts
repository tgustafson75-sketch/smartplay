/**
 * 2026-09-03 — Play's background-location declaration requires a video showing an IN-APP prominent
 * disclosure BEFORE the system permission dialog. The app had the just-in-time timing right and the
 * disclosure missing: roundStore called requestBackgroundPermissionsAsync() directly, so the OS
 * prompt appeared out of nowhere and there was nothing to film for the step reviewers look for.
 *
 * These pin the copy, because with a compliance disclosure the exact words ARE the compliance. Play
 * wants the data named, the BACKGROUND / closed-or-not-in-use nature stated plainly, the purpose
 * given, and an affirmative action required. A future tidy-up that shortens this into something
 * friendlier is a rejection.
 */
import {
  BACKGROUND_LOCATION_TITLE,
  BACKGROUND_LOCATION_BODY,
  BACKGROUND_LOCATION_CONTINUE,
  BACKGROUND_LOCATION_DECLINE,
} from '../../services/backgroundLocationDisclosure';

describe('background location prominent disclosure copy', () => {
  it('names the data being collected', () => {
    expect(BACKGROUND_LOCATION_BODY).toMatch(/location data/i);
    expect(BACKGROUND_LOCATION_BODY).toMatch(/SmartPlay Caddie collects/i);
  });

  it('says plainly that collection continues when the app is not in use', () => {
    // This is the sentence the whole declaration turns on. "Background" alone is jargon; Play's
    // guidance asks for language a person understands.
    expect(BACKGROUND_LOCATION_BODY).toMatch(/when the app is closed or not in use/i);
  });

  it('gives the purpose, not just the fact', () => {
    expect(BACKGROUND_LOCATION_BODY).toMatch(/yardages/i);
    expect(BACKGROUND_LOCATION_BODY).toMatch(/shot tracking/i);
  });

  it('tells the player what the next screen will ask, so the OS dialog is not a surprise', () => {
    expect(BACKGROUND_LOCATION_BODY).toMatch(/allow location all the time/i);
  });

  it('offers a real way out and says the app still works', () => {
    expect(BACKGROUND_LOCATION_DECLINE).toBe('Not now');
    expect(BACKGROUND_LOCATION_BODY).toMatch(/keeps working either way/i);
  });

  it('requires an affirmative action to proceed', () => {
    expect(BACKGROUND_LOCATION_CONTINUE).toBe('Continue');
    expect(BACKGROUND_LOCATION_TITLE.length).toBeGreaterThan(0);
  });

  it('fits on one screen — a video that has to scroll is a video that hides the disclosure', () => {
    // Play asks recordings to scroll slowly when text is cut off; not needing to scroll is simpler.
    expect(BACKGROUND_LOCATION_BODY.length).toBeLessThan(600);
  });
});
