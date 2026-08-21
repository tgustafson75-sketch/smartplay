/**
 * ONE BRAIN, TWO CONTRACTS — the adapter that ends the two-brain drift.
 *
 * 2026-08-21. Tim: "we're creating a bunch of guards, gates and such… because we're trying to clean
 * pathways between two different brains."
 *
 * He is right, and the cost is measurable: api/_brainTools.ts and api/_brain.ts (640 lines between
 * them) exist ONLY to stop kevin.ts and pipecat-turn.ts drifting, and both files document drift that
 * already happened — seven missing tools in July, recommend_club + register_bag + ~255 lines of
 * description drift in August. kevin.ts carries the line "Mirrors api/pipecat-turn.ts exactly" over
 * hand-copied distress logic. Every fix since has been another guard holding two implementations
 * together.
 *
 * The fix is not a better guard. It is one implementation.
 *
 * This translates the pipecat REQUEST/RESPONSE contract onto kevin, so the client keeps the exact
 * shape it already sends and receives while there is only one brain behind it. Ten client call sites
 * are bound to these two shapes; none of them need to change, which is what makes this reversible.
 *
 * WHY KEVIN IS THE SURVIVOR: it holds the capabilities that are expensive to replicate — server-side
 * TTS (audioBase64), vision input, SERVER_TOOLS execution, proactive openers, practice context,
 * per-hole shot context and the static course book. Pipecat's genuinely unique behaviours (sim round
 * framing, the get-to-know interview mute, per-club tendencies) were ported into kevin first, in
 * phase 1, and verified live at 19/19 on both brains before this file existed.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

type HistoryMsg = { role: 'user' | 'assistant'; content: string };

/** Kevin renders the last few turns into its prompt as RECENT CONVERSATION; pipecat does the same
 *  with its own history block. Same strategy, different field name — so this is a rename, not a
 *  downgrade in continuity. */
function toConversationTurns(history: HistoryMsg[]): { role: 'user' | 'kevin'; text: string }[] {
  return (history ?? [])
    .filter(h => h && typeof h.content === 'string' && h.content.trim())
    .map(h => ({ role: h.role === 'assistant' ? ('kevin' as const) : ('user' as const), text: h.content }));
}

/** pipecat's nested `context` object → kevin's flat body. Every field kevin does not receive stays
 *  at its own default, which is why an unmapped field degrades to "generic" rather than to a crash. */
export function pipecatRequestToKevinBody(body: Record<string, unknown>): Record<string, unknown> {
  const context = (body.context ?? {}) as Record<string, unknown>;
  const player = (context.player ?? {}) as Record<string, unknown>;
  const round = (context.round ?? {}) as Record<string, unknown>;
  const bag = (context.bag ?? {}) as Record<string, unknown>;
  const settings = (context.settings ?? {}) as Record<string, unknown>;
  const yardage = (round.yardage ?? {}) as Record<string, unknown>;
  const score = (round.score ?? {}) as Record<string, unknown>;

  return {
    message: body.text,
    conversationTurns: toConversationTurns((body.history ?? []) as HistoryMsg[]),
    screen_context: body.screen_context ?? null,

    language: settings.language ?? 'en',
    responseMode: settings.responseMode ?? 'neutral',
    voiceGender: settings.voiceGender ?? 'male',
    persona: player.caddiePersonality ?? null,
    customCaddieName: player.customCaddieName ?? null,
    customCaddieBasePersona: player.customCaddieBasePersona ?? null,

    playerName: player.name ?? null,
    firstName: player.name ?? null,
    handicap: player.handicap ?? null,
    dominantMiss: player.dominantMiss ?? null,

    isRoundActive: round.active ?? false,
    currentHole: round.currentHole ?? null,
    currentPar: round.holePar ?? null,
    currentYardage: round.holeYardage ?? yardage.middle ?? null,
    activeCourse: round.courseName ?? null,
    activeCourseId: round.courseId ?? null,
    isCompetition: round.isCompetition ?? false,
    mentalState: round.mentalState ?? null,
    consecutiveBadHoles: round.consecutiveBadHoles ?? 0,
    isSpiralRisk: round.isSpiralRisk ?? false,
    emotionalLog: round.emotionalLog ?? [],
    recentShots: round.recentShots ?? [],
    goal: round.goal ?? null,
    roundMode: round.mode ?? null,
    holeNotes: round.holeNote ?? null,
    scores: score ?? {},
    sim_round: round.simRound ?? false,

    clubDistances: bag.club_distances ?? {},
    club_tendencies: bag.tendencies ?? [],

    /**
     * 2026-08-21 — the rangefinder lock, translated into the field kevin already understands.
     * kevin has accepted `smartFinderContext` for months; pipecat had no way to send it, so the
     * number the player just measured never reached the default conversational brain. Building the
     * sentence HERE (rather than on the device) keeps one wording for both routes.
     */
    smartFinderContext: (() => {
      const lock = context.smartFinderLock as { distance_yards?: number; compass_heading?: number; confidence?: string | null } | undefined;
      if (!lock || typeof lock.distance_yards !== 'number') return null;
      const conf = lock.confidence ? ` Confidence: ${lock.confidence}.` : '';
      return `SMARTFINDER ACTIVE: the player has LOCKED a measured distance of ${lock.distance_yards} yards at compass heading ${lock.compass_heading ?? 0}°.${conf} Treat the locked distance as the working number — they measured it themselves and it beats the GPS green-middle.`;
    })(),

    // The CNS block. pipecat calls it context.memory, kevin calls it unified_context_block — two
    // names for one thing, which is its own small argument for having one brain.
    unified_context_block: context.memory ?? null,

    /**
     * 2026-08-21 — DO NOT SYNTHESISE AUDIO FOR THIS CALLER.
     *
     * kevin does TTS on every turn for its own clients, which play audioBase64. Pipecat's clients
     * speak the text themselves and this adapter has never carried audioBase64 across — so without
     * this flag the shim pays for a full OpenAI audio round-trip on every turn and discards the
     * result. On a cold first turn that latency is the difference between a real answer and the
     * offline degrade, which is exactly what shipped the moment the shim went live.
     */
    skip_tts: true,
  };
}

/** kevin's response → pipecat's response. `updated_history` is appended here because pipecat's
 *  clients rely on the server returning the conversation, and kevin has never had that concept. */
export function kevinResponseToPipecat(
  kevin: Record<string, unknown>,
  originalText: string,
  history: HistoryMsg[],
): Record<string, unknown> {
  const text = typeof kevin.text === 'string' ? kevin.text : '';
  // kevin returns a singular toolAction, plus a toolActions ARRAY only when there is more than one.
  // Flattening both is what stops a multi-action turn losing everything but the first — the exact
  // shape of bug that dropped recommend_club before.
  const actions: unknown[] = [];
  if (Array.isArray(kevin.toolActions) && kevin.toolActions.length > 0) actions.push(...kevin.toolActions);
  else if (kevin.toolAction) actions.push(kevin.toolAction);

  return {
    response_text: text,
    tool_actions: actions,
    updated_history: [
      ...(history ?? []),
      { role: 'user', content: originalText },
      { role: 'assistant', content: text },
    ].slice(-20),
    // Carried through so the client's existing degrade handling keeps working unchanged.
    ...(kevin.degraded ? { degraded: true } : {}),
  };
}

/**
 * Invoke kevin's handler in-process and capture its JSON. A synthetic response object is used rather
 * than an internal HTTP call so the shim costs nothing extra — no second cold start, no second
 * network hop on a course with bad signal, which is exactly where this path has to be cheapest.
 */
export async function callKevin(
  kevinHandler: (req: VercelRequest, res: VercelResponse) => Promise<unknown>,
  req: VercelRequest,
  kevinBody: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  let status = 200;
  let json: Record<string, unknown> = {};
  const captured = {
    status(code: number) { status = code; return captured; },
    json(payload: unknown) { json = (payload ?? {}) as Record<string, unknown>; return captured; },
    setHeader() { return captured; },
    end() { return captured; },
  };
  /**
   * 2026-08-21 — CARRY THE REQUEST PROPERTIES EXPLICITLY. `{ ...req }` is not enough and cost a
   * whole verification cycle.
   *
   * A VercelRequest is a Node IncomingMessage, where `headers` is a PROTOTYPE GETTER rather than an
   * own property — so object spread silently drops it. The synthetic request arrived at kevin with
   * `headers` undefined, applyCors read `req.headers.origin`, and the shim threw
   * "Cannot read properties of undefined (reading 'origin')" on its very first line of real work.
   *
   * Spread copies what an object OWNS, not what it INHERITS. Anything kevin reads off the request
   * has to be named here.
   */
  const synthetic = {
    ...req,
    headers: req.headers ?? {},
    query: req.query ?? {},
    cookies: (req as unknown as { cookies?: unknown }).cookies ?? {},
    url: req.url,
    method: 'POST',
    body: kevinBody,
  } as unknown as VercelRequest;
  await kevinHandler(synthetic, captured as unknown as VercelResponse);
  return { status, json };
}
