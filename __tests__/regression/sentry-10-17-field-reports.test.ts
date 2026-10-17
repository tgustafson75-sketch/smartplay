/**
 * 2026-10-17 — Sentry field reports.
 *
 * SMARTPLAY-CADDIE-MOBILE-C "Seeking interrupted." — an unhandled promise rejection on the swing
 * screen (iOS AVPlayer rejects a seek that a newer seek interrupts). Harmless, but every fire-and-forget
 * seek on the swing screens must catch it.
 *
 * SMARTPLAY-CADDIE-MOBILE-M7 "local courses are not updating by user location" (Fold3) — the Play tab
 * read the position once, at mount; the tab outlives hours in the background, so the nearby list kept
 * the old area. It now re-reads the OS last-known position on focus / foreground when stale, without
 * prompting.
 */
import * as fs from 'fs';
import * as path from 'path';

const raw = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');
const code = (rel: string) => raw(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('swing-screen seeks never leave an unhandled rejection', () => {
  for (const f of ['app/swinglab/swing/[swing_id].tsx', 'app/swinglab/smartmotion.tsx', 'app/swinglab/smart-tempo.tsx']) {
    it(f, () => {
      const lines = code(f).split('\n');
      const bad: string[] = [];
      lines.forEach((l, i) => {
        if (/void\s+[\w.?]*(setPositionAsync|playFromPositionAsync)\(/.test(l)) {
          const window = l + (lines[i + 1] ?? '');
          if (!/\.catch\(/.test(window)) bad.push(`${i + 1}: ${l.trim()}`);
        }
      });
      expect(bad).toEqual([]);
    });
  }
});

describe('the Play tab follows the player', () => {
  const p = code('app/(tabs)/play.tsx');
  it('re-reads position on focus and on returning to the foreground, without a permission prompt', () => {
    expect(p).toMatch(/useFocusEffect\(useCallback\(\(\) => \{ void refreshPositionIfMoved\(\); \}/);
    expect(p).toMatch(/AppState\.addEventListener\('change', \(st\) => \{ if \(st === 'active'\) void refreshPositionIfMoved\(\); \}\)/);
    const fn = p.slice(p.indexOf('const refreshPositionIfMoved'), p.indexOf('const refreshPositionIfMoved') + 900);
    expect(fn).toMatch(/getForegroundPermissionsAsync\(\)/);
    expect(fn).not.toMatch(/requestForegroundPermissionsAsync/);
    expect(fn).toMatch(/haversineMeters\(prev, next\) > 1000/);
  });
});
