/**
 * 2026-10-13 (SmartVision/GPS audit #7) — the foreground one-shot seeded lastFix with no accuracy gate:
 * a coarse fix became the stored position and the jump check then rejected good fixes for ~90 s.
 */
import fs from 'fs';
import path from 'path';
const src = fs.readFileSync(path.join(__dirname, '../../services/gpsManager.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('a returning app does not seed a coarse or cached fix', () => {
  it('the one-shot meets the live accuracy bar and is fresh before it becomes lastFix', () => {
    const fn = src.slice(src.indexOf('async function handleAppStateChange'), src.indexOf('function evaluateMode'));
    const gate = fn.indexOf('if (acc == null || acc > OUTLIER_ACCURACY_M || Date.now() - pos.timestamp > 30_000) {');
    const seed = fn.indexOf('lastFix = fresh;');
    expect(gate).toBeGreaterThan(-1);
    expect(seed).toBeGreaterThan(gate);
  });
});
