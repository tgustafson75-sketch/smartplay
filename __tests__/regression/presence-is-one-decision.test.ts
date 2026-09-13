/**
 * 2026-09-13 (Tim, reviewing 28 Settings screenshots — "we wanna be smart, not toggle heavy").
 *
 * SEVEN SWITCHES ANSWERING TWO QUESTIONS.
 *
 * Kevin's presence, Proactive, Interactive Round, Local Mode, Active Listening, Continuous
 * Conversation and Response Style all decided one of two things: how much the caddie talks, and
 * whether it is listening. Spread across seven rows they could contradict each other and regularly
 * did — presence could read Active while Local Mode silenced every non-user-initiated line
 * (`localMode && !opts?.userInitiated` in voiceService), and Proactive could sit ON underneath it,
 * disabled, describing a behaviour that was not happening.
 *
 * The flags all still exist and every consumer still reads the one it always read — 32 files read
 * `trustLevel`, 9 read `responseMode`. What this pins is that ONE thing owns the combination.
 * [[two-owners-is-the-root-cause]] [[an-invariant-has-three-homes]]
 */
import fs from 'fs';
import path from 'path';
import {
  PRESENCE_PROFILES,
  LISTENING_PROFILES,
  presenceFromFlags,
  type CaddiePresence,
} from '../../services/caddiePresence';

const root = path.resolve(__dirname, '../..');
/** Comments name every row this file forbids, so read the CODE. [[strip-comments-before-a-guard-matches]] */
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

const LEVELS: CaddiePresence[] = ['quiet', 'balanced', 'talkative'];

describe('caddie presence is one decision', () => {
  it('every level sets every flag — a missing field leaves a stale setting behind', () => {
    for (const level of LEVELS) {
      const p = PRESENCE_PROFILES[level];
      expect(typeof p.trustLevel).toBe('number');
      expect(typeof p.proactiveKevin).toBe('boolean');
      expect(typeof p.interactiveRound).toBe('boolean');
      expect(typeof p.localMode).toBe('boolean');
      expect(['short', 'neutral', 'detailed']).toContain(p.responseMode);
    }
  });

  it('reads back the level it wrote — the pill cannot show something the flags do not say', () => {
    for (const level of LEVELS) {
      expect(presenceFromFlags({ ...PRESENCE_PROFILES[level] })).toBe(level);
    }
  });

  it('Quiet actually silences: the speech gate and the proactive flag agree', () => {
    // localMode IS the enforcement — voiceService returns early on !userInitiated when it is true.
    expect(PRESENCE_PROFILES.quiet.localMode).toBe(true);
    expect(PRESENCE_PROFILES.quiet.proactiveKevin).toBe(false);
    expect(PRESENCE_PROFILES.quiet.interactiveRound).toBe(false);
    // ...and nothing above Quiet leaves the gate on, which is what made Active-but-silent possible.
    expect(PRESENCE_PROFILES.balanced.localMode).toBe(false);
    expect(PRESENCE_PROFILES.talkative.localMode).toBe(false);
  });

  it('keeps Tim\'s 2026-08-07 call: speak-when-you-stop is off unless asked for', () => {
    expect(PRESENCE_PROFILES.balanced.interactiveRound).toBe(false);
    expect(PRESENCE_PROFILES.talkative.interactiveRound).toBe(true);
  });

  it('legacy or hand-edited flags still resolve to a level rather than a blank pill', () => {
    expect(presenceFromFlags({
      trustLevel: 3, proactiveKevin: true, interactiveRound: false, localMode: true, responseMode: 'neutral',
    })).toBe('quiet'); // the gate wins: it was silent whatever the pill said
    expect(presenceFromFlags({
      trustLevel: 3, proactiveKevin: true, interactiveRound: true, localMode: false, responseMode: 'neutral',
    })).toBe('talkative');
  });

  it('the mic is one decision, and both halves move together', () => {
    expect(LISTENING_PROFILES.on.autoListenEnabled).toBe(true);
    expect(LISTENING_PROFILES.on.continuousConversationMode).toBe(true);
    expect(LISTENING_PROFILES.off.autoListenEnabled).toBe(false);
    expect(LISTENING_PROFILES.off.continuousConversationMode).toBe(false);
  });

  it('Settings renders the two controls and none of the seven it replaced', () => {
    const s = code('app/settings.tsx');
    expect(s).toContain('applyPresence');
    expect(s).toContain('applyListening');
    // the retired rows
    expect(s).not.toContain("t('settings.label.response_style')");
    expect(s).not.toContain("t('settings.label.local_mode')");
    expect(s).not.toContain("t('settings.label.interactive_round')");
    expect(s).not.toContain("t('settings.label.continuous_conversation')");
    expect(s).not.toContain("t('settings.label.active_listening')");
    expect(s).not.toMatch(/label=\{`Proactive \$\{caddieName\}`\}/);
    // and the screen must not write the flags behind the owner's back
    expect(s).not.toMatch(/onValueChange=\{confirmToggle\('Local Mode'/);
    expect(s).not.toMatch(/onSelect=\{\(v\) => setResponseMode\(/);
  });
});

/**
 * 2026-09-13 — ONE EDITABLE HANDICAP.
 *
 * `handicap` (integer) mirrors `handicap_index`: setHandicapIndex has written both since
 * 2026-05-16. But setHandicap wrote only the integer, and Settings offered a second text box wired
 * to it — so typing in "Handicap" left the Index stale for good. The caddie payload sends
 * `handicap`; posting, the recap card and setup gaps read `handicap_index`. That is the divergence
 * landing somewhere it matters.
 */
describe('handicap has one editable owner', () => {
  it('setHandicap can no longer desync the pair', () => {
    expect(code('store/playerProfileStore.ts'))
      .toMatch(/setHandicap:\s*\(hcp\)\s*=>\s*set\(\{\s*handicap:\s*hcp,\s*handicap_index:\s*hcp\s*\}\)/);
  });

  it('Settings has no second handicap box wired to the mirror', () => {
    const s = code('app/settings.tsx');
    expect(s).not.toContain('editHandicap');
    expect(s).not.toMatch(/setHandicap\(/);
  });

  it('onboarding states an INDEX, so a first-run player is not left with a null one', () => {
    const w = code('app/welcome.tsx');
    expect(w).toMatch(/setHandicapIndex\(hcp\)/);
    expect(w).not.toMatch(/setHandicap\(hcp\)/);
  });
});
