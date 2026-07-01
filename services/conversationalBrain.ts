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

// Rolling conversation history for the pipecat path so multi-turn earbud chats keep context.
let pipecatHistory: { role: string; content: string }[] = [];
export function clearConversationalHistory(): void { pipecatHistory = []; }

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
        history: pipecatHistory,
        context: buildPipecatContext(),
        screen_context: screenContextForPrompt(),
      }),
    }).finally(() => clearTimeout(t));
    if (!resp.ok) return null;
    const j = (await resp.json()) as { response_text?: string; tool_actions?: unknown[]; updated_history?: { role: string; content: string }[] };
    const text = typeof j.response_text === 'string' && j.response_text.trim() ? j.response_text : null;
    if (!text) return null;
    if (Array.isArray(j.updated_history)) pipecatHistory = j.updated_history.slice(-12);
    else pipecatHistory = [...pipecatHistory, { role: 'user', content: utterance }, { role: 'assistant', content: text }].slice(-12);
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
