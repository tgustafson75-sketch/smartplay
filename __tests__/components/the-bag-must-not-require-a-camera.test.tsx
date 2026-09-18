/**
 * 2026-09-18 (Tim) — "User needs to be able to manually enter bag details too. new registration
 * forces photo or video. Give users option to skip for later in profile."
 *
 * THE FOURTH STEP OF FIRST RUN HAD ONE KEY FOR THREE DOORS. app/bag-scan offered a video pan, a
 * photo and a photo library — all three a camera — and decideFirstRunRoute sends every fresh
 * install there with an empty bag. A player who will not photograph their clubs ninety seconds
 * into owning the app could not put a single club in the bag, and the only way past was a header
 * chevron that says nothing about where the bag went.
 *
 * Two properties, and each is asserted BY BEHAVIOUR rather than by the presence of a string:
 *
 *   1. A club can be put in the bag with no camera at all — pressed for real, read back out of the
 *      store, and stamped `source: 'manual'` so it is the same registration every other path makes.
 *   2. "Skip for now" is shown when FIRST RUN opened this screen, and NOT when the player walked
 *      here themselves. A skip control that is always on screen is the wrong half of the bug: the
 *      player who chose the bag is not being asked to abandon it.
 *
 * The negative half matters as much as the positive one — this suite has been fooled before by a
 * guard that asserts a shape rather than a property. [[a-guard-can-assert-the-broken-shape]]
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../i18n/locales/en.json';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/bag-scan',
  useSegments: () => [],
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));
/** The whole point is that none of these are reached. Mocked so a regression that opens the camera
 *  fails loudly here rather than hanging on a native module. */
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
  MediaTypeOptions: { Videos: 'Videos', Images: 'Images' },
}));

const freshInstall = () => {
  const { useClubBagStore } = require('../../store/clubBagStore');
  const { useSettingsStore } = require('../../store/settingsStore');
  useClubBagStore.getState().clearBag();
  useSettingsStore.setState({ tutorialsSeen: {} });
};

describe('the bag can be filled without a camera', () => {
  // NO jest.resetModules() here — this file imports React at the top, and a reset registry
  // hands the screen a SECOND copy of React ('Invalid hook call'). The stores are reset instead.
  beforeEach(freshInstall);

  it('typing a club in by hand registers it — no camera, no scan', () => {
    const { useClubBagStore } = require('../../store/clubBagStore');
    const BagScreen = require('../../app/bag-scan').default;
    render(<BagScreen />);

    // The list is closed until asked for, so the camera actions stay the fast path.
    expect(screen.queryByLabelText('Add 7I to my bag')).toBeNull();
    fireEvent.press(screen.getByLabelText('Add clubs by hand from a list'));

    fireEvent.press(screen.getByLabelText('Add 7I to my bag'));
    fireEvent.press(screen.getByLabelText('Add Putter to my bag'));

    const bag = useClubBagStore.getState().clubs;
    expect(Object.keys(bag).sort()).toEqual(['7I', 'PT']);
    // Registered the same way a scan registers, only sourced honestly.
    expect(bag['7I'].source).toBe('manual');
    expect(require('expo-image-picker').launchCameraAsync).not.toHaveBeenCalled();
    expect(require('expo-image-picker').launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('one press starts them off with an off-the-rack set, and never overwrites a club they have', () => {
    const { useClubBagStore } = require('../../store/clubBagStore');
    const { STANDARD_SET } = require('../../services/standardBag');
    const { USGA_CLUB_LIMIT } = require('../../store/clubBagStore');
    // A driver they already scanned, specs and all. The set must leave it alone.
    useClubBagStore.getState().registerClub('DR', { source: 'camera', brand: 'Ping', model: 'G430' });

    const BagScreen = require('../../app/bag-scan').default;
    render(<BagScreen />);
    fireEvent.press(screen.getByLabelText('Add clubs by hand from a list'));
    fireEvent.press(screen.getByLabelText('Fill my bag with a standard fourteen-club set'));

    const bag = useClubBagStore.getState().clubs;
    // Every club in the set is in the bag, and the bag is legal to tee off with.
    for (const id of STANDARD_SET) expect(bag[id]).toBeTruthy();
    expect(Object.keys(bag)).toHaveLength(USGA_CLUB_LIMIT);
    // The scanned driver survived intact — additive, not a reset.
    expect(bag['DR'].source).toBe('camera');
    expect(bag['DR'].variants[0].model).toBe('G430');
    expect(require('expo-image-picker').launchCameraAsync).not.toHaveBeenCalled();
  });

  it('a club already in the bag reads as in, and the same chip takes it out', () => {
    const { useClubBagStore } = require('../../store/clubBagStore');
    const { Alert } = require('react-native');
    // Confirm the removal the way a player would — the chip must not delete silently.
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      const btns = args[2] as { text: string; onPress?: () => void }[] | undefined;
      btns?.find((b) => b.text === 'Remove')?.onPress?.();
    });
    useClubBagStore.getState().registerClub('DR', { source: 'camera' });

    const BagScreen = require('../../app/bag-scan').default;
    render(<BagScreen />);
    fireEvent.press(screen.getByLabelText('Add clubs by hand from a list'));
    fireEvent.press(screen.getByLabelText('Remove DR from my bag'));

    expect(useClubBagStore.getState().clubs['DR']).toBeUndefined();
    (Alert.alert as jest.Mock).mockRestore();
  });
});

describe('first run can be left, and says where the bag went', () => {
  // NO jest.resetModules() here — this file imports React at the top, and a reset registry
  // hands the screen a SECOND copy of React ('Invalid hook call'). The stores are reset instead.
  beforeEach(freshInstall);

  it('offers the skip when first run sent the player here, and names Profile', () => {
    const BagScreen = require('../../app/bag-scan').default;
    render(<BagScreen />);
    expect(screen.getByText('Skip for now')).toBeTruthy();
    // The destination is checkable, not reassuring — Profile → My Bag is a row that exists.
    expect(screen.getByText(/Profile . My Bag/)).toBeTruthy();
  });

  it('does NOT offer it to a player who opened their own bag', () => {
    const { useSettingsStore } = require('../../store/settingsStore');
    useSettingsStore.getState().markTutorialSeen('bag_setup_offered');
    const BagScreen = require('../../app/bag-scan').default;
    render(<BagScreen />);
    expect(screen.queryByText('Skip for now')).toBeNull();
  });

  it('nor to a player who already owns clubs', () => {
    const { useClubBagStore } = require('../../store/clubBagStore');
    useClubBagStore.getState().registerClub('9I', { source: 'manual' });
    const BagScreen = require('../../app/bag-scan').default;
    render(<BagScreen />);
    expect(screen.queryByText('Skip for now')).toBeNull();
  });
});
