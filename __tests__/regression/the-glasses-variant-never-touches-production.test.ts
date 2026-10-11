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
});
