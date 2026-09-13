/**
 * 2026-09-13 — ONE CONTROL FOR "HOW MUCH THE CADDIE SPEAKS UP", AND ONE FOR THE MIC.
 *
 * Tim, reviewing the Settings screen: *"we wanna be smart, not toggle heavy."* Seven switches
 * governed how present the caddie is, and a player had to understand all seven to predict any of
 * them:
 *
 *   Kevin's presence (Quiet/Active) · Proactive Kevin · Interactive Round · Local Mode ·
 *   Active Listening · Continuous Conversation · Response Style
 *
 * They are not seven decisions. They are two — *how much should it talk* and *should it be
 * listening* — spread across seven places that could contradict each other. You could set presence
 * to Quiet and leave Proactive on; you could turn Local Mode on (which gates every
 * non-user-initiated line in voiceService) while the presence pill still read Active.
 *
 * NOTHING IS DELETED. Every flag still exists, every consumer still reads the flag it always read —
 * 32 files read `trustLevel`, 9 read `responseMode`, and none of them change. What changes is that
 * one function owns the combination, so the flags can no longer disagree with each other or with
 * the screen. [[two-owners-is-the-root-cause]]
 *
 * Where the levels come from:
 *   - `trustLevel` is the app's existing presence spine (L1 Quiet, L3 Active; L2 is a type-valid
 *     alias of Active and L4 is Full — see store/trustLevelStore.ts).
 *   - `localMode` reads as "battery saver" in copy, but what it actually does is
 *     `if (settings.localMode === true && !opts?.userInitiated) return` in voiceService — it is the
 *     enforcement of "only speaks when asked", which is precisely Quiet.
 *   - `interactiveRound` (speak a read when you stop walking mid-hole) has been OFF by default
 *     since 2026-08-07 on Tim's explicit call. It stays off at Balanced; Talkative is the stop that
 *     asks for it, which also gives the capability a reachable home instead of a switch nobody found.
 */

export type CaddiePresence = 'quiet' | 'balanced' | 'talkative';

/** The flags a presence level owns. Every field here is an existing setting with existing readers. */
export type PresenceProfile = {
  trustLevel: 1 | 3;
  proactiveKevin: boolean;
  interactiveRound: boolean;
  localMode: boolean;
  responseMode: 'short' | 'neutral' | 'detailed';
};

export const PRESENCE_PROFILES: Record<CaddiePresence, PresenceProfile> = {
  /** Small and silent: tap or talk to it and it answers, otherwise it stays out of the round. */
  quiet: {
    trustLevel: 1,
    proactiveKevin: false,
    interactiveRound: false,
    localMode: true,
    responseMode: 'short',
  },
  /** DEFAULT. Speaks between holes and at the tee, and answers anything — but does not narrate. */
  balanced: {
    trustLevel: 3,
    proactiveKevin: true,
    interactiveRound: false,
    localMode: false,
    responseMode: 'neutral',
  },
  /** Leads the round: reads when you stop mid-hole, and gives the longer version. */
  talkative: {
    trustLevel: 3,
    proactiveKevin: true,
    interactiveRound: true,
    localMode: false,
    responseMode: 'detailed',
  },
};

/**
 * Read the level back OUT of the flags, so the screen reflects what the app is actually doing —
 * including for a player whose stored flags predate this control, or who was moved by something
 * other than the picker. An exact profile match wins; otherwise fall back on the two flags that
 * decide whether the caddie opens its mouth at all.
 */
export function presenceFromFlags(f: {
  trustLevel: number;
  proactiveKevin: boolean;
  interactiveRound: boolean;
  localMode: boolean;
  responseMode: string;
}): CaddiePresence {
  for (const [level, p] of Object.entries(PRESENCE_PROFILES) as [CaddiePresence, PresenceProfile][]) {
    if (
      f.trustLevel === p.trustLevel &&
      f.proactiveKevin === p.proactiveKevin &&
      f.interactiveRound === p.interactiveRound &&
      f.localMode === p.localMode &&
      f.responseMode === p.responseMode
    ) return level;
  }
  if (f.localMode || f.trustLevel === 1 || !f.proactiveKevin) return 'quiet';
  return f.interactiveRound ? 'talkative' : 'balanced';
}

/** The mic is one decision too: listening at all, and staying open between turns. */
export type ListeningProfile = { autoListenEnabled: boolean; continuousConversationMode: boolean };

export const LISTENING_PROFILES: Record<'off' | 'on', ListeningProfile> = {
  off: { autoListenEnabled: false, continuousConversationMode: false },
  on: { autoListenEnabled: true, continuousConversationMode: true },
};
