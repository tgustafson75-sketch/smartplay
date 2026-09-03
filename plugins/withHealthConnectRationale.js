/**
 * 2026-09-03 (pre-build audit) — HEALTH CONNECT'S PRIVACY-POLICY ROUTE, IN THE API-34 FORM.
 *
 * react-native-health-connect's own config plugin declares the rationale the pre-Android-14 way:
 *
 *     androidManifest.application[0].activity[0]['intent-filter'].push({
 *       action: [{ $: { 'android:name': 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE' } }],
 *     });
 *
 * That intent filter is what Health Connect looks for on apps targeting API 33 or lower. This app
 * targets 36. From API 34 onward the platform looks for an exported activity-alias answering
 * ACTION_VIEW_PERMISSION_USAGE in the HEALTH_PERMISSIONS category instead.
 *
 * WHAT BREAKS WITHOUT IT: the four health.READ_* permissions still grant and still read — this is
 * not the grant flow. What is missing is the route from Health Connect's own permission screen to
 * our privacy policy, which is exactly the thing Google reviews the Health Connect data-access
 * declaration against. The app reads Steps, Distance, HeartRate and ActiveCaloriesBurned with the
 * Health Data toggle defaulting ON, so that declaration is being submitted either way.
 *
 * The library's filter is left in place deliberately rather than replaced: it is harmless on 34+,
 * and minSdkVersion is 29, so a device on API 29-33 still finds the form it expects. Both
 * declarations coexist, which is what Google's own migration guidance describes.
 *
 * NATIVE-ONLY. This is AndroidManifest structure written at prebuild; no OTA can add it.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const ALIAS_NAME = 'ViewPermissionUsageActivity';

function withHealthConnectRationale(config) {
  return withAndroidManifest(config, (cfg) => {
    try {
      const app = cfg.modResults?.manifest?.application?.[0];
      if (!app) return cfg;

      app['activity-alias'] = app['activity-alias'] || [];
      // Idempotent: prebuild can run more than once, and a duplicate alias fails the manifest merge.
      const already = app['activity-alias'].some(
        (a) => a?.$?.['android:name'] === ALIAS_NAME,
      );
      if (already) return cfg;

      app['activity-alias'].push({
        $: {
          'android:name': ALIAS_NAME,
          'android:exported': 'true',
          'android:targetActivity': '.MainActivity',
          // Only the system may launch it — without this any app could open the screen.
          'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } }],
            category: [{ $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } }],
          },
        ],
      });
      console.log('[withHealthConnectRationale] added API-34 ViewPermissionUsageActivity alias');
    } catch (e) {
      // Never fail the build for this. A missing alias is a review question; a thrown plugin is no
      // build at all, and this is the one build. [[caddie-failsafe-no-walls]]
      console.warn('[withHealthConnectRationale] skipped:', e && e.message);
    }
    return cfg;
  });
}

module.exports = withHealthConnectRationale;
