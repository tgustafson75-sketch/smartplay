/**
 * 2026-10-15 (review #3, #7) — two ways the resolver mislabelled the number the whole app reads.
 *
 * #3 A WEAK fix (15-90 m) dropped to the static card: the full tee→green scorecard number. "410
 *    STATIC" with the player 160 out — and caddieRequestBody clubbed for 410 while voice "how far"
 *    (raw haversine) said 162. The measured number must stand, labelled low-confidence and not live.
 *
 * #7 A GPS distance to an AI-DERIVED green (api/hole-scan) came back as reason 'ok' and was badged
 *    LIVE, "GPS clean", high confidence — the brain was told to state an estimate flatly.
 */
const mockFix: { current: Record<string, unknown> | null } = { current: null };
const mockGreen: { current: Record<string, unknown> | null } = { current: null };
jest.mock('../../services/smartFinderService', () => {
  const actual = jest.requireActual('../../services/smartFinderService');
  return {
    ...actual,
    getLastFix: () => mockFix.current,
    getGreenYardagesSync: () => mockGreen.current,
    holeData: () => ({ distance: 410, front: 410, back: 410 }),
  };
});

import { resolveYardage, resolvedToFmb, buildYardageInsight } from '../../services/yardageResolver';
import { useRoundStore } from '../../store/roundStore';

beforeEach(() => {
  useRoundStore.setState({ isRoundActive: true, currentHole: 1, userStatedYardage: null } as never);
  mockGreen.current = { middle: 160, front: 150, back: 170, reason: 'ok', green_source: 'courseHoles' };
});
const fix = (extra: Record<string, unknown>) => ({ location: { lat: 33.75, lng: -117.05 }, accuracy_m: 4, timestamp: Date.now(), ...extra });

describe('#3 a weak fix keeps the measured number', () => {
  it('THE BUG: 40 m accuracy no longer falls to the 410 card', () => {
    mockFix.current = fix({ accuracy_m: 40 });
    const r = resolveYardage(1);
    expect(r.value).toBe(160);
    expect(r.source).toBe('gps_live');
  });

  it('labelled honestly: low confidence, not live, not a fallback (badges LAST FIX), says weak', () => {
    mockFix.current = fix({ accuracy_m: 40 });
    const r = resolveYardage(1);
    expect(r.confidence).toBe('low');
    expect(r.live).toBe(false);
    expect(r.is_fallback).toBe(false);
    expect(r.reason).toMatch(/weak/i);
  });

  it('the brain\'s insight carries the measured number at low confidence', () => {
    mockFix.current = fix({ accuracy_m: 40 });
    const i = buildYardageInsight();
    expect(i.yardage).toBe(160);
    expect(i.confidence).toBe('low');
  });

  it('a clean fix is still live, and NO fix still falls to the card', () => {
    mockFix.current = fix({ accuracy_m: 4 });
    expect(resolveYardage(1).live).toBe(true);
    mockFix.current = null;
    const r = resolveYardage(1);
    expect(r.source).toBe('static_card');
    expect(r.value).toBe(410);
  });
});

describe('#7 a distance to an AI-derived green is an estimate', () => {
  it('THE BUG: not live, low confidence, EST (fallback), and says so', () => {
    mockFix.current = fix({ accuracy_m: 3 });
    mockGreen.current = { middle: 160, front: 150, back: 170, reason: 'ok', green_source: 'derived' };
    const r = resolveYardage(1);
    expect(r.value).toBe(160);
    expect(r.live).toBe(false);
    expect(r.confidence).toBe('low');
    expect(r.is_fallback).toBe(true);
    expect(r.reason).not.toMatch(/GPS clean/);
    expect(r.reason).toMatch(/estimated green/i);
    expect(resolvedToFmb(r)?.reason).toBe('estimated');
  });

  it('a surveyed green with a clean fix is unchanged', () => {
    mockFix.current = fix({ accuracy_m: 3 });
    const r = resolveYardage(1);
    expect(r.live).toBe(true);
    expect(r.confidence).toBe('high');
    expect(r.reason).toBe('GPS clean.');
  });
});

describe('#7 the engine reports which green tier answered', () => {
  it('getGreenYardagesSync carries green_source on an ok read', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../services/smartFinderService.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const sync = src.slice(src.indexOf('export function getGreenYardagesSync'), src.indexOf('export async function distanceToPoint'));
    expect(sync).toMatch(/reason: 'ok' as const,\s*green_source: source,/);
    const asyncFn = src.slice(src.indexOf('export async function getGreenYardages'), src.indexOf('export function getGreenYardagesSync'));
    expect(asyncFn).toMatch(/reason: 'ok' as const,\s*green_source: source,/);
  });
});
