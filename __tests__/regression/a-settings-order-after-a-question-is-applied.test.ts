/**
 * 2026-10-31 (Brain recheck r22, BRAIN-AR-2) — A SETTINGS ORDER SAID AFTER A CADDIE QUESTION IS APPLIED OR DECLINED, NOT PROSE.
 *
 * While Kevin is waiting on an answer, the earbud and typed routes send the utterance straight to the brain as conversation.
 * The brain has no theme, handedness or cart/ghost tool, and the precheck-only decline note was skipped for a real order, so
 * "switch to dark mode" after a question was neither applied nor declined, and the spoken reply could say it was done.
 *
 * BEHAVIOURAL: the real isBrainBlindCommand (the predicate both answering branches read), the real precheck and the real
 * follow-up setting line. The answering-branch predicate is recomputed the way listeningSession computes it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { isBrainBlindCommand } from '../../services/brainBlindCommand';
import { followUpSettingLine } from '../../services/voice/followUpSetting';
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { useSettingsStore } from '../../store/settingsStore';

/** The answering-branch rule from services/listeningSession (both surfaces): an answer to the caddie's question stays prose. */
const answersCaddie = (text: string, awaitingFollowUp = true) => awaitingFollowUp && !isBrainBlindCommand(text);

describe('a settings order said after a caddie question is a command, so the router applies it', () => {
  it.each(['switch to dark mode', "I'm left handed", 'switch to light mode'])('"%s" is not swallowed by the answering branch', (said) => {
    expect(precheckLocalIntent(said)?.intent_type).toBe('change_setting');
    expect(isBrainBlindCommand(said)).toBe(true);
    expect(answersCaddie(said)).toBe(false);
  });

  it('the same order with no question pending is unchanged: it is a command either way', () => {
    expect(answersCaddie('switch to dark mode', false)).toBe(false);
  });

  it('risk posture stays an answer: "go for it" and "play it safe" answer the lay-up question (B3/B4)', () => {
    expect(isBrainBlindCommand('go for it')).toBe(false);
    expect(isBrainBlindCommand('play it safe')).toBe(false);
    expect(answersCaddie('go for it')).toBe(true);
  });

  it('an answer that only mentions a setting is still the caddie\'s, and is not a blind command', () => {
    expect(isBrainBlindCommand('how far to the water')).toBe(false);
    expect(isBrainBlindCommand('we got paired with a lefty')).toBe(false);
  });
});

describe('the caddie-tab follow-up loop does not apply risk posture as an order either', () => {
  it('"go for it" after a question is left to the brain (no risk mode set without a club)', async () => {
    expect(await followUpSettingLine('go for it')).toBeNull();
  });

  it('"switch to dark mode" after a question is still applied on the follow-up loop', async () => {
    useSettingsStore.setState({ theme_preference: 'light' });
    expect(await followUpSettingLine('switch to dark mode')).toEqual(expect.any(String));
    expect(useSettingsStore.getState().theme_preference).toBe('dark');
  });
});
