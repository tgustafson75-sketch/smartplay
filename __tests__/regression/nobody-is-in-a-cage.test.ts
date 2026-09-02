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
    expect(sm).toMatch(/const isPractice = effectiveMode === 'practice';/);
  });

  it('rig geometry is still recorded only indoors, on BOTH commit paths', () => {
    expect((sm.match(/effectiveMode === 'practice'/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('the word is gone from everything a player can see', () => {
  const screens = ['app/settings.tsx', 'app/permissions.tsx', 'app/paywall.tsx', 'app/quick-start.tsx',
                   'app/swinglab/library.tsx', 'app/swinglab/upload.tsx', 'components/tools/GlobalToolsMenu.tsx'];

  it('no rendered label, title or description says Cage', () => {
    const offenders: string[] = [];
    for (const f of screens) {
      const src = read(f);
      for (const m of src.matchAll(/(?:label|title|body|sub|why|footer|name)[:=] ?['"]([^'"]*Cage[^'"]*)['"]/g)) {
        offenders.push(`${f} :: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the caddie PILLAR is practice — it covers all swing work, not a venue', () => {
    expect(read('store/settingsStore.ts')).toMatch(/CaddiePillar = 'round' \| 'practice' \| 'drills' \| 'play'/);
    expect(read('services/caddieResolver.ts')).not.toMatch(/return 'cage';/);
  });

  it('a persisted pillar assignment MOVES with the rename rather than being lost', () => {
    const s = read('store/settingsStore.ts');
    expect(s).toMatch(/a\.cage !== undefined && a\.practice === undefined/);
    expect(s).toMatch(/delete a\.cage;/);
  });

  it('the SwingSource value moved, and every stored session moves with it', () => {
    const cs = read('store/swingSessionStore.ts');
    expect(cs).toMatch(/SwingSource = 'live_capture' \| 'uploaded_video'/);
    expect(cs).toMatch(/sess\.source === 'live_cage'\) sess\.source = 'live_capture'/);
    // and nothing still compares against the old value
    for (const f of ['app/swinglab/smartmotion.tsx', 'services/videoUpload.ts', 'app/swinglab/swing/[swing_id].tsx']) {
      expect(read(f)).not.toMatch(/'live_cage'/);
    }
  });

  it('the redundant swing TAG is collapsed, not renamed — indoor already meant it', () => {
    const cs = read('store/swingSessionStore.ts');
    expect(cs).toMatch(/SwingTag = 'range' \| 'indoor' \| 'course' \| 'putt' \| 'chip' \| 'other'/);
    // and every persisted 'cage' tag becomes 'indoor'
    expect(cs).toMatch(/shot\.tag === 'cage'\) shot\.tag = 'indoor'/);
    expect(cs).toMatch(/version: 2,/);
  });

  it('that migration refuses a primitive rather than spreading it', () => {
    expect(read('store/swingSessionStore.ts')).toMatch(/typeof persisted !== 'object' \|\| persisted === null \|\| Array\.isArray\(persisted\)\) return \{\} as never/);
  });

  it('nothing WRITES the retired tag any more', () => {
    for (const f of ['components/PracticeSessionOverlay.tsx', 'services/mediaCapture.ts']) {
      expect(read(f)).not.toMatch(/tag: 'cage'/);
    }
  });
});

describe('the store renamed without abandoning the data', () => {
  const store = read('store/swingSessionStore.ts');

  it('THE THING THAT MUST NOT MOVE: the AsyncStorage key is unchanged', () => {
    // Renaming a persist key does not migrate data, it abandons it — the player opens the app to an
    // empty swing library, with no error and no way back. The file, the hook and the types all moved
    // off "cage"; the key deliberately did not.
    expect(store).toMatch(/name: 'cage-store-v1'/);
    expect(store).toMatch(/DO NOT RENAME/);
  });

  it('the store, hook and types no longer say cage', () => {
    expect(fs.existsSync(path.join(root, 'store/cageStore.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'store/swingSessionStore.ts'))).toBe(true);
    expect(store).toMatch(/export const useSwingSessionStore/);
    expect(store).toMatch(/export interface SwingShot/);
    expect(store).toMatch(/export interface SwingSession/);
  });

  it('nothing imports the old module path', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', '.expo', 'ios', 'android'].includes(e.name)) continue;
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.tsx?$/.test(e.name)) {
          const src = fs.readFileSync(f, 'utf8');
          if (/from '[^']*\/cageStore'/.test(src) || /\buseCageStore\b/.test(src)) {
            offenders.push(path.relative(root, f));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('the backup allowlist still sees this store — a rename must not hide it', () => {
    const snap = read('services/cloudSync/snapshot.ts');
    expect(snap).toMatch(/cage-store-v1/);
  });
});

describe('the rig measurement survived its own rename', () => {
  const settings = read('store/settingsStore.ts');

  it('the field is renamed', () => {
    expect(settings).toMatch(/practiceCanvasFeet: number;/);
    expect(settings).toMatch(/setPracticeCanvasFeet:/);
  });

  it('THE VALUE IS CARRIED — a player measured this by hand', () => {
    // Renaming a persisted field drops it unless carried, and silently resetting to the 14ft default
    // would put their rig geometry wrong with no sign anything happened.
    expect(settings).toMatch(/pc\.practiceCanvasFeet = pc\.cageCanvasFeet/);
  });

  it('and the carry cannot throw or clobber an existing value', () => {
    expect(settings).toMatch(/pc\.practiceCanvasFeet === undefined/);
    expect(settings).toMatch(/typeof pc\.cageCanvasFeet === 'number'/);
  });
});
