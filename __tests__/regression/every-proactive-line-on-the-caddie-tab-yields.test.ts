/**
 * 2026-09-29 (review) — EVERY UNPROMPTED LINE ON THE CADDIE TAB ASKS THE SAME QUESTION AFTER ITS AWAIT.
 *
 * speakProactiveTrigger had it (busy channel, or the tab mid-turn → stay silent; reset only OUR
 * 'proactive'). Three other voices on the same screen did not:
 *   - the stop read and the tee brief awaited engine.analyze and then spoke unconditionally, and reset
 *     the screen with a bare setVoiceState('idle') — clobbering the 'thinking' / 'listening' of a turn
 *     the player started meanwhile (so the answer's avatar went idle, and VAD re-armed under it);
 *   - the app-open opener checked only speaker/mic, not "a turn is still being answered".
 * And voiceChannelBusy itself missed typed / watch turns: handleTranscribedUtterance sets the
 * listening store to 'thinking' without ever raising sessionInFlight.
 *
 * WHY SOURCE-SHAPE AND NOT BEHAVIOUR: these live inside the 5,000-line CaddieTab component (GPS,
 * round store, avatar, VAD); they cannot be driven without rendering the whole tab. The behaviour
 * halves that CAN be driven are tested for real: the brain's commit contract
 * (the-first-ask-after-launch), the hook's superseded reset
 * (a-superseded-reply-does-not-leave-the-tab-thinking), the persona intro
 * (the-persona-intro-yields-to-the-player). Comments are stripped so prose cannot satisfy a pin.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '../../app/(tabs)/caddie.tsx');
const tab = fs.readFileSync(SRC, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The code between an anchor and the next `setVoiceState('proactive')` after it. */
const windowsAfter = (anchor: string): string[] => {
  const out: string[] = [];
  let i = tab.indexOf(anchor);
  while (i !== -1) {
    const end = tab.indexOf("setVoiceState('proactive')", i);
    out.push(tab.slice(i, end === -1 ? i + 2000 : end));
    i = tab.indexOf(anchor, i + anchor.length);
  }
  return out;
};

describe('the Caddie tab never starts an unprompted line on a turn it cannot see', () => {
  it('a typed / watch turn (listening store not idle) counts as busy', () => {
    expect(tab).toMatch(/function voiceChannelBusy\(\): boolean \{\s*return [^;]*useListeningSessionStore\.getState\(\)\.state !== 'idle'/);
  });

  it('THE BUG: the stop read and the tee brief re-check after the analyze await', () => {
    const wins = windowsAfter("engine.analyze({ kind: 'shot_strategy' })");
    expect(wins.length).toBe(2);
    for (const w of wins) expect(w).toMatch(/if \(voiceChannelBusy\(\) \|\| tabTurnActive\(voiceStateRef\.current\)\) return;/);
  });

  it('THE BUG: no proactive voice resets the screen to idle unconditionally', () => {
    expect(tab).not.toMatch(/\.finally\(\(\) => setVoiceState\('idle'\)\)/);
    expect(tab).not.toMatch(/setTimeout\(\(\) => setVoiceState\('idle'\), 3000\)/);
  });

  it('the app-open opener asks the same busy + tab-state question, and seeds history only when it speaks', () => {
    const at = tab.indexOf('await generateProactiveOpener(');
    expect(at).toBeGreaterThan(-1);
    const body = tab.slice(at, at + 2500);
    expect(body).toMatch(/if \(r\.text && \(voiceChannelBusy\(\) \|\| tabTurnActive\(voiceStateRef\.current\)\)\)/);
    const commit = body.indexOf('r.commit?.()');
    expect(commit).toBeGreaterThan(-1);
    expect(commit).toBeLessThan(body.indexOf('speakFromBase64('));
  });

  it('proactive triggers and the interview opener commit only after their busy check', () => {
    const trig = tab.slice(tab.indexOf('async function speakProactiveTrigger('));
    expect(trig.indexOf('composed.commit()')).toBeGreaterThan(trig.indexOf("console.log('[caddie] proactive line dropped"));
    const iv = tab.slice(tab.indexOf('OPENER_FALLBACK,'));
    expect(iv.indexOf('opener.commit()')).toBeGreaterThan(iv.indexOf("s0 === 'arming') return;"));
  });
});
