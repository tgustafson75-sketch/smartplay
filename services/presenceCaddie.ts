/**
 * 2026-05-28 — Fix FE: "Keep the presence alive."
 *
 * Tim's rule: silence + dashes break the trust. When the exact
 * tactical answer isn't available (GPS still finding the player,
 * vision analysis failed, etc.), the caddie should fill that beat
 * with character-true context — what's KNOWN about this hole, this
 * course, this player — and a promise that the precise answer is
 * coming back when signal sharpens.
 *
 * Architecture:
 *   - Single entry: presenceFill({ trigger, context }) → returns the
 *     line as a string (or null on full failure).
 *   - Caller is responsible for SPEAKING the line — typically by
 *     returning it as IntentResult.voice_response so the listening-
 *     session's auto-speak handles it. Keeps the helper composable
 *     (callers that just want telemetry or text echo can skip speak).
 *   - Calls /api/kevin with register='presence' + the gathered
 *     context. Server prompt (api/kevin.ts) knows to produce 1-3
 *     short sentences in the active persona, ending with a "back
 *     in a beat" implication.
 *   - Caches the line for 60s per trigger so repeat asks during the
 *     same drought don't spam the brain.
 *   - On API failure, falls back to a local synthesis pulled from
 *     the same context (concrete hole + par fact + promise). The
 *     presence MUST land — that's the whole point.
 *
 * v1 surface: gps_unready trigger from queryStatusHandler distance
 *   branches. Other surfaces (analysis_failed on SmartMotion,
 *   library_empty etc.) can plug in by adding to the trigger union.
 */

// 2026-05-28 — Fix FI: trigger union expanded beyond gps_unready.
// Each trigger represents a moment where the exact tactical answer
// isn't available and the caddie should fill it with presence rather
// than dropping into silence / canned UI text. The brain prompt in
// api/kevin.ts knows how to handle each trigger string.
type PresenceTrigger = 'gps_unready' | 'analysis_failed' | 'mic_blocked';

interface PresenceContext {
  /** Course-side context the brain uses to ground the patter. */
  courseName?: string | null;
  holeNumber?: number | null;
  par?: number | null;
  teeYardage?: number | null;
  /** Last score / typical contact on this hole if available. */
  lastScoreThisHole?: number | null;
  /** Player + persona context — same shape as other /api/kevin calls. */
  playerName?: string | null;
  persona?: 'kevin' | 'serena' | 'tank' | 'harry' | null;
  /** 2026-05-28 — Fix FI: swing context for analysis_failed trigger.
   *  Lets the brain reference the club / user's note instead of just
   *  apologizing for a generic failure. */
  swingTitle?: string | null;
  club?: string | null;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<PresenceTrigger, { line: string; expiresAt: number }>();

interface PresenceFillOpts {
  trigger: PresenceTrigger;
  context: PresenceContext;
}

/**
 * Compose the patience line. Returns the line as a string (caller
 * speaks it). On full failure returns null — caller should fall back
 * to whatever original silent path it was avoiding.
 *
 * Throttled per trigger: if a presence line for this trigger was
 * generated within CACHE_TTL_MS, the cached line is reused rather
 * than calling the brain again. Keeps cost + latency down on rapid
 * re-asks during the same drought.
 */
export async function presenceFill(opts: PresenceFillOpts): Promise<string | null> {
  const { trigger, context } = opts;
  const now = Date.now();
  const cached = cache.get(trigger);

  if (cached && cached.expiresAt > now) {
    return cached.line;
  }

  let line: string | null = null;
  line = await fetchPresenceFromBrain(trigger, context).catch(() => null);
  if (!line) {
    // Brain unavailable — never break the presence; fall back to
    // local synthesis from the same context.
    line = localPresenceFallback(trigger, context);
  }
  if (line) {
    cache.set(trigger, { line, expiresAt: now + CACHE_TTL_MS });
  }
  return line;
}

async function fetchPresenceFromBrain(
  trigger: PresenceTrigger,
  context: PresenceContext,
): Promise<string | null> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  if (!apiUrl) return null;
  try {
    const playerLine = context.playerName ? `Player: ${context.playerName}.` : '';
    const courseLine = context.courseName ? `Course: ${context.courseName}.` : '';
    const holeLine =
      context.holeNumber != null
        ? `Hole ${context.holeNumber}${context.par != null ? `, par ${context.par}` : ''}${context.teeYardage != null ? `, plays ${context.teeYardage} from the tees` : ''}.`
        : '';
    const histLine =
      context.lastScoreThisHole != null
        ? `Last time on this hole: scored ${context.lastScoreThisHole}.`
        : '';
    const swingLine = context.swingTitle
      ? `Swing: ${context.swingTitle}${context.club ? ` (${context.club})` : ''}.`
      : context.club
        ? `Club: ${context.club}.`
        : '';
    const triggerLine =
      trigger === 'gps_unready'
        ? 'GPS still acquiring — exact yardage will be back in a moment. Give the player a brief presence beat using what is known about the hole + their history. Do NOT apologize. End with a phrase implying yardage returns soon.'
        : trigger === 'analysis_failed'
          ? 'The visual swing analyzer could not get a clean read on this clip (lighting, angle, or video quality). Acknowledge briefly without piling on apologies, point to what could be tried next (re-record at better angle, or tap re-analyze), and reassure the player that one missed read does not change the read of their game.'
          : trigger === 'mic_blocked'
            ? 'Cage Mode wants the microphone for strike detection but the user has not granted permission. Briefly explain why the mic matters (catching the impact transient so we can time the swing), invite them to enable it in settings, and stay warm — this is a permission moment, not a failure.'
            : 'Keep the presence alive briefly while the signal returns.';

    const message =
      `${triggerLine}\n\n` +
      `Context:\n${[playerLine, courseLine, holeLine, histLine, swingLine].filter(Boolean).join(' ')}\n\n` +
      `Give ONE response: 1-3 sentences, ~10-25 words, in the active persona's voice. Stay in PRESENCE register.`;

    const res = await fetch(`${apiUrl}/api/kevin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        register: 'presence',
        persona: context.persona ?? undefined,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string; reply?: string; message?: string };
    const text = (data.response ?? data.reply ?? data.message ?? '').trim();
    return text.length > 0 ? text : null;
  } catch (e) {
    console.log('[presenceCaddie] brain fetch failed:', e);
    return null;
  }
}

/**
 * Last-ditch local fallback. Caddie character is generic here (no
 * persona-specific phrasing — that requires the brain) but the
 * presence still lands. Use when the brain endpoint is unreachable.
 */
function localPresenceFallback(trigger: PresenceTrigger, ctx: PresenceContext): string {
  if (trigger === 'gps_unready') {
    const holePart =
      ctx.holeNumber != null
        ? `Hole ${ctx.holeNumber}${ctx.par != null ? `, par ${ctx.par}` : ''}${ctx.teeYardage != null ? `, plays ${ctx.teeYardage} from the tees` : ''}.`
        : '';
    const histPart =
      ctx.lastScoreThisHole != null
        ? ` Last time here you carded a ${ctx.lastScoreThisHole}.`
        : '';
    return `Still finding you. ${holePart}${histPart} Yardage right back when signal sharpens.`.replace(/\s+/g, ' ').trim();
  }
  if (trigger === 'analysis_failed') {
    const clubPart = ctx.club ? ` your ${ctx.club}` : ' that swing';
    return `Couldn't get a clean read on${clubPart} — could be lighting or angle. Try re-analyze, or grab another from a cleaner side view. One missed clip doesn't change what I know about your game.`;
  }
  if (trigger === 'mic_blocked') {
    return `Need the mic for Cage Mode — that's how I catch the impact to time the swing. Pop into settings and turn it on, and we're back in business.`;
  }
  return 'Hold tight — back to you in a beat.';
}
