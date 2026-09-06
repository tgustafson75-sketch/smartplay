/**
 * Remote kill switches — the client half of Layer 0.
 *
 * 2026-09-06 (Tim) — a feature must be killable on a phone already in a player's pocket: no rebuild,
 * no OTA, no store review. The server half is api/flags.ts reading the `smartplay-flags` Edge Config.
 *
 * ── THE ONE RULE THIS FILE EXISTS TO ENFORCE ────────────────────────────────────────────────────
 *
 * A FAILED FLAG FETCH MUST NEVER DARK A FEATURE. Every path through this module answers "keep what
 * you already had" — there is no branch that turns a feature off because something went wrong. The
 * precedence is: last-known-good cache → bundled defaults (all ON) → never block boot.
 *
 * That is why the merge below runs against CURRENT state rather than against DEFAULTS: if the server
 * ever ships a document missing `smartvision`, the answer is "whatever smartvision is right now", not
 * "true" and certainly not "false". A truncated response cannot resurrect a feature Tim killed, and
 * a malformed one cannot kill a feature he didn't.
 *
 * ── WHY THERE IS NO SYNCHRONOUS HYDRATE ─────────────────────────────────────────────────────────
 *
 * The spec asked for a synchronous read of the cache before first render. AsyncStorage has no
 * synchronous API on any platform, so that is not available to us. What IS available, and is what
 * the requirement actually needs, is this: the store's INITIAL state is the bundled all-ON defaults,
 * so the very first render is correct and instant with no await anywhere. The cached document lands
 * a tick later via zustand's persist rehydration, and the network document later still. Boot is
 * never blocked and no feature is ever hidden while we wait to learn whether it should be.
 *
 * The cost is honest and small: for the first frames after a cold boot, a feature Tim killed is
 * briefly still visible. Hiding everything until the cache loads would trade that for a flash of an
 * empty menu on every launch for every player, forever, to be marginally faster at hiding something
 * in an emergency he can also just watch land a second later.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────
 *
 * No retry loop, no backoff, no circuit breaker, no failure counter, no toast, no banner, no log
 * surface (ENGINEERING-PRINCIPLES #3 and #4). One fetch, one timeout, and on any failure we simply
 * return. The next AppState-active transition is the retry, and it costs nothing to wait for it.
 *
 * Read-only to the app: nothing here writes a flag back. There is no debug toggle and no local
 * override, because a local override is a second source of truth for the one thing that has to be
 * unambiguous in an emergency.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AppState, type AppStateStatus } from 'react-native';
import { getPersistStorage } from '../services/ssrSafeStorage';
import { getApiBaseUrl } from '../services/apiBase';

/** The eight killable surfaces. Adding one here is the only place a new switch is declared. */
export type FlagKey =
  | 'smartvision'
  | 'smartfinder'
  | 'swinglab'
  | 'cage_capture'
  | 'voice_caddie'
  | 'kevin_tool_routing'
  | 'lie_analysis'
  | 'swing_analysis';

export type Flags = Record<FlagKey, boolean>;

/**
 * SHIPPED DEFAULTS — every feature ON.
 *
 * These are what a player gets on a cold install with no network, forever, if /flags never answers.
 * They must mirror the DEFAULTS block in api/flags.ts.
 */
export const DEFAULT_FLAGS: Flags = {
  smartvision: true,
  smartfinder: true,
  swinglab: true,
  cage_capture: true,
  voice_caddie: true,
  kevin_tool_routing: true,
  lie_analysis: true,
  swing_analysis: true,
};

/** Minimum gap between fetches. Not a tuned threshold — it is the spec's own 60s, and it exists so
 *  a player tabbing in and out repeatedly cannot spam the endpoint. */
const MIN_FETCH_INTERVAL_MS = 60_000;

/** The single fetch's own bound. Nothing retries it; the next foreground is the next attempt. */
const FETCH_TIMEOUT_MS = 4_000;

const PERSIST_KEY = 'smartplay.flags.v1';

interface FlagState {
  flags: Flags;
  /** Course ids whose BUILT geometry is not to be trusted. See isCourseGeometryDisabled. */
  disabledCourseIds: string[];
  minSupportedBuild: number;
  /** Server's own stamp on the document. Diagnostic only — nothing branches on it. */
  updatedAt: string | null;
  /** Wall-clock of the last SUCCESSFUL apply. Drives the 60s gate. */
  lastFetchedAt: number;
  /** Internal: set while a fetch is in flight so two foregrounds cannot race. */
  fetching: boolean;
}

interface FlagActions {
  /** Fire-and-forget. Resolves when done; never rejects, never throws. */
  refresh: (opts?: { force?: boolean }) => Promise<void>;
}

/**
 * Keep only real booleans for keys we ship, merged over CURRENT values.
 *
 * An unknown key is ignored — the server may ship a flag this build has never heard of, and that is
 * not an error, it is just a newer server. A known key that is missing or not a boolean keeps what
 * the store already has, which is the whole fail-open contract in one line.
 */
function mergeFlags(current: Flags, raw: unknown): Flags {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return current;
  const src = raw as Record<string, unknown>;
  const out: Flags = { ...current };
  for (const key of Object.keys(DEFAULT_FLAGS) as FlagKey[]) {
    if (typeof src[key] === 'boolean') out[key] = src[key] as boolean;
  }
  return out;
}

/** Course ids are opaque strings. A non-array, or entries that are not strings, are dropped rather
 *  than coerced — a coerced id would disable a course nobody named. */
function parseDisabledCourseIds(current: string[], raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return current;
  const list = (raw as Record<string, unknown>).disabled_course_ids;
  if (!Array.isArray(list)) return current;
  return list.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

export const useFlagStore = create<FlagState & FlagActions>()(
  persist(
    (set, get) => ({
      flags: { ...DEFAULT_FLAGS },
      disabledCourseIds: [],
      minSupportedBuild: 0,
      updatedAt: null,
      lastFetchedAt: 0,
      fetching: false,

      refresh: async ({ force = false } = {}) => {
        const s = get();
        if (s.fetching) return;
        if (!force && Date.now() - s.lastFetchedAt < MIN_FETCH_INTERVAL_MS) return;
        set({ fetching: true });
        try {
          const res = await fetch(`${getApiBaseUrl()}/flags`, {
            method: 'GET',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (!res.ok) return;
          const json: unknown = await res.json();
          if (!json || typeof json !== 'object' || Array.isArray(json)) return;
          const doc = json as Record<string, unknown>;

          const cur = get();
          const minBuild = doc.min_supported_build;
          const stamp = doc.updated_at;
          set({
            flags: mergeFlags(cur.flags, doc.flags),
            disabledCourseIds: parseDisabledCourseIds(cur.disabledCourseIds, doc.course_geometry),
            minSupportedBuild:
              typeof minBuild === 'number' && Number.isFinite(minBuild) ? minBuild : cur.minSupportedBuild,
            updatedAt: typeof stamp === 'string' ? stamp : cur.updatedAt,
            lastFetchedAt: Date.now(),
          });
        } catch {
          /**
           * Timeout, offline, non-JSON, DNS — all the same answer: keep what we have. No retry, no
           * counter, no log line. Deliberately empty; see the header. The next foreground retries.
           */
        } finally {
          set({ fetching: false });
        }
      },
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => getPersistStorage()),
      /** `fetching` is in-flight state, not knowledge — persisting it could strand the store with
       *  fetching:true after a hard kill mid-request and block every future refresh. */
      partialize: (s) => ({
        flags: s.flags,
        disabledCourseIds: s.disabledCourseIds,
        minSupportedBuild: s.minSupportedBuild,
        updatedAt: s.updatedAt,
        lastFetchedAt: s.lastFetchedAt,
      }),
    },
  ),
);

/**
 * Is this feature live? The one read the app should use.
 *
 * Answers from whatever the store currently holds, which on a cold offline boot is the bundled
 * all-ON defaults. It never awaits and never suspends.
 */
export function useFlag(key: FlagKey): boolean {
  return useFlagStore((s) => s.flags[key]);
}

/** Non-hook read, for service-layer and router callers that are not React components. */
export function isFlagEnabled(key: FlagKey): boolean {
  return useFlagStore.getState().flags[key];
}

/**
 * Has this course's BUILT geometry been switched off?
 *
 * 2026-09-06 — the spec originally aimed this at the Golfbert path, which was deleted earlier the
 * same day (f684f65c). Tim's call: point it at the built geometry instead, which is the real
 * exposure. The course engine synthesises holes from OSM/Overpass, and a bad synthesis produces
 * confident WRONG yardages on the tee — worse than none. Listing a course id here makes the geometry
 * layer return nothing for that course only, so it falls through to the honest path that already
 * exists (bundled holes, then the empty state). No new fallback is introduced.
 */
export function isCourseGeometryDisabled(courseId: string | null | undefined): boolean {
  if (!courseId) return false;
  return useFlagStore.getState().disabledCourseIds.includes(courseId);
}

/**
 * Start the background refresh. Called once from app/_layout.tsx.
 *
 * Two triggers, both cheap: boot, and every transition INTO active. The 60s gate inside refresh()
 * is what keeps a player who tabs in and out from spamming the endpoint, so the listener itself
 * stays this dumb on purpose.
 */
export function startFlagSync(): () => void {
  void useFlagStore.getState().refresh({ force: true });
  const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') void useFlagStore.getState().refresh();
  });
  return () => sub.remove();
}

/**
 * Route → flag, for the caddie's own tool routing.
 *
 * 2026-09-06 — services/releaseSurface.ts already learned this lesson the hard way and says so in
 * its header: hiding a card while leaving `appCatalog` and `openToolHandler` wired means the caddie
 * "still offers a shelved screen and navigates straight to it — the exact connected-but-not-used
 * trap, inverted." A kill switch has the same three consumers as a shelf, and gating only the ••• menu
 * would reproduce that bug exactly.
 *
 * Every route here must correspond to a screen that calls useFlagGate, and vice versa. The two are
 * the same decision expressed at the two ends of it — the menu that offers a feature and the code
 * that opens it — and a regression test asserts they agree.
 */
const ROUTE_TO_FLAG: Readonly<Record<string, FlagKey>> = {
  '/smartvision': 'smartvision',
  '/smartfinder': 'smartfinder',
  '/(tabs)/swinglab': 'swinglab',
  '/lie-analysis': 'lie_analysis',
  '/swinglab/upload': 'swing_analysis',
  '/swinglab/smartmotion': 'cage_capture',
};

/**
 * Is this route behind a switch that is currently off?
 *
 * Query-string tolerant, because the menu opens '/smartfinder?autoread=1' and the caddie can too —
 * a gate that misses on a query string is a gate with a hole in it.
 */
export function isRouteKilled(route: string | null | undefined): boolean {
  if (!route) return false;
  const bare = route.split('?')[0];
  const key = ROUTE_TO_FLAG[bare];
  if (!key) return false;
  return !useFlagStore.getState().flags[key];
}
