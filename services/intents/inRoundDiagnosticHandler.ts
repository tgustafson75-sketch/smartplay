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
 * Side note: wants_card param (visual display) is captured but not
 * acted on yet — would require a card-rendering route. Logged as a
 * side_effect tag for owner debug.
 */

import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { getApiBaseUrl } from '../apiBase';

const apiUrl = getApiBaseUrl();

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
      // Keep this call path persona-safe: if we omit persona, /api/kevin
      // falls back to legacy gender defaults and can drift to Kevin's voice.
      let persona: 'kevin' | 'serena' | 'harry' | 'tank' | 'custom' = 'kevin';
      let voiceGender: 'male' | 'female' = 'male';
      let personaIntensity = 100;
      let tankSoftIntro = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const settings = require('../../store/settingsStore') as typeof import('../../store/settingsStore');
        const s = settings.useSettingsStore.getState();
        persona = s.caddiePersonality;
        voiceGender = s.voiceGender;
        personaIntensity = s.personaIntensity?.[s.caddiePersonality] ?? 100;
        tankSoftIntro = s.tankSoftIntro;
      } catch {
        // Non-fatal: defaults keep behavior stable if store is unavailable.
      }

      // 2026-05-26 — Brain call shape: pull the SAME envelope shape
      // hooks/useVoiceCaddie.ts:sendToBrain assembles (context blocks +
      // persona) BUT with the in-round-diagnostic flags set. We can't
      // import sendToBrain here without dragging React deps, so this
      // handler sends a minimal envelope that lets api/kevin compose
      // the prompt; richer per-shot context comes from later turns.
      // The brain's stateful conversation buffer (Phase AR) carries
      // recent shot context across turns so the diagnostic call has
      // grounding from the prior caddie chatter.
      // 2026-06-13 (audit G5) — the diagnostic ("why am I slicing") is exactly where
      // learned tendencies + bag + live geometry help, yet it sent NO context. Compose
      // the SAME merged live+CNS block the chat/voice paths send. Best-effort.
      let unified_context_block: string | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const retr = require('../caddieMemoryRetrieval') as typeof import('../caddieMemoryRetrieval');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const uv = require('../unifiedVisionContext') as typeof import('../unifiedVisionContext');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const rs = require('../../store/roundStore') as typeof import('../../store/roundStore');
        const round = rs.useRoundStore.getState();
        const live = (await uv.getUnifiedVisionContext()).promptBlock;
        unified_context_block = retr.mergeMemoryIntoContext(
          live,
          retr.getCaddieContext({ courseId: round.activeCourseId, hole: round.currentHole, club: round.club }).promptBlock,
        );
      } catch { /* context optional — diagnostic still answers without it */ }
      // Thread the evidence-order doctrine so the cloud read reasons in the same order the
      // offline gate does (lie → flight → strike → grass → setup → motion; one cause + one fix).
      unified_context_block = `${unified_context_block ? unified_context_block + '\n\n' : ''}${EVIDENCE_ORDER_HINT}`;

      const payload = {
        message: patternText,
        language: ctx.language ?? 'en',
        register: 'coach',
        inRoundDiagnostic: true,
        // is_proactive false because the user explicitly asked
        is_proactive: false,
        voiceGender,
        persona,
        // 2026-07-30 (audit A4) — carry the custom caddie's base persona + name, or a custom caddie's
        // in-round "why am I slicing" answer is composed in Kevin's character/phrasing.
        customCaddieBasePersona: (() => { try { return require('../../store/playerProfileStore').usePlayerProfileStore.getState().customCaddieBasePersona ?? 'kevin'; } catch { return 'kevin'; } })(),
        customCaddieName: (() => { try { return require('../../store/playerProfileStore').usePlayerProfileStore.getState().customCaddieName ?? null; } catch { return null; } })(),
        personaIntensity,
        tankSoftIntro,
        unified_context_block,
      };
      const res = await fetch(`${apiUrl}/api/kevin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        // 2026-07-30 (audit A4) — bound the wait so a stalled server can't hang the diagnostic turn forever.
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        return {
          success: false,
          voice_response: 'I tried to dig into that and hit a snag — try once more?',
          side_effects: [`in_round_diagnostic:http_${res.status}`],
          follow_up_needed: false,
        };
      }
      const data = await res.json() as { text?: string };
      const reply = (data.text ?? '').trim();
      if (!reply) {
        return {
          success: false,
          voice_response: "Couldn't pin a single cause from what you described — say a bit more about which shot you're hitting?",
          side_effects: ['in_round_diagnostic:empty_reply'],
          follow_up_needed: true,
        };
      }
      return {
        success: true,
        voice_response: reply,
        side_effects: ['in_round_diagnostic:answered', ...(wantsCard ? ['in_round_diagnostic:wants_card_unsupported'] : [])],
        follow_up_needed: false,
      };
    } catch (e) {
      console.log('[inRoundDiagnostic] brain call threw:', e);
      return {
        success: false,
        voice_response: 'Lost the connection on that one. Try again in a sec.',
        side_effects: ['in_round_diagnostic:exception'],
        follow_up_needed: false,
      };
    }
  },
};
