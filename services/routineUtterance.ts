/**
 * IS THIS A BARE "SAVE MY ROUTINE" / "WHAT'S MY ROUTINE"? — ONE ANSWER FOR THE PRECHECK AND ITS MIRROR.
 *
 * 2026-10-28 (Brain review r4). routine_save REPLACES the stored pre-round routine with the caddie's
 * last line, and it is answered before the caddie hears anything. Its regex was "save / remember /
 * keep within 20 characters of my routine", so:
 *
 *   "Do you remember my warm-up routine?"            → routine overwritten with Kevin's last line
 *   "I want to keep my warm-up short today"          → routine overwritten
 *   "Remember my stretches hurt my back last time"   → routine overwritten
 *   "What should I add to my warm-up?"               → the stored routine read back, question unheard
 *   "Tell me why my routine keeps falling apart …"   → the same
 *
 * A save is an ORDER, and the whole utterance is the order: it opens on the verb (after a filler, a
 * vocative or a polite "can you") and every word after it is part of naming the routine ("save those
 * stretches as my pre-round routine for me, Kevin"). A recall is the same shape with a read verb. Any
 * other word — "short", "hurt", "why", "add" — means he is talking ABOUT the routine, and that is the
 * caddie's.
 *
 * services/localStatusResponder (the brain-failure mirror) runs the same test, so the offline path
 * cannot overwrite the routine on a sentence the online path would not.
 *
 * Pure and dependency-free so both callers (and their tests) can import it.
 */

export type RoutineAsk = 'save' | 'recall';

const ROUTINE_NOUNS = new Set(['routine', 'stretches', 'warmup']);
/** Words that can sit around the routine noun without changing what is being asked. */
const NAMING_WORDS = new Set([
  'that', 'this', 'those', 'these', 'it', 'my', 'the', 'a', 'as', 'to', 'in', 'for', 'me', 'later',
  'next', 'time', 'new', 'one', 'list', 'preround', 'pre', 'round', 'saved', 'again', 'please', 'now',
  'is', 'was', 'kevin', 'serena', 'routine', 'stretches', 'warmup',
]);

const LEAD = /^(?:(?:hey|ok|okay|yo|so|um|uh|hi|well|and|alright|all\s+right)[\s,]+)*(?:[a-z]+,\s*)?(?:please\s+)?/;
const POLITE = /^(?:(?:can|could|will|would)\s+you\s+(?:please\s+)?)/;
const SAVE_OPEN = /^(?:save|keep|remember|store)\s+(that|this|those|these|it|my)\b/;
const RECALL_OPEN = /^(?:what(?:'s|s|\s+is|\s+was|\s+are|\s+were)|tell\s+me|recall|show\s+me|give\s+me|read\s+me|read|run\s+me\s+through|walk\s+me\s+through|go\s+over|remind\s+me\s+of)\b/;

function normalize(utterance: string): string {
  return (utterance ?? '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\bwarm[\s-]?ups?\b/g, 'warmup')
    .replace(/\bstretch(?:es|ing)?\b/g, 'stretches')
    .replace(/\bpre[\s-]?round\b/g, 'preround')
    .replace(/[^a-z0-9'\s,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every remaining word names the routine, and one of them IS the routine. */
function onlyNamesTheRoutine(rest: string): { ok: boolean; mine: boolean } {
  const words = rest.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  const ok = words.every((w) => NAMING_WORDS.has(w)) && words.some((w) => ROUTINE_NOUNS.has(w));
  return { ok, mine: words.includes('my') };
}

/**
 * 'save' / 'recall' when the WHOLE utterance is that order, null otherwise (a question, a story, or
 * any sentence that merely mentions the routine).
 */
export function routineAsk(utterance: string): RoutineAsk | null {
  let t = normalize(utterance).replace(LEAD, '');
  const polite = POLITE.test(t);
  t = t.replace(POLITE, '');

  const save = SAVE_OPEN.exec(t);
  if (save) {
    // "Can you remember my warm-up?" asks whether he remembers it — a recall, not an overwrite.
    if (polite && save[1] === 'my') return null;
    return onlyNamesTheRoutine(t.slice(save[0].length - save[1].length)).ok ? 'save' : null;
  }

  const recall = RECALL_OPEN.exec(t);
  if (recall) {
    const r = onlyNamesTheRoutine(t.slice(recall[0].length));
    // The stored one is HIS: "tell me a good warm-up routine" is a request for a new one.
    return r.ok && r.mine ? 'recall' : null;
  }
  return null;
}
