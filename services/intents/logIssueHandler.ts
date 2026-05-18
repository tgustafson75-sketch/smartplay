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
    'we have an issue with the recap screen',
    'remember this — SmartFinder white-screened at 10x zoom',
    'save this for me: Sunnyvale hole 7 yardage looks wrong',
    'make a note that Tank cut me off mid-sentence',
    'track this — the active listening pill covers the brand row',
    'I want you to know the GPS data bar is static',
    'this is broken: hero shot share button does nothing',
    'this doesn\'t work — voice score is not understood',
    "Kevin, log this — the recap auto-route feels slow",
    'log an issue: yardage stuck at 250',
    'I have feedback for you',
    'report a bug',
    'note this for later',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const rawNote = String(intent.parameters.note ?? intent.raw_text ?? '').trim();
    if (!rawNote) {
      return {
        success: false,
        voice_response: "I didn't catch the issue. Say it again with what's wrong after.",
        side_effects: ['log_issue:empty'],
        follow_up_needed: true,
      };
    }

    // 2026-05-19 — non-owner branch previously said "Got it" silently
    // and dropped the note. Tim hit this when his profile.email wasn't
    // set on the preview build, and concluded the feature was broken.
    // Now: always save (storage is local + cheap), and tell the owner
    // explicitly when their owner gate isn't active so they know what
    // happened. Beta-tester clutter risk is acceptable.
    const isOwner = ownerCheck();

    // Build context snapshot.
    const round = useRoundStore.getState();
    const settings = useSettingsStore.getState();
    const context = {
      route: null as string | null, // active surface registry read at caller
      persona: settings.caddiePersonality ?? null,
      isRoundActive: round.isRoundActive,
      courseId: round.activeCourseId,
      currentHole: round.isRoundActive ? round.currentHole : null,
      appVersion: '1.0.0',
    };

    useIssueLogStore.getState().addEntry(rawNote, context);

    // Echo back the first ~8 words so the user has CONCRETE evidence
    // the right thing was captured. Previously "Got it" / "Logged" gave
    // no clue whether the transcription got the actual issue or some
    // mangled fragment. Now if the echo is wrong, the user can correct
    // immediately ("no, I said X").
    const words = rawNote.split(/\s+/).filter(Boolean);
    const echo = words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '');
    const reply = isOwner
      ? `Saved. I'll remember: ${echo}`
      : `Saved a note: ${echo}. Owner mode isn't active — set your email in Settings to file it in the Issue Log.`;

    return {
      success: true,
      voice_response: reply,
      side_effects: [isOwner ? 'log_issue:saved' : 'log_issue:saved_non_owner'],
      follow_up_needed: false,
    };
  },
};
