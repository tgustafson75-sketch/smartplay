/**
 * 2026-10-14 — THE APP'S JS ENTRY (package.json "main"). Was "expo-router/entry" directly.
 *
 * Expo's TaskManager requires a background task to be defined in the GLOBAL scope at launch: when Android
 * relaunches a killed app in the background to deliver location updates, no screen renders, so a task
 * defined from inside the round (services/backgroundLocationTask, lazily) did not exist and those fixes
 * were dropped (GPS audit #10). It is defined here, before the router — inside try/catch, because a
 * throwing defineTask at module load is what white-screened the Phase 405 build (see app/_layout.tsx).
 * JS only: the native shell loads whatever bundle this entry produces, so it ships over the air.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
require('./services/polyfills');
try {
  require('./services/backgroundLocationTask').defineBackgroundLocationTaskAtEntry();
} catch (e) {
  console.log('[entry] background location task not defined at launch (non-fatal):', e);
}
require('expo-router/entry');
