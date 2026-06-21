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

/**
 * Caption text shown on screen alongside the audio (and as the silent fallback).
 * The two name-bearing greetings (first_launch, demo_mode) accept a
 * caddieName so the on-screen text matches the active persona. The static
 * greetings are persona-neutral and don't require substitution.
 */
export const getGreetingCaption = (file: GreetingFilename, caddieName: string): string => {
  // Tank gets a Marine-cadence opener on first launch + demo mode per
  // Tim 2026-05-15. Other personas (Kevin/Serena/Harry) use the
  // standard friendly opener.
  const isTank = caddieName === 'Tank';
  switch (file) {
    case 'universal_01.mp3':  return "Welcome back. Let's play some golf.";
    case 'universal_02.mp3':  return 'There you are. Ready when you are.';
    case 'universal_03.mp3':  return "Good to see you. Let's do this.";
    case 'morning_01.mp3':    return 'Early start today — I like it.';
    case 'morning_02.mp3':    return 'Morning. Course is calling.';
    case 'evening_01.mp3':    return "Squeezing in a late round? Let's go.";
    case 'evening_02.mp3':    return "Evening light's the best light. Let's play.";
    case 'weekend_01.mp3':    return 'Saturday golf is the right kind of golf.';
    case 'weekend_02.mp3':    return 'Weekend round. My favorite kind.';
    case 'first_launch.mp3':  return isTank
      ? "Let's go Devil Dog! Time to play some golf!"
      : `Welcome to SmartPlay Caddie. I'm ${caddieName} — your golf companion. Let's play some golf.`;
    case 'returning.mp3':     return "Been a minute. Glad you're back.";
    case 'demo_mode.mp3':     return isTank
      ? "Let's go Devil Dog! Time to play some golf!"
      : `Welcome to SmartPlay Caddie. I'm ${caddieName} — your AI golf companion.`;
  }
};

/**
 * The bundled mp3 voice files were recorded for Kevin (male). For Serena,
 * the on-screen caption stays correct via getGreetingCaption, but the
 * audio cannot play "as Kevin" — so the greeting screen skips playback
 * for Serena and shows the silent caption-only path instead. Once Serena
 * audio is recorded (or TTS is wired up), this list can shrink to just
 * the name-bearing files.
 */
export const isKevinSpecificAudio = (file: GreetingFilename): boolean =>
  file === 'first_launch.mp3' || file === 'demo_mode.mp3';

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
  if (isWeekend) {
    // weekend_01 audio says "Saturday" — restrict to Saturday only so Sunday
    // launches never play a clip that names the wrong day.
    if (context.dayOfWeek === 6) pool.push('weekend_01.mp3');
    pool.push('weekend_02.mp3');
  }

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
