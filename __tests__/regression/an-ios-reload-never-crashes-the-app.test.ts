/**
 * 2026-10-13 — Sentry SMARTPLAY-CADDIE-MOBILE-J8: EXC_BAD_ACCESS in -[EXJavaScriptWeakObject
 * .cxx_destruct], inside SharedObjectRegistry.clear, on reload. expo-modules-core 3.0.30 (SDK 54) cleared
 * the registry on a dispatch queue. 2026-11-01 — the lock backport ships in the 1.0.4 binary, and
 * runtimeVersion "1.0.4" is what keeps this JS off every binary without it. This file pins that premise:
 * if one half moves without the other, it fails.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');

describe('the runtime pin that makes iOS reload safe', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as { expo: { runtimeVersion: string } };
  const patch = fs.readFileSync(path.join(root, 'patches', 'expo-modules-core+3.0.30.patch'), 'utf8');

  it('runtimeVersion is 1.0.4, the version whose binary carries the registry lock', () => {
    expect(appJson.expo.runtimeVersion).toBe('1.0.4');
    expect(patch).toContain('SharedObjectRegistry.swift');
  });
});

describe('iOS reloads its JS like Android', () => {
  const RN = require('react-native') as { Platform: { OS: string }; NativeModules: Record<string, unknown> };
  const gate = require('../../services/updateApplyGate') as typeof import('../../services/updateApplyGate');
  const os = RN.Platform.OS;
  afterEach(() => { RN.Platform.OS = os; delete RN.NativeModules.MediaPipePose; });
  const quiet = { ready: true, inRound: false, sessionActive: false, audioBusy: false, msSinceUserTurn: null, sinceLaunchMs: 3_000 };

  it('iOS may auto-apply once the gate is quiet', () => {
    RN.Platform.OS = 'ios';
    expect(gate.reloadIsSafe()).toBe(true);
    expect(gate.mayAutoApplyUpdate(quiet)).toBe(true);
  });

  it('Android may too', () => {
    RN.Platform.OS = 'android';
    expect(gate.reloadIsSafe()).toBe(true);
    expect(gate.mayAutoApplyUpdate(quiet)).toBe(true);
  });

  it('the manual banner and the one reload owner both ask the gate', () => {
    const strip = (f: string) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(strip('components/UpdateAvailableBanner.tsx')).toMatch(/&& !autoStillPossible && reloadIsSafe\(\);/);
    expect(strip('services/autoUpdate.ts')).toMatch(/\.reloadIsSafe\(\)\) return;\s*try \{\s*await Updates\.reloadAsync\(\);/);
  });
});
