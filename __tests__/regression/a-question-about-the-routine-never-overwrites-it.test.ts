/**
 * 2026-10-28 (Brain review r4) — A SENTENCE ABOUT THE ROUTINE NEVER OVERWRITES IT.
 *
 * routine_save REPLACES the stored pre-round routine with the caddie's last line, and the precheck
 * dispatches it before the caddie hears anything. Its regex was "save / remember / keep near my
 * routine", with no question or story guard (a query_status topic is outside ACTING_INTENTS), so
 * "Do you remember my warm-up routine?" overwrote the routine with whatever Kevin said last and
 * answered "Saved. That's your routine now". routine_recall read the stored text back over "What
 * should I add to my warm-up?". The brain-failure mirror (localStatusResponder) had the same hole,
 * with an even looser regex.
 *
 * BEHAVIOURAL: the real precheck, the real queryStatusHandler it dispatches to, and the real offline
 * mirror, against the real profile and conversation-log stores.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { queryStatusHandler } from '../../services/intents/queryStatusHandler';
import { tryLocalReply } from '../../services/localStatusResponder';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useConversationLog } from '../../store/conversationLogStore';
import type { AppContext } from '../../types/voiceIntent';

const SAVED = 'Hamstrings 30s, hips 30s, ten easy wedges.';
const KEVIN_LAST = 'Smooth tempo on this one, middle of the green.';

beforeEach(() => {
  usePlayerProfileStore.getState().setPreRoundRoutine(SAVED);
  useConversationLog.getState().clear();
  useConversationLog.getState().logCaddie(KEVIN_LAST, Date.now());
});

/** Every route: precheck → handler when it claims the turn, and the offline mirror. */
async function sayIt(u: string): Promise<{ intent: string; topic: string | null }> {
  const hit = precheckLocalIntent(u);
  if (hit?.intent_type === 'query_status') {
    await queryStatusHandler.execute(hit, { current_hole: 1 } as unknown as AppContext);
  }
  tryLocalReply(u, 'en');
  return { intent: hit?.intent_type ?? 'null', topic: (hit?.parameters?.query_topic as string | undefined) ?? null };
}

describe('a question or story about the routine reaches the caddie and leaves the routine alone', () => {
  it.each([
    'Do you remember my warm-up routine?',
    'I want to keep my warm-up short today',
    'Remember my stretches hurt my back last time',
    'Can you remember my warm-up?',
  ])('"%s"', async (u) => {
    const r = await sayIt(u);
    expect(r.topic).not.toBe('routine_save');
    expect(usePlayerProfileStore.getState().preRoundRoutine).toBe(SAVED);
  });

  it.each([
    'What should I add to my warm-up?',
    'Tell me why my routine keeps falling apart on the back nine',
  ])('"%s" is not answered with the stored routine', (u) => {
    const hit = precheckLocalIntent(u);
    expect(hit?.parameters?.query_topic).not.toBe('routine_recall');
    expect(hit?.intent_type).toBe('conversational');
    expect(tryLocalReply(u, 'en')?.queryType).not.toBe('routine_recall');
  });
});

describe('the bare orders still work, on both paths', () => {
  it.each([
    'save that routine',
    'Kevin, save that warm-up',
    'remember my stretches',
    'save those stretches as my routine',
    'can you save that routine',
    'save that as my pre-round routine for me',
  ])('"%s" saves the caddie\'s last line', async (u) => {
    expect(precheckLocalIntent(u)?.parameters?.query_topic).toBe('routine_save');
    await sayIt(u);
    expect(usePlayerProfileStore.getState().preRoundRoutine).toBe(KEVIN_LAST);
  });

  it.each([
    "what's my routine",
    'tell me my warm up',
    'run me through my routine',
    "What's my pre-round routine?",
  ])('"%s" reads the stored routine', (u) => {
    expect(precheckLocalIntent(u)?.parameters?.query_topic).toBe('routine_recall');
    expect(tryLocalReply(u, 'en')).toEqual({ text: SAVED, queryType: 'routine_recall' });
  });
});
