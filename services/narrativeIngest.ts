/**
 * 2026-07-08 (Tim — "the getting-to-know-you can't be a form; it has to be an open
 * conversation with the caddie that INGESTS what you say into your profile, always").
 *
 * Always-on narrative ingestion. Observes the caddie CONVERSATION LOG and, off-round,
 * distills what the golfer says about themselves (experience, practice, time, likes,
 * dislikes, work areas, goals, life context) into the CNS narrative
 * (caddieMemoryStore.recordNarrative) via /api/narrative-extract. So talking to the
 * caddie — anywhere, anytime — teaches it who you are and it fits its coaching to you.
 *
 * FREEZE-SAFE: this is a pure OBSERVER of the conversation-log store. It never touches
 * the voice path, transcription, VAD, or the response flow — it just reads user turns
 * and writes the narrative. Best-effort, throttled, fire-and-forget; a failure loses
 * nothing visible and never blocks a conversation.
 *
 * Round conversations already distill at endRound (roundStore → recordReflection); this
 * is the OFF-round path the caddie-tab "talk to me" conversation runs on.
 */

import { useConversationLog, type ConversationTurn } from '../store/conversationLogStore';
import { getApiBaseUrl } from './apiBase';

let started = false;
let lastProcessedAt = 0;      // `at` timestamp of the newest user turn we've ingested
let lastIngestMs = 0;         // wall-clock of the last extract call (throttle)
let inFlight = false;

const MIN_NEW_USER_TURNS = 2;   // wait for a couple of real turns before spending a call
const THROTTLE_MS = 40_000;     // at most ~1 extract per 40s of conversation

/** Is a round active? Off-round is where the get-to-know-you conversation lives; a live
 *  round distills separately at endRound, and mid-round chat is tactical, not narrative. */
function roundActive(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const r = require('../store/roundStore') as typeof import('../store/roundStore');
    return r.useRoundStore.getState().isRoundActive;
  } catch { return false; }
}

async function ingest(newUserTurns: ConversationTurn[]): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const text = newUserTurns.map((t) => t.text).join(' ').slice(0, 3500);
    if (!text.trim()) return;
    const res = await fetch(`${getApiBaseUrl().replace(/\/+$/, '')}/api/narrative-extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const json = (await res.json().catch(() => ({}))) as { facts?: Record<string, unknown>; configured?: boolean };
    if (!res.ok || json.configured === false || !json.facts) return;
    // Only write when something durable was actually extracted (empty is a valid, common result).
    const f = json.facts;
    const hasFact = ['experience', 'practiceFrequency', 'timeAvailable'].some((k) => typeof f[k] === 'string' && (f[k] as string).trim())
      || ['likes', 'dislikes', 'workAreas', 'strengths', 'goals', 'story'].some((k) => Array.isArray(f[k]) && (f[k] as unknown[]).length > 0);
    if (!hasFact) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mem = require('../store/caddieMemoryStore') as typeof import('../store/caddieMemoryStore');
    type NarrativeInput = Parameters<ReturnType<typeof mem.useCaddieMemoryStore.getState>['recordNarrative']>[0];
    mem.useCaddieMemoryStore.getState().recordNarrative({ ...(f as Record<string, unknown>), nowMs: Date.now() } as NarrativeInput);
  } catch { /* ingestion is additive — never surface */ } finally {
    inFlight = false;
  }
}

function maybeIngest(turns: ConversationTurn[]): void {
  if (roundActive()) return; // off-round only
  const now = Date.now();
  if (now - lastIngestMs < THROTTLE_MS) return;
  const newUser = turns.filter((t) => t.role === 'user' && t.at > lastProcessedAt);
  if (newUser.length < MIN_NEW_USER_TURNS) return;
  lastProcessedAt = newUser[newUser.length - 1].at;
  lastIngestMs = now;
  void ingest(newUser);
}

/** Start observing the conversation log. Idempotent; call once at app init. */
export function initNarrativeIngest(): void {
  if (started) return;
  started = true;
  try {
    // Seed the watermark so we don't re-ingest the whole persisted backlog on boot.
    const existing = useConversationLog.getState().turns;
    const lastUser = [...existing].reverse().find((t) => t.role === 'user');
    lastProcessedAt = lastUser?.at ?? 0;
    useConversationLog.subscribe((state) => maybeIngest(state.turns));
  } catch { /* observer is best-effort */ }
}
