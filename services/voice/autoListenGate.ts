/**
 * 2026-10-28 (recheck VC-R2-2) — WHEN THE CADDIE TAB'S AUTO-LISTEN (VAD) RECORDER MAY HOLD THE MIC.
 *
 * The gate read only the tab's own voiceState. That kept the mic clean for the tab's push-to-talk,
 * which was the only push-to-talk when it was written; the badge, the bottom bar and the earbud now
 * open a listeningSession, which never touches voiceState. So VAD kept recording through those turns:
 * the session's capture died on "Only one Recording object", or VAD heard the session's own "Yeah?"
 * through the speaker and claimed the turn. The session's state is the other half of "is the mic free".
 *
 * And the gate cancelled VAD's OWN turns: onSpeechStart sets the tab to 'listening', which closed the
 * gate, which stopped the recorder and threw the clip away before onSpeechEnd — the avatar stuck on
 * 'listening' and auto-listen off for the rest of the visit. A 'listening' that VAD itself announced
 * keeps the gate open until VAD ends or abandons that turn.
 */
export interface AutoListenGateInput {
  autoListen: boolean;
  localMode: boolean;
  roundActive: boolean;
  appActive: boolean;
  /** The Caddie tab's own voiceState. */
  tabVoiceState: string;
  /** listeningSessionStore state — badge, bottom bar, earbud, watch, typed turns. */
  sessionState: string;
  /** VAD announced the turn the tab is 'listening' to (onSpeechStart, not yet ended). */
  vadOwnsTurn: boolean;
  /** SmartMotion's camera is mounted or recording — it owns the mic. */
  smartMotion: boolean;
}

export function autoListenMayHoldMic(g: AutoListenGateInput): boolean {
  if (!g.autoListen || g.localMode || !g.roundActive || !g.appActive || g.smartMotion) return false;
  if (g.sessionState !== 'idle') return false;
  return g.tabVoiceState === 'idle' || (g.vadOwnsTurn && g.tabVoiceState === 'listening');
}
