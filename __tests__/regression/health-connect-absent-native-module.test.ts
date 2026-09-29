/**
 * 2026-09-29 — HEALTH CONNECT'S NATIVE HALF IS NOT IN THE ANDROID BINARY, AND THE JS MUST NOT CARE.
 *
 * react-native.config.js sets platforms.android = null for react-native-health-connect, so the
 * release build no longer compiles the module (1,837 androidx.health.* classes and an alpha
 * connect-client came out). The npm package stays, because services/healthData.ts still imports it
 * — and that code is LIVE in 1.0: services/walkingDetector.ts calls isHealthAvailable() and
 * readHealthSnapshot() on every round tick, and roundStore's end-of-round enrichment calls
 * readHealthSnapshot().
 *
 * With newArchEnabled the package's module body runs TurboModuleRegistry.getEnforcing('HealthConnect'),
 * which THROWS when the native module is absent. So the thing to prove is that an import which
 * throws at evaluation is contained, on Android, by every export a live caller reaches.
 *
 * Break-test (2026-09-29): removing the outer try/catch from initHealth() fails every case here.
 */
import * as RN from 'react-native';
import fs from 'fs';
import path from 'path';

jest.mock('react-native-health-connect', () => {
  throw new Error(
    "Invariant Violation: TurboModuleRegistry.getEnforcing(...): 'HealthConnect' could not be found.",
  );
});

const root = path.resolve(__dirname, '../..');

describe('Health Connect with no native module (the 1.0 Android binary)', () => {
  beforeEach(() => { jest.resetModules(); });

  /**
   * resetModules hands healthData a FRESH react-native mock, so Platform must be set on the instance
   * it will actually import — setting it on the top-level import left every case running as iOS,
   * where healthData returns early and never touches the module (caught by the debugStatus check).
   */
  const load = () => {
    (require('react-native') as typeof RN).Platform.OS = 'android';
    return require('../../services/healthData') as typeof import('../../services/healthData');
  };

  it('availability resolves false instead of throwing', async () => {
    const h = load();
    await expect(h.initHealth()).resolves.toBe(false);
    await expect(h.isHealthAvailable()).resolves.toBe(false);
    expect(h.debugStatus()).toMatchObject({ initFailed: true, cachedAvailable: false, platform: 'android' });
  });

  it('the snapshot the walking detector and end-of-round enrichment read is the empty one', async () => {
    const h = load();
    await expect(h.readHealthSnapshot(0, 1)).resolves.toEqual({
      steps: 0, distanceMeters: 0, heartRateAvg: null, heartRateMax: null, activeCalories: 0, hasData: false,
    });
  });

  it('permission calls report nothing granted', async () => {
    const h = load();
    await expect(h.requestHealthPermissions(['steps'])).resolves.toEqual({ granted: [], denied: ['steps'] });
    await expect(h.getGrantedHealthPermissions()).resolves.toEqual([]);
  });
});

describe('the exclusion and the feature flag move together', () => {
  it('react-native.config.js excludes Health Connect from Android iff HEALTH_CONNECT_ENABLED is false', () => {
    const cfg = require(path.join(root, 'react-native.config.js')) as {
      dependencies?: Record<string, { platforms?: { android?: unknown } }>;
    };
    const excluded = cfg.dependencies?.['react-native-health-connect']?.platforms?.android === null;
    const access = fs.readFileSync(path.join(root, 'services/featureAccess.ts'), 'utf8');
    const flagOff = /export const HEALTH_CONNECT_ENABLED = false;/.test(access);
    const flagOn = /export const HEALTH_CONNECT_ENABLED = true;/.test(access);
    expect(flagOff || flagOn).toBe(true);
    // Off → the native half must be out. On → it must be back in, or every read silently returns empty.
    expect(excluded).toBe(flagOff);
  });
});
