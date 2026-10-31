/**
 * 2026-10-31 (Brain recheck r21, BRAIN-R21-2) — A COMMAND THE BRAIN CANNOT CARRY IS ROUTED IN THE FOLLOW-UP LOOP TOO.
 *
 * R20-3 routed "undo that", "end the round" and "I had three putts" past the answering-turn bypass, but only on the
 * FIRST turn. The caddie-tab follow-up loop (processFollowUp) never called the router, so the same words, said in
 * answer to a Kevin question, went to /api/kevin as prose and nothing was written to the card.
 *
 * BEHAVIOURAL: the predicate that decides the router owns a turn (services/voice/routedCommandHit) and the
 * brain-blind predicate. STRUCTURAL: the hook's follow-up loop routes a brain-blind command before it sends to the brain
 * (the hook cannot load under jest).
 */
import { routedCommandHit } from '../../services/voice/routedCommandHit';
import { isBrainBlindCommand } from '../../services/brainBlindCommand';
import type { IntentResult, VoiceIntent } from '../../types/voiceIntent';

const root = require('path').join(__dirname, '..', '..');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const intent = (intent_type: string, confidence: 'high' | 'medium' | 'low' = 'high'): VoiceIntent =>
  ({ intent_type, confidence, parameters: {}, raw_text: '' }) as unknown as VoiceIntent;
const result = (over: Partial<IntentResult> = {}): IntentResult => ({
  success: true, voice_response: 'Done.', side_effects: [], follow_up_needed: false, ...over,
});

describe('the router owns a brain-blind command on the follow-up loop as on the first turn', () => {
  it.each(['I had three putts', 'undo that', 'end the round'])('"%s" is brain-blind', (said) => {
    expect(isBrainBlindCommand(said)).toBe(true);
  });

  it('a hit with a result the router can speak is routed', () => {
    expect(routedCommandHit(intent('undo'), result())).toBe(true);
    expect(routedCommandHit(intent('log_putts'), result({ follow_up_needed: true }))).toBe(true);
  });

  it('a conversational, unknown or low-confidence intent is not routed, so the brain answers it', () => {
    expect(routedCommandHit(intent('conversational'), result())).toBe(false);
    expect(routedCommandHit(intent('unknown'), result())).toBe(false);
    expect(routedCommandHit(intent('undo', 'low'), result())).toBe(false);
    expect(routedCommandHit(intent('undo'), result({ success: false }))).toBe(false);
  });

  it('a disruptive open needs high confidence to fire from the router', () => {
    const open = result({ tool_action: { type: 'navigate' } as never });
    expect(routedCommandHit(intent('navigate', 'medium'), open)).toBe(false);
    expect(routedCommandHit(intent('navigate', 'high'), open)).toBe(true);
  });
});

describe('the follow-up loop routes a brain-blind command before it sends the turn to the brain', () => {
  const hook = code(require('fs').readFileSync(require('path').join(root, 'hooks/useVoiceCaddie.ts'), 'utf8'));

  it('isBrainBlindCommand → voiceCommandRouter.route → routedCommandHit → sendToBrain, in that order', () => {
    const gate = hook.indexOf('if (isBrainBlindCommand(trimmed)) {');
    const route = hook.indexOf('voiceCommandRouter.route(trimmed, buildAppContextRef.current(), apiUrl)', gate);
    const hit = hook.indexOf('routedCommandHit(routed.intent, routed.result)', route);
    const brain = hook.indexOf('const reply = await sendToBrain(trimmed);');
    expect(gate).toBeGreaterThan(0);
    expect(route).toBeGreaterThan(gate);
    expect(hit).toBeGreaterThan(route);
    expect(brain).toBeGreaterThan(hit);
  });
});
