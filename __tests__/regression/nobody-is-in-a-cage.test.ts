/**
 * 2026-09-01 (Tim): "Nobody was in fucking cage. Cage has nothing to do with it. Why do you keep
 * coming to this assumption... it's just course or fucking range or practice."
 *
 * He was right, and the reason I kept reaching that conclusion is the defect: environmentMode
 * DEFAULTED to 'cage'. Every player who never opened the setting was labelled a cage user, and then
 * five branches in SmartMotion, the detection thresholds and the calibration env-match all keyed off
 * that label. Reading the default back as if it were a choice is how a whole audit thread went the
 * wrong way.
 *
 * The rule now, in his words: "If you're not in a round, default that shit to range. If you are in a
 * round, default that shit to course, period."
 *
 * A persisted 'cage' migrates to RANGE, not to practice — carrying it to the indoor mode would
 * preserve the assumption instead of clearing it.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const settings = read('store/settingsStore.ts');
const sm = read('app/swinglab/smartmotion.tsx');

describe('the environment modes are course, range and practice', () => {
  it("'cage' is not a mode any more", () => {
    expect(settings).toMatch(/environmentMode: 'course' \| 'range' \| 'practice'/);
    expect(settings).toMatch(/setEnvironmentMode: \(mode: 'course' \| 'range' \| 'practice'\)/);
  });

  it('THE DEFAULT is range — never a venue the player did not choose', () => {
    expect(settings).toMatch(/environmentMode: 'range' as const/);
    expect(settings).not.toMatch(/environmentMode: 'cage' as const/);
  });

  it('a live round forces course, and course cannot be chosen by hand', () => {
    expect(sm).toMatch(/effectiveMode: 'course' \| 'range' \| 'practice' = isRoundActive \? 'course' : environmentMode/);
    // the toggle cycles range <-> practice only
    expect(sm).toMatch(/setEnvironmentMode\(environmentMode === 'range' \? 'practice' : 'range'\)/);
    expect(sm).not.toMatch(/setEnvironmentMode\([^)]*'course'/);
  });

  it('a persisted cage migrates to RANGE, clearing the assumption rather than carrying it', () => {
    expect(settings).toMatch(/pe\.environmentMode === 'cage'\) pe\.environmentMode = 'range'/);
    expect(settings).toMatch(/version: 24/);
  });

  it('THE CLASS: no shipped mode comparison names cage', () => {
    const files = [
      'app/swinglab/smartmotion.tsx',
      'store/settingsStore.ts',
      'components/smartmotion/ShotMapPage.tsx',
    ];
    const offenders: string[] = [];
    for (const f of files) {
      // comments legitimately discuss the retired name; code must not compare against it.
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');
      for (const m of code.matchAll(/.{0,40}(?:Mode|mode) === 'cage'/g)) {
        // The MIGRATION must name the retired value in order to convert it — that is the one place
        // 'cage' may still appear, and it exists precisely so the value stops existing everywhere else.
        if (/pe\.environmentMode === 'cage'/.test(m[0])) continue;
        offenders.push(`${f} :: ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the indoor branch still exists — it is renamed, not deleted', () => {
    // Practice trusts acoustics as final segmentation; range/course wait for video confirmation.
    expect(sm).toMatch(/if \(meterMode === 'practice'\) \{/);
    expect(sm).toMatch(/stopMode === 'practice' && detectedSegments\.length <= 1/);
    expect(sm).toMatch(/const isCage = effectiveMode === 'practice';/);
  });

  it('rig geometry is still recorded only indoors, on BOTH commit paths', () => {
    expect((sm.match(/effectiveMode === 'practice'/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
