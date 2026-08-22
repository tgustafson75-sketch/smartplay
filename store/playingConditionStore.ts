/**
 * WHAT THE BALL IS DOING TODAY — the operating condition, not a fault to fix.
 *
 * 2026-08-21 (Tim, describing a failure he has hit live on course more than once):
 *
 *   "I'm hitting everything left today." And it'll give me some advice about WHY. But no — it's
 *   contextual. THAT'S WHERE I'M GONNA HIT. And since we're in round, we gotta say: okay, we're
 *   gonna aim a little bit the other direction now, and take wind into account. And maybe some
 *   corrective — just slow down a little.
 *
 * When a player says that mid-round he is not asking for a diagnosis. He is telling the caddie the
 * TRUTH ABOUT TODAY, and a real caddie's response is to move the aim, not to explain the golf swing
 * on the seventh tee. Diagnosing is what makes the app feel like a lesson when he wanted a partner.
 *
 * Deliberately NOT services/sessionFocusStore: that stores what the player wants to WORK ON, and
 * anything landing there gets coached. Putting "hitting it left" in there would produce exactly the
 * lecture he is complaining about. Same word, opposite intent — so it gets its own home.
 *
 * This also OUTRANKS the long-run model while it is live. clubTendency may have learned he misses
 * right; if he says he is pulling everything today, today wins. The learned model describes his
 * game, this describes his morning.
 *
 * Session-scoped and self-expiring for the same reason: it is true today and wrong tomorrow.
 */
import { create } from 'zustand';

/** Long enough for a round plus warm-up; gone by the next morning. */
const CONDITION_TTL_MS = 6 * 60 * 60 * 1000;

export type ConditionKind = 'ball_flight' | 'physical' | 'feel';

export interface PlayingCondition {
  /** What the player actually said, in their words ("hitting everything left", "back is tight"). */
  stated: string;
  kind: ConditionKind;
  /** Direction to compensate toward, when the statement implies one. */
  compensate?: 'left' | 'right' | 'shorter' | 'longer' | null;
  statedAt: number;
}

interface PlayingConditionState {
  condition: PlayingCondition | null;
  /**
   * 2026-08-21 (Tim) — "the narrative between a golfer and a caddie… I'm gonna talk about what I'm
   * doing and it's gonna EVOLVE even over the course of a round, or even one hole, and that needs to
   * be smart and grows and the caddie knows what to do."
   *
   * So this is a SEQUENCE, not a setting. A round reads "I'm pulling everything" on the 3rd, then
   * "now I'm blocking it right" on the 9th — and the second statement means something different
   * BECAUSE of the first: he has overcorrected. A caddie who only holds the latest line loses the
   * arc and treats an overcorrection as a fresh problem.
   *
   * Kept short on purpose. This is the story of a session, not a medical history.
   */
  history: PlayingCondition[];
  setCondition: (c: Omit<PlayingCondition, 'statedAt'>) => void;
  clearCondition: () => void;
  /** Live condition, or null. Drops a stale one on read so nothing stale can leak into advice. */
  activeCondition: (now?: number) => PlayingCondition | null;
  /** The session's arc, oldest → newest, stale entries dropped. */
  conditionArc: (now?: number) => PlayingCondition[];
}

const MAX_ARC = 4;

export const usePlayingConditionStore = create<PlayingConditionState>()((set, get) => ({
  condition: null,
  history: [],
  setCondition: (c) => set((st) => {
    const next = { ...c, statedAt: Date.now() };
    // Same statement repeated is not a new chapter — replace rather than pad the arc.
    const prev = st.history[st.history.length - 1];
    const isRepeat = prev && prev.stated.trim().toLowerCase() === next.stated.trim().toLowerCase();
    const history = (isRepeat ? st.history.slice(0, -1) : st.history).concat(next).slice(-MAX_ARC);
    return { condition: next, history };
  }),
  clearCondition: () => set({ condition: null, history: [] }),
  conditionArc: (now) => {
    const t = now ?? Date.now();
    const live = get().history.filter(h => h.statedAt > 0 && t - h.statedAt <= CONDITION_TTL_MS);
    if (live.length !== get().history.length) set({ history: live });
    return live;
  },
  activeCondition: (now) => {
    const c = get().condition;
    if (!c) return null;
    const t = now ?? Date.now();
    if (!(c.statedAt > 0) || t - c.statedAt > CONDITION_TTL_MS) { set({ condition: null }); return null; }
    return c;
  },
}));

/**
 * The line the caddie acts on. It says what to DO, because the failure mode here is not missing
 * information — the caddie already heard him — it is responding with a lesson instead of an aim.
 */
export function playingConditionPromptLine(now?: number): string | null {
  const c = usePlayingConditionStore.getState().activeCondition(now);
  if (!c) return null;
  const aim = c.compensate === 'left' ? ' Favour the left side to allow for it.'
    : c.compensate === 'right' ? ' Favour the right side to allow for it.'
    : c.compensate === 'shorter' ? ' Take more club — he is coming up short today.'
    : c.compensate === 'longer' ? ' Take less club — he is flying it today.'
    : '';
  // The ARC, when there is one. A second statement means something different because of the first.
  const arc = usePlayingConditionStore.getState().conditionArc(now);
  const arcLine = arc.length > 1
    ? ` HOW TODAY HAS GONE, in order: ${arc.map(a => `"${a.stated}"`).join(' → ')}. Read the CHANGE, not just the latest line — if he has swung from one miss to its opposite he has overcorrected, and the answer is to settle him down, not to chase the new miss with another adjustment.`
    : '';
  return `TODAY'S CONDITION — the player told you: "${c.stated}". TREAT THIS AS FACT, not a fault to diagnose. It OUTRANKS his learned tendency for the rest of the session: this is where the ball is going today.${aim} Adjust the AIM and the CLUB for it, and factor the wind on top. Do NOT explain why it is happening or start a swing lesson mid-round — he did not ask. At most ONE short corrective cue if it fits naturally ("just slow it down a touch"), never twice in a row, never instead of the club call.${arcLine}`;
}
