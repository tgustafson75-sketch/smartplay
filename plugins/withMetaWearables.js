/**
 * 2026-10-10 — Sightline slice 1: the Meta Wearables DAT SDK for the GLASSES build variant only.
 *
 * app.config.js adds this plugin when APP_VARIANT=glasses; a store build never runs it. Android only
 * (iOS is a separate slice: DAT for iOS uses ExternalAccessory and must never reach an App Store binary).
 *
 *   1. Links glasses-modules/meta-wearables (the Expo module) by giving Gradle autolinking an extra
 *      search path. The module lives OUTSIDE modules/ precisely so default autolinking never finds it —
 *      this plugin is the only way it gets into a binary.
 *   2. Manifest: BLUETOOTH, BLUETOOTH_CONNECT, INTERNET; the DAT APPLICATION_ID / CLIENT_TOKEN meta-data
 *      ("0" = Developer Mode, no credentials); and confirms MainActivity already handles the app's
 *      existing scheme (no new scheme is added).
 *
 * No android/ directory is edited by hand — everything is CNG.
 */
const path = require('path');
const { withAndroidManifest, withSettingsGradle, AndroidConfig } = require('@expo/config-plugins');

const SEARCH_MARKER = '// sightline: glasses-modules search path';

function withGlassesModuleSearchPath(config) {
  return withSettingsGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!contents.includes(SEARCH_MARKER)) {
      const dir = path.join(cfg.modRequest.projectRoot, 'glasses-modules').replace(/\\/g, '/');
      const anchor = 'expoAutolinking.useExpoModules()';
      if (!contents.includes(anchor)) throw new Error('[withMetaWearables] settings.gradle has no expoAutolinking.useExpoModules() to anchor on');
      contents = contents.replace(anchor, `${SEARCH_MARKER}\nexpoAutolinking.searchPaths = ["${dir}"]\n${anchor}`);
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
}

function withGlassesManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] ?? [];
    for (const name of ['android.permission.BLUETOOTH', 'android.permission.BLUETOOTH_CONNECT', 'android.permission.INTERNET']) {
      if (!manifest['uses-permission'].some((p) => p.$['android:name'] === name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    // Developer Mode: both 0. A Dev Center release channel build would carry the real ID and an EAS-env
    // token here — never a token committed to the repo.
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'com.meta.wearable.mwdat.APPLICATION_ID', '0');
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'com.meta.wearable.mwdat.CLIENT_TOKEN', '0');

    // The app's EXISTING scheme must reach MainActivity (Meta AI hands registration back through it).
    const scheme = Array.isArray(cfg.scheme) ? cfg.scheme[0] : cfg.scheme;
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    const handles = (main['intent-filter'] ?? []).some((f) =>
      (f.data ?? []).some((d) => d.$['android:scheme'] === scheme));
    if (!handles) {
      main['intent-filter'] = [...(main['intent-filter'] ?? []), {
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }, { $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
        data: [{ $: { 'android:scheme': scheme } }],
      }];
    }
    return cfg;
  });
}

module.exports = function withMetaWearables(config) {
  return withGlassesManifest(withGlassesModuleSearchPath(config));
};
