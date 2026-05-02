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

import * as Sentry from '@sentry/react-native';
import { useRoundStore } from '../store/roundStore';
import { setBatterySaverFloor } from './gpsManager';

const PROMPT_THRESHOLD = 0.20;

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

function evaluatePrompt(level: number): void {
  const round = useRoundStore.getState();
  if (!round.isRoundActive) return;
  if (state.alreadyPromptedThisRound) return;
  if (level > PROMPT_THRESHOLD) return;
  state = { ...state, promptVisible: true, alreadyPromptedThisRound: true };
  breadcrumb('prompt_shown', { level });
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

  // Reset per-round state on round transitions.
  let active = useRoundStore.getState().isRoundActive;
  roundUnsub = useRoundStore.subscribe((s) => {
    if (s.isRoundActive === active) return;
    active = s.isRoundActive;
    if (!active) resetForNewRound();
  });
}

export function teardownBatteryMonitor(): void {
  if (unsubBattery) { unsubBattery(); unsubBattery = null; }
  if (roundUnsub) { roundUnsub(); roundUnsub = null; }
}
