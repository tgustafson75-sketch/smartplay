/**
 * 2026-09-21 — three ways the STORE BUILD could ship something the OTA path already refuses.
 *
 * Every one of these was a rule that existed and simply did not cover the build door.
 *
 * 1. OWNER MODE. Any non-empty EXPO_PUBLIC_OWNER_EMAIL makes the BUNDLE an owner bundle — Owner
 *    Tools on every player's Settings screen and grantLifetime for everyone, bypassing billing and
 *    persisting to disk before anyone notices. scripts/ota-owner-guard.mjs was written for exactly
 *    that on 2026-09-13 and wired into `ota:production` only. `eas build` exports the same bundle
 *    from the same working tree and ran no guard at all.
 *
 * 2. .easignore SUPERSEDES .gitignore. eas-cli: "if .easignore exists, .gitignore files are not
 *    used." This repo has one and it never mentioned .env, so .env.local — the file the guard above
 *    is watching — was uploaded to the builder on every build, where its EXPO_PUBLIC_* values are
 *    inlined into the production bundle. Two independent layers, both pointed at the same variable,
 *    and the build path went around both.
 *
 * 3. THE DSN MUST SURVIVE AN OTA. EXPO_PUBLIC_SENTRY_DSN lives in the EAS server environment, so it
 *    is present at build time and EMPTY in any bundle exported from a laptop. Gating on the bare
 *    env var means the instrument works in the store build and dies on the first hotfix — which is
 *    the moment it is most needed. Fixed once on 2026-07-06 in app/_layout.tsx, and missed in
 *    services/analytics.ts, where it stayed broken for fourteen weeks.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('the owner guard covers the BUILD door, not just the OTA door', () => {
  const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;

  /**
   * Enumerated rather than spot-checked: the 09-13 guard was correct and covered one script, and
   * this is the same defect one door along. Any script that produces a PRODUCTION bundle counts.
   */
  it.each([
    'ios:build:production',
    'ios:ship',
    'android:build:production',
    'ota:production',
  ])('%s runs the owner guard first', (name) => {
    expect(scripts[name]).toBeDefined();
    expect(scripts[name]).toContain('scripts/ota-owner-guard.mjs');
  });

  it('and no OTHER script quietly publishes production without it', () => {
    const publishes = Object.entries(scripts).filter(([, v]) =>
      (/eas build/.test(v) && /--profile (production|production-apk)/.test(v)) ||
      (/eas update/.test(v) && /--branch production/.test(v)),
    );
    expect(publishes.length).toBeGreaterThan(0);
    for (const [name, cmd] of publishes) {
      expect(`${name}: ${cmd}`).toContain('ota-owner-guard.mjs');
    }
  });
});

describe('.easignore does not upload the file the owner guard is watching', () => {
  const easignore = read('.easignore');

  it('excludes .env files, because .easignore replaces .gitignore entirely', () => {
    const lines = easignore.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    expect(lines).toContain('.env');
    expect(lines).toContain('.env.*');
  });

  it('keeps .env.example, which carries names and no values', () => {
    expect(easignore).toMatch(/^!\.env\.example$/m);
  });

  it('excludes signing material — production uses remote credentials and needs none of it', () => {
    const lines = easignore.split('\n').map(l => l.trim());
    expect(lines).toContain('credentials.json');
    expect(lines).toContain('*.jks');
  });
});

describe('the Sentry DSN survives an OTA, in every file that asks about it', () => {
  it('there is ONE owner and it falls back to the embedded public key', () => {
    const owner = read('services/sentryDsn.ts');
    expect(owner).toMatch(/process\.env\.EXPO_PUBLIC_SENTRY_DSN \|\|/);
    expect(owner).toMatch(/export const SENTRY_DSN/);
    expect(owner).toMatch(/export const HAS_SENTRY_DSN/);
  });

  /**
   * The real assertion. A file may READ the env var only by going through the owner — the 07-06 fix
   * failed precisely because a second file kept its own reading.
   */
  it('no app file gates on the bare env var', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) { if (!/node_modules|__tests__/.test(rel)) walk(rel); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (rel === path.join('services', 'sentryDsn.ts')) continue;   // the owner
        const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
        if (/process\.env\.EXPO_PUBLIC_SENTRY_DSN/.test(src)) offenders.push(rel);
      }
    };
    for (const d of ['services', 'app', 'components', 'store', 'utils', 'hooks', 'contexts']) {
      if (fs.existsSync(path.join(ROOT, d))) walk(d);
    }
    expect(offenders).toEqual([]);
  });
});
