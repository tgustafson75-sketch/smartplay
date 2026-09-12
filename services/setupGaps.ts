/**
 * 2026-09-11 (Tim) — A REASON TO ASK, OR NOTHING TO SAY.
 *
 * Two pieces of feedback that turn out to be one design:
 *
 *   "Maybe only on key features like setting your bag could Caddie ask now and then if you want to
 *    set up if it's not."
 *
 *   "Unless it's logical don't have caddie ask repeatedly questions that could make it unnatural —
 *    stopping the conversation by having to keep telling the caddie you are good and don't need
 *    anything."
 *
 * A caddie who opens every single launch with "anything I can help with?" is not being friendly, he
 * is making you decline him. The fix is not to ask less politely — it is to only ask when there is
 * something worth asking about. So this answers exactly one question: **is there a real gap in this
 * player's setup that would make the caddie meaningfully better if it were filled?**
 *
 * If yes, he may raise THAT, and the mic opens for the answer. If no, he greets and says nothing —
 * and the mic stays shut, because there is no question to answer.
 *
 * The gaps are the same facts the onboarding interview exists to collect, which is Tim's point about
 * it tying back to that logic: this is the interview finishing itself, slowly, in conversation,
 * instead of a form nobody completes.
 *
 * PURE. `pickSetupGap` takes the world and returns a gap or null; the live wrapper reads the stores
 * and the cooldowns. [[no-push-nagging-no-ads]] [[feels-like-a-real-caddie]]
 */

export type SetupGapKey = 'bag' | 'handicap' | 'home_course' | 'miss' | 'distance_control';

export interface SetupGap {
  key: SetupGapKey;
  /** What the caddie is told he may raise. Never a script — the brain says it in his own words. */
  hint: string;
  /** Higher wins when several are missing. Ask about the one that changes the most advice. */
  weight: number;
}

export interface SetupGapWorld {
  registeredClubs: number;
  measuredClubs: number;
  handicapIndex: number | null;
  handicapSet: boolean;
  homeCourse: string | null;
  dominantMiss: string | null;
  distanceControlSet: boolean;
  /** Rounds played together — a brand-new player is not nagged about anything. */
  roundsPlayed: number;
  /** Gap keys currently inside their cooldown, or already answered. */
  suppressed: ReadonlySet<SetupGapKey>;
}

/**
 * Nothing is raised until the player has actually used the app. Asking a stranger to fill in their
 * bag before they have hit a shot is the form-first onboarding this is meant to replace.
 */
export const MIN_ROUNDS_BEFORE_ASKING = 1;

/**
 * The bag is first by a distance. Every club call, every plays-like number and every hole plan reads
 * from it, so an empty bag degrades more of the product than anything else on this list.
 */
const CANDIDATES: { key: SetupGapKey; weight: number; hint: string }[] = [
  {
    key: 'bag',
    weight: 100,
    hint: 'They have not set up their bag yet, so you are clubbing them off a generic chart rather than their own carries. You may offer to sort it — it takes a minute and it changes every club call you make.',
  },
  {
    key: 'handicap',
    weight: 70,
    hint: 'You do not have their handicap, so the scoring targets and the shots-in-hand maths are guesses. You may ask what they play off.',
  },
  {
    key: 'miss',
    weight: 55,
    hint: 'You do not know which way their bad one goes, so you cannot aim them off trouble. You may ask what their miss tends to be.',
  },
  {
    key: 'distance_control',
    weight: 40,
    hint: 'You do not know whether they hit full swings or dial clubs down, which decides whether an in-between number is even playable for them. You may ask.',
  },
  {
    key: 'home_course',
    weight: 25,
    hint: 'You do not know their home course. You may ask where they usually play.',
  },
];

/**
 * The single most-worth-asking gap, or null when there is nothing to raise.
 *
 * Returns ONE. A caddie who lists four things you have not done is a checklist with a voice.
 */
export function pickSetupGap(w: SetupGapWorld): SetupGap | null {
  if (!w || w.roundsPlayed < MIN_ROUNDS_BEFORE_ASKING) return null;

  const missing = new Set<SetupGapKey>();
  // A bag counts as set once ANY club is registered or measured — the player decides how far to go.
  if (w.registeredClubs === 0 && w.measuredClubs === 0) missing.add('bag');
  if (!w.handicapSet && w.handicapIndex == null) missing.add('handicap');
  if (!w.dominantMiss) missing.add('miss');
  if (!w.distanceControlSet) missing.add('distance_control');
  if (!w.homeCourse || !w.homeCourse.trim()) missing.add('home_course');

  const best = CANDIDATES
    .filter((c) => missing.has(c.key) && !w.suppressed.has(c.key))
    .sort((a, b) => b.weight - a.weight)[0];
  return best ? { key: best.key, hint: best.hint, weight: best.weight } : null;
}

/**
 * How long a gap stays quiet after it has been raised once.
 *
 * Long on purpose. The failure Tim named is being asked repeatedly and having to keep saying you are
 * fine; a fortnight means a player who ignores it is not asked again this month, and one who is
 * genuinely never going to set their bag is effectively left alone.
 */
export const GAP_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

const KEY = '@smartplay/setup_gap_asked';

/** When each gap was last raised. Never throws; a storage failure simply means nothing is suppressed. */
export async function loadAskedAt(): Promise<Record<string, number>> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const raw = await AsyncStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

export async function markGapAsked(key: SetupGapKey): Promise<void> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const cur = await loadAskedAt();
    cur[key] = Date.now();
    await AsyncStorage.setItem(KEY, JSON.stringify(cur));
  } catch { /* a missed mark means it may be raised again later — never fatal */ }
}

/** Gap keys still inside their cooldown. */
export function suppressedFrom(askedAt: Record<string, number>, nowMs = Date.now()): Set<SetupGapKey> {
  const out = new Set<SetupGapKey>();
  for (const [k, t] of Object.entries(askedAt ?? {})) {
    if (typeof t === 'number' && nowMs - t < GAP_COOLDOWN_MS) out.add(k as SetupGapKey);
  }
  return out;
}

/**
 * The gap to raise right now, read from live state. Returns null on any failure — a caddie that
 * cannot work out whether to ask should simply not ask.
 */
export async function liveSetupGap(): Promise<SetupGap | null> {
  try {
    const { usePlayerProfileStore } = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
    const { useClubBagStore } = require('../store/clubBagStore') as typeof import('../store/clubBagStore');
    const { getLearnedCarryDistances } = require('../store/clubStatsStore') as typeof import('../store/clubStatsStore');
    const { useRelationshipStore } = require('../store/relationshipStore') as typeof import('../store/relationshipStore');
    const p = usePlayerProfileStore.getState();
    return pickSetupGap({
      registeredClubs: Object.keys(useClubBagStore.getState().clubs ?? {}).length,
      measuredClubs: Object.keys(getLearnedCarryDistances() ?? {}).length,
      handicapIndex: typeof p.handicap_index === 'number' ? p.handicap_index : null,
      handicapSet: typeof p.handicap === 'number' && p.handicap !== 18,
      homeCourse: p.homeCourse ?? null,
      dominantMiss: p.dominantMiss ?? null,
      distanceControlSet: !!p.distanceControl && p.distanceControl !== 'some_partials',
      roundsPlayed: useRelationshipStore.getState().roundsTogether ?? 0,
      suppressed: suppressedFrom(await loadAskedAt()),
    });
  } catch { return null; }
}
