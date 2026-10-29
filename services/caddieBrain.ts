/**
 * ONE CALL TO THE CADDIE.
 *
 * 2026-08-23 (Tim, sprint finish) — "we're gonna be getting any duplication out of here. We need a
 * single source of truth, a single path, a total present caddie… getting all the generics out, no
 * robots, no fucking built-for-failure paths."
 *
 * On 08-22 the mic (useVoiceCaddie) and the text box (useKevin) were joined onto one payload
 * builder. That was half the job, and he could still hear the other half: the caddie-tab voice hook
 * (useCaddieTabMic) and the earbud / watch / badge path (listeningSession → conversationalBrain)
 * were still building a SECOND payload — services/pipecatContext, a differently-shaped nested object
 * — and posting it to a SECOND brain at /api/pipecat-turn.
 *
 * Those two are the hands-free surfaces. They are how he actually plays. So the split he kept
 * describing ("I can feel it going back and forth… it's generic, and then the tone of the voice
 * changes a little bit, and the information's more accurate") was still fully live on exactly the
 * paths he uses most, on the first turn of every round.
 *
 * This is the one function every surface now calls. One payload (buildCaddieRequestBody, which
 * emits the union of everything all four paths ever sent), one endpoint (/api/kevin, the brain that
 * holds server-side TTS, vision, server tools and the course book), one conversation history. There
 * is no second brain left to drift from.
 *
 * WHY NO FALLBACK LADDER: the previous design tried pipecat, then kevin, then an offline responder,
 * then a canned line — four different caddies, each thinner than the last, and the player could not
 * tell which one had answered. That is where the generic answers came from. A phone has signal
 * essentially all the time; one real attempt that reports honestly when it fails beats four
 * attempts that quietly hand back a worse caddie.
 */
import { getApiBaseUrl, markEndpointWarmed } from './apiBase';
import { mayTalkToCaddie } from './featureAccess';
import { buildCaddieRequestBody, type CaddieRequestExtras } from './caddieRequestBody';
import { appendConversationTurn } from './voice/conversationHistory';
import type { ToolAction } from '../types/toolAction';

export interface CaddieTurn {
  text: string;
  /** Server-rendered persona voice. Present unless the caller asked to skip TTS. */
  audioBase64: string | null;
  toolActions: ToolAction[];
}

export interface AskCaddieOptions extends CaddieRequestExtras {
  timeoutMs: number;
  /** Text-only turn (the typed box renders it; no audio needed). Saves the TTS round-trip. */
  skipTts?: boolean;
  /** Caller-owned abort (a mic turn cancelled by the player, not by a timer). */
  signal?: AbortSignal;
  /**
   * 2026-10-27 (Brain review F7) — WHY there was no answer, for a caller that must decide whether to
   * try again. 'timeout' means OUR timer fired: the server is still working on (and billing) the
   * first request, so a retry pays for a second full turn and makes the player wait another window.
   */
  onNoAnswer?: (reason: NoAnswerReason) => void;
}

/**
 * 'refused' (2026-10-28, Brain review r5) — the server ANSWERED, with its own failure (the 200 with
 * error/errorType below). Fast like 'failed', but asking again asks a brain that just said it is down.
 */
export type NoAnswerReason = 'timeout' | 'aborted' | 'refused' | 'failed';

/**
 * A single turn with the caddie.
 *
 * Returns `null` when the brain genuinely could not answer — the caller decides what the player
 * hears. It never invents a reply, and it never silently substitutes a lesser answer: the two
 * habits that produced "generic" and "robot".
 */
export async function askCaddie(opts: AskCaddieOptions): Promise<CaddieTurn | null> {
  // 2026-08-25 — the one caddie access gate (services/featureAccess.mayTalkToCaddie). Inert while
  // subscriptions are off; when they are on, a blocked turn raises the paywall rather than going quiet.
  // A turn the player asked for raises the paywall; a proactive one (is_proactive) stays silent.
  // 2026-10-16 (voice seam review) — an 'abort' listener never fires for a signal that is ALREADY
  // aborted, so a shushed earbud turn's retry ran a full, billed brain call. Already cancelled: no call
  // — checked before the plan gate, so a shushed turn cannot raise or record a paywall block either.
  if (opts.signal?.aborted) { opts.onNoAnswer?.('aborted'); return null; }
  if (!mayTalkToCaddie({ userInitiated: !opts.overrides?.is_proactive })) { opts.onNoAnswer?.('failed'); return null; }
  const { timeoutMs, skipTts, signal, onNoAnswer, ...extras } = opts;
  // The player's own words: what the history keeps and the style learner hears. `message` may carry a
  // reshape meant only for the model (see CaddieRequestExtras.heard).
  const heard = extras.heard?.trim() ? extras.heard : extras.message;
  // When he asked — the history orders this exchange against the router's turns by it.
  const askedAt = Date.now();

  const controller = new AbortController();
  let timedOut = false;
  let refused = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const noAnswer = (): null => {
    onNoAnswer?.(timedOut ? 'timeout' : signal?.aborted ? 'aborted' : refused ? 'refused' : 'failed');
    return null;
  };
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);

  try {
    const body = buildCaddieRequestBody(extras);
    if (skipTts) body.skip_tts = true;

    const res = await fetch(getApiBaseUrl().replace(/\/+$/, '') + '/api/kevin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!res.ok) return noAnswer();
    // 2026-10-16 (voice seam review) — any answer from our server (even the 200-with-error below) proves
    // the phone is online: retire a cached "no internet" verdict so the failure line cannot say it.
    try { (require('../store/connectivityStore') as typeof import('../store/connectivityStore')).reportOnline(); } catch { /* advisory */ }
    // 2026-09-28 — a real answer is the best proof the brain is awake; it refreshes the warmth the
    // budgets read (and spares the next heartbeat a redundant warmup). (A 200 failure below still
    // proves the function is warm — warmth is about the Lambda, not the model.)
    markEndpointWarmed('/api/kevin');

    const raw = (await res.json()) as {
      text?: string;
      audioBase64?: string | null;
      toolAction?: ToolAction | null;
      toolActions?: ToolAction[] | null;
      error?: string;
      errorType?: string;
    };

    /**
     * 2026-10-15 (review) — A FAILURE THAT ARRIVES AS A 200 IS STILL A FAILURE.
     *
     * api/kevin's outer catch answers HTTP 200 with "I'm having trouble connecting — try that again."
     * plus `error` / `errorType` (Fix I shape C, 05-21). res.ok is true, so this returned it as a real
     * turn: every surface spoke it AS the caddie's answer, it went into the shared history as
     * something the caddie "said" (so the next turn answered in that context), the putt-ask and
     * style notes ran on it, and proactive lines read it out unprompted.
     *
     * Null is this function's documented "the brain could not answer"; every caller already owns
     * that outcome (the honest failure line, a proactive fallback, or silence). Checked BEFORE any
     * turn side effect — history, putt-ask, style notes — so a failure leaves no trace of a turn.
     */
    if (raw.error || raw.errorType) {
      console.log('[caddieBrain] /api/kevin answered a failure as 200 —', raw.errorType ?? 'error', '— treated as no answer');
      refused = true;
      return noAnswer();
    }

    /**
     * kevin returns a singular `toolAction`, and the `toolActions` ARRAY only when a turn produced
     * more than one. Reading just one of the two is how recommend_club got dropped for weeks — so
     * read both, array first.
     */
    const toolActions: ToolAction[] = Array.isArray(raw.toolActions) && raw.toolActions.length
      ? raw.toolActions
      : raw.toolAction ? [raw.toolAction] : [];

    let text = typeof raw.text === 'string' ? raw.text.trim() : '';
    // A tool-only turn is a real turn: the caddie DID something. Acknowledging it is the difference
    // between a caddie who acts and a mic that went dead.
    if (!text && toolActions.length) text = 'Done.';
    if (!text) return noAnswer();

    // ONE conversation, whichever surface asked. Written here so no caller can forget it — the
    // reason the caddie used to lose the thread when the player switched from earbud to typing.
    appendConversationTurn(heard, text, askedAt);

    /**
     * 2026-09-11 — THE CADDIE ASKING IN HIS OWN WORDS COUNTS AS ASKING.
     *
     * markAwaitingPutts was called only from logScoreHandler and logPuttsHandler, so when the BRAIN
     * asked — "nice, how many putts on that one?" — nothing marked the question open and the next
     * bare "2" was read as a score again. On a par 4 that is an eagle over a bogey he just gave
     * correctly, which is the exact report, reached by a different door.
     *
     * It lives HERE rather than at the five askCaddie call sites, because hand-copying this is what
     * left the caddie-tab mic without a putt intercept for a month. One brain, one place.
     */
    /**
     * 2026-09-11 (Tim) — HE TAKES A HINT.
     *
     * "The user says 'listen, I don't wanna talk this much, let's be more brief, let's get to the
     * point' — the caddie can take a hint and adjust accordingly. We wanna be smart, not toggle
     * heavy."
     *
     * Here, at the ONE seam every surface funnels through, for the same reason the putt-ask note
     * below lives here: hand-copying it to the five askCaddie call sites is how the caddie-tab mic
     * went a month without a putt intercept. A player should be able to say "you're talking too
     * much" to ANY surface and have it stick.
     *
     * Fire-and-forget. Adjusting how he talks must never be able to fail the turn he is talking in.
     */
    try {
      const { noteUtterance } = require('./caddieStyle') as typeof import('./caddieStyle');
      const st = (require('../store/settingsStore') as typeof import('../store/settingsStore')).useSettingsStore.getState();
      void noteUtterance(heard, { mode: st.responseMode ?? 'neutral', at: st.responseModeSetAt ?? 0 }).catch(() => undefined);
    } catch { /* never let learning a preference break a reply */ }

    try {
      const { noteCaddieAskedForPutts } = require('./pendingPuttAsk') as typeof import('./pendingPuttAsk');
      const rs = (require('../store/roundStore') as typeof import('../store/roundStore')).useRoundStore.getState();
      noteCaddieAskedForPutts(text, rs.isRoundActive ? rs.currentHole : null);
    } catch { /* never let this affect the turn */ }
    return { text, audioBase64: raw.audioBase64 ?? null, toolActions };
  } catch {
    return noAnswer();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}
