/**
 * 2026-07-01 (Tim — "the most natural is a voice path where you say 'look at my club / register
 * my club / add this club', the user shows the sole of the club with the number on it, and it
 * gets registered").
 *
 * The player's REGISTERED BAG — the clubs they've explicitly told the caddie they carry, distinct
 * from clubs merely inferred from swings/logs. Registration flows in from the camera club scan
 * (recognizeClubFromBase64), a voice declaration, or a manual add. The unified brain reads this so
 * it only recommends clubs the player actually has, and club-tied yardage learning gets a canonical
 * roster instead of guessing from observed shots.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { ClubId } from '../services/clubRecognition';
import { CLUB_SNAP_ORDER } from '../services/clubBagReconcile';

export type ClubRegisterSource = 'camera' | 'voice' | 'manual' | 'measured';

/**
 * 2026-09-14 (Tim) — "But this shows there is still not a universal bag logic that is working
 * right. If we know, we should have brands and grip and shaft options. Everything club/bag related
 * has to be unified in logic."
 *
 * ONE RECORD PER PHYSICAL CLUB.
 *
 * Membership was already unified — sixteen readers all come through this store. The PHYSICAL CLUB
 * was not. It was spread across four places:
 *
 *   1. here, as flat brand / model / loft — the HEAD only, and one set of them per catalog slot;
 *   2. `services/clubVariantPerformance`, which learns that he owns THREE DRIVERS from free-text
 *      `club_variant` labels on shots — a fact the bag itself had no way to hold;
 *   3. shaft brand, shaft weight and grip size, which existed nowhere in the app at all;
 *   4. `setClubSpecs`, the edit path, which had ZERO CALLERS — so once a club was registered
 *      nothing could correct it. [[orphans-are-live-bugs]]
 *
 * The consequence was a real contradiction: the app could tell him which of his three drivers scored
 * better while being unable to say what was different about them — and the difference IS the shaft.
 *
 * So a slot holds VARIANTS, each one an actual club in the garage, and one of them is in play. The
 * variant label is the same string `shot.club_variant` carries, so the roster and the comparison are
 * the same fact rather than two. Slot-level specs are DERIVED from the in-play variant (`specsOf`)
 * and stored nowhere, because a flattened copy beside the list it came from is the two-owner bug
 * this change exists to end. [[two-owners-is-the-root-cause]]
 */
export interface ClubVariant {
  /** Stable within the slot. */
  variant_id: string;
  /**
   * What he calls it — "Burner 2", "the stiff one". Matched against `shot.club_variant`
   * case-insensitively, which is how the roster and services/clubVariantPerformance stay one fact.
   */
  label: string;
  /** Stamped on the head. Blank when not legible from a scan — never guessed. */
  brand?: string;
  model?: string;
  loft?: string;
  /** The half a fitting is actually about. Values come from services/clubSpecOptions. */
  shaftBrand?: string;
  shaftWeight?: string;
  gripSize?: string;
  registered_at: number;
  source: ClubRegisterSource;
}

/** The editable spec fields of one physical club — named once so no surface lists them again. */
export type ClubSpecs = Pick<ClubVariant, 'brand' | 'model' | 'loft' | 'shaftBrand' | 'shaftWeight' | 'gripSize'>;

export interface RegisteredClub {
  club_id: ClubId;
  registered_at: number;
  source: ClubRegisterSource;
  /** Optional loft/label captured with the club, e.g. "52°". */
  note?: string;
  /**
   * Every physical club in this slot. Usually one. Empty is legal and means "I carry a 7-iron" with
   * nothing known about it — which is exactly what a voice registration gives you.
   */
  variants: ClubVariant[];
  /** `variant_id` of the one in play. Absent → the first variant, or nothing. */
  inPlay?: string;
}

/** The variant actually in play for a slot, or null when the slot carries no specs at all. */
export function inPlayVariant(c: RegisteredClub | null | undefined): ClubVariant | null {
  if (!c || !Array.isArray(c.variants) || c.variants.length === 0) return null;
  return c.variants.find((v) => v.variant_id === c.inPlay) ?? c.variants[0];
}

/**
 * The specs of the club in play. Derived, never stored — ask this rather than reading a flat field,
 * because there is no flat field to read.
 */
export function specsOf(c: RegisteredClub | null | undefined): ClubSpecs {
  const v = inPlayVariant(c);
  if (!v) return {};
  return {
    brand: v.brand, model: v.model, loft: v.loft,
    shaftBrand: v.shaftBrand, shaftWeight: v.shaftWeight, gripSize: v.gripSize,
  };
}

/** True when anything at all is known about the physical club — drives "specs set" affordances. */
export function hasAnySpec(c: RegisteredClub | null | undefined): boolean {
  const s = specsOf(c);
  return Boolean(s.brand || s.model || s.loft || s.shaftBrand || s.shaftWeight || s.gripSize);
}

// Canonical bag order (driver → putter) for display + brain context.
// 2026-08-24 — this was the SIXTH copy of the catalog, and the comment it replaced said "keep one
// canonical order everywhere" while declaring its own. It now reads the one owner. The ClubId
// annotation is deliberate and uncast: if services/clubRecognition's ClubId union and the catalog
// ever disagree, this line fails typecheck instead of drifting quietly.
const CLUB_ORDER: ClubId[] = [...CLUB_SNAP_ORDER];

/**
 * 2026-09-11 (Tim) — "if in competition only be allowed to add 14 and cite USGA."
 *
 * USGA/R&A Rule 4.1b(1). A player must not start a round with more than fourteen clubs; the penalty
 * is two strokes for each hole where the breach occurred, to a maximum of four. Outside competition
 * nobody counts, and plenty of golfers carry more — so this is a COMPETITION cap, never a
 * restriction on what the app lets you own or carry on a Saturday.
 */
export const USGA_CLUB_LIMIT = 14;

/** The putter's club id in the registered bag. One place, so nothing has to remember it is not 'PUTTER'. */
export const PUTTER_ID = 'PT';

/**
 * The cap on a bag you START a round with. FOURTEEN, always.
 *
 * 2026-09-14 (Tim) — "User can add more than 14 clubs but 14 will load for the course
 * appropriately, or user can select which of the persisted clubs they keep."
 *
 * This returned null outside competition until now, on the 09-11 reasoning that "outside competition
 * nobody counts". That reasoning was about the PENALTY, and it quietly became a statement about the
 * BAG: a casual round could be packed with seventeen clubs, which is not a bag, and it meant the
 * number the app packed to changed depending on a toggle most rounds never touch.
 *
 * What he owns is still unlimited — that is the whole point of the variants roster and of
 * `carriedToday`. This caps only what goes out to the first tee.
 *
 * `isCompetition` no longer changes the number, only what the player is TOLD about it: in
 * competition the packer cites USGA Rule 4.1b(1) and its two-strokes-per-hole penalty. The argument
 * is kept rather than dropped because `packBagForCourse` still needs to know which sentence to write.
 */
export function carryLimitFor(_isCompetition: boolean): number {
  return USGA_CLUB_LIMIT;
}

interface ClubBagState {
  /** Registered clubs keyed by club_id — everything he OWNS. */
  clubs: Record<string, RegisteredClub>;
  /**
   * 2026-09-11 (Tim) — THE SUNDAY BAG.
   *
   * "You could think about something like my Sunday bag, since that's what they're called, and
   * you're gonna have three to six clubs in there for those kind of courses. And it would be just a
   * subspawn of the full bag."
   *
   * The missing distinction: what he OWNS and what he is CARRYING TODAY are two different facts. A
   * committed golfer owns sixteen to eighteen and carries fourteen; walking a par-3 nine he carries
   * four. The app had one list and assumed it was both, so the caddie could name a club sitting in
   * the boot of the car.
   *
   * EMPTY MEANS CARRYING EVERYTHING — the normal case and the honest default. A player who never
   * touches this is unaffected, and an empty list is never read as "carrying nothing".
   */
  carriedToday: string[];
  registerClub: (club_id: ClubId, meta?: { source?: ClubRegisterSource; note?: string; at?: number; variantLabel?: string } & Partial<ClubSpecs>) => void;
  /**
   * Update the specs of the club in play in a slot. Creates the variant when the slot has none — a
   * club registered by voice has no variant until someone says something about it, and an editor
   * that silently dropped the first edit would look exactly like the orphan this replaced.
   */
  setClubSpecs: (club_id: ClubId, specs: Partial<ClubSpecs> & { note?: string }) => void;
  /** Add another physical club to a slot — the second driver. Returns its variant_id. */
  addVariant: (club_id: ClubId, v: { label: string; source?: ClubRegisterSource } & Partial<ClubSpecs>) => string | null;
  /** Update one variant by id, whether or not it is the one in play. */
  setVariantSpecs: (club_id: ClubId, variant_id: string, specs: Partial<ClubSpecs> & { label?: string }) => void;
  /** Put a variant in play — the bag half of "driver today is the Burner 2". */
  setInPlayVariant: (club_id: ClubId, variant_id: string) => void;
  /** Remove one physical club from a slot. Removing the last one leaves the slot registered. */
  removeVariant: (club_id: ClubId, variant_id: string) => void;
  /**
   * 2026-09-14 — THE ONE OWNER OF "WHICH OF MY THREE DRIVERS IS IN PLAY".
   *
   * This fact lived in `store/clubVariantStore`, keyed by normalised club NAME, written by the voice
   * declaration and read by roundStore when it stamps a shot. The bag holds the same fact as
   * `inPlay`, keyed by club id. Two stores, one truth, and they could not see each other: he could
   * say "driver today is the Burner 2" and the bag would still show the Stealth, because the bag had
   * never heard of the Burner.
   *
   * `declareVariant` is that sentence, and it does the whole job — registers the slot if he does not
   * own it yet, finds or creates the physical club, and puts it in play. Accepts a NAME or an id, so
   * a voice path does not have to know which vocabulary the bag uses.
   * [[two-owners-is-the-root-cause]]
   */
  declareVariant: (club: string, label: string) => string | null;
  /** The label of the club in play for a slot, by name or id. What a shot gets stamped with. */
  variantLabelFor: (club: string | null | undefined) => string | null;
  /**
   * One-shot fold of the retired `club-variant-v1` blob. Idempotent via `_legacyVariantsAbsorbed`;
   * a declaration he made by voice on 09-12 must not evaporate because the fact moved house.
   */
  absorbLegacyVariants: (legacy: Record<string, string>) => void;
  _legacyVariantsAbsorbed?: boolean;
  removeClub: (club_id: ClubId) => void;
  clearBag: () => void;
  /** Bag as a driver→putter-sorted array (for display + brain context). */
  bagList: () => RegisteredClub[];
  /**
   * Set the clubs in the bag TODAY. An empty array means carrying the whole registered bag.
   *
   * `limit` caps the selection — pass USGA_CLUB_LIMIT in competition. Enforced HERE rather than only
   * in the UI so a voice path or a future surface cannot start a competition round with fifteen.
   */
  setCarriedToday: (club_ids: string[], opts?: { limit?: number | null }) => void;
  /** Back to carrying everything. */
  clearCarriedToday: () => void;
  /** The clubs actually in play right now — the Sunday-bag subset, or the whole bag. */
  carriedList: () => RegisteredClub[];
  /** True when he has deliberately pared the bag down for this round. */
  isPartialBag: () => boolean;
}

/**
 * A blank string from a vision scan means "could not read it", not "it is empty" — so blanks are
 * dropped before a merge rather than written over something a human typed.
 */
function stripBlank<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'label' || k === 'note' || k === 'source') continue; // handled by the caller
    if (typeof v === 'string' ? v.trim() !== '' : v != null) out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out as Partial<T>;
}

/**
 * A club said any way at all → the catalog id this store is keyed by. `normalizeClub` already owns
 * the four vocabularies ('DR' / 'Driver' / 'driver' / 'D'); this adds the last hop to an id.
 */
function resolveClubId(club: string): string | null {
  const raw = (club ?? '').trim();
  if (!raw) return null;
  if ((CLUB_ORDER as readonly string[]).includes(raw)) return raw;   // already an id
  const { normalizeClub } = require('../services/clubNormalize') as typeof import('../services/clubNormalize');
  const { clubNameToClubId } = require('./clubStatsStore') as typeof import('./clubStatsStore');
  const name = normalizeClub(raw);
  return name ? clubNameToClubId(name) : null;
}

let variantSeq = 0;
/** Monotonic + random: two variants added in the same millisecond must not collide. */
function newVariantId(): string {
  variantSeq += 1;
  return `v${Date.now().toString(36)}${variantSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const useClubBagStore = create<ClubBagState>()(
  persist(
    (set, get) => ({
      clubs: {},
      /**
       * REGISTERING IS IDEMPOTENT AND NEVER DESTRUCTIVE. Re-scanning a bag you already own must add
       * what is new and leave the rest alone — Tim: "If it persists the first time, then anything it
       * missed I can take a picture of." A scan that replaced the slot would delete the shaft and
       * grip he typed in, because a camera cannot read either of them.
       */
      registerClub: (club_id, meta) => {
        if (!club_id || club_id === 'unknown') return;
        const incoming: Partial<ClubSpecs> = {
          brand: meta?.brand, model: meta?.model, loft: meta?.loft,
          shaftBrand: meta?.shaftBrand, shaftWeight: meta?.shaftWeight, gripSize: meta?.gripSize,
        };
        const carries = Object.values(incoming).some((v) => v != null && v !== '');
        set((s) => {
          const prev = s.clubs[club_id];
          const variants = [...(prev?.variants ?? [])];
          if (carries) {
            /**
             * Which physical club did the scan just see? A label match is the answer when it has one
             * (re-scanning the same driver), otherwise the one in play — a second read of a bag is a
             * better look at the same clubs, not a discovery of new ones. A genuinely new driver is
             * added deliberately through addVariant, where the player says so.
             */
            const wanted = (meta?.variantLabel ?? incoming.model ?? '').trim().toLowerCase();
            let idx = wanted ? variants.findIndex((v) => v.label.trim().toLowerCase() === wanted) : -1;
            if (idx < 0) idx = variants.findIndex((v) => v.variant_id === prev?.inPlay);
            if (idx < 0 && variants.length > 0) idx = 0;
            if (idx < 0) {
              variants.push({
                variant_id: newVariantId(),
                label: (meta?.variantLabel ?? incoming.model ?? incoming.brand ?? '').trim() || club_id,
                ...stripBlank(incoming),
                registered_at: meta?.at ?? Date.now(),
                source: meta?.source ?? 'camera',
              });
            } else {
              // Merge: a blank field from a scan is "could not read it", never "erase what you knew".
              variants[idx] = { ...variants[idx], ...stripBlank(incoming) };
              if (meta?.variantLabel?.trim()) variants[idx].label = meta.variantLabel.trim();
            }
          }
          return {
            clubs: {
              ...s.clubs,
              [club_id]: {
                club_id,
                registered_at: prev?.registered_at ?? meta?.at ?? Date.now(),
                source: meta?.source ?? prev?.source ?? 'camera',
                note: meta?.note ?? prev?.note,
                variants,
                inPlay: prev?.inPlay ?? variants[0]?.variant_id,
              },
            },
          };
        });
      },
      setClubSpecs: (club_id, specs) =>
        set((s) => {
          const existing = s.clubs[club_id];
          if (!existing) return s;
          const variants = [...existing.variants];
          const idx = variants.findIndex((v) => v.variant_id === existing.inPlay);
          const at = idx >= 0 ? idx : 0;
          if (variants.length === 0) {
            // First thing ever known about this club. A voice registration starts here.
            variants.push({
              variant_id: newVariantId(),
              label: (specs.model ?? specs.brand ?? '').trim() || club_id,
              ...stripBlank(specs),
              registered_at: Date.now(),
              source: 'manual',
            });
          } else {
            variants[at] = { ...variants[at], ...stripBlank(specs) };
          }
          return {
            clubs: {
              ...s.clubs,
              [club_id]: {
                ...existing,
                note: specs.note ?? existing.note,
                variants,
                inPlay: existing.inPlay ?? variants[0].variant_id,
              },
            },
          };
        }),
      addVariant: (club_id, v) => {
        const existing = get().clubs[club_id];
        if (!existing) return null;
        const label = (v.label ?? '').trim();
        if (!label) return null;
        // Same label twice is the same club said twice, not a fourth driver.
        const dupe = existing.variants.find((x) => x.label.trim().toLowerCase() === label.toLowerCase());
        if (dupe) return dupe.variant_id;
        const variant_id = newVariantId();
        set((s) => ({
          clubs: {
            ...s.clubs,
            [club_id]: {
              ...s.clubs[club_id],
              variants: [...s.clubs[club_id].variants, {
                variant_id, label, ...stripBlank(v),
                registered_at: Date.now(), source: v.source ?? 'manual',
              }],
              inPlay: s.clubs[club_id].inPlay ?? variant_id,
            },
          },
        }));
        return variant_id;
      },
      setVariantSpecs: (club_id, variant_id, specs) =>
        set((s) => {
          const existing = s.clubs[club_id];
          if (!existing) return s;
          const variants = existing.variants.map((v) =>
            v.variant_id === variant_id
              ? { ...v, ...stripBlank(specs), label: specs.label?.trim() || v.label }
              : v);
          return { clubs: { ...s.clubs, [club_id]: { ...existing, variants } } };
        }),
      setInPlayVariant: (club_id, variant_id) =>
        set((s) => {
          const existing = s.clubs[club_id];
          if (!existing || !existing.variants.some((v) => v.variant_id === variant_id)) return s;
          return { clubs: { ...s.clubs, [club_id]: { ...existing, inPlay: variant_id } } };
        }),
      removeVariant: (club_id, variant_id) =>
        set((s) => {
          const existing = s.clubs[club_id];
          if (!existing) return s;
          const variants = existing.variants.filter((v) => v.variant_id !== variant_id);
          const inPlay = existing.inPlay === variant_id ? variants[0]?.variant_id : existing.inPlay;
          return { clubs: { ...s.clubs, [club_id]: { ...existing, variants, inPlay } } };
        }),
      declareVariant: (club, label) => {
        const id = resolveClubId(club);
        const clean = (label ?? '').trim();
        if (!id || !clean) return null;
        /**
         * Declaring a variant of a club you have not registered REGISTERS IT. Refusing would be the
         * app arguing with a player who just told it what is in his hand, and the bag being empty is
         * the commonest state of all before the first scan.
         */
        if (!get().clubs[id]) get().registerClub(id as ClubId, { source: 'voice' });
        const existing = get().clubs[id];
        const found = existing.variants.find((v) => v.label.trim().toLowerCase() === clean.toLowerCase());
        const variant_id = found ? found.variant_id : get().addVariant(id as ClubId, { label: clean, source: 'voice' });
        if (variant_id) get().setInPlayVariant(id as ClubId, variant_id);
        return variant_id ?? null;
      },
      variantLabelFor: (club) => {
        const id = resolveClubId(club ?? '');
        if (!id) return null;
        return inPlayVariant(get().clubs[id])?.label ?? null;
      },
      absorbLegacyVariants: (legacy) => {
        if (get()._legacyVariantsAbsorbed) return;
        const rows = Object.entries(legacy ?? {});
        // An empty fold does not latch: a cloud snapshot restored later still gets absorbed.
        if (rows.length === 0) return;
        for (const [name, label] of rows) {
          try { get().declareVariant(name, label); } catch { /* one bad row is not a reason to lose the rest */ }
        }
        set({ _legacyVariantsAbsorbed: true });
      },
      removeClub: (club_id) =>
        set((s) => {
          const next = { ...s.clubs };
          delete next[club_id];
          return { clubs: next };
        }),
      clearBag: () => set({ clubs: {} }),
      carriedToday: [],
      setCarriedToday: (club_ids, opts) => {
        // Only ids he actually owns — a carried club that is not in the bag is not a fact.
        const owned = new Set(Object.keys(get().clubs));
        let next = [...new Set(club_ids)].filter((id) => owned.has(id));
        /**
         * 2026-09-11 (Tim) — "if in competition only be allowed to add 14 and cite USGA."
         *
         * USGA/R&A Rule 4.1b(1): a player must not START a round with more than fourteen clubs. The
         * penalty is two strokes per hole where the breach happened, capped at four — so a bag the
         * app let you pack wrong is a real scorecard cost, not a cosmetic one.
         *
         * The PUTTER is kept whatever else is trimmed. Nobody plays a round without one, and losing
         * it to an arbitrary slice of the list would be the app making the worst possible choice on
         * the player's behalf.
         */
        const limit = opts?.limit ?? null;
        if (limit != null && next.length > limit) {
          /**
           * 'PT'. Not 'PUTTER' — which is what this line said until typecheck caught it against the
           * ClubId union, and which would have silently trimmed the putter out of a competition bag
           * while the comment above claimed the opposite. A constant asserted in prose and never
           * checked against the type is exactly the shape of thing that ships wrong.
           * [[state-what-you-measured-not-what-you-intended]]
           */
          const putter = next.find((id) => id === PUTTER_ID);
          const rest = next.filter((id) => id !== putter);
          next = putter ? [putter, ...rest.slice(0, Math.max(0, limit - 1))] : rest.slice(0, limit);
        }
        set({ carriedToday: next });
      },
      clearCarriedToday: () => set({ carriedToday: [] }),
      carriedList: () => {
        const all = get().bagList();
        const carried = get().carriedToday;
        if (!carried || carried.length === 0) return all;   // empty = carrying everything
        const keep = new Set(carried);
        const subset = all.filter((c) => keep.has(c.club_id));
        /**
         * A subset that resolves to nothing means the registered bag changed under it — a club was
         * removed after the Sunday bag was chosen. Fall back to the whole bag rather than telling
         * the caddie he is carrying none, which would silence every club call.
         */
        return subset.length > 0 ? subset : all;
      },
      isPartialBag: () => {
        const carried = get().carriedToday;
        return carried.length > 0 && carried.length < Object.keys(get().clubs).length;
      },
      /**
       * 2026-09-13 (Tim) — ONE BAG. Measured clubs ARE in the bag until he says otherwise.
       *
       * The Fit Profile showed "No clubs registered yet" directly beneath "13 tracked", and then
       * named his Driver, 7I, LW and GW in the gap analysis — all true, and self-contradictory to
       * read, because two stores each held half of "your bag": this one (what you told us you carry)
       * and clubStatsStore (what we measured you hitting). Registering is a REFINEMENT — specs,
       * lofts, which ones you packed today — not the thing that decides whether a club exists.
       *
       * It also closes a real hole: caddieRequestBody sends `bagClubs` from carriedList(), so a
       * player who never opened the bag scanner handed the caddie an EMPTY bag while the app had
       * thirteen measured clubs. Club selection and plays-like read from that.
       *
       * The registered bag always wins when it has anything in it, so nothing overrides a real
       * registration, and a measured stand-in is marked source 'measured' so no surface can mistake
       * it for a scanned club with specs. [[sweep-the-missing-half-not-the-unused-export]]
       */
      bagList: () => {
        const registered = Object.values(get().clubs);
        if (registered.length > 0) {
          return registered.sort((a, b) => CLUB_ORDER.indexOf(a.club_id) - CLUB_ORDER.indexOf(b.club_id));
        }
        try {
          /**
           * Narrowly typed on purpose: `typeof import('./clubStatsStore')` pulls the whole module
           * type across a store-to-store boundary and the cycle collapses inference to `any` in
           * every consumer (dashboard, play). This asks for the two members it uses and nothing else.
           */
          const stats = require('./clubStatsStore') as {
            CLUB_ORDER: readonly string[];
            useClubStatsStore: { getState: () => { hasDistance: (c: string) => boolean } };
          };
          const st = stats.useClubStatsStore.getState();
          return stats.CLUB_ORDER
            .filter((c) => c !== 'Putter' && st.hasDistance(c))
            .map((c): RegisteredClub => ({ club_id: c as ClubId, registered_at: 0, source: 'measured', variants: [] }))
            .sort((a, b) => CLUB_ORDER.indexOf(a.club_id) - CLUB_ORDER.indexOf(b.club_id));
        } catch {
          return [];
        }
      },
    }),
    {
      name: 'club-bag-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      version: 2,
      /**
       * v1 → v2: flat brand / model / loft become the slot's first VARIANT.
       *
       * The store key stays `club-bag-v1` on purpose — renaming it would strand every club already
       * on the device, which is the one kind of pre-launch breakage APP-BUILD-RULES B1 still calls a
       * bug. A slot that knew nothing keeps an empty variant list rather than gaining a blank club.
       */
      migrate: (persisted, version) => {
        const st = (persisted ?? {}) as { clubs?: Record<string, Record<string, unknown>>; carriedToday?: string[] };
        if (version >= 2 || !st.clubs) return st as never;
        const clubs: Record<string, RegisteredClub> = {};
        for (const [id, rawClub] of Object.entries(st.clubs)) {
          const raw = rawClub ?? {};
          const brand = typeof raw.brand === 'string' ? raw.brand : undefined;
          const model = typeof raw.model === 'string' ? raw.model : undefined;
          const loft = typeof raw.loft === 'string' ? raw.loft : undefined;
          const registered_at = typeof raw.registered_at === 'number' ? raw.registered_at : Date.now();
          const source = (raw.source as ClubRegisterSource) ?? 'camera';
          const variants: ClubVariant[] = (brand || model || loft)
            ? [{
                variant_id: newVariantId(),
                label: (model || brand || '').trim() || id,
                ...(brand ? { brand } : {}), ...(model ? { model } : {}), ...(loft ? { loft } : {}),
                registered_at, source,
              }]
            : [];
          clubs[id] = {
            club_id: id as ClubId,
            registered_at,
            source,
            ...(typeof raw.note === 'string' ? { note: raw.note } : {}),
            variants,
            ...(variants[0] ? { inPlay: variants[0].variant_id } : {}),
          };
        }
        return { ...st, clubs } as never;
      },
    },
  ),
);
