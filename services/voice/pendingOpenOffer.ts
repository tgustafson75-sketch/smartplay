/**
 * "WANT ME TO OPEN THAT?" — AN OFFER THAT CAN BE TAKEN UP.
 *
 * 2026-10-27 (Brain review B4). A medium-confidence open, navigate or capture is held back by the
 * router's disruptive gate rather than fired, and the player was told "Want me to open that? Just say
 * it again and I will." Nothing remembered the offer: saying it again classified medium again and got
 * the same line, forever, and "yes" went to the acknowledge handler and opened nothing. A promise no
 * code kept, on every route.
 *
 * Now the gated intent is held here for one turn. The next turn takes it up with a plain yes, or by
 * asking for the same thing again — both execute it as confirmed. Anything else is a "no": the offer
 * is dropped, so a later "yes" to an unrelated question can never open a stale screen.
 */
import type { VoiceIntent } from '../../types/voiceIntent';
import { getRecentTurns } from '../conversationState';

export const OPEN_OFFER_LINE = 'Want me to open that?';

/** Long enough to answer, short enough that a "yes" next hole cannot reach it. */
const OFFER_TTL_MS = 90_000;

const AFFIRM_RX =
  /^(?:(?:hey|ok|okay|yeah|yes|yep|yup|sure|please|kevin|serena)[\s,.!]*)*(?:yes|yeah|yep|yup|sure|ok|okay|please|do\s+it|go\s+ahead|open\s+it|yes\s+please|please\s+do|go\s+for\s+it|that'?d\s+be\s+great|sounds\s+good)[\s,.!]*(?:please|thanks|thank\s+you)?[\s.!]*$/i;

interface HeldOffer { intent: VoiceIntent; at: number }

/** The offer made on the last turn, waiting for its answer. */
let pending: HeldOffer | null = null;
/** The same offer while THIS turn is being routed — so a repeat of it can be recognised. */
let answering: HeldOffer | null = null;

function actionKey(i: VoiceIntent): string {
  const p = i.parameters ?? {};
  return [i.intent_type, p.tool_name ?? '', p.direction ?? '', p.capture_type ?? ''].map(String).join('|').toLowerCase();
}

/**
 * Start of a player turn, before any classification. A plain yes to the open offer returns the held
 * intent, now confirmed; anything else returns null and leaves the offer open only for a REPEAT of
 * itself during this same turn (see takeUpRepeatedOffer).
 */
/**
 * 2026-10-28 (B4 re-check) — the offer must still be the caddie's LAST WORD. Not every surface routes
 * through here: the Caddie-tab mic goes straight to the brain, and the avatar mic answers some turns
 * locally. So "anything else drops it" was only true on the routes that call beginTurnForOffer — an
 * offer made on the earbud survived a tab-mic exchange ("Want the driver instead?"), and the earbud
 * "yes" that answered THAT question opened the course map. The shared conversation buffer sees every
 * surface's turns; the offer stands only while its line is the caddie's latest and nothing but this
 * very utterance (the avatar mic records it before routing) came after it. Fails closed.
 */
function offerIsTheLastWord(utterance: string): boolean {
  try {
    const turns = getRecentTurns();
    let i = turns.length - 1;
    if (i >= 0 && turns[i].role === 'user' && turns[i].text === (utterance ?? '').trim()) i -= 1;
    return i >= 0 && turns[i].role === 'kevin' && turns[i].text === OPEN_OFFER_LINE;
  } catch {
    return false;
  }
}

export function beginTurnForOffer(utterance: string, now: number = Date.now()): VoiceIntent | null {
  const held = pending && now - pending.at <= OFFER_TTL_MS && offerIsTheLastWord(utterance) ? pending : null;
  pending = null;
  answering = held;
  if (held && AFFIRM_RX.test((utterance ?? '').trim())) {
    answering = null;
    return { ...held.intent, confidence: 'high' };
  }
  return null;
}

/**
 * The disruptive gate is about to hold `intent`. If the player is asking for the same action the
 * caddie just offered, that IS the confirmation: return it confirmed. Otherwise remember the offer
 * for the next turn and return null.
 */
export function takeUpRepeatedOffer(intent: VoiceIntent, now: number = Date.now()): VoiceIntent | null {
  const prior = answering;
  answering = null;
  if (prior && actionKey(prior.intent) === actionKey(intent)) return { ...intent, confidence: 'high' };
  pending = { intent, at: now };
  return null;
}

/** True while THIS turn is the answer to an offer (it was not a yes) — a repeat must still reach the gate. */
export function isAnsweringOffer(): boolean {
  return answering !== null;
}

/**
 * True while an offer is waiting for its answer — the follow-up bypass must not swallow the "yes".
 * Same last-word rule as beginTurnForOffer: a stale offer must not pull an answer to the caddie's
 * NEWER question away from the brain.
 */
export function hasPendingOpenOffer(utterance: string, now: number = Date.now()): boolean {
  return !!pending && now - pending.at <= OFFER_TTL_MS && offerIsTheLastWord(utterance);
}

/** Test seam. */
export function __resetOpenOffer(): void {
  pending = null;
  answering = null;
}
