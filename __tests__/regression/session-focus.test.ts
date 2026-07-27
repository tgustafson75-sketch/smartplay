/**
 * Session focus (Tim, 2026-07-27). State what you're working on this session → the caddie holds it and
 * orients around it. Guards: it persists as an active focus, EXPIRES after its TTL (no stale ghost days
 * later), feeds a brain-prompt line, and the intent handler sets/clears/validates it.
 */
import { useSessionFocusStore, sessionFocusPromptLine } from '../../store/sessionFocusStore';
import { sessionFocusHandler } from '../../services/intents/sessionFocusHandler';
import type { VoiceIntent } from '../../types/voiceIntent';

const T0 = 1_000_000_000_000;
const intent = (parameters: Record<string, unknown>): VoiceIntent => ({
  intent_type: 'set_session_focus', parameters, confidence: 'high', follow_up_question: null, raw_text: '',
});

beforeEach(() => useSessionFocusStore.getState().clearFocus());

describe('sessionFocusStore', () => {
  it('holds an active focus and exposes it to the brain prompt', () => {
    useSessionFocusStore.getState().setFocus('my slice', { context: 'range', now: T0 });
    const f = useSessionFocusStore.getState().activeFocus(T0 + 1000);
    expect(f?.goal).toBe('my slice');
    expect(f?.context).toBe('range');
    const line = sessionFocusPromptLine(T0 + 1000);
    expect(line).toContain('SESSION FOCUS');
    expect(line).toContain('my slice');
    expect(line).toContain('at the range');
  });

  it('auto-expires a stale focus (no ghost driving the caddie tomorrow)', () => {
    useSessionFocusStore.getState().setFocus('tempo', { now: T0 });
    const NINE_HOURS = 9 * 60 * 60 * 1000;
    expect(useSessionFocusStore.getState().activeFocus(T0 + NINE_HOURS)).toBeNull();
    expect(sessionFocusPromptLine(T0 + NINE_HOURS)).toBeNull();
    // reading a stale focus clears it
    expect(useSessionFocusStore.getState().focus).toBeNull();
  });

  it('clearFocus + empty goal are no-ops for the prompt', () => {
    useSessionFocusStore.getState().setFocus('   ', { now: T0 }); // blank → ignored
    expect(useSessionFocusStore.getState().focus).toBeNull();
    useSessionFocusStore.getState().setFocus('chipping', { now: T0 });
    useSessionFocusStore.getState().clearFocus();
    expect(sessionFocusPromptLine(T0)).toBeNull();
  });
});

describe('sessionFocusHandler', () => {
  it('sets a focus from a natural goal', async () => {
    const r = await sessionFocusHandler.execute(intent({ goal: 'my slice', context: 'range' }), {} as never);
    expect(r.success).toBe(true);
    expect(r.side_effects).toContain('session_focus:set');
    expect(useSessionFocusStore.getState().activeFocus()?.goal).toBe('my slice');
  });

  it('clears on clear:true', async () => {
    useSessionFocusStore.getState().setFocus('tempo');
    const r = await sessionFocusHandler.execute(intent({ clear: true }), {} as never);
    expect(r.success).toBe(true);
    expect(r.side_effects).toContain('session_focus:cleared');
    expect(useSessionFocusStore.getState().focus).toBeNull();
  });

  it('asks a follow-up when no goal is given', async () => {
    const r = await sessionFocusHandler.execute(intent({}), {} as never);
    expect(r.success).toBe(false);
    expect(r.follow_up_needed).toBe(true);
    expect(useSessionFocusStore.getState().focus).toBeNull();
  });
});
