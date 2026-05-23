/**
 * 2026-05-22 — Family Coaching data model.
 *
 * SmartPlay's primary user is the account holder (their profile lives
 * in playerProfileStore). Family Coaching Mode adds a roster of
 * additional golfers — kids, partners, friends — whose swings the
 * account holder records via Meta Ray-Ban glasses or phone capture
 * and reviews with junior-appropriate coaching feedback.
 *
 * Design discipline:
 *   - Account holder is implicit (playerProfileStore stays unchanged).
 *     Family members are SEPARATE entities with their own ids; cage
 *     sessions, swing-library entries, and junior-analysis results
 *     reference family.member_id when applicable, null when the
 *     swing is the account holder's own.
 *   - Privacy-first: kids' records never leave the device by default.
 *     A future server-sync gate (parental opt-in per child) is the
 *     only path for any data to leave. Persistence here is local-only.
 *   - Age drives coaching tone bands — see ageBand() helper:
 *       0-7   "tiny"      single-syllable + game-ified
 *       8-11  "junior"    fundamentals + fun + confidence
 *       12-15 "teen"      technical with encouragement
 *       16+   "adult"     full SmartPlay coaching tone
 *
 * Not in scope (future):
 *   - Server-side family roster sync
 *   - Per-family-member subscription handling (today everyone is
 *     covered by the account holder's plan)
 *   - Coach role separation (a swing coach managing multiple non-family
 *     juniors — would clone this model into a coachingClientsStore)
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

// ─── Types ───────────────────────────────────────────────────────────────

export type FamilyRelationship =
  | 'self'        // the account holder — implicit; not stored in roster
  | 'child'
  | 'partner'
  | 'sibling'
  | 'parent'
  | 'friend'
  | 'other';

export type SkillLevel = 'first_swings' | 'learning' | 'developing' | 'competitive';

export type AgeBand = 'tiny' | 'junior' | 'teen' | 'adult';

export interface FamilyMember {
  id: string;
  /** First name only — never store a full name unless explicitly entered. */
  firstName: string;
  /** Optional nickname the parent uses when speaking to the caddie
   *  ("Buddy", "Champ"). Voice intent matcher checks both. */
  nickname?: string | null;
  relationship: FamilyRelationship;
  /** Age in years. Drives ageBand() → coaching tone selection. */
  age: number | null;
  skillLevel: SkillLevel;
  /** Right or left dominant — used by junior analyzer to mirror notes. */
  handedness: 'right' | 'left' | 'unknown';
  /** Optional simplified handicap (kids rarely have one; capture an
   *  approximate "shoots 110ish" as 38 etc. when parent provides one). */
  approximate_handicap: number | null;
  /** Local-only avatar emoji or initial — never an image upload. */
  avatar_emoji: string;
  /** When the member was added (ms epoch). */
  added_at: number;
  /** When the member's roster entry was last edited. */
  updated_at: number;
  /** Soft-archive — keeps records but hides from the active picker.
   *  Useful when a kid moves out / loses interest. */
  archived: boolean;
}

// ─── State ───────────────────────────────────────────────────────────────

interface FamilyState {
  members: FamilyMember[];
  /** Currently-targeted golfer for voice intents like "record their
   *  swing". null = the account holder (self). Set by voice ("coach
   *  Emma") or by Settings → Family. */
  active_member_id: string | null;

  addMember: (input: Omit<FamilyMember, 'id' | 'added_at' | 'updated_at' | 'archived'>) => string;
  updateMember: (id: string, patch: Partial<Omit<FamilyMember, 'id' | 'added_at'>>) => void;
  archiveMember: (id: string) => void;
  removeMember: (id: string) => void;
  setActiveMember: (id: string | null) => void;

  /** Lookup by id. Defensive — returns null on miss. */
  getMember: (id: string | null | undefined) => FamilyMember | null;
  /** Find by free-text name (first name OR nickname, case-insensitive).
   *  Used by voice intent classifier ("Emma" / "Buddy"). Returns null
   *  on no match; first match wins on ties. */
  findByName: (name: string) => FamilyMember | null;
  /** Non-archived members, sorted by added_at ascending. */
  activeRoster: () => FamilyMember[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Coaching tone tier from age. Junior analyzer reads this to pick a
 * system-prompt voice + technical depth. Capture for any-age fallback:
 * when age is null we default to 'junior' since the most common
 * Family-mode use case is recording a kid.
 */
export function ageBand(age: number | null | undefined): AgeBand {
  if (age == null) return 'junior';
  if (age <= 7) return 'tiny';
  if (age <= 11) return 'junior';
  if (age <= 15) return 'teen';
  return 'adult';
}

function newId(): string {
  return 'fam_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

// ─── Store ───────────────────────────────────────────────────────────────

export const useFamilyStore = create<FamilyState>()(
  persist(
    (set, get) => ({
      members: [],
      active_member_id: null,

      addMember: (input) => {
        const now = Date.now();
        const member: FamilyMember = {
          ...input,
          id: newId(),
          added_at: now,
          updated_at: now,
          archived: false,
        };
        set((s) => ({ members: [...s.members, member] }));
        console.log(
          `[family] addMember id=${member.id} name=${member.firstName} ` +
          `rel=${member.relationship} age=${member.age ?? '?'} ` +
          `band=${ageBand(member.age)}`,
        );
        return member.id;
      },

      updateMember: (id, patch) => {
        set((s) => ({
          members: s.members.map((m) =>
            m.id === id ? { ...m, ...patch, updated_at: Date.now() } : m,
          ),
        }));
      },

      archiveMember: (id) => {
        set((s) => ({
          members: s.members.map((m) =>
            m.id === id ? { ...m, archived: true, updated_at: Date.now() } : m,
          ),
          active_member_id: s.active_member_id === id ? null : s.active_member_id,
        }));
      },

      removeMember: (id) => {
        // Hard delete — only used when the parent explicitly removes
        // a member from Settings → Family with a confirm dialog. Any
        // recorded swings keyed to this id stay in cageStore but
        // become "unknown golfer" until the user re-tags or deletes.
        set((s) => ({
          members: s.members.filter((m) => m.id !== id),
          active_member_id: s.active_member_id === id ? null : s.active_member_id,
        }));
      },

      setActiveMember: (id) => {
        set({ active_member_id: id });
        if (id) console.log(`[family] active member set: ${id}`);
        else console.log('[family] active member cleared (back to self)');
      },

      getMember: (id) => {
        if (!id) return null;
        return get().members.find((m) => m.id === id) ?? null;
      },

      findByName: (name) => {
        if (!name) return null;
        const n = name.trim().toLowerCase();
        if (!n) return null;
        return (
          get().members.find(
            (m) =>
              !m.archived &&
              (m.firstName.toLowerCase() === n || m.nickname?.toLowerCase() === n),
          ) ?? null
        );
      },

      activeRoster: () =>
        get()
          .members.filter((m) => !m.archived)
          .sort((a, b) => a.added_at - b.added_at),
    }),
    {
      name: 'family-store-v1',
      version: 1,
      storage: createJSONStorage(() => getPersistStorage()),
      partialize: (s) => ({
        members: s.members,
        active_member_id: s.active_member_id,
      }),
    },
  ),
);
