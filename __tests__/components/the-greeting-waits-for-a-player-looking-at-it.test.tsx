/**
 * 2026-10-25 (Sentry NB–NH — a relaunch mid-round, route /greeting, in_foreground: false).
 *
 * A headset or car "play" can launch SmartPlay in the BACKGROUND (the native BluetoothMediaButton
 * module registers it with MPRemoteCommandCenter), and index routes every cold launch to /greeting.
 * The greeting then played into the player's earbuds with no screen up — spending the once-per-launch
 * greeting where nobody could see it — and it was the line the press then cut (NE).
 *
 * Mounts the real greeting screen (audio stubbed) and asks what the player would hear: nothing until
 * the app is the open app, then the greeting.
 */
import React from 'react';
import { AppState } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPlayLocalFile = jest.fn(async () => undefined);
const mockGoToTab = jest.fn();
jest.mock('../../services/voiceService', () => ({
  playLocalFile: (...a: unknown[]) => (mockPlayLocalFile as (...x: unknown[]) => Promise<void>)(...a),
  stopSpeaking: jest.fn(async () => undefined),
  configureAudioForSpeech: jest.fn(async () => undefined),
}));
jest.mock('../../services/voiceWarmup', () => ({ prewarmVoice: jest.fn() }));
jest.mock('../../services/kevinGreeting', () => ({
  pickGreeting: () => 'universal_01.mp3',
  recordLaunch: jest.fn(async () => undefined),
  getLaunchContext: jest.fn(async () => ({})),
  getGreetingCaption: () => 'There you are.',
}));
jest.mock('../../services/kevinGreetingManifest', () => ({ getGreetingAssetForPersona: () => 1 }));
jest.mock('../../services/getCaddieClip', () => ({ getCaddieClip: () => 1 }));
jest.mock('../../services/apiBase', () => ({ getApiBaseUrl: () => 'http://localhost:9' }));
jest.mock('../../services/safeBack', () => ({ goToTab: (...a: unknown[]) => mockGoToTab(...a) }));
jest.mock('expo-asset', () => ({
  Asset: { fromModule: () => ({ downloadAsync: async () => undefined, localUri: 'file:///greeting.mp3' }) },
}));
jest.mock('expo-av', () => require('../mocks/expoAv.js'));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ colors: { background: '#000', accent: '#0f0', text_primary: '#fff' } }),
}));
jest.mock('../../store/settingsStore', () => {
  const state = { voiceGender: 'female', caddiePersonality: 'serena', language: 'en', hasHydrated: true };
  const useSettingsStore = (sel: (s: typeof state) => unknown) => sel(state);
  useSettingsStore.getState = () => state;
  return { useSettingsStore };
});

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
let listeners: Array<(s: string) => void> = [];
let current = 'active';

beforeEach(() => {
  jest.useFakeTimers();
  mockPlayLocalFile.mockClear();
  mockGoToTab.mockClear();
  listeners = [];
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => current });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, l: (s: string) => void) => {
    listeners.push(l);
    return { remove: () => { listeners = listeners.filter((x) => x !== l); } };
  }) as unknown as typeof AppState.addEventListener);
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); current = 'active'; });

async function settle(ms = 50) {
  for (let i = 0; i < 10; i++) await act(async () => { jest.advanceTimersByTime(ms / 10); await Promise.resolve(); });
}
function mount() {
  const Greeting = require('../../app/greeting').default;
  return render(<SafeAreaProvider initialMetrics={metrics}><Greeting /></SafeAreaProvider>);
}

describe('the greeting is for a player looking at the app', () => {
  it('THE BUG: launched in the background — nothing plays, and the 10s net does not spend the greeting', async () => {
    current = 'background';
    mount();
    await settle(200);
    await act(async () => { jest.advanceTimersByTime(15_000); });
    await settle();
    expect(mockPlayLocalFile).not.toHaveBeenCalled();
    expect(mockGoToTab).not.toHaveBeenCalled();
  });

  it('the first active starts it', async () => {
    current = 'background';
    mount();
    await settle(200);
    expect(mockPlayLocalFile).not.toHaveBeenCalled();
    current = 'active';
    await act(async () => { listeners.forEach((l) => l('active')); });
    await settle(200);
    expect(mockPlayLocalFile).toHaveBeenCalledTimes(1);
  });

  it('a foreground launch greets exactly as before', async () => {
    current = 'active';
    mount();
    await settle(200);
    expect(mockPlayLocalFile).toHaveBeenCalledTimes(1);
  });

  it('iOS turning active between first render and subscription is not missed', async () => {
    current = 'inactive';
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, l: (s: string) => void) => {
      current = 'active'; // the change fired before anyone was listening
      listeners.push(l);
      return { remove: () => undefined };
    }) as unknown as typeof AppState.addEventListener);
    mount();
    await settle(200);
    expect(mockPlayLocalFile).toHaveBeenCalledTimes(1);
  });
});
