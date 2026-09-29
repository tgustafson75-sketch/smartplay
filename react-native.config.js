/**
 * 2026-09-29 — Health Connect is OUT of 1.0, so its native half is out of the Android binary too.
 *
 * The permissions and the config plugin were removed from app.json on 2026-09-03 and
 * services/featureAccess.ts pins HEALTH_CONNECT_ENABLED = false, but the npm module still
 * autolinked: the 1.0.2 release APK carried 1,837 androidx.health.* classes and an ALPHA client
 * (androidx.health.connect:connect-client 1.1.0-alpha11) — dead weight, and exactly what the Play
 * SDK Index flags.
 *
 * The JS stays. services/healthData.ts only ever reaches the module through `await import(...)`
 * inside try/catch; with the native half absent the module's TurboModuleRegistry.getEnforcing
 * throws, the import rejects, and every export resolves to its empty value
 * (__tests__/regression/health-connect-absent-native-module.test.ts proves it).
 *
 * TO TURN HEALTH CONNECT BACK ON: delete this entry in the SAME change that restores the four
 * health permissions, the plugin and HEALTH_CONNECT_ENABLED = true (run-sim's RELEASE 1.0 guard
 * requires those three to move together) — and it is a store build, not an OTA.
 */
module.exports = {
  dependencies: {
    'react-native-health-connect': {
      platforms: {
        android: null,
      },
    },
  },
};
