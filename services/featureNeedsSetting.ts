/**
 * 2026-10-14 (Tim: "it should tell the user that a function only works with that setting") — WHEN A
 * SETTING TURNS A FEATURE OFF, SAY WHICH ONE.
 *
 * Two settings silently disabled pocket tracking (GPS audit #10): iOS location below "Always" (no
 * background updates — no hole advance or shot tracking with the phone locked), and Android notifications
 * denied (no foreground service, so the background task is skipped). The round still played; the player
 * just never learned why the phone in his pocket did nothing. Now: one alert naming the feature, the
 * setting it needs, and a button to it. Once per app session — told, not nagged.
 */
import { Alert, Linking } from 'react-native';

export type NeededSetting = 'location_always' | 'notifications';

const COPY: Record<NeededSetting, { title: string; body: string }> = {
  location_always: {
    title: 'Pocket tracking is off',
    body:
      'Auto hole advance and shot tracking with your phone in your pocket or locked only work with ' +
      'Location set to "Always". Everything else in your round works as normal.\n\n' +
      'Settings → SmartPlay Caddie → Location → Always.',
  },
  notifications: {
    title: 'Pocket tracking is off',
    body:
      'Auto hole advance and shot tracking with your phone in your pocket or locked only work with ' +
      'notifications allowed — Android needs one to keep GPS running in the background. Everything ' +
      'else in your round works as normal.\n\nSettings → SmartPlay Caddie → Notifications.',
  },
};

const toldThisSession = new Set<NeededSetting>();

/** Test seam: the harness cannot present an Alert. */
let presenter: ((title: string, body: string) => void) | null = null;
export function _setNeededSettingPresenter(fn: ((title: string, body: string) => void) | null): void {
  presenter = fn;
}
export function _resetNeededSettingSession(): void {
  toldThisSession.clear();
}

/** Tell him once per session that `setting` turns a feature off, with a way to it. Never throws. */
export function tellFeatureNeedsSetting(setting: NeededSetting): void {
  if (toldThisSession.has(setting)) return;
  toldThisSession.add(setting);
  const { title, body } = COPY[setting];
  try {
    if (presenter) { presenter(title, body); return; }
    Alert.alert(title, body, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => { void Linking.openSettings().catch(() => undefined); } },
    ]);
  } catch { /* telling him must never cost the round */ }
}
