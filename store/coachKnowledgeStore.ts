/**
 * 2026-05-25 — Fix AF: coach-refinement knowledge store.
 *
 * The real Tank (Marc Ward) needs to refine the caddie's definitions
 * in his own words during testing. Flow:
 *   1. User asks: "what is Smash Factor"
 *   2. Caddie answers
 *   3. Marc says trigger phrase ("remember this" / "add to brain" /
 *      "here's how I'd say it" / "let me refine that")
 *   4. Mic auto-opens (longer window — explanations are longer)
 *   5. Marc speaks his refined explanation
 *   6. Refinement persists here, indexed by topic (extracted from
 *      Marc's prior turn or first words)
 *   7. Future brain calls include matching coach refinements in the
 *      system prompt — caddie uses Marc's framing going forward
 *
 * Persisted to AsyncStorage. Capped at 200 entries (FIFO).
 *
 * Scoping: coach refinements are GLOBAL — they're Marc's expertise
 * being teachable to every persona for every user. Topic-keyed so a
 * refinement on "smash factor" shows up only when smash factor is
 * relevant. Authored by `authoredByEmail` for provenance.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

export interface CoachKnowledgeEntry {
  /** Stable id. */
  id: string;
  /** ms-since-epoch when authored. */
  timestamp: number;
  /** Topic this refinement applies to ("smash factor", "early
   *  extension", etc). Used for retrieval matching. Lowercase. */
  topic: string;
  /** Marc's prior question / the prompt that triggered the refinement.
   *  Optional context — helps the brain see WHY the refinement was
   *  authored. */
  prior_question: string | null;
  /** The caddie's original answer (what Marc is refining). */
  caddie_original_answer: string | null;
  /** Marc's refined explanation in his own words. The CORE payload. */
  refinement: string;
  /** Author email — provenance. Lets us scope retrieval to
   *  trusted coaches later if multiple people author. */
  authoredByEmail: string | null;
}

interface CoachKnowledgeState {
  entries: CoachKnowledgeEntry[];
  addEntry: (
    topic: string,
    refinement: string,
    opts?: {
      prior_question?: string | null;
      caddie_original_answer?: string | null;
      authoredByEmail?: string | null;
    },
  ) => void;
  /** Retrieve up to N entries whose topic matches the query
   *  (substring, case-insensitive). Returns newest first so the most
   *  recent refinement wins on the same topic. */
  matchByTopic: (query: string, max?: number) => CoachKnowledgeEntry[];
  remove: (id: string) => void;
  clearAll: () => void;
}

const MAX_ENTRIES = 200;
const DEFAULT_MATCH_MAX = 3;

export const useCoachKnowledgeStore = create<CoachKnowledgeState>()(
  persist(
    (set, get) => ({
      entries: [],
      addEntry: (topic, refinement, opts) => {
        const t = topic.trim().toLowerCase();
        const r = refinement.trim();
        if (!t || !r) return;
        const entry: CoachKnowledgeEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          topic: t,
          prior_question: opts?.prior_question ?? null,
          caddie_original_answer: opts?.caddie_original_answer ?? null,
          refinement: r,
          authoredByEmail: opts?.authoredByEmail ?? null,
        };
        set(s => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
        console.log('[coachKnowledge] new refinement on', t, '·', r.slice(0, 60));
      },
      matchByTopic: (query, max = DEFAULT_MATCH_MAX) => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        return get().entries
          .filter(e => q.includes(e.topic) || e.topic.includes(q))
          .slice(0, max);
      },
      remove: (id) => set(s => ({ entries: s.entries.filter(e => e.id !== id) })),
      clearAll: () => set({ entries: [] }),
    }),
    {
      name: 'coach-knowledge-v1',
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);

/**
 * Cheap helper that returns coach refinements as a context blob ready
 * to interpolate into Kevin's system prompt. Empty string when none
 * match. Pairs each entry with its author so the brain can weight
 * trusted-coach refinements higher than random user refinements (when
 * we expand authoring later).
 */
export function getCoachKnowledgeForMessage(message: string): string {
  const matches = useCoachKnowledgeStore.getState().matchByTopic(message, 3);
  if (matches.length === 0) return '';
  const lines = matches.map(m =>
    `- On "${m.topic}" (coach refinement${m.authoredByEmail ? ` by ${m.authoredByEmail}` : ''}): "${m.refinement}"`,
  );
  return `COACH REFINEMENTS (use these as the authoritative framing for the topics below — trusted coach voice, supersedes the default explanation):\n${lines.join('\n')}`;
}
