/**
 * RETRIEVE — conservative, offline retrieval over the golf-knowledge corpus.
 *
 * This is the read side that a later RAG step (Increment 3) will use to inject
 * the relevant SLICE of knowledge into the caddie brain prompt — never the
 * whole corpus. Matching is intentionally conservative: it favors whole-phrase
 * alias/topic hits and only falls back to keyword overlap, so the caddie pulls
 * facts that are actually on-topic rather than loosely associated.
 *
 * Pure / local / synchronous / offline. No React, no Node, no fetch.
 */

import type { KBEntry, KBLayer, KBHonesty } from './schema';
import { GOLF_KNOWLEDGE } from './modules';

/** Normalize text for matching: lowercase, strip punctuation, collapse space. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words ignored when scoring keyword overlap (too common to be meaningful). */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for',
  'is', 'it', 'this', 'that', 'my', 'me', 'i', 'do', 'how', 'what', 'why',
  'should', 'can', 'with', 'too', 'so', 'am', 'are', 'be', 'get', 'got',
  'keep', 'keeps', 'have', 'has', 'when', 'does', 'help', 'about', 'your',
]);

function contentWords(s: string): string[] {
  return norm(s).split(' ').filter(w => w.length >= 3 && !STOP.has(w));
}

interface Scored {
  entry: KBEntry;
  score: number;
}

/**
 * 2026-07-26 (deep audit — wire the dormant personalization) — the player's REAL known signals, used to
 * (a) rerank KB entries toward this specific player and (b) tell the brain to TAILOR a generic principle
 * to them. Built server-side from context.player / context.bag (dominantMiss, handedness, …) — see the
 * brain routes. HONEST by construction: only keys with a real value personalize; unknown → generic entry,
 * never a fabricated one.
 */
export interface CnsProfile {
  /** cnsPersonalize key → concise real value, e.g. { dominantMiss: 'slice', handedness: 'left' }. */
  signals?: Record<string, string>;
  /** appSignals that are LIVE for this player right now, e.g. ['tempo','bag','gps'] (grounding). */
  liveSignals?: string[];
}

/** Personalization boost: an on-topic entry whose cnsPersonalize matches a signal the player HAS. */
const CNS_MATCH_BOOST = 4;

/** True when the entry personalizes against a dimension the player has a real value for. */
function personalizationMatch(entry: KBEntry, profile?: CnsProfile): boolean {
  const sig = profile?.signals;
  if (!sig || !entry.cnsPersonalize?.length) return false;
  return entry.cnsPersonalize.some(k => typeof sig[k] === 'string' && sig[k].trim().length > 0);
}

/**
 * Score one entry against the normalized query.
 *   - whole-phrase alias contained in the query → strong (10 + alias length)
 *   - topic phrase contained in the query → solid (8)
 *   - module name appears as a query word → light (3)
 *   - keyword overlap (alias/topic/principle words ∩ query words) → 1 each
 * Returns 0 when nothing meaningful matches.
 */
function scoreEntry(entry: KBEntry, q: string, qWords: Set<string>): number {
  let score = 0;

  // Whole-phrase alias containment — the strongest, most intentional signal.
  for (const alias of entry.aliases) {
    const na = norm(alias);
    if (na.length >= 3 && q.includes(na)) {
      score += 10 + Math.min(na.length, 20) / 10;
    }
  }

  // Topic phrase containment.
  const nt = norm(entry.topic);
  if (nt.length >= 3 && q.includes(nt)) score += 8;

  // Module token present as a discrete word.
  const moduleWord = entry.module.replace(/_/g, ' ');
  if (qWords.has(moduleWord) || norm(moduleWord).split(' ').some(w => qWords.has(w))) {
    score += 3;
  }

  // Keyword overlap across aliases + topic + principle (lighter, capped).
  let overlap = 0;
  const bag = [
    ...entry.aliases.flatMap(contentWords),
    ...contentWords(entry.topic),
    ...contentWords(entry.principle),
  ];
  const seen = new Set<string>();
  for (const w of bag) {
    if (qWords.has(w) && !seen.has(w)) {
      seen.add(w);
      overlap += 1;
    }
  }
  // Cap raw keyword overlap so a long principle can't outscore a real alias hit.
  score += Math.min(overlap, 4);

  return score;
}

export interface RetrieveOpts {
  /** Max entries to return (default 4). */
  max?: number;
  /** Restrict to these knowledge layers. */
  layers?: KBLayer[];
  /**
   * Minimum relevance score to include (default 2 = FLOOR). Standalone OFFLINE
   * answering passes a higher bar (a real alias/topic match, e.g. 8) so loose
   * keyword overlap isn't served as a confident answer with no LLM to filter it.
   * The brain's RAG grounding keeps the low default — it filters relevance itself.
   * 2026-06-29 (Tim) — this is the "no vortex" gate.
   */
  minScore?: number;
  /**
   * 2026-07-26 — the player's real signals. When present, an ON-TOPIC entry whose cnsPersonalize matches
   * a known signal gets a small rerank boost so the slice-fix (not the hook-fix) surfaces for a slicer.
   * Never lifts an off-topic entry (boost only applies when the base relevance score is already > 0).
   */
  cnsProfile?: CnsProfile;
}

/**
 * Retrieve the most relevant KB entries for a transcript/query. Conservative
 * and capped — returns [] when nothing scores above the floor.
 */
export function retrieveKB(query: string, opts: RetrieveOpts = {}): KBEntry[] {
  const max = opts.max ?? 4;
  const q = norm(query);
  if (!q) return [];

  const qWords = new Set(contentWords(query));

  let pool = GOLF_KNOWLEDGE;
  if (opts.layers && opts.layers.length) {
    const allow = new Set(opts.layers);
    pool = pool.filter(e => allow.has(e.layer));
  }

  const scored: Scored[] = [];
  for (const entry of pool) {
    const base = scoreEntry(entry, q, qWords);
    if (base <= 0) continue; // never let personalization surface an off-topic entry
    // On-topic AND personalizes to a dimension this player actually has → nudge it up the list.
    const score = base + (personalizationMatch(entry, opts.cnsProfile) ? CNS_MATCH_BOOST : 0);
    scored.push({ entry, score });
  }

  // Require a minimal floor so a single weak keyword doesn't surface noise.
  // Callers answering standalone (offline, no LLM filter) pass a higher minScore.
  const FLOOR = opts.minScore ?? 2;
  scored.sort((a, b) => b.score - a.score);

  return scored
    .filter(s => s.score >= FLOOR)
    .slice(0, max)
    .map(s => s.entry);
}

/** Humanize a cnsPersonalize key for the prompt hint ('dominantMiss' → 'dominant miss'). */
function humanizeKey(k: string): string {
  return k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
}

/**
 * Compact text block for prompt injection. One tight bullet per entry:
 *   "• <principle> [<honesty>]"
 * 2026-07-26 (deep audit — wire personalization) — when a `cnsProfile` is supplied, an entry tagged to
 * personalize against a dimension the player HAS a real value for gets a compact tailoring directive
 * appended ("→ tailor to this player: dominant miss: slice"), and an entry grounded in a signal that's
 * LIVE for this player is marked so the brain speaks it as measured. Both fire ONLY from real values —
 * an unknown dimension stays generic (no fabrication). Without a profile, behavior is unchanged.
 * Returns '' when there are no entries (so the caller can omit the section).
 */
export function kbForPrompt(entries: KBEntry[], cnsProfile?: CnsProfile): string {
  if (!entries.length) return '';
  const sig = cnsProfile?.signals;
  const live = cnsProfile?.liveSignals?.length ? new Set(cnsProfile.liveSignals) : null;
  return entries
    .map(e => {
      let line = `• ${e.principle}${e.honesty ? ` [${e.honesty}]` : ''}`;
      // Tailoring directive — only for dimensions the player has a real value for.
      if (sig && e.cnsPersonalize?.length) {
        const matched = e.cnsPersonalize
          .filter(k => typeof sig[k] === 'string' && sig[k].trim().length > 0)
          .map(k => {
            const v = sig[k].trim();
            // 'known' is a dimension flag — the detail lives in the CNS memory block the brain already
            // has, so just name the dimension. A concrete value (dominant miss: slice) is shown inline.
            return v === 'known' ? humanizeKey(k) : `${humanizeKey(k)}: ${v.slice(0, 40)}`;
          });
        if (matched.length) line += `  → tailor to this player (${matched.join('; ')})`;
      }
      // Grounding note — only when the entry's app signal is actually live for this player.
      if (live && e.appSignals?.length) {
        const grounded = e.appSignals.filter(s => live.has(s));
        if (grounded.length) line += `  → grounded in the player's ${grounded.join(', ')} data`;
      }
      return line;
    })
    .join('\n');
}

/**
 * Honesty filter — split retrieved entries by how grounded they are, so the
 * caddie can be told which facts it may state as MEASURED vs which are
 * coaching guidance only. (north-star honesty gate.)
 */
export function splitByHonesty(entries: KBEntry[]): Record<KBHonesty, KBEntry[]> {
  const out: Record<KBHonesty, KBEntry[]> = {
    measurable: [],
    directional: [],
    coaching_only: [],
  };
  for (const e of entries) {
    out[e.honesty ?? 'coaching_only'].push(e);
  }
  return out;
}

/** Keep only entries at or above a minimum honesty (measurable > directional > coaching_only). */
export function filterByHonesty(entries: KBEntry[], min: KBHonesty): KBEntry[] {
  const rank: Record<KBHonesty, number> = {
    coaching_only: 0,
    directional: 1,
    measurable: 2,
  };
  const floor = rank[min];
  return entries.filter(e => rank[e.honesty ?? 'coaching_only'] >= floor);
}
