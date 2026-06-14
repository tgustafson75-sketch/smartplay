/**
 * 2026-06-13 — Conversation distiller (the CNS ingestion fix).
 *
 * The conversation log captures every dialogue turn but nothing ever read it back
 * into memory — the richest learning signal was stranded (CNS audit G1). This pulls
 * DURABLE, HIGH-CONFIDENCE golf signals out of what the player actually SAID this
 * round and returns them as short takeaway notes, which round-end folds into the
 * CNS reflection (caddieMemoryStore.recordReflection) so the brain can recall them
 * next round.
 *
 * HONESTY: narrow patterns only (the localIntentPrecheck philosophy — a false
 * positive is worse than a miss). It NEVER infers a number or a tendency the player
 * didn't state; if nothing matches, it returns []. Pure, sync, never throws,
 * deterministic → unit-tested. No LLM, no network (a cloud summary can enrich the
 * same reflection later, like the recap does). See memory: caddie-cns,
 * self-growing-agent-architecture.
 */

export interface ConversationTurnLike {
  role: 'caddie' | 'user';
  text: string;
  at: number;
}

const MISS_WORDS: Record<string, string> = {
  slic: 'slice', hook: 'hook', pull: 'pull', push: 'push', chunk: 'chunk',
  thin: 'thin', top: 'top', fat: 'fat', block: 'block', shank: 'shank', skull: 'thin',
};

function normalizeMiss(token: string): string | null {
  const t = token.toLowerCase();
  for (const key of Object.keys(MISS_WORDS)) {
    if (t.startsWith(key)) return MISS_WORDS[key];
  }
  return null;
}

/**
 * Distill durable signals from the player's utterances this round. Returns up to
 * `max` short notes (deduped). Only the USER's words are mined — the caddie's own
 * lines aren't "learning" about the player.
 */
export function distillConversation(turns: ConversationTurnLike[], max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    const k = s.toLowerCase();
    if (!seen.has(k) && out.length < max) { seen.add(k); out.push(s); }
  };

  for (const turn of turns ?? []) {
    if (!turn || turn.role !== 'user' || typeof turn.text !== 'string') continue;
    const text = turn.text.toLowerCase();

    // 1) Stated miss tendency — "I keep slicing", "I was hooking it", "I always pull".
    const miss = text.match(/\bi\s+(?:keep|kept|always|tend\s+to|am|was|been)\s+(?:hitting\s+|going\s+)?([a-z]+?)(?:ing|s|ed)?\b/);
    if (miss) {
      const m = normalizeMiss(miss[1]);
      if (m) add(`Said they're fighting a ${m}.`);
    }
    // Also "my slice / my hook" possessive form.
    const possMiss = text.match(/\bmy\s+(slic[a-z]*|hook|pull|push|chunk|thin|top|fat|block|shank)\b/);
    if (possMiss) {
      const m = normalizeMiss(possMiss[1]);
      if (m) add(`Said they're fighting a ${m}.`);
    }

    // 2) Explicit focus — "working on my tempo", "trying to fix my takeaway".
    const focus = text.match(/\b(?:working\s+on|trying\s+to\s+fix|fix\s+my|struggling\s+with)\s+(?:my\s+)?([a-z][a-z ]{2,28}?)(?:\s+(?:today|right now|lately))?\s*[.?!]?$/);
    if (focus) {
      const phrase = focus[1].trim().replace(/\s+/g, ' ');
      if (phrase.length >= 3) add(`Working on: ${phrase}.`);
    }

    // 3) Stated club carry — "my 7 iron goes 150", "driver carries 250".
    const carry = text.match(/\b(driver|\d\s*(?:wood|iron|hybrid)|pitching wedge|sand wedge|[3-9]\s*i)\b[^.?!]{0,18}?\b(?:goes|carries|flies|hits)\b[^.?!]{0,8}?(\d{2,3})\b/);
    if (carry) {
      const club = carry[1].replace(/\s+/g, ' ').trim();
      add(`Mentioned their ${club} carries about ${carry[2]}.`);
    }
  }

  return out;
}
