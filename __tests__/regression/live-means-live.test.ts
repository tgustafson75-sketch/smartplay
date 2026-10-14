/**
 * 2026-10-13 (SmartVision/GPS audit #3, #4) — two numbers were badged LIVE in green that were not:
 *   - a fix gpsManager had DEGRADED (no fresh fix for 60 s, not the benign stationary case) — the frozen
 *     position read "GPS clean · LIVE" for up to five minutes under trees;
 *   - the tee ESTIMATE (card length minus the straight line from the tee) — on a 250+150 dogleg it read
 *     ~139 when the truth was ~75.
 * The resolver now owns "is it live" (`live`), and the pill says EST. / LAST FIX for those two.
 */
const mockFix: { current: Record<string, unknown> | null } = { current: null };
const mockGreen: { current: { middle: number; front: number; back: number; reason: string } | null } = { current: null };
jest.mock('../../services/smartFinderService', () => {
  const actual = jest.requireActual('../../services/smartFinderService');
  return {
    ...actual,
    getLastFix: () => mockFix.current,
    getGreenYardagesSync: () => mockGreen.current,
    holeData: () => ({ distance: 400, front: 400, back: 400 }),
  };
});

import { resolveYardage } from '../../services/yardageResolver';
import { resolveYardageSource, yardageSourceLabel, isLiveYardage } from '../../services/yardageSource';
import { useRoundStore } from '../../store/roundStore';

beforeEach(() => {
  useRoundStore.setState({ isRoundActive: true, currentHole: 1, userStatedYardage: null } as never);
  mockGreen.current = { middle: 152, front: 140, back: 163, reason: 'ok' };
});
const fix = (extra: Record<string, unknown>) => ({ location: { lat: 33.75, lng: -117.05 }, accuracy_m: 4, timestamp: Date.now(), ...extra });

describe('the resolver owns "live"', () => {
  it('a fresh fix to a real green is live', () => {
    mockFix.current = fix({});
    const r = resolveYardage(1);
    expect(r.source).toBe('gps_live');
    expect(r.live).toBe(true);
  });

  it('a DEGRADED fix keeps its number but is not live, and says how old it is', () => {
    // degraded is about AGE (gpsManager's 60 s stage-1); accuracy stays moderate so it is not 'weak'
    mockFix.current = fix({ timestamp: Date.now() - 75_000, accuracy_m: 9, degraded: true });
    const r = resolveYardage(1);
    expect(r.value).toBe(152);
    expect(r.live).toBe(false);
    expect(r.confidence).toBe('low');
    expect(r.reason).toMatch(/Last GPS fix 75s ago/);
  });

  it('the tee ESTIMATE is never live', () => {
    mockFix.current = fix({});
    mockGreen.current = { middle: 139, front: 139, back: 139, reason: 'estimated' };
    const r = resolveYardage(1);
    expect(r.is_fallback).toBe(true);
    expect(r.live).toBe(false);
  });
});

describe('one label owner for every pill', () => {
  it('EST. and LAST FIX, never green', () => {
    expect(resolveYardageSource({ displayYardage: 139, liveYardage: null, isBuilding: false, gpsNotLive: 'estimate' })).toBe('estimate');
    expect(yardageSourceLabel('estimate')).toBe('EST.');
    expect(yardageSourceLabel('last')).toBe('LAST FIX');
    expect(isLiveYardage('estimate')).toBe(false);
    expect(isLiveYardage('last')).toBe(false);
    expect(resolveYardageSource({ displayYardage: 152, liveYardage: 152, isBuilding: false, gpsNotLive: null })).toBe('live');
  });

  it('the strip and the caddie screen read it — no private copy of the labels', () => {
    const strip = require('fs').readFileSync(require('path').join(__dirname, '../../components/CaddieDataStrip.tsx'), 'utf8');
    expect(strip).toContain('{yardageSourceLabel(yardageSource)}');
    expect(strip).not.toMatch(/'LIVE' : yardageSource === 'building'/);
    const caddie = require('fs').readFileSync(require('path').join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8');
    expect(caddie).toContain("return resolvedYardage?.live === true ? (resolvedYardage.value ?? null) : null;");
  });
});

describe('gpsManager\'s own benign-stationary rule decides "degraded"', () => {
  it('a stale fix that was accurate (≤10 m) is a golfer standing still, not a lost signal', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../services/smartFinderService.ts'), 'utf8');
    expect(src).toContain("degraded: fix.confidence === 'low' && !(fix.accuracy_m != null && fix.accuracy_m <= 10),");
  });
});
