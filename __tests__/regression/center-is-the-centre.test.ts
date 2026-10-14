/**
 * 2026-10-13 (course-engine audit #4) — the cockpit CENTER cell showed the PIN-adjusted number: back pin,
 * F 140 / CENTER 158 / B 163 with the true centre at 146. The hero ("YARDS TO PIN") is the flag; the
 * CENTER cell is the green's centre. The resolver now carries both.
 */
import { resolvedToFmb, type ResolvedYardage } from '../../services/yardageResolver';

const base: ResolvedYardage = {
  value: 158, front: 140, back: 163, source: 'gps_live', confidence: 'high',
  reason: 'GPS clean. Pin back: playing 158 (+12 on the middle).', asOf: Date.now(), is_fallback: false,
};

describe('CENTER is the centre', () => {
  it('a declared pin moves the number to the flag, and the centre stays the centre', () => {
    const f = resolvedToFmb({ ...base, pin_applied: true, center: 146 })!;
    expect(f.middle).toBe(158);     // to the flag — the hero
    expect(f.center).toBe(146);     // the CENTER cell
  });
  it('no pin: they are the same number', () => {
    const f = resolvedToFmb({ ...base, value: 146 })!;
    expect(f.center).toBe(146);
    expect(f.middle).toBe(146);
  });
  it('the card\'s CENTER cell reads the centre', () => {
    const card = require('fs').readFileSync(require('path').join(__dirname, '../../components/caddie/cockpit/DistanceCard.tsx'), 'utf8');
    expect(card).toMatch(/label=\{t\('cockpit_distance_card\.label\.center'\)\} value=\{center\} hero/);
    expect(card).toMatch(/const center = toDisplayDistance\(fmb\?\.center \?\? fmb\?\.middle/);
  });
  it('the resolver keeps the centre when it applies a pin', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../services/yardageResolver.ts'), 'utf8');
    expect(src).toMatch(/value: adj\.yards,\s*center: r\.value,\s*pin_applied: true,/);
  });
});
