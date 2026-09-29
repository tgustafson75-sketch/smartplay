/**
 * 2026-09-29 — a founding / promo code is redeemed where a player looks for one: the plans screen
 * and Settings' subscription section. Mounted and tapped, because "the row exists" is not the
 * property — "a tap reaches the store's redemption" is. (The paywall itself was once built, correct
 * and unreachable; see a-paywall-only-a-locked-out-player-can-reach.)
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../i18n/locales/en.json';

const mockSdk = {
  configure: jest.fn(),
  setDebugLogsEnabled: jest.fn(),
  getCustomerInfo: jest.fn(async () => ({ entitlements: { active: {}, all: {} } })),
  getOfferings: jest.fn(async () => ({ current: { availablePackages: [] } })),
  invalidateCustomerInfoCache: jest.fn(async () => undefined),
  presentCodeRedemptionSheet: jest.fn(async () => undefined),
  addCustomerInfoUpdateListener: jest.fn(),
  removeCustomerInfoUpdateListener: jest.fn(() => true),
};
jest.mock('react-native-purchases', () => ({ __esModule: true, default: mockSdk }));
// expo-av has no native side under jest-expo; the paywall's greeting voice is not under test here.
jest.mock('../../services/voiceService', () => ({ speak: jest.fn(async () => undefined), configureAudioForSpeech: jest.fn(async () => undefined) }));
// analytics.track starts a flush interval that would hold jest open; the events are not under test.
jest.mock('../../services/analytics', () => ({ track: jest.fn(), captureError: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/paywall',
  useSegments: () => [],
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));

describe('Have a code? — on the plans screen', () => {
  it('opens Apple\'s offer-code sheet', async () => {
    const Paywall = require('../../app/paywall').default;
    render(<Paywall />);
    await act(async () => { fireEvent.press(screen.getByText('Have a code? Redeem it')); });
    expect(mockSdk.presentCodeRedemptionSheet).toHaveBeenCalledTimes(1);
  }, 30_000); // the paywall's first require transforms most of the app cold
});
