/**
 * 2026-09-15 — App Review, guideline 5.1.1(iv). Both halves of the rejection were about the words
 * and the buttons on ONE screen, app/permissions.tsx:
 *
 *   the primary button used the OS dialog's own verb of consent, and Apple asked for
 *    "Continue" or "Next" instead;
 *
 *   a postpone button let the user close the message and delay the request, and Apple
 *    requires that the user always proceed to the request after the message.
 *
 * Both are render-level facts — which controls exist before the OS is asked, and what they say —
 * so a source grep is the wrong instrument (and the rejected strings are not written here either,
 * so a release grep for them stays clean). This mounts the screen and looks at it.
 *
 * The postpone button was not an oversight; it was the screen's stated design — every state had
 * one so the screen could never strand the user. Deleting it deletes the escape
 * hatch, so the last case here holds the replacement property: Continue always reaches the request,
 * and the screen always reaches an exit.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../i18n/locales/en.json';

// Real English, not keys — t() falls back to the key, so asserting on keys would pass even with
// the string deleted, and the button's WORDS are the whole finding.
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: mockReplace }),
  usePathname: () => '/permissions',
  useSegments: () => [],
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));

const granted = { granted: true, canAskAgain: true, status: 'granted' as const };
const denied = { granted: false, canAskAgain: true, status: 'denied' as const };
const state = (ok: boolean) => ({
  camera: ok ? granted : denied,
  microphone: ok ? granted : denied,
  location: ok ? granted : denied,
  backgroundLocation: ok ? granted : denied,
  mediaLibrary: ok ? granted : denied,
  coreGranted: ok,
  allGranted: ok,
});

const mockRequest = jest.fn(async () => state(true));
const mockGetState = jest.fn(async () => state(false));
const mockAlreadyAsked = jest.fn(() => false);
jest.mock('../../services/permissionsManager', () => ({
  requestCorePermissions: (...a: unknown[]) => mockRequest(...(a as [])),
  getCorePermissionsState: (...a: unknown[]) => mockGetState(...(a as [])),
  corePermissionsRequested: () => mockAlreadyAsked(),
}));

// Spied, not module-mocked: replacing react-native/Libraries/Linking/Linking wholesale leaves the
// `react-native` barrel re-exporting an undefined `Linking`, and the screen imports it from there.
const mockOpenSettings = jest.spyOn(require('react-native').Linking, 'openSettings')
  .mockImplementation(async () => undefined);

const mount = () => {
  const Screen = require('../../app/permissions').default;
  return render(<Screen />);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAlreadyAsked.mockReturnValue(false);
  mockRequest.mockResolvedValue(state(true));
});

describe('the permission primer leads to the permission request and nowhere else', () => {
  it('the primary button says Continue, not Allow', async () => {
    mount();
    await screen.findByText('Continue');
    // The one literal below is the rejected wording, written here ONLY so this assertion can
    // prove its absence. It is the single place in the app that still spells it.
    expect(screen.queryByText(/allow all/i)).toBeNull();
  });

  it('offers no way to skip or postpone the request', async () => {
    mount();
    await screen.findByText('Continue');
    expect(screen.queryByText(/skip/i)).toBeNull();
    expect(screen.queryByText(/not now|maybe later|remind me/i)).toBeNull();
    // And there is exactly ONE control here, so nothing can be a postponement in other words.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('offers no escape to device Settings BEFORE the request', async () => {
    // A Settings shortcut on the primer is the same defect wearing a different label: the user
    // leaves the explanation without ever meeting the request.
    mount();
    await screen.findByText('Continue');
    expect(screen.queryByText(/open settings/i)).toBeNull();
  });

  it('Continue always asks the OS', async () => {
    mount();
    fireEvent.press(await screen.findByText('Continue'));
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
  });

  it('a full grant leaves the screen on its own', async () => {
    jest.useFakeTimers();
    try {
      mount();
      fireEvent.press(await screen.findByText('Continue'));
      await waitFor(() => expect(mockRequest).toHaveBeenCalled());
      jest.runAllTimers();
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('declining everything is a finish, not a dead end', async () => {
    // This is the property the deleted postpone button used to carry. Removing it is only safe
    // because a denial still leaves the screen — the app does not argue with the answer, and the
    // notice about what is now switched off lives on the feature that needs it
    // (components/PermissionBanner, app/lie-analysis, hooks/useVoiceCaddie), not here.
    jest.useFakeTimers();
    try {
      mockRequest.mockResolvedValue(state(false));
      mount();
      fireEvent.press(await screen.findByText('Continue'));
      await waitFor(() => expect(mockRequest).toHaveBeenCalled());
      jest.runAllTimers();
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('never offers a Settings shortcut in place of the request', async () => {
    // Apple's advice puts the Settings link on the feature that is switched off. On the primer it
    // would just be the postpone button under another name.
    mockRequest.mockResolvedValue(state(false));
    mount();
    fireEvent.press(await screen.findByText('Continue'));
    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    expect(screen.queryByText(/open settings/i)).toBeNull();
    expect(mockOpenSettings).not.toHaveBeenCalled();
  });

  it('a request the OS never answers still lets the user out', async () => {
    // The hang the postpone button used to rescue. ASK_TIMEOUT_MS is the rescue now, with no UI.
    jest.useFakeTimers();
    try {
      mockRequest.mockReturnValue(new Promise(() => { /* never settles */ }));
      mount();
      fireEvent.press(await screen.findByText('Continue'));
      jest.advanceTimersByTime(30_000);
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    } finally {
      jest.useRealTimers();
    }
  });

});
