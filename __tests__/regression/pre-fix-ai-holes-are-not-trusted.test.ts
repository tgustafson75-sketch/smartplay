/**
 * 2026-09-23 — Course Cloud served AI-found holes placed with the 2x-wrong Mapbox scale as course
 * maps, and phones cached them. After the cloud clean, a cached map from before it that carries
 * estimated holes is rebuilt online — and those holes do not count as "mapped" when judging whether
 * the rebuild is a downgrade, or the clean rebuild would be refused for the misplaced copy.
 */
import { preScaleEstimateCount, trustedMappedHoleCount, SCALE_FIX_CLOUD_CLEAN_AT } from '../../services/courseGeometryService';
import * as fs from 'fs';
import * as path from 'path';

const g = { lat: 1, lng: 1 };
const geo = (fetched_at: number, estimated: number, real: number) => ({
  course_id: 'c', course_name: 'C', fetched_at,
  holes: [
    ...Array.from({ length: estimated }, (_, i) => ({ hole_number: i + 1, green: g, estimated: true })),
    ...Array.from({ length: real }, (_, i) => ({ hole_number: estimated + i + 1, green: g })),
  ],
}) as never;

describe('AI holes from before the scale fix are not trusted', () => {
  const CLEAN = 1_000;
  it('a pre-clean map with AI holes: only its real holes count', () => {
    expect(preScaleEstimateCount(geo(500, 6, 12), CLEAN)).toBe(6);
    expect(trustedMappedHoleCount(geo(500, 6, 12), CLEAN)).toBe(12);
  });
  it('a map fetched after the clean is trusted whole, AI holes included', () => {
    expect(trustedMappedHoleCount(geo(1_500, 6, 12), CLEAN)).toBe(18);
  });
  it('the cutoff is stamped before shipping, and the servability + downgrade checks use it', () => {
    expect(SCALE_FIX_CLOUD_CLEAN_AT).toBeGreaterThan(Date.UTC(2026, 8, 23));
    const src = fs.readFileSync(path.join(__dirname, '../../services/courseGeometryService.ts'), 'utf8');
    expect(src).toMatch(/if \(preScaleEstimateCount\(geo\) > 0\) return false;/);
    expect(src).toMatch(/const had = trustedMappedHoleCount\(existing\);/);
    expect(src).toMatch(/if \(trustedMappedHoleCount\(inMem\) > incoming\)/);
  });
});
