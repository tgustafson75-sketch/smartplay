/**
 * 2026-09-29 — THE SDKs PLAY'S SDK INDEX FLAGGED ON 1.0.2 MUST NOT DRIFT BACK.
 *
 * Play Console flagged outdated SDKs on the 1.0.2 store build. Moved for the next store build:
 *   @sentry/react-native   7.2.0  -> 7.13.x  (sentry-android 8.21.1 -> 8.32.0)
 *   react-native-purchases 10.8.1 -> 10.10.x (purchases-hybrid-common 18.33.1 -> 19.3.1; Play Billing 8)
 *
 * Expo 54's bundledNativeModules pins @sentry/react-native to ~7.2.0, so `npx expo install --fix`
 * would quietly put the old one back. package.json's expo.install.exclude is what stops that.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const installed = (name: string): string =>
  JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;

const atLeast = (v: string, floor: string) => {
  const a = v.split('.').map(Number);
  const b = floor.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

describe.each([
  ['@sentry/react-native', '7.13.0', 7],
  ['react-native-purchases', '10.10.2', 10],
])('%s', (name, floor, major) => {
  it(`declared range floor is >= ${floor}`, () => {
    const spec = String(pkg.dependencies[name]).replace(/^[~^]/, '');
    expect(atLeast(spec, floor)).toBe(true);
  });

  it(`installed version is >= ${floor} and still major ${major}`, () => {
    const v = installed(name);
    expect(atLeast(v, floor)).toBe(true);
    expect(Number(v.split('.')[0])).toBe(major);
  });
});

it('expo install --fix cannot pull Sentry back to the Expo 54 pin', () => {
  expect(pkg.expo?.install?.exclude ?? []).toContain('@sentry/react-native');
});
