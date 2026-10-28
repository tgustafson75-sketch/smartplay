/**
 * 2026-10-27 (Brain review B8) — "SAVE THAT ROUTINE" IS NOT A HERO MOMENT; A QUESTION IS NOT A REEL OR A MUTE.
 *
 * On the avatar mic, after Kevin gave a warm-up, "save that routine" / "Kevin, save that warm-up"
 * matched HERO_PHRASES' "save that" as a phrase INSIDE the utterance. tabBypassKind returned 'hero'
 * before the router, the hook filed a clip-less hero moment and spoke the hero line, and the routine
 * — which the precheck's routine_save owns on the earbud and typed routes — was never saved.
 * hero_view and mute had no question guard: "what were my best shots today" opened the reel and
 * "is mute on" silently ended the turn.
 *
 * BEHAVIOURAL: the real tabBypassKind (useVoiceCaddie.checkBypasses switches on it) and the real
 * precheck, which is where the routine sentence must land once the bypass lets it through.
 */
import { tabBypassKind } from '../../services/tabVoiceBypass';
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const inRound = { isRoundActive: true, language: 'en' };

describe('the avatar-mic bypasses leave these to the caddie', () => {
  it.each([
    'save that routine',
    'Kevin, save that warm-up',
    'save that routine for me',
    'save that stretch routine',
    'save that drill',
  ])('"%s" is not a hero moment', (u) => {
    expect(tabBypassKind(u, inRound)).toBeNull();
  });

  it('and "save that routine" then reaches the routine save it was always meant for', () => {
    expect(tabBypassKind('save that routine', inRound)).toBeNull();
    const intent = precheckLocalIntent('save that routine') as { parameters?: { query_topic?: string } } | null;
    expect(intent?.parameters?.query_topic).toBe('routine_save');
  });

  it.each([
    'what were my best shots today',
    'did I hit my best shots today?',
  ])('the question "%s" does not open the hero reel', (u) => {
    expect(tabBypassKind(u, inRound)).not.toBe('hero_view');
  });

  it.each(['is mute on', 'is it on mute?', 'why did you go silence'])('the question "%s" does not mute', (u) => {
    expect(tabBypassKind(u, inRound)).not.toBe('mute');
  });
});

describe('the real commands still fire', () => {
  it.each([
    'save that',
    'Save that shot!',
    'Kevin, save that one',
    'save that one, Kevin',
    'Serena save that',
    'oh, save that',
    "that's a keeper",
    'did you get that',
    'save that please',
  ])('"%s" is a hero moment', (u) => {
    expect(tabBypassKind(u, inRound)).toBe('hero');
  });

  it.each(['show me my hero reel', 'show my best shots'])('"%s" opens the reel', (u) => {
    expect(tabBypassKind(u, inRound)).toBe('hero_view');
  });

  it.each(['mute', 'be quiet', 'stop talking'])('"%s" mutes', (u) => {
    expect(tabBypassKind(u, inRound)).toBe('mute');
  });
});
