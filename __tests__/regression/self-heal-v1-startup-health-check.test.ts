/**
 * 2026-11-10 — SELF-HEAL v1: the startup health check (services/startupHealth) reports a broken
 * config or an unreachable backend to Sentry instead of failing silently, and is wired to run after
 * the first screen mounts.
 *
 * Break test: delete services/startupHealth.ts, or remove its effect from app/_layout.tsx, and this
 * file fails. The behaviour tests drive the real function; the wiring test reads the layout source,
 * because rendering the 2,000-line root layout under node is not possible.
 */
import * as fs from 'fs';
import * as path from 'path';

const sentry: Record<string, jest.Mock> = {};
jest.mock('@sentry/react-native', () => new Proxy({}, {
  get: (_t, k: string) => (sentry[k] ??= jest.fn()),
}));

let expoConfig: Record<string, unknown> | undefined;
jest.mock('expo-constants', () => ({ __esModule: true, default: { get expoConfig() { return expoConfig; } } }));

let updatesEnabled = true;
jest.mock('expo-updates', () => ({ get isEnabled() { return updatesEnabled; } }));

let warmed = true;
jest.mock('../../services/apiBase', () => {
  const actual = jest.requireActual('../../services/apiBase');
  return {
    ...actual,
    warmBackendConnection: jest.fn(async () => undefined),
    isConnectionWarmed: jest.fn(() => warmed),
  };
});

import { runStartupHealthCheck } from '../../services/startupHealth';

const HEALTHY = { version: '1.0.4', android: { versionCode: 35 }, ios: { buildNumber: '35' } };

beforeEach(() => {
  for (const k of Object.keys(sentry)) sentry[k].mockClear();
  expoConfig = HEALTHY;
  updatesEnabled = true;
  warmed = true;
  (global as Record<string, unknown>).__DEV__ = false;
});

describe('startup health check', () => {
  it('reports nothing on a healthy launch', async () => {
    expect(await runStartupHealthCheck()).toEqual([]);
    expect(sentry.captureMessage ?? jest.fn()).not.toHaveBeenCalled();
  });

  it('reports an unreachable backend to Sentry, one fingerprint per failure set', async () => {
    warmed = false;
    expect(await runStartupHealthCheck()).toEqual(['backend']);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [msg, opts] = sentry.captureMessage.mock.calls[0];
    expect(msg).toBe('startup_health_check_failed');
    expect(opts.tags).toEqual({ health_failed: 'backend' });
    expect(opts.fingerprint).toEqual(['startup-health', 'backend']);
  });

  it('reports a release build that cannot receive an OTA update', async () => {
    updatesEnabled = false;
    expect(await runStartupHealthCheck()).toEqual(['updates']);
  });

  it('does not flag expo-updates in a dev client, where it is off by design', async () => {
    (global as Record<string, unknown>).__DEV__ = true;
    updatesEnabled = false;
    expect(await runStartupHealthCheck()).toEqual([]);
  });

  it('reports a missing build number (Sentry dist would read 0)', async () => {
    expoConfig = { version: '1.0.4' };
    expect(await runStartupHealthCheck()).toEqual(['build_identity']);
  });
});

describe('wiring', () => {
  it('app/_layout.tsx runs it from a mount effect inside the navigator, fire-and-forget', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../app/_layout.tsx'), 'utf8');
    const effect = src.match(/useEffect\(\(\) => \{\s*void import\('\.\.\/services\/startupHealth'\)\.then\(m => m\.runStartupHealthCheck\(\)\)[^\n]*\n\s*\}, \[\]\);/);
    expect(effect).not.toBeNull();
    // Inside a component (after mount), not at module load.
    expect(src.indexOf(effect![0])).toBeGreaterThan(src.indexOf('function AppNavigator()'));
  });
});
