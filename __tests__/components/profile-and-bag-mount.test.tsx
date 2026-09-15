/**
 * 2026-09-14 (Tim, going to bed) — "make sure everything is done there's nothing open".
 *
 * The two screens he says he will open FIRST in the morning — Profile and the bag — are the two
 * largest pieces of new code written today, and every test guarding them so far reads SOURCE. A
 * source grep cannot tell you a screen mounts. This repo has never had a render test (the jest
 * `components` project was configured and empty), so nothing has ever proven any screen mounts.
 *
 * This mounts both against the real stores. It is a smoke test on purpose: if it renders without
 * throwing and puts its own headings on screen, the thing he taps in the morning exists.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../i18n/locales/en.json';

/**
 * Real English, not keys. `t()` falls back to the key when i18n is uninitialised, so asserting on
 * keys would pass even if the translation were missing — and a screen rendering `bag.add.video` at
 * a player is a defect this repo has a separate guard for. Initialising here means these
 * assertions also prove the copy resolves.
 */
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/profile',
  useSegments: () => [],
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
  MediaTypeOptions: { Videos: 'Videos', Images: 'Images' },
}));

describe('the screens Tim opens first actually mount', () => {
  it('the profile form renders its fields', () => {
    const { ProfileForm } = require('../../components/profile/ProfileForm');
    render(<ProfileForm />);
    // The field he said was missing, and the one that proves the pickers rendered.
    expect(screen.getByText(/WHERE YOU'RE AT|Where you/i)).toBeTruthy();
    expect(screen.getByText('Competitive')).toBeTruthy();
    expect(screen.getByText('Improving')).toBeTruthy();
  });

  it('the bag screen renders, and offers all three ways in', () => {
    const BagScreen = require('../../app/bag-scan').default;
    render(<BagScreen />);
    expect(screen.getByText(/Scan with video/i)).toBeTruthy();
    expect(screen.getByText(/Take a photo/i)).toBeTruthy();
    expect(screen.getByText(/Add photos/i)).toBeTruthy();
  });

  it('the bag opens on the BAG once clubs exist — not on the camera', () => {
    const { useClubBagStore } = require('../../store/clubBagStore');
    useClubBagStore.getState().clearBag();
    useClubBagStore.getState().registerClub('DR', { source: 'camera', brand: 'TaylorMade', model: 'Stealth 2', loft: '10.5\u00b0' });
    useClubBagStore.getState().registerClub('7I', { source: 'voice' });

    const BagScreen = require('../../app/bag-scan').default;
    render(<BagScreen />);

    // The racks, and the club with its specs — the state that used to be unreachable because the
    // screen only ever had a camera.
    expect(screen.getByText('WOODS')).toBeTruthy();
    expect(screen.getByText('IRONS')).toBeTruthy();
    expect(screen.getByText('DR')).toBeTruthy();
    expect(screen.getByText(/TaylorMade . Stealth 2/)).toBeTruthy();
    // A club registered by voice knows nothing yet and must say so, not show blanks.
    expect(screen.getByText('Tap to add brand, shaft and grip')).toBeTruthy();
  });

  it('an empty bag says so rather than looking broken', () => {
    const { useClubBagStore } = require('../../store/clubBagStore');
    useClubBagStore.getState().clearBag();
    const BagScreen = require('../../app/bag-scan').default;
    render(<BagScreen />);
    expect(screen.getByText('Your bag is empty')).toBeTruthy();
  });

  it('the profile form shows his home courses and the bag he owns', () => {
    const { usePlayerProfileStore } = require('../../store/playerProfileStore');
    usePlayerProfileStore.getState().setHomeCourses([{ id: 'local:palms', name: 'Palms' }]);
    const { ProfileForm } = require('../../components/profile/ProfileForm');
    render(<ProfileForm />);
    expect(screen.getByText('Palms')).toBeTruthy();
    expect(screen.getByText('Home courses (up to 3)')).toBeTruthy();
  });
});
