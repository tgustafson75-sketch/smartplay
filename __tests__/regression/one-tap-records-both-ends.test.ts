/**
 * 2026-09-21 (Tim: "I hate long press, should just be tap that starts a 3 to 5 second countdown
 * silently but shows on phone").
 *
 * The long-press separated two recordings that never wanted separating — the wrist IMU on tap, the
 * phone's camera on hold — so the two readings of one swing depended on the player remembering to
 * line them up. One tap now drives both.
 *
 * THREE THINGS THIS PINS, each because it is a way the feature could rot back:
 *
 * 1. THE GESTURE IS ACTUALLY GONE. A removed feature whose handler is still registered is the
 *    worst of both: undocumented and live.
 *
 * 2. THE COUNTDOWN REACHES THE CAMERA. It runs on the PHONE deliberately — the player is walking
 *    into frame with the watch on the wrist they are about to swing, so the wrist is the one place
 *    they cannot look. If the route stops carrying it, the recording starts while they are still
 *    walking and every clip is useless in a way nobody would attribute to this.
 *
 * 3. BOTH CAMERA PATHS GO THROUGH ONE OWNER. SmartMotion renders either vision-camera or
 *    expo-camera, each with its own onCameraReady. Two copies of "start when ready" is how a
 *    countdown works on one device and silently does not on another — this repo's defining defect,
 *    and the reason `beginPendingCapture` exists. [[no-half-fixes-enforce-every-surface]]
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the long-press is gone from the watch', () => {
  const wear = strip(read('wear-os-app/app/src/main/java/com/smartplaycaddie/wear/MainActivity.kt'));

  it('registers no long-click handler at all', () => {
    expect(wear).not.toMatch(/setOnLongClickListener/);
  });

  it('the tap starts the wrist capture AND asks the phone for a countdown', () => {
    const toggle = wear.slice(wear.indexOf('private fun onToggleCapture'));
    expect(toggle).toMatch(/startForegroundService\(svc\)|startService\(svc\)/);
    expect(toggle).toMatch(/sendToPhone\(COMMAND_PATH, "smartmotion_countdown"/);
  });

  /**
   * The wrist capture is useful on its own, so a phone that is asleep must not stop it — but the
   * player has to be told which half happened. This is the same "say what actually happened"
   * rule the delivery callback was added for earlier today.
   */
  it('says so when only the watch half happened', () => {
    expect(wear).toMatch(/Watch only - phone not reachable/);
  });
});

describe('the countdown reaches the camera, on both camera implementations', () => {
  const orch = strip(read('services/handsFreeOrchestrator.ts'));
  const bridge = strip(read('services/watchCaddieBridge.ts'));
  const bus = strip(read('services/smartMotionRecordBus.ts'));
  const screen = strip(read('app/swinglab/smartmotion.tsx'));

  it('the watch verb survives the whitelist', () => {
    expect(bridge).toMatch(/smartmotion_countdown/);
    expect(bus).toMatch(/'countdown'/);
  });

  it('a closed SmartMotion opens with a countdown, not straight into recording', () => {
    const arm = orch.slice(orch.indexOf("case 'smartmotion_countdown'"));
    expect(arm).toMatch(/countdown=5/);
    expect(arm).toMatch(/autoRecord=1/);
  });

  it('an already-open SmartMotion runs the countdown instead of recording now', () => {
    const arm = orch.slice(orch.indexOf("case 'smartmotion_countdown'"), orch.indexOf("case 'smartmotion_toggle'"));
    expect(arm).toMatch(/emitSmartMotionCommand\('countdown'\)/);
    expect(arm).not.toMatch(/emitSmartMotionCommand\('start'\)/);
  });

  /**
   * The assertion that actually protects the feature: NEITHER onCameraReady may call
   * startRecording directly, or the countdown is honoured on one camera and skipped on the other.
   */
  it('neither camera starts recording behind the countdown’s back', () => {
    const readyBlocks = screen.match(/onCameraReady=\{\(\)\s*=>\s*\{[\s\S]*?\}\}/g) ?? [];
    expect(readyBlocks.length).toBeGreaterThanOrEqual(2);
    for (const b of readyBlocks) {
      expect(b).toMatch(/beginPendingCapture\(\)/);
      expect(b).not.toMatch(/startRecording\(\)/);
    }
  });

  it('the countdown is rendered where the player can read it — over the preview', () => {
    expect(screen).toMatch(/countdownLeft !== null/);
    expect(screen).toMatch(/countdownNumber/);
  });
});
