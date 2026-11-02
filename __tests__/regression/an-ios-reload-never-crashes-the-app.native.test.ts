/**
 * 2026-10-13 — Sentry SMARTPLAY-CADDIE-MOBILE-J8: EXC_BAD_ACCESS in -[EXJavaScriptWeakObject
 * .cxx_destruct], inside SharedObjectRegistry.clear, 4s into a cold start on an iPhone 13 (1.0.2+31) —
 * the launch auto-apply reloading into a fresh OTA. expo-modules-core 3.0.30 (SDK 54) clears the
 * registry on a dispatch queue; expo/expo#43937 fixed it on main only. Two halves:
 *   native — patches/expo-modules-core+3.0.30.patch backports the lock (iOS 1.0.4+);
 *   JS     — iOS reloads, and runtimeVersion "1.0.4" keeps the JS off binaries without the lock.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');

describe('the registry patch', () => {
  const patch = fs.readFileSync(path.join(root, 'patches', 'expo-modules-core+3.0.30.patch'), 'utf8');
  const installed = fs.readFileSync(
    path.join(root, 'node_modules', 'expo-modules-core', 'ios', 'Core', 'SharedObjects', 'SharedObjectRegistry.swift'), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('is pinned to the installed version — a bump would silently drop it', () => {
    const v = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'expo-modules-core', 'package.json'), 'utf8')).version;
    expect(v).toBe('3.0.30');
    expect(patch).toContain('-  private static let lockQueue = DispatchQueue');
  });

  it('is applied: no dispatch queue left, every access goes through the lock on the caller\'s thread', () => {
    expect(installed).not.toMatch(/lockQueue/);
    expect(installed).toMatch(/private let lock = NSLock\(\)/);
    expect(installed).toMatch(/internal func clear\(\) \{\s*locked \{\s*self\.pairs\.removeAll\(\)/);
    // NSLocking.withLock needs iOS 16; the deployment target is 15.1
    expect(installed).not.toMatch(/\.withLock\s*\{/);
  });
});
