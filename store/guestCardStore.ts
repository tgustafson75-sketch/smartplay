/**
 * ADDED PLAYERS' SCORECARDS — the second card, kept deliberately away from the first.
 *
 * 2026-09-20 (Tim, from Echo Hills) — "I put in competetion thinking that would allow me to add a
 * scorecard for my daughter but that did not work. Nothing is more irratating than missing items I
 * have worked on multiple times." And, on what it should be:
 *
 *   "Dont want add player hidden behind tournament. OG version had tabs at the top and I could edit
 *    names and we could add putting the players hdcp and an export button but we dont inject the
 *    data from that card to the primary user data. Would be good promo to be able to export a
 *    caddies read on the guest /added players own round."
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: a guest's score never becomes the owner's score.
 *
 * That is why this is its own store and not a player dimension on `roundStore.scores`. That record
 * is `Record<hole, strokes>` for ONE person and it feeds the handicap posting path
 * (computeWhsPostingScore → the player's Index), the recap, the caddie payload and the round
 * history. Widening it would put a guest one bug away from the owner's handicap, and "we dont
 * inject the data from that card to the primary user data" is the requirement, not a preference.
 * Keeping the two apart at the STORE means no later mistake in a component can cross them.
 * [[two-owners-is-the-root-cause]]
 *
 * WHY NOT tournamentStore: that is the group-play tool (teams, scramble/skins/stableford/match
 * play) and it works. This is the simpler thing Tim actually asked for — a card beside his, on the
 * scorecard he is already looking at, not behind a format picker.
 *
 * Lifecycle: the cards persist so a round can be exported after it ends, and are cleared explicitly
 * (Clear card, or starting a fresh set). Guests here are NOT the 24h-expiring
 * `guestProfileStore` records — those are names the caddie uses in conversation and carry no
 * scores. Same person, two different jobs; this one holds the numbers.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

/** Player 1 is always the device owner and is not stored here. Three guests beside him. */
export const MAX_GUEST_CARDS = 3;

export interface GuestCard {
  id: string;
  /** Editable display name. Blank is allowed while typing; the UI falls back to "Player N". */
  name: string;
  /**
   * The guest's own Handicap Index, typed by whoever is keeping the card. Null = unknown, and the
   * UI must then show GROSS only rather than inventing a net score. Tim: "we could add putting the
   * players hdcp" — so it is entered, never derived, and never read from the owner's profile.
   */
  handicapIndex: number | null;
  /** hole number (1-18) → strokes. Missing / 0 = not played. */
  scores: Record<number, number>;
}

interface GuestCardState {
  cards: GuestCard[];
  /** Course this set of cards belongs to, so a new course starts a clean card. */
  courseLabel: string | null;

  addCard: (name?: string) => GuestCard | null;
  removeCard: (id: string) => void;
  setName: (id: string, name: string) => void;
  setHandicap: (id: string, index: number | null) => void;
  setScore: (id: string, hole: number, strokes: number) => void;
  bumpScore: (id: string, hole: number, delta: number) => void;
  clearAll: () => void;
  noteCourse: (label: string | null) => void;
}

function mintId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const useGuestCardStore = create<GuestCardState>()(
  persist(
    (set, get) => ({
      cards: [],
      courseLabel: null,

      addCard: (name) => {
        if (get().cards.length >= MAX_GUEST_CARDS) return null;
        const card: GuestCard = {
          id: mintId(),
          name: (name ?? '').trim(),
          handicapIndex: null,
          scores: {},
        };
        set((s) => ({ cards: [...s.cards, card] }));
        return card;
      },

      removeCard: (id) => set((s) => ({ cards: s.cards.filter((c) => c.id !== id) })),

      setName: (id, name) =>
        set((s) => ({
          // 20 chars matches the OG editor. Trimming happens at render, not here, so a space
          // mid-typing does not fight the user.
          cards: s.cards.map((c) => (c.id === id ? { ...c, name: name.slice(0, 20) } : c)),
        })),

      setHandicap: (id, index) =>
        set((s) => ({
          cards: s.cards.map((c) => {
            if (c.id !== id) return c;
            if (index == null || !Number.isFinite(index)) return { ...c, handicapIndex: null };
            // WHS runs +54 to -10. Clamping rather than rejecting keeps a fat-fingered 500 from
            // producing a net score of minus four hundred on a shared card.
            return { ...c, handicapIndex: Math.max(-10, Math.min(54, Math.round(index * 10) / 10)) };
          }),
        })),

      setScore: (id, hole, strokes) =>
        set((s) => ({
          cards: s.cards.map((c) => {
            if (c.id !== id) return c;
            const next = { ...c.scores };
            // 0 means "not played" and is stored as absence, so an emptied hole reads the same as
            // one never touched — the same convention roundStore.scores uses.
            if (!Number.isFinite(strokes) || strokes <= 0) delete next[hole];
            else next[hole] = Math.min(20, Math.round(strokes));
            return { ...c, scores: next };
          }),
        })),

      bumpScore: (id, hole, delta) => {
        const card = get().cards.find((c) => c.id === id);
        if (!card) return;
        get().setScore(id, hole, (card.scores[hole] ?? 0) + delta);
      },

      clearAll: () => set({ cards: [], courseLabel: null }),

      noteCourse: (label) =>
        set((s) => {
          const next = (label ?? '').trim() || null;
          // A different course means a different card. Silently carrying yesterday's scores onto a
          // new scorecard is the kind of quiet wrongness that costs someone a whole round.
          if (s.courseLabel && next && s.courseLabel !== next) {
            return { courseLabel: next, cards: s.cards.map((c) => ({ ...c, scores: {} })) };
          }
          return { courseLabel: next ?? s.courseLabel };
        }),
    }),
    {
      name: 'guest-cards-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      version: 1,
    },
  ),
);

/** Gross total across the holes actually played. */
export function grossTotal(card: GuestCard): number {
  return Object.values(card.scores).reduce((a, b) => a + (b > 0 ? b : 0), 0);
}

/** How many holes carry a score. */
export function holesPlayed(card: GuestCard): number {
  return Object.values(card.scores).filter((v) => v > 0).length;
}

/**
 * Net total, or null when the guest's Index is unknown.
 *
 * Deliberately a simple whole-round allowance (Index × slope/113, applied to the total) rather than
 * per-hole stroke allocation: this card has no stroke-index column to allocate against, and an
 * invented allocation would produce a per-hole "NET" that looks authoritative and is not. The total
 * is honest at the level it is shown. [[smartmotion-metrics-honesty]]
 */
export function netTotal(card: GuestCard, slope = 113, holes: 9 | 18 = 18): number | null {
  if (card.handicapIndex == null) return null;
  const played = holesPlayed(card);
  if (played === 0) return null;
  const full = card.handicapIndex * (slope / 113);
  const allowance = holes === 9 ? full / 2 : full;
  return Math.round((grossTotal(card) - allowance) * 10) / 10;
}
