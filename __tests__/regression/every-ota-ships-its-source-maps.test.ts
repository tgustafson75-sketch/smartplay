/**
 * 2026-10-13 — every OTA reached Sentry with NO source maps. Store builds upload theirs on EAS, where
 * the SENTRY_AUTH_TOKEN secret is readable; `eas update` exports on the Mac, where EAS never hands a
 * secret out (`eas env:exec` withholds it). The bundles field users actually run had unreadable stacks.
 *
 * The fix rides npm's post-hook so the publish command stays the guarded `&&` chain the other publish
 * tests read, and the upload refuses loudly — never silently — when it has no token.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const root = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

describe('every production OTA uploads its source maps', () => {
  it('npm runs the upload after a successful ota:production', () => {
    expect(pkg.scripts['postota:production']).toBe('node scripts/ota-sourcemaps.mjs');
    expect(pkg.scripts['ota:production']).toMatch(/eas update --branch production$/);
  });

  it('with no token it exits non-zero and says why — a mapless OTA is never silent', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-maps-'));
    fs.mkdirSync(path.join(cwd, 'dist'));
    fs.writeFileSync(path.join(cwd, 'dist', 'metadata.json'), '{}');
    const r = spawnSync('node', [path.join(root, 'scripts', 'ota-sourcemaps.mjs')], {
      cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: cwd } as unknown as NodeJS.ProcessEnv, // no token, empty home
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('NOT UPLOADED');
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('uploads to the org and project the app reports to', () => {
    const s = fs.readFileSync(path.join(root, 'scripts', 'ota-sourcemaps.mjs'), 'utf8');
    expect(s).toContain("SENTRY_ORG: 'smartplay-ai'");
    expect(s).toContain("SENTRY_PROJECT: 'smartplay-caddie-mobile'");
    expect(s).toContain("'sentry-expo-upload-sourcemaps', 'dist'");
  });
});
