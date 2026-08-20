/**
 * Recording how the player is actually doing.
 *
 * 2026-08-20 (QA sweep). log_emotional_state is the tool the prompt itself calls "the core of the
 * app", and it fired almost never. Probed live:
 *   "I am so damn frustrated, I have topped three in a row" → warm reply, tools: []
 *   "I am really pissed off right now"                      → warm reply, tools: []
 *   "honestly I feel great today, everything is clicking"   → warm reply, tools: []
 * Same root cause as recommend_club: on the 'fast' tier the empathetic answer IS the whole turn and
 * no tool_calls come with it. Emotional tracking that records only when the model feels like it is
 * not tracking.
 */
import { detectEmotionalState } from '../../api/_brain';

describe('the utterances that were silently lost', () => {
  it.each([
    ['I am so damn frustrated, I have topped three in a row', 'frustrated', 'negative'],
    ['I am really pissed off right now',                      'frustrated', 'negative'],
    ['honestly I feel great today, everything is clicking',   'confident',  'positive'],
    ["I can't hit a fairway to save my life",                 'frustrated', 'negative'],
    ["I'm so nervous on this tee shot",                       'anxious',    'negative'],
    ["I give up, this is hopeless",                           'resigned',   'negative'],
  ])('%s → %s/%s', (text, state, valence) => {
    expect(detectEmotionalState(text)).toEqual({ state, valence });
  });
});

describe('resignation outranks frustration when both are present', () => {
  it('records the more specific end state', () => {
    // "I'm done with this" also trips frustration cues; resigned is the more useful note to keep.
    expect(detectEmotionalState("I'm done with this, nothing is working")?.state).toBe('resigned');
  });
});

describe('does not invent a mood', () => {
  it.each([
    ['what club should I hit here',                'a plain question'],
    ['how far is the pin',                         'a distance question'],
    ['the wind is brutal on this hole',            'weather, not self-report'],
    ['par 4, 380 yards',                           'facts'],
    ['log a 5 for this hole',                      'a command'],
    ['',                                           'empty'],
  ])('stays silent on: %s (%s)', (text) => {
    expect(detectEmotionalState(text)).toBeNull();
  });

  it('ignores a question even when it contains a charged word', () => {
    // Asking ABOUT frustration is not being frustrated.
    expect(detectEmotionalState('Do you ever get frustrated caddying?')).toBeNull();
  });

  it('requires the player to be talking about themselves', () => {
    expect(detectEmotionalState('Tiger looked frustrated on that hole')).toBeNull();
  });
});
