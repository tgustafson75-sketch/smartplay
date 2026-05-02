/**
 * Phase T — Rules query handler.
 *
 * Voice queries about rules during a round route here. Handler:
 *   1. Looks up the most relevant rule(s) from data/rulesReference.ts
 *   2. Sends a Sonnet-grounded prompt that uses the bundled rule as
 *      authoritative context (Sonnet does NOT invent rule details —
 *      it phrases the answer using the rule data we provide)
 *   3. Returns Caddie-register response: brief, tactical, includes
 *      the answer + what to do next
 *
 * If no rule matches the query well, Kevin honestly says he wants to
 * verify before answering — better than confidently wrong.
 *
 * Authority: 2023 Rules of Golf via data/rulesReference.ts.
 */

import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { findRelevantRules, type RuleEntry } from '../../data/rulesReference';

export const rulesQueryHandler: IntentHandler = {
  intent_type: 'rules_query',

  parameter_schema: {
    query_text: 'the original user utterance describing the rules situation',
  },

  examples: [
    'can I drop free here',
    'is that out of bounds',
    'what is the rule on embedded ball',
    'do I get relief from casual water',
    'can I move my ball from a divot',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const queryText = String(intent.parameters.query_text ?? intent.parameters.utterance ?? '').trim();
    const matches = findRelevantRules(queryText, 3);

    if (matches.length === 0) {
      return {
        success: true,
        voice_response: "Let me check on that one — I want to make sure I get the rule right. Can you describe the situation more — is it relief, a penalty area, the green?",
        side_effects: ['rules:no_match'],
        follow_up_needed: true,
      };
    }

    // Top match is the most relevant rule. Use its summary as the immediate
    // answer; Sonnet routing is reserved for follow-up depth (the reference
    // surface or a "tell me more" intent). Direct answer keeps Caddie
    // register tight and TTFA fast.
    const top = matches[0];
    const voice_response = phraseAnswer(top, queryText);

    return {
      success: true,
      voice_response,
      side_effects: [`rules:matched:${top.rule_id}`],
      follow_up_needed: false,
      // Open the reference surface scrolled to this rule for follow-up depth
      tool_action: { type: 'open_url', url: `/reference?rule=${top.rule_id}` } as never,
    };
  },
};

/**
 * Convert a RuleEntry into a Caddie-register voice response. Uses the
 * rule_summary as the lead, optionally appends the tactical_advice when
 * the query suggests in-round decision-making (vs. study mode).
 */
function phraseAnswer(rule: RuleEntry, queryText: string): string {
  const q = queryText.toLowerCase();
  const inRound = /can i|do i|is that|what (do|should|am)|drop|move|hit/.test(q);

  if (inRound) {
    // Brief: rule_summary + tactical_advice's first sentence if available.
    const advice = rule.tactical_advice.split(/\.\s+/)[0];
    return `${rule.rule_summary} ${advice}.`;
  }

  // Otherwise just the rule_summary; user can tap into the reference
  // surface for the detailed_explanation.
  return rule.rule_summary;
}
