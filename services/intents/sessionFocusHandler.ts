/**
 * 2026-07-27 — Session-focus intent (Tim).
 *
 * "I'm at the range, I want to work on my slice today" / "let's dial in tempo this session" → capture a
 * durable session focus the caddie holds + orients around (see store/sessionFocusStore + the injection
 * in caddieMemoryRetrieval). "Forget the focus, let's just hit" → clear it. The brain also drops it
 * naturally when the player clearly moves on (prompt-side), so this is the EXPLICIT set/clear path.
 */
import type { IntentHandler, IntentResult, VoiceIntent } from '../../types/voiceIntent';
import { useSessionFocusStore } from '../../store/sessionFocusStore';
import { parsePlanPeriodDays, saysToday } from '../practice/planFocus';
import { applyPlanFocusWords } from '../../store/practicePlanStore';

export const sessionFocusHandler: IntentHandler = {
  intent_type: 'set_session_focus',

  parameter_schema: {
    goal: 'what the player wants to work on this session, in their words ("my slice", "tempo")',
    note: 'optional extra detail ("staying in posture")',
    context: "'range' | 'course' | 'practice' when known",
    clear: 'true when the player wants to END the focus (no set goal)',
  },

  examples: [
    "I'm at the range, I want to work on my slice today",
    "let's focus on my tempo this session",
    "today we're dialing in my chipping",
    "forget the focus, let's just hit some balls",
  ],

  async execute(intent: VoiceIntent): Promise<IntentResult> {
    const p = (intent.parameters ?? {}) as { goal?: unknown; note?: unknown; context?: unknown; clear?: unknown };

    if (p.clear === true) {
      useSessionFocusStore.getState().clearFocus();
      return {
        success: true,
        voice_response: "Got it — no set focus, we'll take it as it comes.",
        side_effects: ['session_focus:cleared'],
        follow_up_needed: false,
      };
    }

    const goal = typeof p.goal === 'string' ? p.goal.trim() : '';
    if (!goal) {
      return {
        success: false,
        voice_response: 'What do you want to zero in on this session?',
        side_effects: ['session_focus:empty'],
        follow_up_needed: true,
      };
    }

    const context = p.context === 'range' || p.context === 'course' || p.context === 'practice' ? p.context : null;
    const note = typeof p.note === 'string' && p.note.trim() ? p.note.trim() : null;

    /**
     * 2026-10-01 (Tim — "if I say I want to work on my irons this week, that checks against the
     * SmartPlan, updates"). This handler said "Locked in — we're working on my irons THIS SESSION" to
     * "this week", and the 8-hour session focus was gone by morning while the plan never moved.
     *
     * A stretch of days is a PLAN change: apply it to the SmartPlan, then let the caddie answer — he
     * sees the updated plan and can say what it changed, which no fixed line here can. Words that
     * name no plan focus ("my slice this week") go to him too; he keeps them as a reminder or asks.
     */
    const said = [intent.raw_text, goal, note].filter((x) => typeof x === 'string' && x.trim()).join(' ');
    const periodDays = saysToday(said) ? null : parsePlanPeriodDays(said);
    if (periodDays != null) {
      const keys = applyPlanFocusWords(goal, periodDays);
      // success:false + route_to_brain is the "answer this conversationally" shape every path honours:
      // listeningSession checks route_to_brain first; the on-screen mic falls through to the brain on
      // a non-success with no follow-up (hooks/useVoiceCaddie isCommandHit).
      return {
        success: false,
        voice_response: null,
        side_effects: [keys.length > 0 ? `plan_focus:set:${keys.join('+')}` : 'plan_focus:unresolved'],
        follow_up_needed: false,
        route_to_brain: true,
      };
    }
    useSessionFocusStore.getState().setFocus(goal, { note, context });

    return {
      success: true,
      voice_response: `Locked in — we're working on ${goal} this session. I'll keep everything pointed at that.`,
      side_effects: ['session_focus:set'],
      follow_up_needed: false,
    };
  },
};
