/**
 * 2026-09-23 — Course Cloud holds AI-found holes placed with the old 2x Mapbox scale. From
 * AI_SCALE_FIX_AT they are never chosen as a hole's best report and never served; a fixed client's
 * re-share refreshes its report time and is trusted. The app's cached maps use the same instant.
 */
import { readSharedGeometry, recordContribution, isPreScaleAiRow, AI_SCALE_FIX_AT } from '../../api/_courseCloud';
import { SCALE_FIX_CLOUD_CLEAN_AT } from '../../services/courseGeometryService';

const BEFORE = '2026-09-20T00:00:00Z', AFTER = '2026-09-25T00:00:00Z';
const row = (hole: number, source: string, at: string, extra: Record<string, unknown> = {}) => ({
  course_id: 'c', hole, source, confidence: 0.6, updated_at: at, created_at: at,
  tee_lat: 33.68, tee_lng: -117.18, green_lat: 33.683, green_lng: -117.179, ...extra,
});

function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; row: Record<string, unknown> }[] = [];
  const q = (table: string) => {
    const filters: [string, unknown][] = [];
    const api = {
      select: () => api,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return api; },
      order: () => api,
      upsert: async (r: Record<string, unknown>) => { writes.push({ table, row: r }); return { error: null }; },
      then: (res: (v: { data: unknown; error: null }) => unknown) =>
        res({ data: (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v)), error: null }),
    };
    return api;
  };
  return { db: { from: q } as never, writes };
}

describe('Course Cloud never uses AI geometry from before the scale fix', () => {
  it('app and server use one instant', () => {
    expect(SCALE_FIX_CLOUD_CLEAN_AT).toBe(Date.parse(AI_SCALE_FIX_AT));
  });

  it('classifies only AI rows from before the fix', () => {
    expect(isPreScaleAiRow(row(1, 'ai_vision', BEFORE))).toBe(true);
    expect(isPreScaleAiRow(row(1, 'ai_vision', AFTER))).toBe(false);
    expect(isPreScaleAiRow(row(1, 'osm', BEFORE))).toBe(false);
  });

  it('a pre-fix AI hole is not served; OSM and post-fix AI holes are', async () => {
    const { db } = fakeDb({ course_geometry: [row(1, 'ai_vision', BEFORE), row(2, 'osm', BEFORE), row(3, 'ai_vision', AFTER)] });
    const holes = await readSharedGeometry(db, 'c');
    expect(holes?.map((h) => h.hole_number)).toEqual([2, 3]);
  });

  it('a hole\'s best report is chosen among trusted reports only', async () => {
    const { db, writes } = fakeDb({ course_geometry_reports: [
      row(4, 'ai_vision', BEFORE, { confidence: 0.7, green_lat: 1 }),                    // misplaced, higher confidence
    ] });
    await recordContribution(db, 'c', 'fresh-client', [{ hole: 4, green_lat: 33.683, green_lng: -117.179, confidence: 0.5 } as never]);
    const report = writes.find((w) => w.table === 'course_geometry_reports')!.row;
    expect(Date.parse(String(report.created_at))).toBeGreaterThan(Date.parse(BEFORE));   // re-share refreshes its time
    // The canonical recompute read only the stored (pre-fix) report here — it must not be chosen.
    expect(writes.find((w) => w.table === 'course_geometry')).toBeUndefined();
  });
});
