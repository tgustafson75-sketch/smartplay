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
import { useRoundStore } from '../store/roundStore';
import { buildPipecatContext } from './pipecatContext';
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
        persona: settings.caddiePersonality,
        // Personalization parity with the main kevin path.
        playerName: profile.name ?? '',
        firstName: profile.firstName ?? '',
        handicap: profile.handicap ?? 18,
        dominantMiss: profile.dominantMiss ?? null,
        missType: profile.missType ?? null,
        kevinContext: profile.kevinContext ?? null,
        persistentPatterns: profile.persistentPatterns ?? null,
        recentShots: (round.shots ?? []).slice(-5),
      }),
    }).finally(() => clearTimeout(t));
    if (!resp.ok) return null;
    const j = (await resp.json()) as { text?: string; audioBase64?: string | null; toolAction?: unknown };
    return {
      text: typeof j.text === 'string' ? j.text : null,
      audioBase64: typeof j.audioBase64 === 'string' ? j.audioBase64 : null,
      toolActions: j.toolAction ? [j.toolAction] : [],
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
  const orchestrator = useSettingsStore.getState().voiceOrchestrator ?? 'pipecat';
  if (orchestrator === 'pipecat') {
    const p = await tryPipecat(utterance, timeoutMs);
    if (p) return p;
  }
  const k = await tryKevin(utterance, timeoutMs);
  return k ?? { text: null, audioBase64: null, toolActions: [], source: 'none' };
}
