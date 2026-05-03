/**
 * Static require manifest for Kevin greeting audio assets.
 *
 * Metro static-analyzes require() calls so the asset bundling depends on
 * the literal strings here. Every entry must point at a real file in
 * `assets/audio/greetings/` — even a 0-byte placeholder will satisfy the
 * bundler. The greeting screen handles runtime load failures (invalid /
 * empty mp3) gracefully and falls through to a silent text-only greeting.
 */

import type { GreetingFilename } from './kevinGreeting';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AssetModule = any;

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
