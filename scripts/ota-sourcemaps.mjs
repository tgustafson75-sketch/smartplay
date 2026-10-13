#!/usr/bin/env node
/**
 * ota-sourcemaps — upload the source maps of the update just exported to dist/ to Sentry.
 *
 * 2026-10-13. Store builds upload their maps on EAS (SENTRY_AUTH_TOKEN is an EAS *secret*, which
 * builds can read), but `eas update` exports and publishes from THIS Mac, where that secret is never
 * delivered — `eas env:exec` withholds secrets by design. So every OTA bundle — the code every field
 * user actually runs — reached Sentry with no maps, and its stack traces were unreadable.
 *
 * The token for this lives OUTSIDE the repo: $SENTRY_AUTH_TOKEN, or the one-line file
 * ~/.config/smartplay/sentry-auth-token (org smartplay-ai, scope project:releases + org:read).
 * Missing token = exit 1 with the reason. An update shipped without maps must be loud, not silent.
 *
 * Runs as npm's `postota:production` hook: after a successful publish, never before, and without the
 * `-- --message` arguments npm hands only to the main script. Re-run alone: `npm run ota:sourcemaps`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TOKEN_FILE = join(homedir(), '.config', 'smartplay', 'sentry-auth-token');
const token = process.env.SENTRY_AUTH_TOKEN?.trim()
  || (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : '');

if (!existsSync('dist/metadata.json')) {
  console.error('[ota-sourcemaps] no dist/metadata.json — nothing exported to upload.');
  process.exit(1);
}
if (!token) {
  console.error(`[ota-sourcemaps] NOT UPLOADED: no Sentry token (set SENTRY_AUTH_TOKEN or write ${TOKEN_FILE}).`);
  console.error('[ota-sourcemaps] The update itself is published; its crashes will be unreadable until this runs.');
  process.exit(1);
}
const r = spawnSync('npx', ['sentry-expo-upload-sourcemaps', 'dist'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    SENTRY_AUTH_TOKEN: token,
    SENTRY_ORG: 'smartplay-ai',
    SENTRY_PROJECT: 'smartplay-caddie-mobile',
    SENTRY_URL: 'https://sentry.io/',
  },
});
process.exit(r.status ?? 1);
