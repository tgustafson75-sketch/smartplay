/**
 * 2026-10-16 (GPS sweep, finding 10) — startRound awaited the background-location disclosure and
 * requestBackgroundPermissionsAsync BEFORE startGpsManager(). On Android 11+ that request sends the
 * player to system Settings, so no GPS ran until they came back — every round, for anyone without
 * "Always". The code comment claimed "foreground GPS is already running by this point"; it was not.
 *
 * Source-order guard over comment-stripped code: the orchestration lives in a fire-and-forget IIFE
 * behind permission prompts that the logic test environment cannot drive.
 */
import * as fs from 'fs';
import * as path from 'path';

const code = fs.readFileSync(path.resolve(__dirname, '../../store/roundStore.ts'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('round start', () => {
  const disclosure = code.indexOf("await import('../services/backgroundLocationDisclosure')");
  const start = code.lastIndexOf('await startGpsManager();', disclosure);

  it('THE BUG: GPS starts before the background-location prompt is awaited', () => {
    expect(disclosure).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(-1);
    expect(code.indexOf('await startGpsManager();', disclosure)).toBe(-1); // not (also) after it
  });

  it('does not start GPS for a round that ended while permission was being asked', () => {
    expect(code.slice(start - 200, start)).toMatch(/if \(!get\(\)\.isRoundActive\) return;/);
  });

  it('re-arms background tracking once "Always" may have been granted', () => {
    expect(code.slice(disclosure, disclosure + 600)).toMatch(/startBackgroundLocation\(\)/);
  });
});
