/**
 * ONE CALL TO THE CADDIE.
 *
 * 2026-08-23 (Tim, sprint finish) — "we're gonna be getting any duplication out of here. We need a
 * single source of truth, a single path, a total present caddie… getting all the generics out, no
 * robots, no fucking built-for-failure paths."
 *
 * On 08-22 the mic (useVoiceCaddie) and the text box (useKevin) were joined onto one payload
 * builder. That was half the job, and he could still hear the other half: the caddie-tab voice hook
 * (usePipecatVoice) and the earbud / watch / badge path (listeningSession → conversationalBrain)
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
import { getApiBaseUrl } from './apiBase';
import { buildCaddieRequestBody, type CaddieRequestExtras } from './caddieRequestBody';
import { appendPipecatTurn } from './voice/pipecatHistory';
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
}

/**
 * A single turn with the caddie.
 *
 * Returns `null` when the brain genuinely could not answer — the caller decides what the player
 * hears. It never invents a reply, and it never silently substitutes a lesser answer: the two
 * habits that produced "generic" and "robot".
 */
export async function askCaddie(opts: AskCaddieOptions): Promise<CaddieTurn | null> {
  const { timeoutMs, skipTts, signal, ...extras } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    if (!res.ok) return null;

    const raw = (await res.json()) as {
      text?: string;
      audioBase64?: string | null;
      toolAction?: ToolAction | null;
      toolActions?: ToolAction[] | null;
    };

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
    if (!text) return null;

    // ONE conversation, whichever surface asked. Written here so no caller can forget it — the
    // reason the caddie used to lose the thread when the player switched from earbud to typing.
    appendPipecatTurn(extras.message, text);

    return { text, audioBase64: raw.audioBase64 ?? null, toolActions };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}
