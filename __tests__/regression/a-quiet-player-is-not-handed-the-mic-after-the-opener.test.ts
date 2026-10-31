/**
 * 2026-10-31 (caddie-home CAD-HOME-R3-2) — A QUIET PLAYER IS NOT HANDED AN OPEN MIC BY AN OPENER HE NEVER HEARD.
 *
 * The get-to-know opener calls speak() without userInitiated. At Quiet (trust 1) or Local Mode the speech
 * gate denies it: speak() flashes the question as a caption and returns at once. The hand-off to the mic
 * ran on speak()'s resolution, so it fired anyway. The player read a question, heard nothing, and got a live
 * recorder that stood down after a few seconds of silence.
 *
 * The hand-off now asks the same gate the speech asked. Two parts: the gate itself denies an unbidden line at
 * Quiet and at Local Mode and allows it at Companion, and the opener's hand-off sits behind that answer.
 * Break-test: revert the caddie.tsx change and the ordering guard fails.
 */
import fs from 'fs';
import path from 'path';

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

jest.setTimeout(60_000);

describe('a Quiet player is not handed the mic after an opener that was only a caption', () => {
  afterEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  it('the speech gate denies an unbidden line at Quiet and under Local Mode, and allows it at Companion', () => {
    jest.resetModules();
    const { useTrustLevelStore } = require('../../store/trustLevelStore') as typeof import('../../store/trustLevelStore');
    const { useSettingsStore } = require('../../store/settingsStore') as typeof import('../../store/settingsStore');
    const { isVoiceAllowed } = require('../../services/voiceService') as typeof import('../../services/voiceService');

    useSettingsStore.setState({ voiceEnabled: true, localMode: false });
    useTrustLevelStore.setState({ level: 1 });
    expect(isVoiceAllowed({ userInitiated: false })).toBe(false);

    useTrustLevelStore.setState({ level: 2 });
    expect(isVoiceAllowed({ userInitiated: false })).toBe(true);

    useSettingsStore.setState({ localMode: true });
    expect(isVoiceAllowed({ userInitiated: false })).toBe(false);
    expect(isVoiceAllowed({ userInitiated: true })).toBe(true);
  });

  it('the get-to-know opener checks the gate before it hands over the mic, in the speech promise\'s finally', () => {
    const src = stripComments(fs.readFileSync(path.join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8'));
    const start = src.indexOf('const openerAudible = isVoiceAllowed({ userInitiated: false });');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("'get_to_know_opener'", start);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    // The gate is read before the line is spoken, and the hand-off is inside an `if` on that answer.
    expect(block.indexOf('.finally(')).toBeGreaterThan(block.indexOf('speak(opener.text'));
    expect(block).toMatch(/if \(openerAudible\) \{\s*try \{\s*handMicToPlayer\(/);
  });
});
