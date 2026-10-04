/**
 * 2026-10-01 (Tim — "first question she thought, then didn't answer at all"; he waited, no tap).
 *
 * A listening turn has a dozen exits. The honest-failure path reports itself
 * (turn_ended_without_answer), but several earlier returns — state moved on after the classifier,
 * the session left 'responding' before the reply, a silent handler result, a hang the dormancy
 * watchdog closed — end the turn with no words heard or read and NO report, so the one case he
 * described left no evidence.
 *
 * listeningSession feeds every state change through here, so the check holds whatever the exit: a
 * turn that entered 'thinking' and reached 'idle' without a single line given to the player
 * (voiceService's caption counter did not move) is reported with the state it left from, the intent
 * and how long it took. A tap-to-close and an intentional silent acknowledgement stay diag.
 */
import { getCaptionSeq } from '../voiceService';
import { logVoiceDiag, logVoiceSilentFail } from '../voiceErrorLog';

type CloseReason = 'user_close' | 'dormancy_timeout';

let owed: { seq: number; at: number } | null = null;
let intent: string | null = null;
let closing: CloseReason | null = null;

export function noteTurnState(prev: string, next: string): void {
  if (next === 'thinking' && prev !== 'thinking') {
    owed = { seq: getCaptionSeq(), at: Date.now() };
    intent = null;
    return;
  }
  if (next !== 'idle' || prev === 'idle') return;
  const turn = owed;
  owed = null;
  if (!turn || getCaptionSeq() !== turn.seq) return;
  const extra = { from: prev, ms: Date.now() - turn.at, intent, close: closing };
  if (closing === 'user_close' || intent === 'acknowledge') logVoiceDiag('turn_ended_silent', extra);
  else logVoiceSilentFail('turn_ended_silent', extra);
}

export function noteTurnIntent(intentType: string): void { intent = intentType; }

/**
 * 2026-10-03 (review) — the turn ACTED instead of speaking: a silent tool-open (the screen change is
 * the answer, 08-06), a navigation, a successful command with no line, brain tool actions. Those are
 * answers. Without this every "open SmartVision" filed a voice_silent_fail to the owner inbox.
 */
export function noteTurnActed(): void { owed = null; }

/** Bracket a close so the idle it causes is attributed to it. */
export function noteTurnClosing(reason: CloseReason | null): void { closing = reason; }
