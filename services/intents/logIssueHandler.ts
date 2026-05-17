/**
 * 2026-05-17 — Owner-only "log this" intent for in-app issue capture.
 *
 * Tim asked: "is it possible with only my login that I can talk to
 * Kevin about issues with the app and then they are stored somewhere
 * so that when we come back to this, we can review that file?"
 *
 * Flow:
 *   1. User says "Kevin, log this" / "log an issue" / "I have feedback" /
 *      "report a bug" plus the rest of the utterance describing what they
 *      want logged.
 *   2. The voice-intent classifier returns intent_type='log_issue' with
 *      parameters.note = the issue description.
 *   3. This handler verifies the user is the owner (isOwnerEmail), then
 *      appends an entry to issueLogStore with route + persona + round
 *      context snapshot.
 *   4. Caddie acknowledges the capture in a single short line.
 *
 * Non-owner sessions: silently noops (returns success but doesn't save
 * anything) so the beta-tester voice doesn't accidentally trigger
 * owner-only state.
 */

import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { isOwnerEmail, usePlayerProfileStore } from '../../store/playerProfileStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useRoundStore } from '../../store/roundStore';
import { useIssueLogStore } from '../../store/issueLogStore';

function ownerCheck(): boolean {
  const profile = usePlayerProfileStore.getState();
  return isOwnerEmail(profile.email);
}

export const logIssueHandler: IntentHandler = {
  intent_type: 'log_issue',

  parameter_schema: {
    note: 'string — the user-spoken issue / feedback / bug description, with the wake phrase already stripped',
  },

  examples: [
    'Kevin, log this — the recap auto-route feels slow',
    'log an issue: SmartFinder white-screened when I tapped 10x zoom',
    'I have feedback for you about the active listening pill',
    'report a bug — Tank cut me off mid-sentence',
    'note this — Sunnyvale hole 7 yardage looks wrong',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const rawNote = String(intent.parameters.note ?? intent.raw_text ?? '').trim();
    if (!rawNote) {
      return {
        success: false,
        voice_response: "I didn't catch what you wanted me to log. Say it again with the issue after.",
        side_effects: ['log_issue:empty'],
        follow_up_needed: true,
      };
    }

    // Owner gate — non-owner sessions silently no-op so a tester
    // accidentally hitting "log this" doesn't write to a personal debug
    // log they can't see.
    if (!ownerCheck()) {
      return {
        success: true,
        voice_response: "Got it.",
        side_effects: ['log_issue:non_owner_skip'],
        follow_up_needed: false,
      };
    }

    // Build context snapshot.
    const round = useRoundStore.getState();
    const settings = useSettingsStore.getState();
    const context = {
      route: null as string | null, // active surface registry is read by caller; left null here for now
      persona: settings.caddiePersonality ?? null,
      isRoundActive: round.isRoundActive,
      courseId: round.activeCourseId,
      currentHole: round.isRoundActive ? round.currentHole : null,
      appVersion: '1.0.0',
    };

    useIssueLogStore.getState().addEntry(rawNote, context);

    return {
      success: true,
      voice_response: "Logged. We'll review it later.",
      side_effects: ['log_issue:saved'],
      follow_up_needed: false,
    };
  },
};
