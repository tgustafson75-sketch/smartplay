/**
 * 2026-09-23 — THE SCALE WAS TWICE THE TRUTH. Every projection assumed 156543 m/px at z0 (256-px
 * raster tiles). Mapbox Static Images zoom is on 512-px tiles: measured by drawing a line on a real
 * tile — 150 m east of 33.683N,-117.179W at z16, 600x600 — it spanned 148 px; the old constant said 75.
 * So SmartVision framed each hole one zoom level too tight (the tee cut off), drew every marker and
 * tapped yardage at half its true distance, and AI-found greens were placed at twice theirs.
 */
import { mapboxMetersPerPixel, computeFitView, MAPBOX_Z0_METERS_PER_PX } from '../../services/mapboxImagery';
import { projectToTilePixels, unprojectTilePixel } from '../../services/smartVisionOverlay';
import * as fs from 'fs';
import * as path from 'path';

const C = { lat: 33.683, lng: -117.179 };
const east = (m: number) => ({ lat: C.lat, lng: C.lng + m / (111320 * Math.cos((C.lat * Math.PI) / 180)) });

describe('SmartVision projects at the scale Mapbox actually draws', () => {
  it('matches the measured tile: 150 m ≈ 148-151 px at z16', () => {
    expect(150 / mapboxMetersPerPixel(C.lat, 16)).toBeGreaterThan(145);
    expect(150 / mapboxMetersPerPixel(C.lat, 16)).toBeLessThan(153);
    const p = projectToTilePixels(east(150), C, 16, 0, 600, 600);
    expect(p.x - 300).toBeGreaterThan(145);
    expect(p.x - 300).toBeLessThan(153);
  });

  it('project and unproject agree', () => {
    const p = projectToTilePixels(east(150), C, 16, 0, 600, 600);
    const back = unprojectTilePixel(p.x, p.y, C, 16, 0, 600, 600);
    expect(Math.abs(back.lng - east(150).lng)).toBeLessThan(1e-6);
  });

  it('a fitted hole really fits: the whole tee→green length plus margin is inside the tile', () => {
    const tee = C, green = { lat: C.lat + 400 / 110540, lng: C.lng };   // a 400 m hole, due north
    const fit = computeFitView({ tee, green, width: 400, height: 700 })!;
    const covered = 700 * mapboxMetersPerPixel(fit.center.lat, fit.zoom);
    expect(covered).toBeGreaterThanOrEqual(400);
    expect(covered).toBeLessThan(400 * 2);   // and not zoomed out past the margin
  });

  it('no other scale constant exists anywhere in the app', () => {
    const files = ['app/smartvision.tsx', 'services/smartVisionOverlay.ts', 'services/holeGeometryDerivation.ts', 'services/mapboxImagery.ts'];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect({ f, hit: /156[_]?543/.test(src) }).toEqual({ f, hit: false });
    }
    expect(MAPBOX_Z0_METERS_PER_PX).toBeCloseTo(78271.5, 0);
  });
});
