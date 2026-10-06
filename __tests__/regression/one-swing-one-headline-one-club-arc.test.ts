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

/**
 * 2026-10-05 (Tim: "one clean, fast, and correct analysis path that the orchestrator makes sure is
 * correct") — the fix for all of the above was not five locks but ONE writer: SmartMotion, the Swing
 * Library and the cage summary all go through the orchestrator's run, and the screens only draw.
 */
const runner = code('services/swing/orchestrator/shotDetail.ts');
const run = code('services/swing/orchestrator/uploadRun.ts');
const read = code('services/videoUpload.ts');

describe('one swing, one headline, one club arc', () => {
  it('the body read is drawn from the store — setting the angle re-runs nothing', () => {
    const at = sm.indexOf('setAngle(bio.angle);');
    expect(at).toBeGreaterThan(-1);
    const deps = sm.slice(at).match(/\}, \[([^\]]*)\]\);/)?.[1] ?? '';
    expect(deps.split(',').map((d) => d.trim())).toEqual(['selectedShotBio']);
  });

  it('there is exactly one club-arc runner in the app, and it saves the shot (and swing 1 on the session)', () => {
    expect((sm.match(/detectClubPath\(/g) ?? []).length).toBe(0);
    expect((detail.match(/detectClubPath\(/g) ?? []).length).toBe(0);
    expect((runner.match(/detectClubPath\(/g) ?? []).length).toBe(1);
    expect(runner).toMatch(/store\.setShotClubArc\(input\.sessionId, input\.shotId, pts, frame, arc\.source\);\s*if \(first\) store\.setSessionClubArc\(input\.sessionId, pts, frame, arc\.source\);/);
  });

  it('SmartMotion writes no verdict of its own — only the camera\'s ball-never-left evidence', () => {
    expect((sm.match(/setSessionAnalysis\(/g) ?? []).length).toBe(1);
    expect(sm).toMatch(/store\.setSessionAnalysis\(sessionId, noLaunchIssue\(\), null\);/);
    expect(sm).not.toMatch(/setSessionAnalysisStatus\(/);
    expect(sm).not.toMatch(/\banalyzeSwing\(/);
    expect(sm).toMatch(/runSwingAnalysis\(sid, \{/);
  });

  it('the read applies contact honesty for every swing, and keeps a strike the camera saw', () => {
    expect(read).toMatch(/primary_issue = applyContactHonesty\(primary_issue, results\.map\(r => r\.analysis\.contact_read\), cur\?\.feel_note, cur\?\.primary_issue\?\.issue_id\);/);
    const { applyContactHonesty } = require('../../services/swing/contactVerdict') as typeof import('../../services/swing/contactVerdict');
    const fault = { issue_id: 'over_the_top' } as never;
    expect(applyContactHonesty(fault, ['clean'], null, 'no_launch')?.issue_id).toBe('no_launch');
    expect(applyContactHonesty(fault, ['clean'], 'felt a bit fat', null)?.issue_id).toBe('heavy_contact');
    expect(applyContactHonesty(fault, [null, 'thin'], null, null)?.issue_id).toBe('thin_contact');
    expect(applyContactHonesty(fault, ['clean'], null, 'over_the_top')?.issue_id).toBe('over_the_top');
    // and the body read's fallback verdict never replaces it either
    expect(run).toMatch(/if \(s\.analysis_status !== 'ok' && s\.primary_issue\?\.issue_id === 'no_launch'\) \{[\s\S]{0,200}setSessionAnalysisStatus\(input\.sessionId, 'ok'\);\s*return true;/);
  });

  it('the detail screen asks the run, keyed on the shot — play/pause restarts nothing', () => {
    const at = detail.indexOf('return requestShotDetail(swing_id, selShot.id, { arc: showTrace });');
    expect(at).toBeGreaterThan(-1);
    const open = detail.indexOf('}, [', at);
    const deps = detail.slice(open, detail.indexOf(']);\n', open));
    expect(deps).toContain('showTrace');
    expect(deps).not.toMatch(/isPlaying/);
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

  it('finds the one runner', () => {
    expect(calls.map((c) => c.f)).toEqual(['services/swing/orchestrator/shotDetail.ts']);
  });

  it('it passes the impact anchor and its tolerance, from the shared rule', () => {
    expect(calls[0].args).toMatch(/impactMs: anchorMs, toleranceMs/);
    expect(runner).toMatch(/const \{ anchorMs, toleranceMs \} = clubArcAnchor\(\{/);
    expect(runner).toMatch(/narrowClubPathWindow\(rawStartMs, rawEndMs, anchorMs\)/);
  });
});

/** 2026-10-04 (sweep) — what the adversarial pass found on the live screen. */
describe('the review loop and the third headline writer', () => {
  it('the reel narrates the run\'s reads and re-persists nothing (the run classifies across every swing)', () => {
    const at = sm.indexOf('const pipelineNarrate = useCallback(');
    const body = sm.slice(at, sm.indexOf('const selectSwing = useCallback(', at));
    expect(body).not.toMatch(/setSessionAnalysis|setShotAnalysis|classifySession/);
    expect(body).toMatch(/runWindowedAnalysis\(uri, segs\[0\], 0\)/);
  });
  it('Play on a clip parked at its end restarts from the swing (Android ENDED never re-fires didJustFinish)', () => {
    expect(sm).toMatch(/if \(atEnd\) await v\?\.playFromPositionAsync\(/);
  });
  it('the finish is handled FIRST, ahead of the window loop and its seek guard', () => {
    const h = sm.slice(sm.indexOf('const onReviewPlaybackStatus = useCallback('));
    expect(h.indexOf("'didJustFinish' in s")).toBeGreaterThan(-1);
    expect(h.indexOf("'didJustFinish' in s")).toBeLessThan(h.indexOf('loopSeekGuardRef.current = true'));
    expect(h.slice(0, h.indexOf("'positionMillis' in s"))).not.toMatch(/!loopSeekGuardRef\.current/);
  });
});

/** 2026-10-05 — final review of the one-path SmartMotion screen. */
describe('SmartMotion waits for the run, and re-analyze is a new request', () => {
  const ra = sm.slice(sm.indexOf('const runAnalysis = useCallback('), sm.indexOf("if (phase !== 'review' || analysis || puttAnalysis) return;"));
  it('no cloud read: stays on Analyzing until the run SETTLES (no "no read" flash, then a verdict)', () => {
    expect(ra).toMatch(/setAnalysisError\(null\);\s*try \{[\s\S]{0,400}await whenStageSettled\(swingRunKey\(sid\), 'settle'\);/);
  });
  it('re-analyze does not blank the body read it cannot recompute (the store-drawn effect owns it)', () => {
    expect(ra).not.toMatch(/setPoseFrames\(null\);\s*setBiomech\(null\);/);
  });
  it('measurements travel only for swing 1, the swing the read attaches them to', () => {
    expect(ra).toMatch(/measured: reuse && selectedSwingRef\.current === 0 \? \{/);
  });
  it('re-analyze never joins the read still going (its new view/window would be dropped)', () => {
    expect(ra).toMatch(/if \(reuse\) \{\s*try \{[\s\S]{0,500}liveRun\(swingRunKey\(sid\)\)\?\.cancel\(\);/);
  });
  it('leaving the screen drops the run\'s results for it (no putt read spoken on the next screen)', () => {
    expect(sm).toMatch(/pipelineRunRef\.current\+\+;[^\n]*\n[\s\S]{0,200}sessionRunRef\.current \+= 1;/);
  });
});
