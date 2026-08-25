/**
 * Pipecat turn endpoint — A THIN SHIM OVER api/kevin. No brain of its own.
 *
 * 2026-08-24 (Tim's call, after the unification audit) — THE SECOND BRAIN IS GONE.
 *
 * This route carried its own 744-line implementation of the caddie turn: its own prompt assembly,
 * its own tool loop, its own fallbacks. api/kevin carried another. api/_brain.ts and
 * api/_brainTools.ts (815 lines between them) existed ONLY to stop the two drifting, and both files
 * document drift that happened anyway — seven missing tools in July, recommend_club + register_bag
 * and ~255 lines of description drift in August.
 *
 * The audit that finished today confirmed what the 08-23 payload work implied: **no client calls
 * this route any more.** Twelve client references to /api/kevin, zero to here. So the second brain
 * was not serving anyone — it was only making every fix need two homes, which is precisely how the
 * caddie ended up calling a 7 wood a "5 wood" in one file and not the other.
 *
 * WHY A SHIM RATHER THAN A DELETION. A tester whose bundle predates 2026-08-23 still has code that
 * posts here. Deleting the route would 404 them until they relaunch; keeping it as a pass-through
 * costs one function and cannot drift, because there is nothing here to drift FROM. The contract
 * this route promised — nested `context` in, `{ response_text, tool_actions, updated_history }` out
 * — is honoured exactly, by api/_brainShim, which was built and probed for this purpose.
 *
 * Everything else that used to live here now lives in api/kevin, which is the only place a caddie
 * behaviour needs to be written.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowInference } from './_inferLimit';
import { completeText } from './_aiProvider';
import { pipecatRequestToKevinBody, kevinResponseToPipecat, callKevin } from './_brainShim';

const SESSION_SECRET = process.env.PIPECAT_SESSION_SECRET ?? '';

type HistoryMsg = { role: 'user' | 'assistant'; content: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!allowInference(req, res, 'pipecat-turn')) return;

  // Pre-warm: warm the runtime + provider client and return fast. No auth, no turn.
  if (req.body?.mode === 'warmup' || req.query?.mode === 'warmup') {
    try {
      await completeText('openai', 'fast', 'ping', [{ role: 'user', content: 'ping' }], { maxTokens: 1 });
    } catch { /* warmup is best-effort */ }
    return res.status(200).json({ ok: true, warmed: true });
  }

  // Auth — only enforced when BOTH sides have a secret configured. EXPO_PUBLIC_PIPECAT_SECRET is not
  // set in prod OTA builds, so the client sends ''; requiring a match would block every field call.
  const incomingSecret = req.body?.secret ?? req.headers['x-pipecat-secret'] ?? '';
  if (SESSION_SECRET && incomingSecret && incomingSecret !== SESSION_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { text, history = [], screen_context = null } = (req.body ?? {}) as {
    text: string;
    history: HistoryMsg[];
    screen_context?: string | null;
  };

  // Ephemeral "current screen/drill" so a question asked inside a drill is answered about THAT
  // drill. Capped for safety. The shim forwards this to kevin, which owns the rest.
  let _screenContext: string | null =
    typeof screen_context === 'string' && screen_context.trim()
      ? screen_context.slice(0, 600)
      : null;

  if (_screenContext && /getting to know the golfer/i.test(_screenContext)) {
    _screenContext +=
      '\n\nGET-TO-KNOW INTERVIEW MODE — LISTEN & GATHER, DO NOT OPEN ANYTHING. This is a pure ' +
      'profile-building conversation to learn the golfer. When the player describes a swing ' +
      'fault, a weakness, a club they struggle with, or something they want to work on ("I come ' +
      'over the top", "I slice my driver", "my chipping is bad"), that is INFORMATION to absorb ' +
      'and ask about — NEVER a command to open SwingLab, a drill, Smart Motion, record, or ' +
      'navigate anywhere. Do NOT call navigate / open_swinglab / record_swing / configure_drill / ' +
      'set_angle, and do NOT say you are opening or pulling up anything. Just keep the ' +
      'conversation going: reflect back what you heard and ask ONE natural follow-up question ' +
      '(end with a question mark so the mic stays open). Only exception: the player EXPLICITLY ' +
      'says to stop the interview and open something ("okay, take me to the tempo drill now").' +
      // 2026-08-08 (Tim — bag registration IS interview material). register_bag is a DATA tool, not a
      // navigation — it stays LIVE in the interview. Actively ask about the bag at a natural moment.
      '\nEXCEPTION — register_bag stays ON: when they tell you the clubs they carry or their ' +
      'yardages, CALL register_bag with everything they said (it records silently — no navigation). ' +
      'At a natural point in the interview, ASK about their bag: what clubs they carry and their ' +
      'go-to yardages (7-iron and driver at minimum).';
  }
  if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

  /**
   * The interview augmentation above is written BACK onto the body, because the shim reads
   * `body.screen_context` when it maps this contract onto kevin's. Mutating here rather than
   * threading a second parameter keeps the shim's mapping the single description of the translation.
   */
  const body = { ...(req.body as Record<string, unknown>), screen_context: _screenContext };

  /** The pipecat contract's graceful degrade: a non-200 trips the client's voice circuit breaker as
   *  if the network died, so failures come back in the shape its callers already handle. */
  const degraded = (why: string) =>
    res.status(200).json({
      response_text: 'Give me one sec and ask me again.',
      tool_actions: [],
      updated_history: history,
      degraded: true,
      error: why,
    });

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const kevinHandler = (require('./kevin') as { default: never }).default as never;
    const out = await callKevin(kevinHandler, req, pipecatRequestToKevinBody(body));
    if (out.status !== 200) return degraded(`kevin_${out.status}`);
    res.setHeader('X-Brain', 'kevin');
    return res.status(200).json(kevinResponseToPipecat(out.json, text, history));
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[pipecat-turn] shim failed:', msg);
    return degraded(msg);
  }
}
