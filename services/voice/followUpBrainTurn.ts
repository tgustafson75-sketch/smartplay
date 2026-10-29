/**
 * THE CADDIE-TAB FOLLOW-UP TURN — the brain half of useVoiceCaddie's follow-up listen loop.
 *
 * 2026-10-28 (Brain review r5) — this was the hook's `sendToBrain`, the last place in the app that
 * posted a player's turn to /api/kevin with its own fetch instead of services/caddieBrain.askCaddie.
 * Everything askCaddie does after a turn was therefore missing on every follow-up:
 *
 *   • noteCaddieAskedForPutts — the caddie asks "nice, how many putts?" in a follow-up reply, the
 *     player says "one", nothing marked the question open, and the bare "one" was read as a SCORE
 *     (on a par 4, a hole-in-one over the par he had just given correctly);
 *   • caddieStyle.noteUtterance — "you're talking too much" said in a follow-up never stuck;
 *   • the shared conversation history — a follow-up exchange was invisible to the next turn on every
 *     other surface.
 *
 * Moved out of the hook so the rule is tested against the real askCaddie (the hook cannot load under
 * jest). The hook keeps the loop, the intercepts and the speaking; this owns the turn.
 */
import { Vibration } from 'react-native';
import { askCaddie, type NoAnswerReason } from '../caddieBrain';
import { preBrainReply, shapeForBrain } from './preBrainTurn';
import { isEndpointWarmed } from '../apiBase';
import { BRAIN_FETCH_TIMEOUT_MS, COLD_BRAIN_FETCH_TIMEOUT_MS } from '../../constants/voiceTimeouts';
import { recordFailure as recordVoiceEndpointFailure, recordSuccess as recordVoiceEndpointSuccess } from '../voiceCircuitBreaker';
import { logVoiceError, logVoiceSilentFail } from '../voiceErrorLog';
import { CADDIE_NOTICE_ON_US } from '../caddieAckLines';
import type { ToolAction } from '../../types/toolAction';

export interface FollowUpReply {
  text: string;
  audioBase64: string | null;
  toolAction: ToolAction | null;
  toolActions?: ToolAction[];
  /**
   * 2026-07-06 (voice-parity F3) — a degrade line from the failure owner. The caller still SPEAKS it,
   * but must NOT log it as a real conversational turn.
   */
  fallback: boolean;
}

// 2026-07-25 / 09-28 — the first turn after launch is cold on the Lambda AND the provider SDK and can
// pass the warm 30s budget; give the brain the longer budget only until /api/kevin itself is warm.
const brainTimeoutMs = (): number => (isEndpointWarmed('/api/kevin') ? BRAIN_FETCH_TIMEOUT_MS : COLD_BRAIN_FETCH_TIMEOUT_MS);

export async function followUpBrainTurn(message: string, opts: { language: string; responseMode?: string | null }): Promise<FollowUpReply> {
  const { language } = opts;
  // The player's own words — `message` is reshaped below, and the local answer must read what he asked.
  const heard = message;
  /**
   * 2026-10-15 (review) — what a FAILED turn says, from the one owner. A local answer from real data
   * is a real answer (logged + kept); anything else is a fallback (spoken, never logged as something
   * the caddie said).
   */
  const failedTurn = async (): Promise<FollowUpReply> => {
    const failure = require('../caddieFailureReply') as typeof import('../caddieFailureReply');
    const langSafe = failure.safeLang(language);
    const r = await failure.caddieFailureReply({ heard, language: langSafe })
      .catch(() => ({ text: CADDIE_NOTICE_ON_US[langSafe], source: 'on_us' as const, verdict: null }));
    logVoiceSilentFail(r.source === 'local_answer' ? 'local_responder_hit' : 'local_responder_miss', {
      source: r.source,
      language: langSafe,
      transcriptHead: heard.slice(0, 60),
    });
    return { text: r.text, audioBase64: null, toolAction: null, fallback: r.source !== 'local_answer' };
  };

  // 2026-06-24 — off-device usage telemetry (opt-in; no-op if off). No message content sent.
  try { require('../usageTelemetry').track('voice_turn'); } catch { /* telemetry never throws */ }

  // 2026-10-27 (Brain review B10) — help, the song portal and the two reshapes are ONE shared step
  // (services/voice/preBrainTurn) that every surface runs, in one order.
  const spoken = await preBrainReply(message);
  if (spoken) return { text: spoken, audioBase64: null, toolAction: null, fallback: false };
  message = shapeForBrain(message);

  try {
    // The builder sends the top observations; record the use once per brain send.
    const rel = (require('../../store/relationshipStore') as typeof import('../../store/relationshipStore')).useRelationshipStore.getState();
    const topObs = rel.getTopObservations();
    if (topObs.length > 0) rel.markObservationsUsed(topObs.map(o => o.id));
  } catch { /* never blocks the turn */ }

  // The builder reads the course-intelligence cache; a miss warms it so the NEXT turn lands it.
  try {
    const r = (require('../../store/roundStore') as typeof import('../../store/roundStore')).useRoundStore.getState();
    if (r.isRoundActive && r.activeCourseId) {
      const intel = require('../courseIntelligenceService') as typeof import('../courseIntelligenceService');
      if (!intel.getCachedCourseIntelligenceSync(r.activeCourseId)) void intel.warmCourseIntelligenceMirror(r.activeCourseId);
    }
  } catch { /* non-fatal — the brain still works without intel */ }

  // 2026-06-13 (audit G5) — the LIVE context block (GPS / geometry / hazards / recent shots).
  let liveBlock: string | null = null;
  try {
    const uv = await import('../unifiedVisionContext');
    liveBlock = (await uv.getUnifiedVisionContext()).promptBlock;
  } catch { /* live context optional */ }

  let reason: NoAnswerReason | null = null;
  const ask = () => askCaddie({
    message,
    heard,
    language,
    liveBlock,
    responseMode: opts.responseMode ?? null,
    timeoutMs: brainTimeoutMs(),
    onNoAnswer: (r) => { reason = r; },
  });

  let turn = await ask();
  /**
   * Retry ONCE, the SAME question to the SAME caddie, on a FAST failure only (a 5xx, a dropped socket).
   * 2026-09-23 — never after our own timeout: the first turn is still running on the server and is
   * billed in full, so a retry buys it twice and makes the player wait a second window. Never after a
   * 'refused' either: the server answered, and what it said was that the brain is down.
   */
  if (!turn && reason === 'failed') {
    recordVoiceEndpointFailure('kevin');
    logVoiceError('kevin_response', new Error('brain_fast_failure'));
    reason = null;
    turn = await ask();
  }

  if (!turn) {
    if (reason !== 'refused') recordVoiceEndpointFailure('kevin', reason === 'timeout' ? 'timeout' : 'network');
    try { Vibration.vibrate(120); } catch { /* haptics optional */ }
    // 2026-06-06 / 2026-10-15 — a failed turn answers LOCALLY where it can, through the one owner.
    return failedTurn();
  }

  recordVoiceEndpointSuccess('kevin');
  // Points — every REAL caddie response is a 3-pt interaction (Tim's spec).
  try {
    const pointsMod = require('../../store/pointsStore') as typeof import('../../store/pointsStore');
    pointsMod.usePointsStore.getState().addPoints(3, 'caddie_interaction');
  } catch (e) { console.log('[points] caddie-interaction emit failed:', e); }

  return {
    text: turn.text,
    audioBase64: turn.audioBase64,
    toolAction: null,
    // askCaddie already folds the singular toolAction into the array.
    toolActions: turn.toolActions.length ? turn.toolActions : undefined,
    fallback: false,
  };
}
