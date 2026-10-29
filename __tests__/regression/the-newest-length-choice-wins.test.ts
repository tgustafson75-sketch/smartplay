/**
 * 2026-10-28 (Brain recheck R7) — THE NEWEST LENGTH CHOICE WINS, SPOKEN OR PICKED.
 *
 * "Tell me more about that layup" on any route matched the FULLER list, saved a learned 'full' with no
 * expiry, and effectiveResponseMode returned it whenever one existed. So a player who then picked the
 * Quiet presence (responseMode 'short') kept getting 'detailed' on every route, and the picker gave no
 * hint why. The reverse held too: one "just give me the number" outranked a later Detailed.
 *
 * BEHAVIOURAL: the real caddieStyle learner, the real presence applier and settingsStore, and the real
 * payload builder every route goes through.
 */
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useSettingsStore } from '../../store/settingsStore';
import { applyPresence } from '../../services/caddiePresence';
import * as cs from '../../services/caddieStyle';

const realNow = Date.now;
let clock = 1_800_000_000_000;
const sent = () => buildCaddieRequestBody({ message: 'what club here?', language: 'en' }).responseMode;
/** What askCaddie hands the learner: the player's words and where he currently stands. */
const say = (words: string) => {
  clock += 60_000;
  const st = useSettingsStore.getState();
  return cs.noteUtterance(words, { mode: st.responseMode, at: st.responseModeSetAt });
};
const pick = (p: Parameters<typeof applyPresence>[0]) => { clock += 60_000; applyPresence(p); };

beforeEach(async () => {
  Date.now = () => clock;
  await cs.saveLearnedStyle(null);
  pick('balanced');
});
afterEach(() => { Date.now = realNow; });

describe('a spoken hint and a picked setting: the later one wins', () => {
  it('THE BUG: a learned "longer" does not outrank Quiet picked afterwards', async () => {
    // A hint seeded directly, as the pre-fix learner saved one from "tell me more about that layup".
    clock += 60_000;
    await cs.saveLearnedStyle({ style: 'full', at: clock, heard: 'tell me more about that layup' });
    expect(sent()).toBe('detailed');
    pick('quiet');
    expect(sent()).toBe('short');
  });

  it('THE BUG, reversed: a learned "brief" does not outrank Talkative picked afterwards', async () => {
    await say('keep it short');
    expect(sent()).toBe('short');
    pick('talkative');
    expect(sent()).toBe('detailed');
  });

  it('a hint he says AFTER picking still takes over, one step from where he actually is', async () => {
    pick('quiet');
    await say('give me longer answers');
    // From Quiet's short, one step up — not from a stale learned style the pick replaced.
    expect(sent()).toBe('neutral');
  });

  it('the settings card stops quoting a hint a later pick replaced', async () => {
    await say('keep it short');
    const learned = await cs.loadLearnedStyle();
    expect(cs.describeLearnedStyle(learned, useSettingsStore.getState().responseModeSetAt)).toContain('keep it short');
    pick('talkative');
    expect(cs.describeLearnedStyle(learned, useSettingsStore.getState().responseModeSetAt)).toBeNull();
  });

  it('the moment of the choice survives a restart (it is persisted with the choice)', () => {
    pick('quiet');
    const persisted = useSettingsStore.persist.getOptions().partialize!(useSettingsStore.getState()) as {
      responseMode?: string; responseModeSetAt?: number;
    };
    expect(persisted.responseMode).toBe('short');
    expect(persisted.responseModeSetAt).toBe(clock);
  });
});

describe('a question about one thing is not a lasting style', () => {
  it.each([
    ['tell me more about that layup', 'quiet', 'short'],
    ['walk me through this putt', 'quiet', 'short'],
    ['can you elaborate', 'quiet', 'short'],
    ['more detail on the wind please', 'quiet', 'short'],
    ['just give me the number', 'talkative', 'detailed'],
  ] as const)('"%s" leaves %s where he set it', async (words, preset, mode) => {
    pick(preset);
    expect(await say(words)).toBeNull();
    expect(sent()).toBe(mode);
  });
});
