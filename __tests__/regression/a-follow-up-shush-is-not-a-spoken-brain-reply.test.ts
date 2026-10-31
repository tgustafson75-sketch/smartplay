/**
 * 2026-10-31 (Brain recheck r18, BRAIN-5) — A SHUSH OR A PENALTY SAID IN THE FOLLOW-UP LOOP IS HEARD.
 *
 * Kevin asks "Want a club suggestion?" and the tab mic reopens. processFollowUp ran only the close
 * gate, the putt answer, the course pick and then the brain, so "be quiet", "mute" and "silence" went
 * to /api/kevin and the reply was spoken straight through the shush. "Penalty" went to the brain
 * instead of adding the stroke. The first turn already runs tabBypassKind; the follow-up loop now runs
 * the same checkBypasses before the brain, with the same handling.
 *
 * BEHAVIOURAL on the phrase rule (the real tabBypassKind), and structural on the hook's follow-up
 * path: the bypass must run before sendToBrain, and the mute branch must end the loop without a
 * brain call or a spoken reply.
 */
import * as fs from 'fs';
import * as path from 'path';
import { tabBypassKind } from '../../services/tabVoiceBypass';

const inRound = { isRoundActive: true, language: 'en' };

describe('a follow-up shush or penalty is a bypass, not a brain turn', () => {
  it.each([
    ['be quiet', 'mute'],
    ['mute', 'mute'],
    ['silence', 'mute'],
    ['penalty', 'penalty'],
  ])('"%s" → %s', (t, kind) => {
    expect(tabBypassKind(t, inRound)).toBe(kind);
  });

  const src = fs.readFileSync(path.resolve(__dirname, '../../hooks/useVoiceCaddie.ts'), 'utf8');
  const follow = src.slice(src.indexOf('const processFollowUp = async'), src.indexOf('const reply = await sendToBrain(trimmed);'));

  it('the follow-up loop runs the bypass check before it sends the transcript to the brain', () => {
    // `follow` ends at the brain call, so any bypass check found here runs before it. The ref reads the
    // latest checkBypasses (the loop's closure is built once, so a plain call would see a stale round).
    expect(follow).toMatch(/checkBypassesRef\.current\(trimmed\)/);
  });

  it('a handled mute stops speaking and returns before any brain call or spoken reply', () => {
    const mute = follow.slice(follow.indexOf('if (bypass.triggerMute) {'));
    const branch = mute.slice(0, mute.indexOf('}'));
    expect(branch).toContain("await stopSpeaking('screen:hooks-usevoicecaddie');");
    expect(branch).toMatch(/return;/);
  });
});
