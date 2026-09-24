/**
 * 2026-09-23 (lint sweep — "we don't want ANY issues pending"). Two warnings were real bugs:
 *
 * - SmartMotion: `clearCountdown` was built and never called. A watch/voice "stop" during the
 *   5-second count was ignored (nothing was recording yet), so the count started the recording
 *   anyway; a toggle during it started a second recording on top of the count's.
 * - Quick log shot: the submit callback read `distanceUnit` without depending on it, so after a
 *   yards/metres switch the next shot's typed distance was converted with the OLD unit.
 */
import * as fs from 'fs';
import * as path from 'path';

const code = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('lint-sweep bugs stay fixed', () => {
  it('stop and toggle during a SmartMotion countdown cancel it instead of recording', () => {
    const sm = code('app/swinglab/smartmotion.tsx');
    expect(sm).toMatch(/const counting = countdownTimerRef\.current != null;/);
    expect(sm).toMatch(/if \(cmd === 'stop'\) \{ if \(counting\) clearCountdown\(\);/);
    expect(sm).toMatch(/if \(counting\) clearCountdown\(\);\s*else if \(recording\) void stopRecording\(\);\s*else beginNextRecording\(\);/);
  });

  it('a quick-logged shot converts its distance with the unit on screen now', () => {
    const q = code('components/QuickLogShotSheet.tsx');
    expect(q).toMatch(/fromDisplayDistance\(distNum, distanceUnit\)/);
    expect(q).toMatch(/\}, \[club, distance, outcome, direction, currentHole, holeOverride, logShot, onClose, pinnedLoc, distanceUnit\]\);/);
  });
});
