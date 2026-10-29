/**
 * 2026-10-28 (Brain recheck r10) — A COMPLAINT ABOUT SHORT ANSWERS IS NOT A REQUEST FOR THEM.
 *
 * BRIEFER was a plain substring list, so "Stop giving me short answers", "Why are you giving me short
 * answers today", "I don't need less detail, I need more", "How do I get to the point where I can
 * break 80?", "Let's wrap it up, it's getting dark" and "My buddy is talking too much on the tee" each
 * moved the learned style one step toward brief and saved it — and 'short' tells /api/kevin "Maximum
 * 15 words." A player who complained about short answers got shorter ones on every later turn, and the
 * boot cleanup (stillASignal) kept the entry because the same matcher still heard it.
 *
 * BEHAVIOURAL: the real learner, the real AsyncStorage memory, and the real payload builder every
 * route goes through.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useSettingsStore } from '../../store/settingsStore';
import * as cs from '../../services/caddieStyle';

const KEY = '@smartplay/caddie_style';
const NOT_ASKS = [
  'Stop giving me short answers',
  'Why are you giving me short answers today',
  "I don't need less detail, I need more",
  'How do I get to the point where I can break 80?',
  "Let's wrap it up, it's getting dark",
  'My buddy is talking too much on the tee',
  "You're not talking too much",
  "I don't need longer answers",
];

beforeEach(async () => {
  await cs.saveLearnedStyle(null);
  useSettingsStore.setState({ responseMode: 'neutral', responseModeSetAt: 0 } as never);
});

describe('a refusal, a goal, the round or someone else is not a style signal', () => {
  it.each(NOT_ASKS)('"%s" → null', (u) => {
    expect(cs.detectStyleSignal(u)).toBeNull();
  });

  it('THE BUG: complaining about short answers does not put him on 15 words', async () => {
    expect(await cs.noteUtterance('Stop giving me short answers', { mode: 'neutral', at: 0 })).toBeNull();
    expect(buildCaddieRequestBody({ message: 'what club here?', language: 'en' }).responseMode).toBe('neutral'); // pre-fix: 'short'
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('a brief style an old build learned from a complaint is forgotten at boot', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ style: 'brief', at: 1_790_000_000_000, heard: "Let's wrap it up, it's getting dark" }));
    await cs.primeStyleCache();
    expect(cs.learnedStyleSync()).toBeNull();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });
});

describe('the real asks still move him', () => {
  it.each([
    ["You're talking too much", 'briefer'],
    ['Kevin, get to the point', 'briefer'],
    ['Kevin wrap it up', 'briefer'],
    ["why don't you keep it short", 'briefer'],
    ['why are you so long winded', 'briefer'],
    ['you always talk too much', 'briefer'],
    ["listen, I don't wanna talk this much, let's be more brief, let's get to the point", 'briefer'],
    ['stop explaining', 'briefer'],
    ["I don’t need the explanation", 'briefer'],
    ["you're too brief", 'fuller'],
    ['stop being so brief', 'fuller'],
    ['longer answers please', 'fuller'],
  ])('"%s" → %s', (u, want) => {
    expect(cs.detectStyleSignal(u)).toBe(want);
  });
});
