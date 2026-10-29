/**
 * 2026-05-26 — Fix BR: in-round diagnostic intent handler.
 *
 * The voice-intent classifier emits `in_round_diagnostic` when the
 * user describes a multi-shot pattern AND asks WHY ("irons fine but
 * driver going right hard, why?"). Without a registered handler the
 * dispatcher previously returned the canned "I can't do that yet"
 * — even though the brain endpoint already has a coach-diagnostic
 * mode that's exactly what this intent wants.
 *
 * This handler bridges the gap: forwards the pattern + intent flag
 * to /api/kevin with `register: 'coach'` + `inRoundDiagnostic: true`
 * so kevin.ts:
 *   - Forces tier = CONVERSATIONAL (Sonnet) for reasoning
 *   - Injects the in-round diagnostic system prompt block
 *   - Returns a multi-sentence coaching reply (vs the tight tactical
 *     2-sentence default)
 *
 * Returns the brain's reply as voice_response so the caller speaks
 * it through the normal TTS pipeline.
 *
 * wants_card (visual display) opens app/diagnostic-card with the read —
 * on every route since 2026-10-28 (it was the earbud twin's alone).
 */

import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { askCaddie, type NoAnswerReason } from '../caddieBrain';
import { isEndpointWarmed } from '../apiBase';
import { BRAIN_FETCH_TIMEOUT_MS, COLD_BRAIN_FETCH_TIMEOUT_MS } from '../../constants/voiceTimeouts';

/**
 * 2026-08-23 — the module-level `const apiUrl = getApiBaseUrl()` that used to live here is gone with
 * the hand-built fetch. It was frozen at module load, so after a mid-session dual-host failover this
 * handler would have kept calling the dead host forever — the identical bug that was found and fixed
 * in useKevin on 07-07 and never looked for here. askCaddie reads the live host at call time.
 */

/**
 * 2026-07-25 — Evidence-order gate (Tank doctrine, folded into the caddie brain KB as
 * contact.diagnose-evidence-order / contact.diagnose-ask-one). A real caddie reads the
 * evidence before blaming the swing — lie → ball flight → strike → where the grass first
 * got cut → setup → motion — and when a piece is missing, asks the ONE most useful question
 * instead of guessing at mechanics. This runs BEFORE the cloud brain: it's deterministic +
 * OFFLINE (works during a signal drought, exactly when a golfer wants a quick read), and it
 * keeps the diagnostic from firing a confident-but-blind answer off a vague "why'd that
 * happen". When the utterance already carries real evidence, we skip straight to the brain.
 */
interface DiagEvidence {
  hasDirection: boolean; // start line / curve / a named shape (the ball flight)
  hasStrike: boolean;    // heel/toe/fat/thin/flush — where it hit the face / ground
  hasLie: boolean;       // rough/bunker/uphill/tee — what shot was possible
  isMishitWord: boolean; // chunk/fat/thin/top — implies a low-point question is most useful
}
export function assessDiagnosticEvidence(text: string): DiagEvidence {
  const t = text.toLowerCase();
  return {
    hasDirection: /\b(left|right|slic\w*|hook\w*|pull\w*|push\w*|fade[ds]?|draw[ns]?|straight|started?\s+(?:left|right|out)|way\s+(?:left|right)|curv\w*|start\s*line)\b/.test(t),
    hasStrike: /\b(fat|thin|chunk\w*|top\w*|blad\w*|heel|toe|flush\w*|pure[ds]?|caught\s+it\s+(?:thin|heavy|fat)|behind\s+(?:it|the\s+ball)|off\s+the\s+(?:heel|toe))\b/.test(t),
    hasLie: /\b(rough|fairway|bunker|sand|hardpan|uphill|downhill|sidehill|tee\s*box|off\s+the\s+tee|deep\s+grass|buried|divot|bare\s+lie|wet)\b/.test(t),
    isMishitWord: /\b(chunk\w*|fat|thin|top\w*|blad\w*|shank\w*|duff\w*|skull\w*|behind\s+(?:it|the\s+ball))\b/.test(t),
  };
}
/** The single most-useful question when the evidence is too thin to diagnose honestly, or
 *  null when there's enough to hand to the brain. Follows Tank's order: a low-point/grass
 *  question when a mishit is named but the ball-flight isn't; otherwise the ball-flight. */
export function evidenceGateQuestion(ev: DiagEvidence): string | null {
  // Enough concrete evidence (a ball flight, plus at least one of strike/lie) → let the brain reason.
  if (ev.hasDirection && (ev.hasStrike || ev.hasLie)) return null;
  // A named mishit but no ball-flight → the low point is what tells the story (Tank's signature).
  if (ev.isMishitWord && !ev.hasDirection) {
    return "Before I go blaming the swing — where'd the grass first get cut, before the ball or right at it? And what was the lie?";
  }
  // Vague ("why'd that happen", "what's wrong") with no flight and no strike → ask the ball flight.
  if (!ev.hasDirection && !ev.hasStrike) {
    return "Let's read the evidence first — which way did it go? Did it start left or right, and which way did it curve?";
  }
  return null;
}
/** Short doctrine hint threaded to the brain so the cloud read follows the same order. */
const EVIDENCE_ORDER_HINT =
  'Diagnose in evidence order before mechanics: lie → ball flight (start + curve) → strike → where the grass first got cut → setup → motion. Give one cause + one fix, not a rebuild.';

export const inRoundDiagnosticHandler: IntentHandler = {
  intent_type: 'in_round_diagnostic',
  parameter_schema: {
    pattern_text: 'verbatim summary of the pattern the user described',
    wants_card: 'optional bool — true for visual card, default false (voice response)',
  },
  examples: [
    "irons flushing but driver going right hard, what's wrong",
    'why am I slicing my long clubs but my wedges are fine',
    "what's going on with my swing today",
  ],
  execute: async (intent: VoiceIntent, ctx: AppContext): Promise<IntentResult> => {
    const params = (intent.parameters ?? {}) as { pattern_text?: string; wants_card?: boolean };
    const patternText = typeof params.pattern_text === 'string' ? params.pattern_text.trim() : '';
    const wantsCard = params.wants_card === true;

    if (!patternText) {
      // Defensive: classifier should always emit pattern_text but if it
      // doesn't, fall through to the brain with the raw transcript.
      // Don't return a canned reply — that's the silent-failure path.
      return {
        success: false,
        voice_response: null,
        side_effects: ['in_round_diagnostic:no_pattern_text'],
        follow_up_needed: false,
      };
    }

    // 2026-07-25 — Evidence-order gate (OFFLINE-first). Assess what the golfer actually gave
    // us; if the ball flight / strike / lie is too thin to diagnose honestly, ask the ONE most
    // useful question instead of guessing. Uses both the classifier summary AND the raw text so
    // "why'd I chunk that" is caught even when pattern_text is terse.
    const evidence = assessDiagnosticEvidence(`${patternText} ${intent.raw_text ?? ''}`);
    const gateQuestion = evidenceGateQuestion(evidence);
    if (gateQuestion) {
      return {
        success: true,
        voice_response: gateQuestion,
        side_effects: ['in_round_diagnostic:evidence_gate'],
        follow_up_needed: true,
      };
    }

    try {
      /**
       * 2026-08-23 (Tim, sprint finish — "a single source of truth, a single path") — this was the
       * FIFTH hand-built payload to /api/kevin, and its own comment admitted the problem: "we can't
       * import sendToBrain here without dragging React deps, so this handler sends a minimal
       * envelope." So the one turn where the player asks WHY — "why am I slicing this" — went to the
       * brain thinner than any other, and every field added elsewhere since had to be remembered
       * here separately (persona, the intensity dial, the custom caddie's name, the CNS block: four
       * separate later fixes, each one catching up to a payload that had already fallen behind).
       *
       * services/caddieBrain has no React dependency, which is what makes it usable from a service
       * like this one. Same payload as every other surface; this path's two distinguishing flags
       * ride as overrides.
       */
      const live = await (async () => {
        try {
          const uv = require('../unifiedVisionContext') as typeof import('../unifiedVisionContext');
          return (await uv.getUnifiedVisionContext()).promptBlock;
        } catch { return null; }
      })();

      let noAnswer: NoAnswerReason | null = null;
      const turn = await askCaddie({
        message: patternText,
        heard: intent.raw_text?.trim() || patternText,
        language: ctx.language ?? 'en',
        liveBlock: live,
        // The evidence-order doctrine, so the cloud read reasons in the SAME order the offline gate
        // does (lie → flight → strike → grass → setup → motion; one cause + one fix).
        contextSuffix: EVIDENCE_ORDER_HINT,
        /**
         * 2026-10-28 (Brain review r2) — the shared brain budget, warm or cold. A flat 15s here was the
         * odd one out: api/kevin lets a turn run to ~22s, and this Sonnet coach read (a cold Lambda, a
         * full cache write, a tool round) can pass 15s. The phone gave up while the server finished and
         * billed the turn — and the caddie tab then asked the brain the same question again.
         */
        timeoutMs: isEndpointWarmed('/api/kevin') ? BRAIN_FETCH_TIMEOUT_MS : COLD_BRAIN_FETCH_TIMEOUT_MS,
        onNoAnswer: (reason) => { noAnswer = reason; },
        // Review G2 — a shush aborts the Sonnet read instead of letting it finish (and bill) unheard.
        signal: ctx.signal,
        // The caller speaks this reply through the voice layer, so the server need not render audio.
        skipTts: true,
        overrides: {
          register: 'coach',
          inRoundDiagnostic: true,
          // The player explicitly asked — this is not the caddie speaking first.
          is_proactive: false,
        },
      });
      if (!turn) {
        /**
         * 2026-10-28 (Brain review r2) — WHAT A FAILED READ MEANS TO THE ROUTE THAT ASKED.
         *
         * A non-success result with a line used to be the "hit a snag — try once more?" reply; but the
         * caddie-tab mic treats any non-success as "not a command" and hands the words to the brain, so
         * that line was never spoken there — a SECOND full Sonnet turn was sent instead.
         *
         * Our timer firing means the server is still working on (and billing) this read: asking again
         * pays twice and makes him wait a second window. So a timeout is answered HERE, by the one
         * failure owner (services/caddieFailureReply), as a handled turn every route speaks. A failure
         * that came back fast is the brain's to own — no line, so every route takes it to the caddie.
         *
         * 2026-10-28 (Brain recheck R7) — a REFUSAL is answered here too. The server already ran its
         * whole model ladder and said the brain is down; handing the words on started that ladder
         * again on every route before he heard the failure line.
         */
        if (noAnswer === 'timeout' || noAnswer === 'refused') {
          const failure = require('../caddieFailureReply') as typeof import('../caddieFailureReply');
          const reply = await failure.caddieFailureReply({ heard: intent.raw_text ?? patternText, language: ctx.language });
          return {
            success: true,
            voice_response: reply.text,
            side_effects: [`in_round_diagnostic:${noAnswer}:` + reply.source],
            follow_up_needed: false,
          };
        }
        return {
          success: false,
          voice_response: null,
          side_effects: ['in_round_diagnostic:no_answer'],
          follow_up_needed: false,
        };
      }
      const reply = turn.text.trim();
      if (!reply) {
        return {
          success: false,
          voice_response: "Couldn't pin a single cause from what you described — say a bit more about which shot you're hitting?",
          side_effects: ['in_round_diagnostic:empty_reply'],
          follow_up_needed: true,
        };
      }
      // The card renders the reasoning and re-plays it without re-querying Sonnet, so it is pushed
      // whether or not the line is spoken aloud — a muted player still gets the read.
      let cardShown = false;
      if (wantsCard) {
        try {
          (require('expo-router') as typeof import('expo-router')).router.push({
            pathname: '/diagnostic-card',
            params: { pattern: patternText, reasoning: reply },
          });
          cardShown = true;
        } catch (e) { console.log('[inRoundDiagnostic] diagnostic-card nav failed', e); }
      }
      return {
        success: true,
        voice_response: reply,
        side_effects: ['in_round_diagnostic:answered', ...(cardShown ? ['in_round_diagnostic:card'] : [])],
        follow_up_needed: false,
      };
    } catch (e) {
      console.log('[inRoundDiagnostic] brain call threw:', e);
      // askCaddie owns its own errors, so a throw is ours, before or after it; the caddie path owns
      // the failure line (it had a hard-coded English one here).
      return {
        success: false,
        voice_response: null,
        side_effects: ['in_round_diagnostic:exception'],
        follow_up_needed: false,
      };
    }
  },
};
