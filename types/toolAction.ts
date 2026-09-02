/**
 * THE tool-action contract — the single definition of what the caddie can ask the app to DO.
 *
 * 2026-08-13 (Tim: "no fucking way you just fixed that… I'll bet you find shit you missed.") — he
 * was right, and this was the miss. `ToolAction` lived inside app/api/kevin+api.ts, the DEPRECATED
 * Expo dev-server twin of the canonical brain, and the three live voice hooks (useVoiceCaddie,
 * useKevin, useCaddieTabMic) all imported it from there.
 *
 * So the shipping client was typed against a brain it never talks to. The twin's own header listed
 * six ways it had drifted from canonical since 2026-05-26 — including a tool the real brain does not
 * emit — and TypeScript happily agreed with the drifted copy, because the drifted copy WAS the type.
 * A deprecated file cannot be deleted while three live hooks depend on it, which is exactly how it
 * survived eleven weeks of audits: every attempt to remove it broke the build, so it stayed.
 *
 * The contract now lives here, owned by neither brain. Both brains and the client import it, so a
 * tool cannot exist on one side of the wire and not the other.
 */
export type ToolAction =
  | { type: 'open_smartvision' }
  | { type: 'open_smartfinder' }
  // 2026-08-20 (Tim — "tap OR ASK to zoom the pin flag and get a tight read"). Magnify the
  // rangefinder scene by voice. Typed here from the start: the ONLY two UI tools ever silently
  // dropped were the two that lacked a ToolAction member, so an untyped payload is the drop class.
  | { type: 'zoom_target'; level?: 'in' | 'out' | 'reset' }
  // 2026-08-21 — set_session_focus completes a wire that has existed on the CLASSIFIER path since
  // early on and never became a brain tool; set_playing_condition is what the ball is doing TODAY,
  // which the caddie must aim around rather than diagnose. Typed here from the start — the only two
  // UI tools ever silently dropped were the two that lacked a ToolAction member.
  | { type: 'set_session_focus'; goal?: string; note?: string; clear?: boolean }
  | { type: 'set_playing_condition'; stated: string; kind?: 'ball_flight' | 'physical' | 'feel'; compensate?: 'left' | 'right' | 'shorter' | 'longer'; clear?: boolean }
  // 2026-08-21 — the JUNE narrative brain (f4e0b31e) plus the rest of the state the brain could not
  // write. All four have worked on the CLASSIFIER path for months and were unreachable in
  // conversation, so "I'm 150 out with my 7-iron on twelve, downhill lie" recorded nothing.
  | { type: 'set_hole_note'; note: string; hole?: number }
  | { type: 'state_yardage'; yards: number }
  | { type: 'club_change'; club: string }
  | { type: 'declare_hole'; hole: number }
  | { type: 'open_swinglab' }
  | { type: 'log_score'; hole?: number; score: number }
  | { type: 'record_swing' }
  | { type: 'log_shot'; direction?: string; contactQuality?: string; outcome?: string; feel?: string; club?: string; hole?: number; shot_number?: number; distance_yards?: number }
  // 2026-07-04 (Tim — compound "parse anything into context") — a PRE-shot plan the
  // player declared (club/yardage/shot/hole) that sets context + confirms, not a log.
  | { type: 'plan_shot'; club?: string; distance_yards?: number; shot_number?: number; hole?: number; target?: string }
  // 2026-07-04 (Tim — verbal reminders) — "remind me to work on putting Thursday" → a
  // SmartPlan reminder.
  | { type: 'set_reminder'; text: string; when?: string }
  | { type: 'log_emotional_state'; state: string; valence: 'positive' | 'neutral' | 'negative' }
  // 2026-06-26 — voice "log this issue" → a real issue-log entry (owner-gated client-side)
  | { type: 'log_issue'; note: string }
  // Phase R — generic in-app navigation for voice handlers (swing detail, library)
  | { type: 'open_url'; url: string }
  // 2026-06-04 — Tool-handler navigation deferred to the client so the
  // caller can await speak BEFORE the destination screen mounts. Previously
  // openToolHandler.ts called router.push synchronously inside the handler,
  // which raced TTS for screens that claim audio/camera resources on mount
  // (SmartMotion quick-record, Coach Mode, cage mode, SmartFinder).
  | { type: 'navigate'; path: string }
  // navigate_replace uses router.replace instead of router.push so the
  // back button doesn't return to the active-caddie screen after round end.
  | { type: 'navigate_replace'; path: string }
  // 2026-06-22 — SmartMotion voice layer: Kevin configures the drill or closes SwingLab.
  | { type: 'configure_drill'; club?: string; shot_count?: number }
  | { type: 'close_swinglab' }
  // SmartVision voice calibration — user stands at tee/green and says "mark tee/green"
  | { type: 'mark_tee' }
  | { type: 'mark_green' }
  // 2026-06-29 (Tim) — switch the active caddie persona by voice ("switch to Harry").
  | { type: 'switch_caddie'; personality: 'kevin' | 'serena' | 'harry' }
  // 2026-06-29 (Tim) — voice sets the SmartMotion camera angle ("down the line"/"face on"/"putting").
  | { type: 'set_angle'; angle: 'down_the_line' | 'face_on' | 'putt' }
  | { type: 'set_golfer'; name: string }
  /**
   * 2026-08-19 — THE TWO THAT KEPT GETTING DROPPED, finally typed.
   *
   * `recommend_club` and `register_bag` were the ONLY members of api/_brainTools.UI_TOOLS with no
   * entry in this union, and they are the only two tools this app has silently lost — three times,
   * at three different seams:
   *   • 2026-08-08 — register_bag declared and prompted but missing from the service dispatcher:
   *     the caddie confirmed the bag out loud and nothing was written.
   *   • 2026-08-17 — the Caddie tab's unknown-tool `default:` logged and dropped both, killing
   *     advice→outcome pairing for every round played through that tab.
   *   • 2026-08-19 — both existed only in api/pipecat-turn, so turn 1 of a conversation could
   *     record a club recommendation and the FOLLOW-UP turn could not: the tool did not exist on
   *     the brain that answers it.
   *
   * Every one of those was invisible to the compiler for the same reason — the payload had no type,
   * so `raw as ToolAction` in useCaddieTabMic cast an unknown shape into the union and every
   * consumer read `a.club` off a member that did not exist. A missing case in a switch over an
   * untyped member is not an error anyone can see.
   *
   * Typing them does not by itself force a handler, but it ends the silence: the fields are now
   * declared where consumers read them, and the parity test alongside this file asserts that every
   * UI_TOOL has a member here — so the next tool cannot join the brain without one.
   */
  | { type: 'recommend_club'; club: string; shape?: string }
  | { type: 'register_bag'; clubs?: unknown[]; distances?: unknown[] };

// ── POST handler ──────────────────────────────────────────────────────────────
