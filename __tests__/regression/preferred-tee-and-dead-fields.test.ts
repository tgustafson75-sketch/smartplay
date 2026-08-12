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

describe('what was inert is now wired, not deleted', () => {
  /**
   * 2026-08-12 (Tim, correcting me) — "don't just delete when you find something adds value if
   * wired like it should have been. A huge part of the app is mental state and mental coaching…
   * Per hole stats matter especially for history, ghost rounds, and progress tracking."
   *
   * He was right. I had removed riskMode and holeStats because nothing referenced them — but "no
   * producer" is a reason to BUILD the producer when the thing has value, not to delete the shape.
   * Both are restored with real producers and real consumers. fillerEnabled stayed deleted: a
   * speech-filler toggle with no filler system behind it had nothing to wire to.
   */
  const rs = read('store/roundStore.ts');

  it('risk posture has a player producer — you can just tell the caddie', () => {
    const pre = read('services/localIntentPrecheck.ts');
    expect(pre).toContain("setting_name: 'risk_mode', new_value: 'safe'");
    expect(pre).toContain("setting_name: 'risk_mode', new_value: 'aggressive'");
    expect(read('services/intents/changeSettingHandler.ts')).toContain("case 'risk_mode': {");
  });

  it('risk posture has a CADDIE producer — the mental read moves it', () => {
    // This is the "dynamics" — a player three-plus bad holes deep shouldn't still be attacking pins.
    expect(rs).toContain("if (mental === 'spiraling' && get().riskMode === 'normal') {");
    expect(rs).toContain("get().setRiskMode('safe', true);");
  });

  it('never overrides a posture the player chose', () => {
    // The ease-off only fires from 'normal'. Ask for aggressive and you keep aggressive.
    expect(rs).toContain("get().riskMode === 'normal'");
  });

  it('risk posture reaches the actual club, not just the wording', () => {
    const cns = read('services/cnsShotRead.ts');
    expect(cns).toContain('risk: ShotRiskMode = \'normal\'');
    expect(cns).toContain('const postureBreak =');
    // Only breaks NEAR-TIES — a posture must never hand you a club that doesn't fit the shot.
    expect(cns).toContain('// a posture must never hand you a club that doesn\'t fit the shot.');
  });

  it('every shot-read caller passes it — one unwired caller is a silent half-fix', () => {
    for (const f of ['app/smartvision.tsx', 'app/smartfinder.tsx', 'services/localStatusResponder.ts']) {
      expect(read(f)).toContain('risk: useRoundStore.getState().riskMode');
    }
  });

  it('per-hole stats are DERIVED, with a real producer', () => {
    expect(rs).toContain('getHoleStats: () => {');
    expect(rs).toContain('score - putts <= par - 2');
  });

  it('GIR returns null rather than false when par or putts are unknown', () => {
    // Otherwise a course with no card silently reports every hole as a miss, and an unrecorded
    // putt count would call every bogey a green in regulation.
    expect(rs).toContain("typeof par === 'number' && par > 0 && s.putts[hole] != null");
  });

  it('fairwayHit stays null — we still have no honest fairway signal', () => {
    // outcome === 'clean' means "no penalty", not "found the fairway".
    expect(rs).toContain('fairwayHit: null,');
  });

  it('the stats are frozen onto the round record while par is still in memory', () => {
    // courseHoles is cleared at round end, so deriving later would make GIR permanently unknowable.
    expect(rs).toContain('holeStats: get().getHoleStats(),');
    expect(rs).toContain('holeStats?: HoleStats[];');
  });

  it('fillerEnabled stayed deleted — there was no filler system to wire it to', () => {
    expect(read('store/settingsStore.ts')).not.toContain('fillerEnabled');
  });

  it('the honest CLEAN TEE % labelling survives the cleanup', () => {
    // The reason those fields existed is still true: outcome==='clean' means "no penalty", not
    // "hit the fairway". The tile must keep saying what the data supports.
    expect(read('app/(tabs)/dashboard.tsx')).toContain('CLEAN TEE %');
  });
});
