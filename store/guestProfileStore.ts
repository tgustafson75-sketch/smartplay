/**
 * Guest profile store — lightweight, session-scoped player records.
 *
 * 2026-05-24 — Built to back the quick_round voice intent. When the
 * user says "Tim is playing with Bob and Sarah today," we mint guest
 * profiles for Bob and Sarah without overwriting the device owner's
 * profile in playerProfileStore. Distinct from familyStore (rostered
 * household members) and tournamentStore.teams[].players (string-only
 * names for the standalone tournament scoring tool).
 *
 * Lifecycle: guests auto-expire 24h after their last touch so a forgotten
 * round doesn't carry strangers' names into next week. Pruning happens
 * on hydrate + on every addGuest call.
 *
 * Identity: id is a deterministic slug-with-timestamp so two "Bob"s
 * added on the same day collide cleanly (the second call returns the
 * existing id rather than minting a duplicate).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const GUEST_TTL_MS = 24 * 60 * 60 * 1000;

export interface GuestProfile {
  id: string;
  displayName: string;
  /** Lowercased + punctuation-stripped name for dedupe lookups. */
  matchKey: string;
  addedAt: number;
  lastSeenAt: number;
  /** Optional rough handicap if user volunteered it ("Bob's a 12"). */
  handicap?: number | null;
}

interface GuestProfileState {
  guests: GuestProfile[];

  /**
   * Add or refresh a guest by display name. Returns the canonical
   * guest record (existing if dedup hit, otherwise newly minted).
   * Touches lastSeenAt either way. Trims/normalizes input.
   */
  addGuest: (displayName: string, opts?: { handicap?: number | null }) => GuestProfile | null;

  /** Mark a guest as seen now (extends TTL). No-op for unknown id. */
  touchGuest: (id: string) => void;

  /** Drop a guest by id. */
  removeGuest: (id: string) => void;

  /** Drop everyone — used by an "end round" / "clear guests" voice action later. */
  clearGuests: () => void;

  /** Remove entries whose lastSeenAt is older than TTL. Idempotent. */
  pruneStale: () => void;
}

function makeMatchKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function makeGuestId(name: string): string {
  const slug = makeMatchKey(name).slice(0, 20) || 'guest';
  return `guest_${slug}_${Date.now().toString(36)}`;
}

export const useGuestProfileStore = create<GuestProfileState>()(
  persist(
    (set, get) => ({
      guests: [],

      addGuest: (displayName, opts) => {
        const trimmed = displayName.trim();
        if (!trimmed) return null;
        const matchKey = makeMatchKey(trimmed);
        if (!matchKey) return null;

        const now = Date.now();
        const existing = get().guests.find(g => g.matchKey === matchKey);
        if (existing) {
          // Refresh lastSeenAt + optionally update handicap; keep id stable.
          set(s => ({
            guests: s.guests.map(g => g.id === existing.id
              ? {
                  ...g,
                  lastSeenAt: now,
                  handicap: opts?.handicap !== undefined ? opts.handicap : g.handicap,
                }
              : g,
            ),
          }));
          return { ...existing, lastSeenAt: now };
        }

        const fresh: GuestProfile = {
          id: makeGuestId(trimmed),
          displayName: trimmed,
          matchKey,
          addedAt: now,
          lastSeenAt: now,
          handicap: opts?.handicap ?? null,
        };
        // Prune before adding so the list doesn't drift across rounds.
        const live = get().guests.filter(g => now - g.lastSeenAt < GUEST_TTL_MS);
        set({ guests: [...live, fresh] });
        return fresh;
      },

      touchGuest: (id) => {
        set(s => ({
          guests: s.guests.map(g => g.id === id ? { ...g, lastSeenAt: Date.now() } : g),
        }));
      },

      removeGuest: (id) => {
        set(s => ({ guests: s.guests.filter(g => g.id !== id) }));
      },

      clearGuests: () => set({ guests: [] }),

      pruneStale: () => {
        const cutoff = Date.now() - GUEST_TTL_MS;
        set(s => ({ guests: s.guests.filter(g => g.lastSeenAt >= cutoff) }));
      },
    }),
    {
      name: 'guest-profiles-v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      onRehydrateStorage: () => (state) => {
        // Drop expired guests on app boot so a stale roster never leaks
        // into a fresh session.
        if (state) {
          const cutoff = Date.now() - GUEST_TTL_MS;
          state.guests = state.guests.filter(g => g.lastSeenAt >= cutoff);
        }
      },
    },
  ),
);

/** Resolve a name to an existing guest record (no mutation). */
export function findGuestByName(name: string): GuestProfile | null {
  const matchKey = makeMatchKey(name);
  if (!matchKey) return null;
  return useGuestProfileStore.getState().guests.find(g => g.matchKey === matchKey) ?? null;
}
