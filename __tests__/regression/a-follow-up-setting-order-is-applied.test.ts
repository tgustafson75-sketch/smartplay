/**
 * 2026-10-31 (Brain recheck r19, BRAIN-C) — A SETTINGS ORDER SAID IN THE FOLLOW-UP LOOP IS APPLIED.
 *
 * After Kevin asks a question, the next utterance goes through processFollowUp, which skips
 * voiceCommandRouter. The brain has no theme, handedness or risk-mode tool, and the decline note only
 * fires for a precheck decline, so "switch to dark mode" or "I'm left handed" said in that loop changed
 * nothing and was never mentioned to the brain. The loop now applies an unblocked settings order through
 * the same change_setting handler the first turn uses (services/voice/followUpSetting).
 *
 * BEHAVIOURAL: the real followUpSettingLine on the real stores; plus a guard that the follow-up loop
 * calls it before the brain (comments stripped, so the doc comment cannot satisfy it).
 */
import * as fs from 'fs';
import * as path from 'path';
import { followUpSettingLine } from '../../services/voice/followUpSetting';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';

const code = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('a settings order in the follow-up loop is applied, and the caddie says so', () => {
  it('"switch to dark mode" sets the theme and returns the confirmation', async () => {
    useSettingsStore.setState({ theme_preference: 'light' });
    const line = await followUpSettingLine('switch to dark mode');
    expect(line).toEqual(expect.any(String));
    expect(useSettingsStore.getState().theme_preference).toBe('dark');
  });

  it('"I\'m left handed" sets handedness', async () => {
    usePlayerProfileStore.setState({ handedness: 'right' });
    const line = await followUpSettingLine("I'm left handed");
    expect(line).toEqual(expect.any(String));
    expect(usePlayerProfileStore.getState().handedness).toBe('left');
  });

  it('an utterance that is not a settings order is left to the brain', async () => {
    expect(await followUpSettingLine('how far to the water')).toBeNull();
    expect(await followUpSettingLine('what club should I hit here')).toBeNull();
  });
});

describe('the follow-up loop applies the order before it reaches the brain', () => {
  it('processFollowUp calls followUpSettingLine', () => {
    const hook = code('hooks/useVoiceCaddie.ts');
    const body = hook.slice(hook.indexOf('const processFollowUp = async'), hook.indexOf('const processAudioUri'));
    expect(body).toMatch(/followUpSettingLine\(trimmed\)/);
    expect(body.indexOf('followUpSettingLine(trimmed)')).toBeLessThan(body.indexOf('sendToBrain('));
  });
});
