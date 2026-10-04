/**
 * 2026-10-04 — SmartMotion orchestrator phase 2 (docs/SMARTMOTION-ORCHESTRATOR.md).
 *
 * The live screen's stages were started by effects, and four of them either ran twice or let the
 * ORDER they finished in decide the answer:
 *   - the pose pass re-ran itself: it sets `angle`, and `angle` was in its own deps;
 *   - swing 1's club arc ran twice (review read + a persist path with a different anchor);
 *   - the saved headline was whichever of the on-device verdict and the cloud read landed first;
 *   - a duff (ball never left) written after the save could be overwritten by the tempo re-commit;
 *   - on the swing detail screen, every play/pause tap restarted the club-arc read from the top.
 *
 * Effect wiring is not reachable from a unit test, so these read the effect itself — deps arrays and
 * the commit conditions — with comments stripped so prose cannot satisfy them.
 */
import fs from 'fs';
import path from 'path';

const code = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

const sm = code('app/swinglab/smartmotion.tsx');
const detail = code('app/swinglab/swing/[swing_id].tsx');

describe('one swing, one headline, one club arc', () => {
  it('the pose pass does not re-run when it sets the angle', () => {
    const at = sm.indexOf('setAngle(bio.angle);');
    expect(at).toBeGreaterThan(-1);
    const deps = sm.slice(at).match(/\}, \[([^\]]*)\]\);/)?.[1] ?? '';
    expect(deps).toContain('selectedSwing');
    expect(deps.split(',').map((d) => d.trim())).not.toContain('angle');
  });

  it('the screen has exactly one club-arc runner, and it saves swing 1', () => {
    expect((sm.match(/detectClubPath\(/g) ?? []).length).toBe(1);
    expect(sm).toMatch(/selectedSwing === 0 && sid && r && clubArcSessionRef\.current !== sid/);
    expect(sm).toMatch(/setSessionClubArc\(sid, pts \?\? \[\]/);
  });

  it('a named cloud fault always takes the headline and is locked', () => {
    expect(sm).toMatch(/const cloudNamed = rolled != null && rolled\.issue_id !== 'smartmotion_observation';/);
    expect(sm).toMatch(/if \(contactPi \|\| \(!contactAlreadySaved && \(cloudNamed \|\| poseVerdictSessionRef\.current !== sessionId\)\)\)/);
    expect(sm).toMatch(/if \(contactPi \|\| cloudNamed\) cloudVerdictLockRef\.current = sessionId;/);
    // and the on-device re-commit respects the lock
    expect(sm).toMatch(/cloudVerdictLockRef\.current === sessionId\) return;/);
  });

  it('a duff written after the save is locked against the tempo re-commit', () => {
    expect(sm).toMatch(/store\.setSessionAnalysis\(sessionId, duff, null\);\s*cloudVerdictLockRef\.current = sessionId;/);
  });

  it('the detail screen club arc is not restarted by play/pause, and a found arc is saved', () => {
    const at = detail.indexOf('const shotArc = shot?.club_arc');
    expect(at).toBeGreaterThan(-1);
    const deps = detail.slice(at).match(/\}, \[([^\]]*)\]\);/)?.[1] ?? '';
    expect(deps).toContain('showTrace');
    expect(deps.split(',').map((d) => d.trim())).not.toContain('isPlaying');
    expect(detail).toMatch(/setShotClubArc\(session\.id, shot\.id, pts,/);
  });
});

/**
 * 2026-10-04 — the review loop filled the Java heap. expo-av's `isLooping` is ExoPlayer repeat mode on
 * Android, which buffers the next loops ahead up to the 131MB video cap: a heap dump of a 37MB clip in
 * review held 130.7MB of ExoPlayer segments and the app died of OutOfMemoryError. Loop by restarting
 * at didJustFinish instead. Every screen, because every player has the same native default.
 */
describe('no video player loops with ExoPlayer repeat mode', () => {
  const walk = (dir: string): string[] => fs.readdirSync(path.join(__dirname, '..', '..', dir), { withFileTypes: true })
    .flatMap((d) => d.isDirectory() ? walk(`${dir}/${d.name}`) : /\.tsx$/.test(d.name) ? [`${dir}/${d.name}`] : []);
  const files = [...walk('app'), ...walk('components')];

  it('scans real screens', () => {
    expect(files).toContain('app/swinglab/smartmotion.tsx');
    expect(files).toContain('app/recap/[round_id].tsx');
  });

  it.each(files)('%s', (rel) => {
    const src = code(rel);
    expect(src).not.toMatch(/\bisLooping(?!=\{false\})(?=[\s/>]|=\{true\})/);
  });
});

/**
 * 2026-10-04 (phase 3) — the upload pass ran detectClubPath with NO impact anchor, so its dense samples
 * spread across the whole window while every other runner clustered them on impact. Every runner now
 * passes an anchor, and the ones that build it from pose frames use the shared rule.
 */
describe('every club-arc runner anchors on impact by the one rule', () => {
  const walk = (dir: string): string[] => fs.readdirSync(path.join(__dirname, '..', '..', dir), { withFileTypes: true })
    .flatMap((d) => d.isDirectory() ? walk(`${dir}/${d.name}`) : /\.tsx?$/.test(d.name) ? [`${dir}/${d.name}`] : []);
  const files = [...walk('app'), ...walk('services'), ...walk('components')].filter((f) => f !== 'services/swing/clubPath.ts');
  const calls = files.flatMap((f) => {
    const src = code(f);
    return [...src.matchAll(/detectClubPath\(\{([\s\S]*?)\}\)/g)].map((m) => ({ f, args: m[1] }));
  });

  it('finds the runners', () => {
    expect(calls.map((c) => c.f).sort()).toEqual([
      'app/swinglab/smartmotion.tsx', 'app/swinglab/swing/[swing_id].tsx', 'app/swinglab/swing/[swing_id].tsx', 'services/videoUpload.ts',
    ]);
  });

  it.each([0, 1, 2, 3])('runner %i passes an impact anchor', (i) => {
    expect(calls[i].args).toMatch(/impactMs:/);
  });

  it('pose-built anchors go through clubArcAnchorMs / poseImpactFromFrames', () => {
    expect(code('services/videoUpload.ts')).toMatch(/const arcAnchorMs = clubArcAnchorMs\(\{[\s\S]{0,900}?impactMs: arcAnchorMs,/);
    expect(sm).toMatch(/const segStrikeMs = clubArcAnchorMs\(\{/);
    expect(detail).toMatch(/const arcAnchorMs = clubArcAnchorMs\(\{/);
    expect(detail).toMatch(/useMemo\(\(\) => poseImpactFromFrames\(poseFrames\)/);
  });
});
