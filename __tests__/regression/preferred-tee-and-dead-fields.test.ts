/**
 * 2026-08-12 — store-field sweep: written but never read.
 *
 * Continuing the adversarial passes into the store layer, asking of every field: is anything on the
 * other end of this? Four came back with nothing, and one of them was USER-VISIBLE, which is a worse
 * class than the rest.
 *
 *   preferredTee    Settings offers Front / Middle / Back, it persisted, it rode along in the cloud
 *                   backup — and every course load took `course.tees[0]` regardless. A player who
 *                   set "Front" was quoted back-tee yardages, and the caddie clubbed them off those
 *                   numbers. The user can SEE this setting, so they believe they configured
 *                   something, while the app silently disagrees with every number it then tells them.
 *
 *   riskMode        'safe' | 'normal' | 'aggressive' on the round, persisted, reset in four places,
 *                   with a setter no screen or voice path ever called and no consumer anywhere. A
 *                   caddie posture the player couldn't set and the caddie never consulted.
 *   fillerEnabled   a persisted setting with a setter nothing called and no reader.
 *   holeStats       a per-hole stats array initialised in four places, never populated, never read.
 *
 * preferredTee got wired because it's a real promise to the user. The other three were deleted:
 * inert state that looks live is how a reviewer (or I) concludes a feature exists.
 */
import { pickTeeSet } from '../../services/teeSelection';
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const TEES = [
  { tee_name: 'Championship', total_yards: 7100 },
  { tee_name: 'Blue', total_yards: 6600 },
  { tee_name: 'White', total_yards: 6100 },
  { tee_name: 'Gold', total_yards: 5400 },
];

describe('Preferred Tee finally selects a tee', () => {
  it('front takes the shortest set, back the longest', () => {
    expect(pickTeeSet(TEES, 'front')?.tee_name).toBe('Gold');
    expect(pickTeeSet(TEES, 'back')?.tee_name).toBe('Championship');
  });

  it('middle takes the median, favouring the shorter of two central sets', () => {
    // A player who hasn't thought about it shouldn't be handed the longer card.
    expect(pickTeeSet(TEES, 'middle')?.tee_name).toBe('White');
  });

  it('chooses by LENGTH, not by name', () => {
    // Tee names are marketing and differ per course — name-matching works at one club and fails at
    // the next. The preference is about length.
    const oddNames = [
      { tee_name: 'Heritage', total_yards: 5200 },
      { tee_name: 'Legacy', total_yards: 6900 },
    ];
    expect(pickTeeSet(oddNames, 'front')?.tee_name).toBe('Heritage');
    expect(pickTeeSet(oddNames, 'back')?.tee_name).toBe('Legacy');
  });

  it('falls back to the upstream order when there is nothing to choose between', () => {
    // One set, or yardages the upstream never provided — guessing from names would be worse.
    expect(pickTeeSet([{ tee_name: 'Only' }], 'back')?.tee_name).toBe('Only');
    expect(pickTeeSet([{ tee_name: 'A' }, { tee_name: 'B' }], 'front')?.tee_name).toBe('A');
    expect(pickTeeSet([{ tee_name: 'A', total_yards: 6000 }, { tee_name: 'B' }], 'back')?.tee_name).toBe('A');
  });

  it('never returns undefined for a non-empty list, and null for an empty one', () => {
    expect(pickTeeSet([], 'middle')).toBeNull();
    expect(pickTeeSet(null, 'middle')).toBeNull();
    expect(pickTeeSet(undefined, 'middle')).toBeNull();
    for (const p of ['front', 'middle', 'back'] as const) expect(pickTeeSet(TEES, p)).toBeTruthy();
  });

  it('the course screen actually reads the setting now', () => {
    const src = read('app/course/[course_id].tsx');
    expect(src).toContain('const preferredTee = usePlayerProfileStore((st) => st.preferredTee);');
    expect(src).toContain('pickTeeSet(course.tees, preferredTee)');
    expect(src).toContain('pickTeeSet(course?.tees, preferredTee)');
    // The bug, verbatim: always the first tee set.
    expect(src).not.toContain('course.tees[0]');
    expect(src).not.toContain('course?.tees[0]');
  });
});

describe('the inert fields are gone, not just unused', () => {
  it('riskMode is removed from state, setter and persistence', () => {
    const rs = read('store/roundStore.ts');
    expect(rs).not.toContain("riskMode: 'safe' | 'normal' | 'aggressive';");
    expect(rs).not.toContain('setRiskMode');
    expect(rs).not.toContain('riskMode: s.riskMode,');
  });

  it('holeStats and its orphaned type are removed', () => {
    const rs = read('store/roundStore.ts');
    expect(rs).not.toContain('holeStats');
    expect(rs).not.toContain('export interface HoleStats');
  });

  it('fillerEnabled is removed from state, setter and the backup allowlist', () => {
    const ss = read('store/settingsStore.ts');
    expect(ss).not.toContain('fillerEnabled');
    expect(ss).not.toContain('setFillerEnabled');
  });

  it('the dashboard no longer cites a type that no longer exists', () => {
    // The comment explained an honest product gap (no real fairway-in-regulation data) by pointing
    // at HoleStats.fairwayHit. Deleting the type without the comment leaves a phantom citation.
    expect(read('app/(tabs)/dashboard.tsx')).not.toContain('HoleStats.fairwayHit');
  });

  it('the honest CLEAN TEE % labelling survives the cleanup', () => {
    // The reason those fields existed is still true: outcome==='clean' means "no penalty", not
    // "hit the fairway". The tile must keep saying what the data supports.
    expect(read('app/(tabs)/dashboard.tsx')).toContain('CLEAN TEE %');
  });
});
