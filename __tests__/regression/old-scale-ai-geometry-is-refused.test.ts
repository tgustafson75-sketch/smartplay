/**
 * 2026-09-23 — AI-found greens projected with the old 2x Mapbox scale were shared into Course Cloud,
 * where every player reads them. After the cloud is cleaned, a phone that has not taken the update
 * must not re-seed it: the share route stores AI geometry only from clients on the fixed scale.
 */
const mockRecord = jest.fn(async () => 1);
jest.mock('../../api/_inferLimit', () => ({ allowInference: () => true }));
jest.mock('../../api/_cors', () => ({ applyCors: () => false }));
jest.mock('../../api/_supabase', () => ({ getSmartPlaySupabase: () => ({}) }));
jest.mock('../../api/_courseCloud', () => ({ recordContribution: (...a: unknown[]) => (mockRecord as (...x: unknown[]) => unknown)(...a) }));

import handler from '../../api/course-geometry-share';

function call(body: Record<string, unknown>) {
  const out: { status?: number; json?: unknown } = {};
  const res = { status(c: number) { out.status = c; return this; }, json(j: unknown) { out.json = j; return this; }, setHeader() {} };
  const req = { method: 'POST', headers: { 'x-app-key': 'spc_share_k1_2f8d61b4c07a49e3a1d5e9f60b3c7a29' }, body };
  return (handler as (q: unknown, s: unknown) => Promise<unknown>)(req, res).then(() => out);
}
const holes = [{ hole: 1, green_lat: 33.68, green_lng: -117.18 }];

describe('Course Cloud only stores AI geometry placed with the measured scale', () => {
  beforeEach(() => mockRecord.mockClear());
  it('a client without the scale marker (not updated) is thanked and NOT stored', async () => {
    const r = await call({ course_id: 'x', contributor: 'c', holes });
    expect(r.status).toBe(200);
    expect(mockRecord).not.toHaveBeenCalled();
  });
  it('a client on the fixed scale is stored', async () => {
    await call({ course_id: 'x', contributor: 'c', holes, scale_v: 2 });
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });
  it('the app sends the marker', () => {
    const src = jest.requireActual('fs').readFileSync(jest.requireActual('path').join(__dirname, '../../services/courseCloud.ts'), 'utf8');
    expect(src).toMatch(/holes: fresh\.map\(toShareHole\), scale_v: 2 \}/);
  });
});
