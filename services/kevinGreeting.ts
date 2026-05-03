/**
 * Kevin launch greeting — selection + persistence.
 *
 * Three responsibilities:
 *   1. pickGreeting(context) — choose the filename to play given the
 *      launch context (first-ever, returning, time-of-day, weekend, demo).
 *   2. recordLaunch() — persist hasLaunchedBefore + lastLaunchTimestamp
 *      to AsyncStorage so the next launch can compute daysSinceLastLaunch.
 *   3. getLaunchContext() — read persistence + clock + env into the
 *      shape pickGreeting consumes.
 *
 * Audio file lookup happens in a separate manifest module (./kevinGreetingManifest)
 * so this layer stays decision-only.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_HAS_LAUNCHED = '@smartplay/kevin_greeting_has_launched';
const KEY_LAST_TS      = '@smartplay/kevin_greeting_last_ts';

export interface LaunchContext {
  isFirstLaunchEver: boolean;
  daysSinceLastLaunch: number;
  hourOfDay: number;     // 0–23 local
  dayOfWeek: number;     // 0=Sun … 6=Sat
  isDemoMode: boolean;   // EXPO_PUBLIC_DEMO_MODE=true → press / demo builds
}

export type GreetingFilename =
  | 'universal_01.mp3' | 'universal_02.mp3' | 'universal_03.mp3'
  | 'morning_01.mp3' | 'morning_02.mp3'
  | 'evening_01.mp3' | 'evening_02.mp3'
  | 'weekend_01.mp3' | 'weekend_02.mp3'
  | 'first_launch.mp3' | 'returning.mp3' | 'demo_mode.mp3';

/** Caption text shown on screen alongside the audio (and as the silent fallback). */
export const GREETING_CAPTION: Record<GreetingFilename, string> = {
  'universal_01.mp3':  "Welcome back. Let's play some golf.",
  'universal_02.mp3':  'There you are. Ready when you are.',
  'universal_03.mp3':  "Good to see you. Let's do this.",
  'morning_01.mp3':    'Early start today — I like it.',
  'morning_02.mp3':    'Morning. Course is calling.',
  'evening_01.mp3':    "Squeezing in a late round? Let's go.",
  'evening_02.mp3':    "Evening light's the best light. Let's play.",
  'weekend_01.mp3':    'Saturday golf is the right kind of golf.',
  'weekend_02.mp3':    'Weekend round. My favorite kind.',
  'first_launch.mp3':  "Welcome to SmartPlay Caddie. I'm Kevin — your golf companion. Let's play some golf.",
  'returning.mp3':     "Been a minute. Glad you're back.",
  'demo_mode.mp3':     "Welcome to SmartPlay Caddie. I'm Kevin — your AI golf companion.",
};

// ─── Selection ───────────────────────────────────────────────────────────────

export function pickGreeting(context: LaunchContext): GreetingFilename {
  if (context.isDemoMode) return 'demo_mode.mp3';
  if (context.isFirstLaunchEver) return 'first_launch.mp3';
  if (context.daysSinceLastLaunch >= 14) return 'returning.mp3';

  const isMorning = context.hourOfDay >= 5 && context.hourOfDay < 11;
  const isEvening = context.hourOfDay >= 17 && context.hourOfDay < 21;
  const isWeekend = context.dayOfWeek === 0 || context.dayOfWeek === 6;

  const pool: GreetingFilename[] = [
    'universal_01.mp3', 'universal_02.mp3', 'universal_03.mp3',
  ];
  if (isMorning) pool.push('morning_01.mp3', 'morning_02.mp3');
  if (isEvening) pool.push('evening_01.mp3', 'evening_02.mp3');
  if (isWeekend) pool.push('weekend_01.mp3', 'weekend_02.mp3');

  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export async function getLaunchContext(): Promise<LaunchContext> {
  const isDemoMode = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
  const now = new Date();
  const hourOfDay = now.getHours();
  const dayOfWeek = now.getDay();

  let isFirstLaunchEver = true;
  let daysSinceLastLaunch = 0;
  try {
    const hasLaunched = await AsyncStorage.getItem(KEY_HAS_LAUNCHED);
    isFirstLaunchEver = hasLaunched !== '1';
    const lastTsRaw = await AsyncStorage.getItem(KEY_LAST_TS);
    if (lastTsRaw) {
      const lastTs = Number(lastTsRaw);
      if (Number.isFinite(lastTs)) {
        daysSinceLastLaunch = Math.max(0, Math.floor((Date.now() - lastTs) / (24 * 60 * 60 * 1000)));
      }
    }
  } catch (e) {
    console.warn('[kevinGreeting] failed to read launch persistence', e);
  }

  return { isFirstLaunchEver, daysSinceLastLaunch, hourOfDay, dayOfWeek, isDemoMode };
}

/** Persist the new launch markers AFTER the greeting has been picked. */
export async function recordLaunch(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_HAS_LAUNCHED, '1');
    await AsyncStorage.setItem(KEY_LAST_TS, String(Date.now()));
  } catch (e) {
    console.warn('[kevinGreeting] failed to write launch persistence', e);
  }
}
