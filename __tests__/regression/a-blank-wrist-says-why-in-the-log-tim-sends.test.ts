/**
 * 2026-09-20 (Tim, from Echo Hills) — "and watch did not show yardage. Is it because I am on the
 * pre launch build of the watch app?"
 *
 * THE ANSWER ALREADY EXISTED AND COULD NOT LEAVE THE DEVICE. The 2026-09-09 pass gave
 * pushYardageToWatch six distinct reasons — no_native_module, no_active_round, the yardage funnel's
 * own no_fix/no_hole/no_green_coords, no_connected_node, and a throw — and wrote every one to
 * roundTrace. But roundTrace only leaves the phone with a round trace or an owner Field Report, and
 * what Tim actually sends is the ISSUE LOG. So a question with a recorded answer came back as a
 * guess. [[missing-log-entry-is-the-evidence]]
 *
 * Those reasons have completely different fixes — an unpaired watch, a round that never started, a
 * hole with no green, a missing module — so collapsing them into "it didn't work" is the failure
 * this guards against.
 *
 * AND IT MUST STAY QUIET. Tim's 2026-08-10 instruction was "shut off the non-errors on the issue
 * log", so two limits are part of the fix, not polish: the watch toggle gates it (NativeMod exists
 * on every Android build whether or not a watch was ever paired), and it reports once per reason
 * rather than once per 18-second tick.
 */
import * as fs from 'fs';
import * as path from 'path';

const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const bridge = strip(
  fs.readFileSync(path.join(__dirname, '../../services/watchCaddieBridge.ts'), 'utf8'),
);
const exportSvc = fs.readFileSync(
  path.join(__dirname, '../../services/issueLogExport.ts'), 'utf8',
);

describe('a blank wrist says why, in the log Tim actually sends', () => {
  it('the blocking reasons reach the issue log, not only the round trace', () => {
    expect(bridge).toMatch(/reportWatchBlocked\('no_connected_node'/);
    expect(bridge).toMatch(/reportWatchBlocked\('no_native_module'\)/);
    expect(bridge).toMatch(/reportWatchBlocked\(y\.reason \?\? 'no_yardage'/);
    expect(bridge).toMatch(/reportWatchBlocked\('threw'/);
  });

  it('it logs a kind the export actually sends', () => {
    expect(bridge).toMatch(/addAppEvent\('watch_yardage_blocked'[\s\S]{0,120}'app_error'\)/);
    // ...and that kind must still be on the reportable list, or this is a log nobody receives.
    expect(exportSvc).toMatch(/REPORTABLE_KINDS[\s\S]{0,300}'app_error'/);
  });

  it('only for someone who turned the watch on', () => {
    const fn = bridge.slice(bridge.indexOf('function reportWatchBlocked'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/watchSwingEnabled/);
    expect(body).toMatch(/return;/);
  });

  it('once per reason, not once per tick', () => {
    const fn = bridge.slice(bridge.indexOf('function reportWatchBlocked'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/reportedWatchReasons\.has\(reason\)/);
    expect(body).toMatch(/reportedWatchReasons\.add\(reason\)/);
    // A successful delivery must clear it, or one early drop silences the rest of the round.
    expect(bridge).toMatch(/markWatchAlive\(\);\s*reportedWatchReasons\.clear\(\);/);
  });

  it('a quiet phone between rounds files nothing', () => {
    // no_active_round is the normal state of the app on a worktop; logging it every 18s is the
    // 2026-08-10 noise problem, so it must NOT be mirrored.
    expect(bridge).not.toMatch(/reportWatchBlocked\('no_active_round'/);
  });
});
