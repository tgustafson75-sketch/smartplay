/**
 * 2026-09-29 (review) — SmartFinder and SmartVision only checked the remote kill flag, so a deep link
 * (smartplay://smartfinder) opened a paid tool on the lite edition. Every in-app button asks canAccess
 * first; the screen itself now does too (hooks/useEntitlementGate).
 *
 * This MOUNTS the real screens (native modules stubbed) and follows what they do on mount:
 *   • a lite player is sent to the paywall (replace, so Back does not bounce into the screen);
 *   • an active / trial / lifetime player, and an owner, are never touched;
 *   • nothing is decided before the profile store has hydrated (the 'free' default would look like a
 *     locked-out subscriber).
 */
import React from 'react';
import { render, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { use as i18nUse } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../i18n/locales/en.json';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: mockPush, replace: mockReplace, back: jest.fn(), canGoBack: () => false },
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: mockReplace, canGoBack: () => false }),
  usePathname: () => '/smartfinder',
  useSegments: () => [],
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));
jest.mock('react-native-gesture-handler', () => {
  const { View: V } = require('react-native');
  const chain: unknown = new Proxy({}, { get: () => () => chain });
  return {
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    GestureHandlerRootView: V,
    Gesture: new Proxy({}, { get: () => () => chain }),
  };
});
jest.mock('react-native-reanimated', () => ({ runOnJS: (fn: unknown) => fn, __esModule: true, default: {} }));
jest.mock('expo-camera', () => {
  const { View: V } = require('react-native');
  return {
    CameraView: V,
    useCameraPermissions: () => [{ granted: false, canAskAgain: true }, jest.fn()],
    useMicrophonePermissions: () => [{ granted: false, canAskAgain: true }, jest.fn()],
  };
});
jest.mock('expo-sensors', () => {
  const sensor = { addListener: () => ({ remove() {} }), setUpdateInterval() {}, isAvailableAsync: async () => false, removeAllListeners() {} };
  return { DeviceMotion: sensor, Accelerometer: sensor, Magnetometer: sensor, Gyroscope: sensor, Barometer: sensor };
});
jest.mock('expo-av', () => require('../mocks/expoAv.js'));
jest.mock('expo-speech', () => require('../mocks/expoGeneric.js'));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => undefined, activateKeepAwakeAsync: async () => undefined, deactivateKeepAwake: () => undefined }));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: async () => ({ status: 'denied', granted: false }),
  requestForegroundPermissionsAsync: async () => ({ status: 'denied', granted: false }),
  getCurrentPositionAsync: async () => { throw new Error('no gps in test'); },
  getLastKnownPositionAsync: async () => null,
  watchPositionAsync: async () => ({ remove() {} }),
  watchHeadingAsync: async () => ({ remove() {} }),
  Accuracy: { High: 4, Balanced: 3, BestForNavigation: 6, Highest: 5, Low: 2, Lowest: 1 },
}));

beforeAll(async () => {
  await i18nUse(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

async function mount(route: 'smartfinder' | 'smartvision') {
  const Screen = route === 'smartfinder' ? require('../../app/smartfinder').default : require('../../app/smartvision').default;
  const r = render(<SafeAreaProvider initialMetrics={metrics}><Screen /></SafeAreaProvider>);
  // The gate decides a tick after mount (navigating during the first commit breaks the router).
  await act(async () => { jest.advanceTimersByTime(5); });
  for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); });
  return r;
}

const pushedPaywall = () =>
  [...mockReplace.mock.calls, ...mockPush.mock.calls].some(([to]) => to === '/paywall');

beforeEach(() => {
  jest.useFakeTimers();
  mockReplace.mockClear();
  mockPush.mockClear();
  const { useRoundStore } = require('../../store/roundStore');
  useRoundStore.setState({ isRoundActive: false });
  const { usePlayerProfileStore } = require('../../store/playerProfileStore');
  usePlayerProfileStore.setState({ subscription_status: 'free', email: '' });
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

describe.each(['smartfinder', 'smartvision'] as const)('%s — the screen checks its own door', (route) => {
  it.each(['free', 'expired'] as const)('a %s (lite) player arriving by deep link is sent to the paywall', async (status) => {
    require('../../store/playerProfileStore').usePlayerProfileStore.setState({ subscription_status: status });
    const r = await mount(route);
    expect(mockReplace).toHaveBeenCalledWith('/paywall');
    r.unmount();
  });

  it.each(['active', 'trial', 'lifetime'] as const)('a %s player is never gated', async (status) => {
    require('../../store/playerProfileStore').usePlayerProfileStore.setState({ subscription_status: status });
    const r = await mount(route);
    expect(pushedPaywall()).toBe(false);
    r.unmount();
  });

  it('an owner is never gated, whatever the status says', async () => {
    const { usePlayerProfileStore, OWNER_EMAILS } = require('../../store/playerProfileStore');
    const owner = (OWNER_EMAILS as string[] | undefined)?.[0] ?? process.env.EXPO_PUBLIC_OWNER_EMAIL;
    if (!owner) return; // no owner configured in this build — nothing to assert
    usePlayerProfileStore.setState({ subscription_status: 'free', email: owner });
    const r = await mount(route);
    expect(pushedPaywall()).toBe(false);
    r.unmount();
  });

  it('nothing is decided before the profile store has hydrated', async () => {
    const { usePlayerProfileStore } = require('../../store/playerProfileStore');
    const persist = usePlayerProfileStore.persist;
    const realHas = persist.hasHydrated;
    const realOn = persist.onFinishHydration;
    let finish: (() => void) | null = null;
    let hydrated = false;
    persist.hasHydrated = () => hydrated;
    persist.onFinishHydration = (fn: () => void) => { finish = fn; return () => { finish = null; }; };
    try {
      // Pre-hydration default is 'free' — a subscriber would look locked out.
      const r = await mount(route);
      expect(pushedPaywall()).toBe(false);
      // Hydration lands with the persisted 'active'.
      await act(async () => {
        usePlayerProfileStore.setState({ subscription_status: 'active' });
        hydrated = true;
        (finish as unknown as () => void)?.();
      });
      await act(async () => { jest.advanceTimersByTime(5); });
      expect(pushedPaywall()).toBe(false);
      r.unmount();
    } finally {
      persist.hasHydrated = realHas;
      persist.onFinishHydration = realOn;
    }
  });
});
