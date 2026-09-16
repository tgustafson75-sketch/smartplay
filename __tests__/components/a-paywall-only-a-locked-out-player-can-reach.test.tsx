/**
 * 2026-09-15 — App Review, guideline 2.1(b): "we cannot locate the In-App Purchases ... within the
 * app at this time."
 *
 * The paywall was not broken and not hidden by a flag. SUBSCRIPTIONS_ENABLED has been true since
 * 2026-09-03, app/paywall.tsx renders both prices, a Subscribe button and a Restore — and a
 * reviewer could not get to it, because EVERY route to it was a gate:
 *
 *     triggerPaywall(feature, () => router.push('/paywall'))   ← fires only when canAccess() fails
 *
 * A fresh install starts a 14-day trial; a trial grants 'pro'; 'pro' passes every canAccess check.
 * So for the first fortnight of any install there was no reachable path to the purchase screen at
 * all. App Review installs fresh. They were always going to land inside the trial, and nothing
 * they could tap would show them a product.
 *
 * This is the gate for the property that was missing — NOT "the row exists" (a source grep would
 * say that), but "a player who has lost nothing can still reach the purchase screen". So it mounts
 * the menu as a player mid-trial, with full entitlement, and follows the tap.
 * [[reachable-not-just-wired]] [[smartplay-defect-class-unwired-halves]]
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

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: mockPush, replace: jest.fn(), back: jest.fn() },
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/caddie',
  useSegments: () => [],
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));

describe('the purchase screen is reachable by a player who has lost nothing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { useToolsMenuStore } = require('../../store/toolsMenuStore');
    useToolsMenuStore.setState({ isOpen: true });
    // The exact state App Review is in on a fresh install: mid-trial, fully entitled, nothing
    // gated, so not one triggerPaywall call site in the app can fire.
    const { usePlayerProfileStore } = require('../../store/playerProfileStore');
    usePlayerProfileStore.setState({
      subscription_status: 'trial',
      trial_started_at: Date.now(),
    });
  });

  it('full entitlement is exactly the state that used to hide it', () => {
    const { canAccess } = require('../../services/featureAccess');
    // Every gated feature passes, so every triggerPaywall route is dead. If this ever stops being
    // true the test below stops testing anything, so assert the premise.
    for (const f of ['smartvision', 'smartfinder', 'cage_mode', 'voice_advanced']) {
      expect(canAccess(f, 'trial')).toBe(true);
    }
  });

  it('the tools menu offers a route to the paywall that asks no entitlement question', () => {
    const { GlobalToolsMenu } = require('../../components/tools/GlobalToolsMenu');
    render(<GlobalToolsMenu />);

    const row = screen.getByText('Subscription');
    fireEvent.press(row);

    expect(mockPush).toHaveBeenCalledWith('/paywall');
  });
});
