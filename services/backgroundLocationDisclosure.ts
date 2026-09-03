/**
 * 2026-09-03 — PROMINENT DISCLOSURE for background location.
 *
 * Google Play's background-location declaration requires a video showing, in one take: the app
 * opening, "the user-flows to get to the prominent disclosure and consent screen (making sure the
 * full disclosure is visible)", the system dialog, and the feature working. The disclosure is an
 * IN-APP screen you build and show BEFORE the OS prompt — the OS prompt does not count, and neither
 * does the privacy policy or the ToS.
 *
 * The app had the timing right and the disclosure missing. roundStore called
 * requestBackgroundPermissionsAsync() directly at round start, so the system dialog appeared out of
 * nowhere; app/permissions.tsx even documents the just-in-time move ("background location is NOT
 * requested here anymore"). Just-in-time is half the requirement. There was nothing to film for the
 * step a reviewer is looking for, so a truthful recording would have shown the exact failure the
 * form exists to catch.
 *
 * WHAT THE COPY HAS TO CONTAIN, and why it reads the way it does. Play's guidance is specific: name
 * the data, say plainly that it is collected in the BACKGROUND / when the app is CLOSED OR NOT IN
 * USE, say what it is for, and require an affirmative action to continue. Every one of those is
 * pinned by a test, because this is copy whose exact words are the compliance.
 *
 * An Alert rather than a route: this sits inside the round-start orchestration, which is the most
 * load-bearing path in the app. A dialog the player must act on satisfies the requirement and is
 * clearly filmable, without putting a navigation into the sequence that starts GPS.
 * [[caddie-failsafe-no-walls]]
 */

import { Alert, Platform } from 'react-native';

export const BACKGROUND_LOCATION_TITLE = 'Keep your yardages live';

/**
 * The disclosure itself. Deliberately one block of text so the whole thing is visible in a video
 * without scrolling — Play asks that a recording scroll slowly if text is cut off, and the simplest
 * way to satisfy that is to not need scrolling.
 */
export const BACKGROUND_LOCATION_BODY =
  'SmartPlay Caddie collects location data to keep your yardages, hole changes and shot tracking ' +
  'working during a round — including when the app is closed or not in use, so you can put your ' +
  'phone in your pocket and keep playing.\n\n' +
  'Next you\'ll be asked to allow location all the time. You can choose "while using the app" ' +
  'instead, or change it any time in Settings — the rest of the app keeps working either way.';

export const BACKGROUND_LOCATION_CONTINUE = 'Continue';
export const BACKGROUND_LOCATION_DECLINE = 'Not now';

/** Test seam: the harness cannot present an Alert, and a hung promise would stall a round. */
let presenter: ((title: string, body: string) => Promise<boolean>) | null = null;
export function _setDisclosurePresenter(fn: ((title: string, body: string) => Promise<boolean>) | null): void {
  presenter = fn;
}

function present(title: string, body: string): Promise<boolean> {
  if (presenter) return presenter(title, body);
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      body,
      [
        // Declining is a first-class answer, not a trap: the round still plays, GPS still works in
        // the foreground, and nothing here is allowed to read as a wall. [[overstrict-gate-lens]]
        { text: BACKGROUND_LOCATION_DECLINE, style: 'cancel', onPress: () => resolve(false) },
        { text: BACKGROUND_LOCATION_CONTINUE, onPress: () => resolve(true) },
      ],
      // Dismissing without choosing is a decline, not a grant. Without this the promise never
      // settles on Android's hardware back and the round-start orchestration waits forever.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * Show the disclosure and report whether to go on to the system prompt.
 *
 * Returns false — WITHOUT showing anything — when there is nothing to ask for: permission already
 * granted, or a platform where this prompt does not exist. Showing a disclosure for a permission the
 * player already gave is nagging, and nagging is a defect here. [[no-push-nagging-no-ads]]
 *
 * Never throws. A disclosure that fails is a background permission not requested, which costs
 * pocket-play accuracy; it must never cost the round.
 */
export async function ensureBackgroundLocationDisclosure(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') return false;
    const Location = await import('expo-location');
    const current = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (current?.granted) return false;
    // Asked and permanently refused: the OS will not show its dialog again, so a disclosure in front
    // of a prompt that cannot appear is pure friction.
    if (current && current.status === 'denied' && current.canAskAgain === false) return false;
    return await present(BACKGROUND_LOCATION_TITLE, BACKGROUND_LOCATION_BODY);
  } catch {
    return false;
  }
}
