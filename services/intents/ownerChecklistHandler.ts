import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useOwnerChecklistStore, GROUP_LABEL } from '../../store/ownerChecklistStore';
import { isOwnerEmail, usePlayerProfileStore } from '../../store/playerProfileStore';

/**
 * 2026-09-09 (Tim: "have it so the Caddie can read the reminder if I want") — THE LIST, SPOKEN.
 *
 * The point of putting the checklist on the phone was that the laptop is not on the first tee. The
 * point of this is that the PHONE is often not in your hand either: it is in a cart holder or a
 * pocket, and you are wearing a glove. Asking out loud is the only interaction that works with a
 * club in the other hand, which is the whole premise of the caddie.
 *
 * Reads the OUTSTANDING items only. A checklist that reads back the things you already did is a
 * chore, and after a few ticks the part you need is buried at the end.
 *
 * OWNER-ONLY, like every other surface of this feature. A non-owner falls through to the brain
 * (`success: false`) rather than being told a list exists — the same boundary watchRoundSync draws,
 * and for the same reason: this ships during a feature freeze only because it cannot appear for
 * anyone else.
 */
export const ownerChecklistHandler: IntentHandler = {
  intent_type: 'owner_checklist',

  parameter_schema: {},

  examples: [
    'what\'s on my checklist',
    'read my checklist',
    'what\'s left on my list',
    'read my reminders',
    'what do I still need to test',
    'my to do list',
  ],

  async execute(_intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    if (!isOwnerEmail(usePlayerProfileStore.getState().email)) {
      // Not "you don't have one" — nothing at all, so the brain answers whatever they actually meant.
      return { success: false, voice_response: null, side_effects: ['owner_checklist:not_owner'], follow_up_needed: false };
    }

    let remaining: ReturnType<typeof useOwnerChecklistStore.getState>['items'] = [];
    try { remaining = useOwnerChecklistStore.getState().items.filter((i) => !i.done); }
    catch { return { success: false, voice_response: null, side_effects: ['owner_checklist:unavailable'], follow_up_needed: false }; }

    if (remaining.length === 0) {
      return {
        success: true,
        voice_response: 'Your checklist is clear — everything is ticked off.',
        side_effects: ['owner_checklist:clear'],
        follow_up_needed: false,
      };
    }

    /**
     * Grouped, and capped at five spoken items.
     *
     * Spoken lists do not work the way written ones do: past about five, the listener has lost the
     * first one and nothing has been communicated. So the caddie names the group, reads the top few,
     * and says how many are left rather than reciting all ten into the wind.
     */
    const SPOKEN_CAP = 5;
    const head = remaining.slice(0, SPOKEN_CAP);
    const byGroup = new Map<string, string[]>();
    for (const i of head) {
      const label = GROUP_LABEL[i.group] ?? 'Other';
      byGroup.set(label, [...(byGroup.get(label) ?? []), i.title]);
    }
    const parts = [...byGroup.entries()].map(([label, titles]) => `${label}: ${titles.join(', ')}`);
    const more = remaining.length - head.length;
    const tail = more > 0 ? ` And ${more} more — they're in Settings, Owner Tools.` : '';

    return {
      success: true,
      voice_response: `${remaining.length} still open. ${parts.join('. ')}.${tail}`,
      side_effects: [`owner_checklist:read:${remaining.length}`],
      follow_up_needed: false,
    };
  },
};
