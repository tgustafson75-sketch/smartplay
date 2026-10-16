/**
 * 2026-10-15 (review) — THE ON-SCREEN MIC'S BYPASSES DO NOT ANSWER QUESTIONS.
 *
 * hooks/useVoiceCaddie checks these before the brain. The 6-word cap kept long sentences out but not
 * questions, so on the pre-fix lists:
 *
 *   "Is that out of bounds?" / "Is that a penalty?" / "Do I take a drop?" / "I lost it right"
 *        → a penalty stroke added to the card
 *   "How far to the bunker?" / "How far is the carry?" / "How far to clear the creek?"
 *        → "You're 152 yards to the center." — the wrong question answered
 *   "What do you see here?" → SmartVision opened
 *
 * BEHAVIOURAL: the real tabBypassKind (the hook's checkBypasses switches on it) with the real lists.
 */
import { tabBypassKind } from '../../services/tabVoiceBypass';

const inRound = { isRoundActive: true, language: 'en' };

describe('questions and stories reach the caddie', () => {
  it.each([
    'Is that out of bounds?',
    'Is that a penalty?',
    'Do I take a drop?',
    'I lost it right',
    'Is that a penalty stroke?',
    'How far to the bunker?',
    'How far is the carry?',
    'How far to clear the creek?',
    'How far to the water?',
    'What do you see here?',
    'Can you see the hole?',
  ])('"%s" → no bypass', (t) => {
    expect(tabBypassKind(t, inRound)).toBeNull();
  });
});

describe('real commands keep working', () => {
  it.each([
    ['add a penalty', 'penalty'],
    ['penalty stroke', 'penalty'],
    ['penalty', 'penalty'],
    ['how far', 'yardage'],
    ['How far?', 'yardage'],
    ["what's my yardage", 'yardage'],
    ['yardage', 'yardage'],
    ['smart vision', 'vision'],
    ['analyze the hole', 'vision'],
    ['save that shot', 'hero'],
    ['did you get that', 'hero'],
    ['show me my best shots', 'hero_view'],
    ['be quiet', 'mute'],
    ['mute', 'mute'],
  ])('"%s" → %s', (t, kind) => {
    expect(tabBypassKind(t, inRound)).toBe(kind);
  });

  it('a penalty is never added off a round, and the yardage shortcut stays English-only', () => {
    expect(tabBypassKind('add a penalty', { isRoundActive: false, language: 'en' })).toBeNull();
    expect(tabBypassKind('how far', { isRoundActive: true, language: 'es' })).toBeNull();
  });
});
