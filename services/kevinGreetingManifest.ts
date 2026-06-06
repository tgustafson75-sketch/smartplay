/**
 * Static require manifest for greeting audio assets — PERSONA-AWARE.
 *
 * 2026-06-05 — Tim's standing rule: "treat all profiles like Kevin."
 * Kevin's greeting plays bundled mp3 with zero network — never fails.
 * Serena/Harry/Tank were silent on splash because their TTS depended
 * on /api/voice succeeding mid-cold-launch on possibly-spotty
 * connections. STRUCTURAL FIX: pre-generate every persona's voice
 * for every greeting line using OpenAI gpt-4o-mini-tts, bundle the
 * mp3s as assets, ship in the app. Now every persona has the same
 * offline guarantee Kevin always had.
 *
 * Files:
 *   assets/audio/greetings/<filename>.mp3            (Kevin — legacy path)
 *   assets/audio/greetings/serena/<filename>.mp3
 *   assets/audio/greetings/harry/<filename>.mp3
 *   assets/audio/greetings/tank/<filename>.mp3
 *
 * Storage: ~2MB added to APK for ~36 new files (12 captions × 3 personas).
 *
 * Metro static-analyzes require() calls so the asset bundling depends on
 * the literal strings here. Every entry must point at a real file. The
 * greeting screen handles runtime load failures gracefully and falls
 * through to a silent text-only greeting on any miss.
 */

import type { GreetingFilename } from './kevinGreeting';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AssetModule = any;

// Kevin — legacy path. These files are Kevin's recorded voice from the
// original implementation. Other personas have their own subdirectories.
export const GREETING_ASSETS: Record<GreetingFilename, AssetModule> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'universal_01.mp3':  require('../assets/audio/greetings/universal_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'universal_02.mp3':  require('../assets/audio/greetings/universal_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'universal_03.mp3':  require('../assets/audio/greetings/universal_03.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'morning_01.mp3':    require('../assets/audio/greetings/morning_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'morning_02.mp3':    require('../assets/audio/greetings/morning_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'evening_01.mp3':    require('../assets/audio/greetings/evening_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'evening_02.mp3':    require('../assets/audio/greetings/evening_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'weekend_01.mp3':    require('../assets/audio/greetings/weekend_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'weekend_02.mp3':    require('../assets/audio/greetings/weekend_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'first_launch.mp3':  require('../assets/audio/greetings/first_launch.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'returning.mp3':     require('../assets/audio/greetings/returning.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'demo_mode.mp3':     require('../assets/audio/greetings/demo_mode.mp3'),
};

const SERENA_GREETING_ASSETS: Record<GreetingFilename, AssetModule> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'universal_01.mp3':  require('../assets/audio/greetings/serena/universal_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'universal_02.mp3':  require('../assets/audio/greetings/serena/universal_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'universal_03.mp3':  require('../assets/audio/greetings/serena/universal_03.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'morning_01.mp3':    require('../assets/audio/greetings/serena/morning_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'morning_02.mp3':    require('../assets/audio/greetings/serena/morning_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'evening_01.mp3':    require('../assets/audio/greetings/serena/evening_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'evening_02.mp3':    require('../assets/audio/greetings/serena/evening_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'weekend_01.mp3':    require('../assets/audio/greetings/serena/weekend_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'weekend_02.mp3':    require('../assets/audio/greetings/serena/weekend_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'first_launch.mp3':  require('../assets/audio/greetings/serena/first_launch.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'returning.mp3':     require('../assets/audio/greetings/serena/returning.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'demo_mode.mp3':     require('../assets/audio/greetings/serena/demo_mode.mp3'),
};

const HARRY_GREETING_ASSETS: Record<GreetingFilename, AssetModule> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'universal_01.mp3':  require('../assets/audio/greetings/harry/universal_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'universal_02.mp3':  require('../assets/audio/greetings/harry/universal_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'universal_03.mp3':  require('../assets/audio/greetings/harry/universal_03.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'morning_01.mp3':    require('../assets/audio/greetings/harry/morning_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'morning_02.mp3':    require('../assets/audio/greetings/harry/morning_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'evening_01.mp3':    require('../assets/audio/greetings/harry/evening_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'evening_02.mp3':    require('../assets/audio/greetings/harry/evening_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'weekend_01.mp3':    require('../assets/audio/greetings/harry/weekend_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'weekend_02.mp3':    require('../assets/audio/greetings/harry/weekend_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'first_launch.mp3':  require('../assets/audio/greetings/harry/first_launch.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'returning.mp3':     require('../assets/audio/greetings/harry/returning.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'demo_mode.mp3':     require('../assets/audio/greetings/harry/demo_mode.mp3'),
};

const TANK_GREETING_ASSETS: Record<GreetingFilename, AssetModule> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'universal_01.mp3':  require('../assets/audio/greetings/tank/universal_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'universal_02.mp3':  require('../assets/audio/greetings/tank/universal_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'universal_03.mp3':  require('../assets/audio/greetings/tank/universal_03.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'morning_01.mp3':    require('../assets/audio/greetings/tank/morning_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'morning_02.mp3':    require('../assets/audio/greetings/tank/morning_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'evening_01.mp3':    require('../assets/audio/greetings/tank/evening_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'evening_02.mp3':    require('../assets/audio/greetings/tank/evening_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'weekend_01.mp3':    require('../assets/audio/greetings/tank/weekend_01.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'weekend_02.mp3':    require('../assets/audio/greetings/tank/weekend_02.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'first_launch.mp3':  require('../assets/audio/greetings/tank/first_launch.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'returning.mp3':     require('../assets/audio/greetings/tank/returning.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'demo_mode.mp3':     require('../assets/audio/greetings/tank/demo_mode.mp3'),
};

/**
 * Get the bundled greeting asset for the active persona. Returns Kevin's
 * file if the persona isn't recognized — defensive default so a new
 * persona without bundled audio doesn't crash the greeting.
 */
export function getGreetingAssetForPersona(
  persona: string | null | undefined,
  filename: GreetingFilename,
): AssetModule {
  switch (persona) {
    case 'serena': return SERENA_GREETING_ASSETS[filename];
    case 'harry':  return HARRY_GREETING_ASSETS[filename];
    case 'tank':   return TANK_GREETING_ASSETS[filename];
    case 'kevin':
    default:       return GREETING_ASSETS[filename];
  }
}

// ─── POST-SPLASH OPENER ────────────────────────────────────────────────
//
// 2026-06-06 — Restored after a week-long search. Prior implementations
// failed in 6 attempts because they used network TTS that intermittently
// silent-failed during cold launch. With bundled mp3s (same pattern as
// the persona greetings above), the opener plays reliably every time.
//
// One short invitation line per persona, in their voice. Fires once per
// app process after the greeting completes, via awaitGreetingComplete()
// signal from app/greeting.tsx and playLocalFile() in caddie.tsx.

const OPENER_ASSETS: Record<string, AssetModule> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  kevin:  require('../assets/audio/openers/kevin.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  serena: require('../assets/audio/openers/serena.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  harry:  require('../assets/audio/openers/harry.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  tank:   require('../assets/audio/openers/tank.mp3'),
};

export function getOpenerAssetForPersona(persona: string | null | undefined): AssetModule {
  return OPENER_ASSETS[persona ?? 'kevin'] ?? OPENER_ASSETS.kevin;
}
