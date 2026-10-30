/**
 * 2026-10-29 (Brain recheck r12) — A COMPLAINT ABOUT THE ANSWERS, OR A PHRASE THAT MEANS SOMETHING
 * ELSE IN GOLF, IS NOT A REQUEST FOR SHORTER ONES.
 *
 * r10 split BRIEFER by what a phrase names, but two halves were still bare substrings. "You keep
 * giving me short answers", "your short answers are driving me nuts", "these short answers are
 * annoying" each matched 'short answers' with nothing in front to refuse it, so the complaint moved
 * him to 15 words. "We should wrap it up when you are done" matched 'wrap it up' because a "you"
 * sat in the same clause, though nobody was asking him for anything.
 *
 * FIX: "short answers" / "shorter answers" count only as a request frame ("give me", "I want", "from
 * now on"); "get to the point" and "wrap it up" count only when they are addressed to him (his name,
 * an imperative, or "you should/can ... wrap").
 *
 * BEHAVIOURAL: the real style detector and the real learner.
 */
import { detectStyleSignal } from '../../services/caddieStyle';

describe('a complaint about the answers is not a request for shorter ones', () => {
  it.each([
    'you keep giving me short answers',
    'your short answers are driving me nuts',
    'these short answers are annoying',
    'we should wrap it up when you are done',
    'let us wrap it up when you finish',
  ])('"%s" → null', (u) => {
    expect(detectStyleSignal(u)).toBeNull();
  });
});

describe('the requests and the addressed asks still move him', () => {
  it.each([
    ['give me short answers', 'briefer'],
    ['I want shorter answers', 'briefer'],
    ['short answers from now on', 'briefer'],
    ['Kevin wrap it up', 'briefer'],
    ['you should wrap it up now', 'briefer'],
    ['just get to the point', 'briefer'],
    ['Kevin, get to the point', 'briefer'],
    ['give me longer answers', 'fuller'],
  ])('"%s" → %s', (u, want) => {
    expect(detectStyleSignal(u)).toBe(want);
  });
});
