/**
 * 2026-07-01 (whole-app audit — mic convergence). ONE conversational brain for every mic.
 *
 * The caddie-tab mic already routed conversational turns to the pipecat brain, but the universal
 * badge / earbud / hands-free path (services/listeningSession) still hit legacy /api/kevin directly,
 * so "the one way to talk to the unified caddie" reached a DIFFERENT brain. This routes those turns
 * to the SAME pipecat brain (with the SAME rich context via buildPipecatContext) — and, critically,
 * falls back to the legacy kevin call on ANY pipecat failure, so the earbud path can never break
 * worse than it does today. Default orchestrator is pipecat; an explicit 'kevin' setting still works.
 */

import { getApiBaseUrl } from './apiBase';
import { useSettingsStore } from '../store/settingsStore';
import { getActiveCaddie } from './caddieResolver';
import { useRoundStore } from '../store/roundStore';
import { buildPipecatContext } from './pipecatContext';
import { getCaddieContext, mergeMemoryIntoContext } from './caddieMemoryRetrieval';
import { screenContextForPrompt } from './screenContext';

export interface BrainReply {
  text: string | null;
  audioBase64: string | null;
  /** Normalized tool actions to dispatch (may be empty). Both brains map into this shape. */
  toolActions: unknown[];
  /** Which brain answered — telemetry / debugging. */
  source: 'pipecat' | 'kevin' | 'none';
}

// 2026-07-01 (audit — MIC CONVERGENCE) — was a private `pipecatHistory` disjoint
// from usePipecatVoice's, and never cleared. Now shares the ONE history module so
// the caddie keeps context across mics + resets on round boundaries.
import { getPipecatHistory, setPipecatHistory, appendPipecatTurn, clearPipecatHistory } from './voice/pipecatHistory';
export function clearConversationalHistory(): void { clearPipecatHistory(); }

async function tryPipecat(utterance: string, timeoutMs: number): Promise<BrainReply | null> {
  try {
    const apiBase = getApiBaseUrl().replace(/\/+$/, '');
    const secret = process.env.EXPO_PUBLIC_PIPECAT_SECRET ?? '';
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(`${apiBase}/api/pipecat-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        secret,
        text: utterance,
        history: getPipecatHistory(),
        context: buildPipecatContext(),
        screen_context: screenContextForPrompt(),
      }),
    }).finally(() => clearTimeout(t));
    if (!resp.ok) return null;
    const j = (await resp.json()) as { response_text?: string; tool_actions?: unknown[]; updated_history?: { role: string; content: string }[]; degraded?: boolean };
    // 2026-07-23 (V1 fix) — the server returns 200 with degraded:true when all providers failed /
    // it threw. Treat it as a miss so this path falls through to tryKevin instead of returning the
    // canned "ask me again" as a legitimate source:'pipecat' answer.
    if (j.degraded === true) return null;
    let text = typeof j.response_text === 'string' && j.response_text.trim() ? j.response_text : null;
    const hasTools = Array.isArray(j.tool_actions) && j.tool_actions.length > 0;
    // 2026-07-06 (voice-lifecycle audit #11) — a TOOL-ONLY reply (empty text, real
    // actions) was thrown away and the turn RE-RUN through legacy kevin: second
    // brain call, different answer, original actions lost. Keep the actions and
    // speak a minimal ack instead.
    if (!text && hasTools) text = 'Done.';
    if (!text) return null;
    if (Array.isArray(j.updated_history)) setPipecatHistory(j.updated_history);
    else appendPipecatTurn(utterance, text);
    return { text, audioBase64: null, toolActions: Array.isArray(j.tool_actions) ? j.tool_actions : [], source: 'pipecat' };
  } catch {
    return null;
  }
}

async function tryKevin(utterance: string, timeoutMs: number): Promise<BrainReply | null> {
  try {
    const apiBase = getApiBaseUrl().replace(/\/+$/, '');
    const settings = useSettingsStore.getState();
    const round = useRoundStore.getState();
    // 2026-07-01 (audit — MIC CONVERGENCE) — the kevin FALLBACK used to ship a
    // starved payload, so when pipecat was down the earbud/watch reply came from a
    // stranger (no name, handicap, or miss tendency). Fold in the same core
    // personalization the main kevin path sends so the fallback still sounds like
    // the player's caddie. Best-effort read; /api/kevin tolerates missing fields.
    const profile = (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('../store/playerProfileStore').usePlayerProfileStore.getState() as {
          name?: string; firstName?: string; handicap?: number; dominantMiss?: string | null;
          missType?: string | null; kevinContext?: unknown; persistentPatterns?: unknown;
          customCaddieBasePersona?: string; customCaddieName?: string | null;
        };
      } catch { return {} as Record<string, never>; }
    })();
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(`${apiBase}/api/kevin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AI-Provider': settings.aiProvider ?? 'gemini' },
      signal: controller.signal,
      body: JSON.stringify({
        message: utterance,
        language: settings.language,
        currentHole: round.isRoundActive ? round.currentHole : null,
        currentYardage: round.currentYardage ?? null,
        activeCourse: round.activeCourse,
        holeNotes: round.holeNotes,
        isRoundActive: round.isRoundActive,
        voiceGender: settings.voiceGender ?? 'male',
        persona: getActiveCaddie(), // audit C1 — per-pillar active caddie (falls back to global; see pipecatContext)
        // 2026-07-30 (voice audit #1) — a CUSTOM caddie must carry its chosen base persona + name on the
        // kevin FALLBACK too, else it reverts to Kevin's name + onyx voice whenever pipecat degrades.
        customCaddieBasePersona: profile.customCaddieBasePersona ?? 'kevin',
        customCaddieName: profile.customCaddieName ?? null,
        // 2026-07-24 (full-app audit) — the earbud→kevin FALLBACK was dropping the brain-steering
        // toggles, so Kids Mode / Response Style / intensity / Tank soft-intro silently defaulted the
        // moment pipecat degraded. Send them so the fallback caddie honors the SAME settings the
        // primary brain does (matches services/voice/brainSettings + pipecat-turn).
        responseMode: settings.responseMode ?? 'neutral',
        cecilyMode: settings.cecilyMode ?? false,
        // 2026-08-09 (deferred-minor fix) — key the intensity dial off the persona actually SENT
        // (per-pillar getActiveCaddie), not the global pick: with pillar overrides active, Serena was
        // being scaled by Kevin's dial.
        personaIntensity: settings.personaIntensity?.[getActiveCaddie()] ?? 100,
        tankSoftIntro: settings.tankSoftIntro ?? false,
        // Personalization parity with the main kevin path.
        playerName: profile.name ?? '',
        firstName: profile.firstName ?? '',
        handicap: profile.handicap ?? 18,
        dominantMiss: profile.dominantMiss ?? null,
        missType: profile.missType ?? null,
        kevinContext: profile.kevinContext ?? null,
        persistentPatterns: profile.persistentPatterns ?? null,
        recentShots: (round.shots ?? []).slice(-5),
        // 2026-08-10 (connected audit D1 — Tim: "caddie brain universal, ties to the whole CNS"). The
        // pipecat-DOWN fallback used to drop the learned block, so an earbud "what's the play / is this
        // my usual miss?" lost bag + tendencies the moment pipecat degraded. Send the SAME CNS block the
        // primary path + the on-screen kevin path send, so the degraded caddie still knows the player.
        unified_context_block: mergeMemoryIntoContext(
          null,
          getCaddieContext({
            courseId: round.activeCourseId,
            hole: round.isRoundActive ? round.currentHole : null,
            club: round.club,
          }).promptBlock,
        ),
      }),
    }).finally(() => clearTimeout(t));
    if (!resp.ok) return null;
    const j = (await resp.json()) as { text?: string; audioBase64?: string | null; toolAction?: unknown; toolActions?: unknown };
    // 2026-07-30 (audit #1 — SILENT DATA LOSS) — kevin.ts returns BOTH a single `toolAction` (the last
    // action) and the full `toolActions` array. Reading only `toolAction` dropped every action but the
    // last on a multi-action turn ("log my 5 and record my next swing" → the score write was lost).
    // Prefer the array; fall back to the single field for older server responses.
    const acts = Array.isArray(j.toolActions) && j.toolActions.length ? j.toolActions : (j.toolAction ? [j.toolAction] : []);
    return {
      text: typeof j.text === 'string' ? j.text : null,
      audioBase64: typeof j.audioBase64 === 'string' ? j.audioBase64 : null,
      toolActions: acts,
      source: 'kevin',
    };
  } catch {
    return null;
  }
}

/**
 * Route a conversational utterance to the unified brain. pipecat first (default), kevin as the
 * always-there fallback so the earbud/badge path never regresses. An explicit 'kevin' orchestrator
 * skips pipecat.
 */
export async function conversationalBrainTurn(utterance: string, opts?: { timeoutMs?: number }): Promise<BrainReply> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  // 2026-08-09 (dead-trigger audit) — the user_explicit_stuck team-intel trigger was built +
  // thresholded + had a full suggestion UI and was never called ("intent surfaced via voice" — the
  // wiring never happened). This is the single chokepoint every conversational utterance passes.
  // Conservative phrase gate; the store's per-session cap + pending guard bound it further.
  try {
    if (/(i'?m (so |really )?(stuck|frustrated)|not getting (any )?better|keep (doing|hitting) the same|what am i doing wrong)/i.test(utterance)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ti = require('./teamIntelligence') as typeof import('./teamIntelligence');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const surf = (require('./activeSurfaceRegistry') as typeof import('./activeSurfaceRegistry')).getActiveSurface();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const roundActive = (require('../store/roundStore') as typeof import('../store/roundStore')).useRoundStore.getState().isRoundActive;
      const pillar = roundActive ? 'round' as const
        : surf === 'cage' || surf === 'swing_library' || surf === 'swing_detail' ? 'cage' as const
        : surf === 'drill_detail' || surf === 'drill_session' ? 'drills' as const
        : 'play' as const;
      ti.evaluateUserExplicitStuck(pillar);
    }
  } catch { /* suggestion is best-effort — never blocks the turn */ }
  const orchestrator = useSettingsStore.getState().voiceOrchestrator ?? 'pipecat';
  if (orchestrator === 'pipecat') {
    const p = await tryPipecat(utterance, timeoutMs);
    if (p) return p;
  }
  const k = await tryKevin(utterance, timeoutMs);
  return k ?? { text: null, audioBase64: null, toolActions: [], source: 'none' };
}

/**
 * 2026-07-25 (Tim — KILL the canned opener) — generate the caddie's post-splash OPENER from the
 * BRAIN instead of a bundled mp3. The mp3 had no text anywhere in the app, so the player's reply
 * ("yes") hit the brain with EMPTY history and got a generic "what do you want to work on?" — the
 * "simpleton, not AI" bug. This makes the opener a real, personalized brain line AND — critically —
 * SEEDS the shared conversation history with it (assistant turn), so the very next reply is answered
 * in context. Returns text + TTS audio in one call (kevin TTS's by default). Best-effort: text:null
 * on any failure and the caller simply stays silent (no canned fallback — that was the whole problem).
 */
export async function generateProactiveOpener(opts?: { timeoutMs?: number }): Promise<BrainReply> {
  const timeoutMs = opts?.timeoutMs ?? 12_000;
  try {
    const apiBase = getApiBaseUrl().replace(/\/+$/, '');
    const settings = useSettingsStore.getState();
    const profile = (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('../store/playerProfileStore').usePlayerProfileStore.getState() as {
          name?: string; firstName?: string; handicap?: number; dominantMiss?: string | null;
          missType?: string | null; kevinContext?: unknown; persistentPatterns?: unknown;
          customCaddieBasePersona?: string; customCaddieName?: string | null;
        };
      } catch { return {} as Record<string, never>; }
    })();
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(`${apiBase}/api/kevin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AI-Provider': settings.aiProvider ?? 'gemini' },
      signal: controller.signal,
      body: JSON.stringify({
        // A directive, NOT a player utterance — is_proactive tells the brain the player didn't ask.
        message: 'The player just opened the app and is on the caddie home screen (not in a round). Greet them as their caddie and open the conversation — warm, natural, one or two sentences, by name if you know it. If you know their game, you may nod to it. Never read a script.',
        is_proactive: true,
        language: settings.language,
        isRoundActive: false,
        voiceGender: settings.voiceGender ?? 'male',
        persona: getActiveCaddie(), // audit C1 — per-pillar active caddie (falls back to global; see pipecatContext)
        // 2026-07-30 (voice audit #1) — a CUSTOM caddie must carry its chosen base persona + name on the
        // kevin FALLBACK too, else it reverts to Kevin's name + onyx voice whenever pipecat degrades.
        customCaddieBasePersona: profile.customCaddieBasePersona ?? 'kevin',
        customCaddieName: profile.customCaddieName ?? null,
        // 2026-08-09 (deferred-minor fix) — key the intensity dial off the persona actually SENT
        // (per-pillar getActiveCaddie), not the global pick: with pillar overrides active, Serena was
        // being scaled by Kevin's dial.
        personaIntensity: settings.personaIntensity?.[getActiveCaddie()] ?? 100,
        tankSoftIntro: settings.tankSoftIntro ?? false,
        responseMode: settings.responseMode ?? 'neutral',
        cecilyMode: settings.cecilyMode ?? false,
        playerName: profile.name ?? '',
        firstName: profile.firstName ?? '',
        handicap: profile.handicap ?? 18,
        dominantMiss: profile.dominantMiss ?? null,
        missType: profile.missType ?? null,
        kevinContext: profile.kevinContext ?? null,
        persistentPatterns: profile.persistentPatterns ?? null,
      }),
    }).finally(() => clearTimeout(t));
    if (!resp.ok) return { text: null, audioBase64: null, toolActions: [], source: 'none' };
    const j = (await resp.json()) as { text?: string; audioBase64?: string | null };
    const text = typeof j.text === 'string' && j.text.trim() ? j.text.trim() : null;
    if (!text) return { text: null, audioBase64: null, toolActions: [], source: 'none' };
    // Seed the shared history with ONLY the caddie's opener (assistant turn). The directive above is
    // deliberately NOT recorded, so the player's next reply is answered against the greeting.
    setPipecatHistory([{ role: 'assistant', content: text }]);
    return { text, audioBase64: typeof j.audioBase64 === 'string' ? j.audioBase64 : null, toolActions: [], source: 'kevin' };
  } catch {
    return { text: null, audioBase64: null, toolActions: [], source: 'none' };
  }
}
