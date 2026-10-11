/**
 * 2026-10-10 — Sightline slice 1. Meta's DAT SDK must never reach a store binary (iOS: App Store
 * rejection; Android: developer-preview SDK), and production OTAs must never target a binary with it.
 * app.config.js adds the glasses variant ONLY for APP_VARIANT=glasses; everything else is untouched.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '../..');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const appConfig = require('../../app.config.js') as (a: { config: Record<string, unknown> }) => Record<string, unknown>;

const run = (variant: string | undefined) => {
  const prev = process.env.APP_VARIANT;
  if (variant == null) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = variant;
  try { return appConfig({ config: JSON.parse(JSON.stringify(appJson)) }); }
  finally { if (prev == null) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = prev; }
};

describe('the glasses build variant', () => {
  it.each([undefined, 'production', 'preview', 'development', ''])('APP_VARIANT=%s returns app.json unchanged', (v) => {
    expect(run(v)).toEqual(appJson);
  });

  it('APP_VARIANT=glasses: own runtime, the JS gate, and the DAT plugin — nothing else changes', () => {
    const g = run('glasses');
    expect(g.runtimeVersion).toBe('glasses-dev-1');
    expect(g.runtimeVersion).not.toBe(appJson.runtimeVersion);
    expect((g.extra as { appVariant?: string }).appVariant).toBe('glasses');
    expect((g.plugins as unknown[]).slice(-1)).toEqual(['./plugins/withMetaWearables.js']);
    const { runtimeVersion: _r, extra: _e, plugins: _p, ...rest } = g;
    const { runtimeVersion: _r2, extra: _e2, plugins: _p2, ...base } = appJson;
    expect(rest).toEqual(base);
  });

  it('the glasses EAS profile is a dev client on its own channel, never production', () => {
    const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
    const g = eas.build.glasses;
    expect(g).toMatchObject({ developmentClient: true, distribution: 'internal', channel: 'glasses', android: { buildType: 'apk' } });
    expect(g.env.APP_VARIANT).toBe('glasses');
    expect(g.extends).toBeUndefined();
    for (const p of ['production', 'production-apk', 'preview', 'development']) expect(eas.build[p].env?.APP_VARIANT).toBeUndefined();
  });

  it('the glasses surface needs the variant AND the remote switch (default OFF)', () => {
    const { DEFAULT_FLAGS } = require('../../store/flagStore') as typeof import('../../store/flagStore');
    expect(DEFAULT_FLAGS.glasses_enabled).toBe(false);
    const gate = fs.readFileSync(path.join(root, 'services/glassesGate.ts'), 'utf8');
    expect(gate).toMatch(/return isGlassesVariant\(\) && isFlagEnabled\('glasses_enabled'\);/);
  });

  it('the DAT module can only be linked by the glasses plugin — never by default autolinking', () => {
    // Not under modules/ (the default local-module dir), not a package.json dependency, not in node_modules.
    expect(fs.existsSync(path.join(root, 'glasses-modules/meta-wearables/expo-module.config.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'modules/meta-wearables'))).toBe(false);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }['meta-wearables']).toBeUndefined();
    expect(pkg.expo?.autolinking?.searchPaths ?? []).not.toContain('./glasses-modules');
    // ...and the glasses plugin is what adds the search path, and the Developer Mode meta-data
    const plugin = fs.readFileSync(path.join(root, 'plugins/withMetaWearables.js'), 'utf8');
    expect(plugin).toMatch(/expoAutolinking\.searchPaths = \["\$\{dir\}"\]/);
    expect(plugin).toMatch(/'com\.meta\.wearable\.mwdat\.APPLICATION_ID', '0'/);
    expect(plugin).toMatch(/'com\.meta\.wearable\.mwdat\.CLIENT_TOKEN', '0'/);
    // pinned SDK, Maven Central, all three on one version; mockdevice is test-only
    const gradle = fs.readFileSync(path.join(root, 'glasses-modules/meta-wearables/android/build.gradle'), 'utf8');
    expect(gradle).toMatch(/def MWDAT_VERSION = '1\.0\.1'/);
    expect(gradle).toMatch(/androidTestImplementation "com\.meta\.wearable:mwdat-mockdevice:\$\{MWDAT_VERSION\}"/);
    expect(gradle).not.toMatch(/^\s*implementation "com\.meta\.wearable:mwdat-mockdevice/m);
    expect(gradle).not.toMatch(/maven\.pkg\.github\.com/);
  });

  it('handleIntent runs in BOTH onCreate and onNewIntent; initialize once per process', () => {
    const k = fs.readFileSync(path.join(root, 'glasses-modules/meta-wearables/android/src/main/java/expo/modules/metawearables/MetaWearablesPackage.kt'), 'utf8');
    expect(k).toMatch(/override fun onCreate\(activity: Activity[\s\S]{0,200}Sightline\.handleIntent\(activity, activity\.intent\)/);
    expect(k).toMatch(/override fun onNewIntent\(intent: Intent\): Boolean \{[\s\S]{0,120}Sightline\.handleIntent\(it, intent\)/);
    const s = fs.readFileSync(path.join(root, 'glasses-modules/meta-wearables/android/src/main/java/expo/modules/metawearables/Sightline.kt'), 'utf8');
    expect(s).toMatch(/if \(!initialized\.compareAndSet\(false, true\)\) return/);
  });
});
