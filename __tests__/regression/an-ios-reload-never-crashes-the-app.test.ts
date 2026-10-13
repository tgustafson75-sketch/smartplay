/**
 * 2026-10-13 — Sentry SMARTPLAY-CADDIE-MOBILE-J8: EXC_BAD_ACCESS in -[EXJavaScriptWeakObject
 * .cxx_destruct], inside SharedObjectRegistry.clear, 4s into a cold start on an iPhone 13 (1.0.2+31) —
 * the launch auto-apply reloading into a fresh OTA. expo-modules-core 3.0.30 (SDK 54) clears the
 * registry on a dispatch queue; expo/expo#43937 fixed it on main only. Two halves:
 *   native — branch native/expo-modules-core-reload-fix backports the lock for the next native build;
 *   JS     — iOS never reloads (the update applies on the next launch); JS cannot tell a patched binary.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');

describe('iOS never reloads its JS', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native') as { Platform: { OS: string }; NativeModules: Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gate = require('../../services/updateApplyGate') as typeof import('../../services/updateApplyGate');
  const os = RN.Platform.OS;
  afterEach(() => { RN.Platform.OS = os; delete RN.NativeModules.MediaPipePose; });
  const quiet = { ready: true, inRound: false, sessionActive: false, audioBusy: false, msSinceUserTurn: null, sinceLaunchMs: 3_000 };

  it('iOS: never auto-applies — whatever modules the binary has', () => {
    RN.Platform.OS = 'ios';
    expect(gate.reloadIsSafe()).toBe(false);
    expect(gate.mayAutoApplyUpdate(quiet)).toBe(false);
    RN.NativeModules.MediaPipePose = {};   // 1.0.3 has the module but not the patch
    expect(gate.mayAutoApplyUpdate(quiet)).toBe(false);
  });

  it('Android always may', () => {
    RN.Platform.OS = 'android';
    expect(gate.reloadIsSafe()).toBe(true);
  });

  it('the manual banner and the one reload owner both ask the gate', () => {
    const strip = (f: string) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(strip('components/UpdateAvailableBanner.tsx')).toMatch(/&& !autoStillPossible && reloadIsSafe\(\);/);
    expect(strip('services/autoUpdate.ts')).toMatch(/\.reloadIsSafe\(\)\) return;\s*try \{\s*await Updates\.reloadAsync\(\);/);
  });
});
