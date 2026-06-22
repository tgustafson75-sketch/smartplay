/**
 * Pre-beta — low-battery honest prompt.
 *
 * Subscribes to battery level once at app start. When level drops to ≤20%
 * during an active round (and we haven't already prompted this round),
 * surfaces a single Yes/No prompt. The user's choice sticks for the rest
 * of the round. No second prompt at 10% — one ask per round, by design.
 *
 * If expo-battery is not installed (EAS preview without the dependency),
 * the module degrades silently — no battery telemetry, no prompt.
 */

import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { useRoundStore } from '../store/roundStore';
import { setBatterySaverFloor } from './gpsManager';

const PROMPT_THRESHOLD = 0.20;
// 2026-06-12 — if a round STARTS already low, offer the saver immediately instead of
// waiting to drain to 20% mid-round. Tim showed up at 24% on a power-hungry Z Fold and
// never got the offer because it only fired at ≤20%. 30% gives real runway to decide.
const ROUND_START_THRESHOLD = 0.30;

type Listener = (state: BatteryState) => void;

export interface BatteryState {
  level: number | null;          // 0..1
  promptVisible: boolean;
  saverActive: boolean;          // user opted-in this round
  alreadyPromptedThisRound: boolean;
}

let state: BatteryState = {
  level: null,
  promptVisible: false,
  saverActive: false,
  alreadyPromptedThisRound: false,
};

const listeners = new Set<Listener>();
let unsubBattery: (() => void) | null = null;
let roundUnsub: (() => void) | null = null;

function emit() {
  for (const cb of listeners) {
    try { cb(state); } catch {}
  }
}

function breadcrumb(message: string, data?: Record<string, unknown>) {
  try {
    Sentry.addBreadcrumb({ category: 'battery', level: 'info', message, data });
  } catch {}
}

function evaluatePrompt(level: number, threshold: number = PROMPT_THRESHOLD): void {
  const round = useRoundStore.getState();
  if (!round.isRoundActive) return;
  if (state.alreadyPromptedThisRound) return;
  if (state.saverActive) return; // already on — don't nag
  if (level > threshold) return;
  state = { ...state, promptVisible: true, alreadyPromptedThisRound: true };
  breadcrumb('prompt_shown', { level, threshold });
  emit();
}

export function subscribeBattery(cb: Listener): () => void {
  listeners.add(cb);
  cb(state);
  return () => { listeners.delete(cb); };
}

export function getBatteryState(): BatteryState {
  return state;
}

/** User accepted battery-saver mode for the rest of this round. */
export function acceptBatterySaver(): void {
  state = { ...state, saverActive: true, promptVisible: false };
  setBatterySaverFloor('walking');
  breadcrumb('saver_accepted');
  emit();
}

/** User declined — keep going at full power. */
export function declineBatterySaver(): void {
  state = { ...state, saverActive: false, promptVisible: false };
  breadcrumb('saver_declined');
  emit();
}

/** Round-end clears per-round flags. */
function resetForNewRound(): void {
  state = {
    level: state.level,
    promptVisible: false,
    saverActive: false,
    alreadyPromptedThisRound: false,
  };
  setBatterySaverFloor(null);
  emit();
}

export function initBatteryMonitor(): void {
  if (unsubBattery) return;
  // expo-battery native methods don't exist on web — the stubs throw at call-site
  // rather than failing the typeof guard, so bail out before touching the module.
  if (Platform.OS === 'web') return;
  let Battery: typeof import('expo-battery') | null = null;
  try {
    Battery = require('expo-battery') as typeof import('expo-battery');
  } catch {
    console.log('[battery] expo-battery not installed; monitor degraded to no-op');
    return;
  }

  const BatteryMod = Battery; // capture the verified-non-null reference
  void (async () => {
    try {
      if (typeof BatteryMod.getBatteryLevelAsync !== 'function') return;
      const lvl = await BatteryMod.getBatteryLevelAsync();
      state = { ...state, level: lvl };
      emit();
      if (lvl <= PROMPT_THRESHOLD) evaluatePrompt(lvl);
    } catch {}
  })();

  if (typeof BatteryMod.addBatteryLevelListener !== 'function') return;
  const sub = BatteryMod.addBatteryLevelListener(({ batteryLevel }: { batteryLevel: number }) => {
    state = { ...state, level: batteryLevel };
    emit();
    evaluatePrompt(batteryLevel);
  });
  unsubBattery = () => { try { sub.remove(); } catch {} };

  // Reset per-round state on round end; offer the saver up front on round START if the
  // battery is already low (so a player who tees off low isn't stuck at full-power GPS
  // until it drains to 20%).
  let active = useRoundStore.getState().isRoundActive;
  roundUnsub = useRoundStore.subscribe((s) => {
    if (s.isRoundActive === active) return;
    active = s.isRoundActive;
    if (!active) { resetForNewRound(); return; }
    if (state.level != null) evaluatePrompt(state.level, ROUND_START_THRESHOLD);
  });
}

export function teardownBatteryMonitor(): void {
  if (unsubBattery) { unsubBattery(); unsubBattery = null; }
  if (roundUnsub) { roundUnsub(); roundUnsub = null; }
}
