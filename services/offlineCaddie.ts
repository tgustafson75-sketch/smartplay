/**
 * services/offlineCaddie.ts
 *
 * 2026-06-27 — Phase A of the offline-degrade build. ONE composer that answers a
 * query with NO network, by chaining the local capabilities that already existed
 * but were never unified on the client:
 *
 *   1) tryLocalReply()  — round-state queries (yardage, club call, score, hole
 *      info, wind, plays-like, last shot) built from GPS + the logged round +
 *      learned CNS guidance. Fully localized (en/es/zh). [[localStatusResponder]]
 *
 *   2) retrieveKB()     — the on-device golf-knowledge KB (pure / synchronous /
 *      offline) for coaching & strategy questions. Until now retrieveKB ran ONLY
 *      server-side (api/kevin.ts, api/pipecat-turn.ts), injected into the LLM
 *      prompt — so the KB did nothing when the network was down even though it
 *      ships in the app bundle. This brings it to the device. [[caddie-brain-kb-spec]]
 *
 * Returns null when neither layer can answer, so the caller keeps its own
 * fallback line. Honest by construction: round answers come from real measured
 * signals (and hedge on weak GPS); KB answers are curated principles carrying
 * their own honesty tag.
 *
 * Localization note: the KB is authored in English. Non-English callers still get
 * the (localized) round-state answers but skip the KB, so we never speak English
 * coaching to an es/zh user. The on-device LLM (Phase B / Tier 2) is what will
 * add fluent, translated synthesis on top of this same grounding. [[offline-caddie-plan]]
 */

import { tryLocalReply, type LocalReplyLanguage } from './localStatusResponder';
import { retrieveKB } from './knowledgeBase/retrieve';
import type { KBEntry } from './knowledgeBase/schema';

export interface OfflineAnswer {
  text: string;
  /** Which local layer produced the answer. */
  source: 'round_state' | 'knowledge_base';
  /** localStatusResponder queryType (round_state) or KB topic (knowledge_base). */
  detail?: string;
}

/**
 * Compose a short, speakable coaching reply from the top KB entries. We surface
 * the single best principle plus one concrete cue (when present) — enough to be
 * useful spoken aloud, short enough not to ramble. No LLM: this is the honest
 * deterministic Tier-1 reply; Tier-2 (on-device LLM) will synthesize fluently
 * over the same retrieved entries.
 */
function composeKbReply(entries: KBEntry[]): string | null {
  if (!entries.length) return null;
  const top = entries[0];
  const principle = (top.principle ?? '').trim();
  if (!principle) return null;
  const parts: string[] = [principle];
  const cue = top.coachingCues?.find((c) => c && c.trim());
  if (cue) parts.push(cue.trim());
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return text || null;
}

/**
 * Answer a query with zero network. Round-state first (most specific + grounded),
 * then the golf-knowledge KB. Returns null if neither can help.
 */
export function answerOffline(
  query: string,
  language: LocalReplyLanguage = 'en',
): OfflineAnswer | null {
  if (!query || typeof query !== 'string' || !query.trim()) return null;

  // 1) Round-state — the most specific, fully localized, signal-grounded layer.
  try {
    const local = tryLocalReply(query, language);
    if (local) {
      return { text: local.text, source: 'round_state', detail: local.queryType };
    }
  } catch {
    // tryLocalReply is defensive, but never let a store hiccup block the KB pass.
  }

  // 2) Golf-knowledge KB — English-authored, so only for EN callers for now.
  if (language === 'en') {
    try {
      const kb = composeKbReply(retrieveKB(query, { max: 2 }));
      if (kb) return { text: kb, source: 'knowledge_base' };
    } catch {
      // No KB answer — fall through to null.
    }
  }

  return null;
}
