/**
 * 2026-09-28 (1.0.2) — FOUR FUNNEL EVENTS, FIRST-PARTY ONLY.
 *
 * Install → first round → second round, and the first time the player talks to the caddie: the four
 * points Tim needs to see where players drop off. There was no way to count any of them (the 1.02
 * monetization audit). They go through the existing usage telemetry (services/usageTelemetry →
 * /api/usage → smartplay.usage_events) — no third-party SDK — and respect its toggle.
 *
 * Each fires ONCE per install. The "already fired" set is persisted, so a relaunch, a reinstall of the
 * JS bundle by OTA, or a second input path reaching the same moment cannot double-count. A reinstall of
 * the app clears it along with everything else, which is correct: that is a new install.
 *
 * Exactly what each event sends is documented in FUNNEL_EVENT_FIELDS below, because it must match the
 * App Store privacy answers and the Play Data safety form word for word.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export type FunnelEvent = 'first_open' | 'first_round' | 'second_round' | 'first_caddie_turn';
export type CaddieTurnPath = 'mic' | 'vad' | 'earbud' | 'typed';

/**
 * The props each event carries, in addition to the envelope every usage event has
 * (event name, client timestamp, and the random per-install anonId — see usageTelemetry.flushUsage).
 * Enforced, not just documented: fireOnce drops any prop not listed here.
 */
const FUNNEL_EVENT_FIELDS: Record<FunnelEvent, readonly string[]> = {
  first_open: ['platform'],
  first_round: ['holes', 'mode'],
  second_round: ['days_since_first_round'],
  first_caddie_turn: ['path', 'in_round'],
};

const KEY = 'smartplay.funnel.v1';
type Persisted = { fired: FunnelEvent[]; firstRoundAt: number | null; roundsStarted: number };
let state: Persisted | null = null;
let loading: Promise<Persisted> | null = null;

async function load(): Promise<Persisted> {
  if (state) return state;
  if (loading) return loading;
  loading = (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const p = raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
      state = {
        fired: Array.isArray(p.fired) ? p.fired : [],
        firstRoundAt: typeof p.firstRoundAt === 'number' ? p.firstRoundAt : null,
        roundsStarted: typeof p.roundsStarted === 'number' ? p.roundsStarted : 0,
      };
    } catch {
      state = { fired: [], firstRoundAt: null, roundsStarted: 0 };
    }
    return state;
  })().finally(() => { loading = null; });
  return loading;
}

async function save(): Promise<void> {
  try { if (state) await AsyncStorage.setItem(KEY, JSON.stringify(state)); } catch { /* best-effort */ }
}

/** Wait for the settings store so a user's persisted telemetry choice is read, not the default. */
async function settingsReady(): Promise<void> {
  const { useSettingsStore } = require('../store/settingsStore') as typeof import('../store/settingsStore');
  if (useSettingsStore.getState().hasHydrated) return;
  await new Promise<void>((resolve) => {
    const unsub = useSettingsStore.subscribe((s) => { if (s.hasHydrated) { unsub(); resolve(); } });
    if (useSettingsStore.getState().hasHydrated) { unsub(); resolve(); }
  });
}

async function fireOnce(event: FunnelEvent, props: Record<string, unknown>): Promise<void> {
  const s = await load();
  if (s.fired.includes(event)) return;
  // 2026-09-29 (review) — the funnel is for installs that STARTED on this build. first_open only fires
  // on a first launch, so an install that updated from 1.0.1 never has it, and its next round is not
  // its "first_round". Without this, every upgrader's first round after the update read as a new player.
  if (event !== 'first_open' && !s.fired.includes('first_open')) return;
  s.fired.push(event);
  await save();
  await settingsReady();
  // The declared field list IS the whitelist: nothing a caller adds later can leave the phone without
  // first being added to FUNNEL_EVENT_FIELDS — which is what the privacy answers are written from.
  const allowed = FUNNEL_EVENT_FIELDS[event];
  const clean = Object.fromEntries(Object.entries(props).filter(([k]) => allowed.includes(k)));
  try { (require('./usageTelemetry') as typeof import('./usageTelemetry')).track(event, clean); } catch { /* never throws */ }
}

/** The first launch of this install. Called where first_opened_at is stamped. */
export function noteFirstOpen(): void {
  void fireOnce('first_open', { platform: Platform.OS }).catch(() => undefined);
}

/** A real (non-sim) round started. Fires first_round on the first, second_round on the second. */
export function noteRoundStarted(info: { holes: number; mode: string }): void {
  void (async () => {
    const s = await load();
    s.roundsStarted += 1;
    if (s.roundsStarted === 1) s.firstRoundAt = Date.now();
    await save();
    if (s.roundsStarted === 1) await fireOnce('first_round', { holes: info.holes, mode: info.mode });
    else if (s.roundsStarted === 2) {
      const days = s.firstRoundAt ? Math.floor((Date.now() - s.firstRoundAt) / 86_400_000) : null;
      await fireOnce('second_round', { days_since_first_round: days });
    }
  })().catch(() => undefined);
}

/** The player addressed the caddie — every input path calls this; only the first counts. */
export function noteCaddieTurn(path: CaddieTurnPath): void {
  void (async () => {
    let inRound = false;
    try { inRound = (require('../store/roundStore') as typeof import('../store/roundStore')).useRoundStore.getState().isRoundActive; } catch { /* default */ }
    await fireOnce('first_caddie_turn', { path, in_round: inRound });
  })().catch(() => undefined);
}

/** Test seam. Never called by the app. */
export function __resetFunnelForTest(): void { state = null; loading = null; }
