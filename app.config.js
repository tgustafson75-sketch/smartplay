/**
 * 2026-10-10 — Sightline slice 1 (Meta glasses, Android-first, dev-only).
 *
 * app.json stays the source of truth. This file exists ONLY to add the `glasses` build variant:
 *
 *   APP_VARIANT=glasses   → own runtimeVersion ("glasses-dev-1", so production OTAs can never target
 *                           a binary with the glasses SDK in it, and glasses OTAs never reach a store
 *                           binary), `extra.appVariant = 'glasses'` (the JS gate), and the glasses
 *                           config plugin (plugins/withMetaWearables.js — the DAT SDK, Android only).
 *   anything else         → the config is returned UNCHANGED (byte-identical `expo config` output —
 *                           pinned by __tests__/regression/the-glasses-variant-never-touches-production).
 */
const GLASSES_RUNTIME = 'glasses-dev-1';

module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'glasses') return config;
  return {
    ...config,
    runtimeVersion: GLASSES_RUNTIME,
    extra: { ...(config.extra ?? {}), appVariant: 'glasses' },
    plugins: [...(config.plugins ?? []), './plugins/withMetaWearables.js'],
  };
};
