/**
 * 2026-10-25 (Sentry NB–NH, iPhone 17 Pro Max, build 33, a relaunch mid-round) — IS THE APP UP?
 *
 * Seven seconds after a cold start, still on /greeting, with the app NOT in the foreground
 * (in_foreground: false), an earbud press reached listeningSession. iOS refused the recording —
 * "Start encountered an error: recording not started." — the session retried into the same wall and
 * then said "my mic didn't open — tap me again", which no tap could fix while the app stayed in the
 * background. A play/pause command can also be what LAUNCHED the app in the background: the native
 * BluetoothMediaButton module registers SmartPlay with MPRemoteCommandCenter.
 *
 * Not a refusal: with the phone locked mid-round and an audio session already active, iOS may allow
 * the recording, and pocketed earbud talk is the core on-course flow. So a press only WAITS briefly
 * for the app to come forward (cold launch, unlock), and a failed start is explained only once it
 * has actually failed (listeningSession). What this module adds is the clock: if JS was suspended
 * during the wait, the press is minutes old when the timer finally fires, and opening a mic on it
 * would be a hot mic nobody asked for.
 */
import { AppState, Platform } from 'react-native';

/** True when the platform can refuse to start a recording from the background. */
export function micRequiresForeground(): boolean {
  return Platform.OS === 'ios';
}

/** True when the platform could have refused a recording because the app is not the open app. */
export function micMayBeRefusedNow(): boolean {
  return micRequiresForeground() && AppState.currentState !== 'active';
}

/** A suspended JS thread wakes late; anything this far past its own deadline is a stale press. */
const STALE_SLACK_MS = 500;

export type ForegroundWait = 'active' | 'not_active' | 'stale';

/**
 * Waits up to maxMs for the app to be 'active' — immediately if it already is. 'not_active' means the
 * wait ran its course and the app is still behind something (locked, backgrounded); 'stale' means the
 * answer arrived so late (JS suspended mid-wait) that the press it was waiting for is no longer live.
 * Never rejects.
 */
export function waitForAppActive(maxMs: number): Promise<ForegroundWait> {
  if (AppState.currentState === 'active') return Promise.resolve('active');
  const startedAt = Date.now();
  return new Promise<ForegroundWait>((resolve) => {
    let settled = false;
    let sub: { remove: () => void } | null = null;
    const finish = (active: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sub?.remove(); } catch { /* already removed */ }
      if (Date.now() - startedAt > maxMs + STALE_SLACK_MS) resolve('stale');
      else resolve(active ? 'active' : 'not_active');
    };
    const timer = setTimeout(() => finish(AppState.currentState === 'active'), maxMs);
    try {
      sub = AppState.addEventListener('change', (next) => { if (next === 'active') finish(true); });
    } catch { /* no AppState events — the timer still answers */ }
  });
}

/** The short wait a mic press makes; 'active' at once where the platform does not care. */
export async function settleForegroundForMic(maxMs: number): Promise<ForegroundWait> {
  if (!micRequiresForeground()) return 'active';
  // Settled in the background (locked in a pocket) is not "coming forward": nothing will arrive in
  // maxMs, and the pocketed earbud press must not pay the wait. Only a transitional state waits.
  if (AppState.currentState === 'background') return 'not_active';
  return waitForAppActive(maxMs);
}
