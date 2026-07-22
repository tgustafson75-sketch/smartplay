/**
 * Cloud backup · snapshot gather/apply.
 *
 * The backup payload is a map of { <persist-store-key> : <raw JSON string> }.
 * Every backed-up store is a zustand persist store whose serialized blob lives
 * in AsyncStorage under its `name` key (see services/ssrSafeStorage.ts). So the
 * snapshot is just a curated multiGet of those keys — no per-store coupling, and
 * restore is a multiSet that the stores rehydrate from on next boot.
 *
 * v1 scope = STRUCTURED data only (the irreplaceable JSON). Media-heavy stores
 * (cage-store swing clips, custom-caddie base64 portraits) are deliberately
 * EXCLUDED here — they reference local file:// media that won't survive a
 * reinstall anyway, and belong to the phase-2 media sync (Supabase Storage).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** The current snapshot shape. Bump when the SET of keys or the wrapper shape
 *  changes so restore can migrate/skip an old payload cleanly. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Curated allowlist of persist-store keys to back up. EXPLICIT (not "everything
 * minus") so a new store is never silently swept into the cloud without thought.
 * Every entry is structured JSON that is expensive or impossible to recreate.
 */
export const BACKED_UP_STORE_KEYS: string[] = [
  // ── Crown jewels ──────────────────────────────────────────────
  'round-store-v1',        // rounds, scores, shots, handicap history
  'club-bag-v1',           // the player's bag
  'club-stats-v1',         // per-club learned distances
  'caddie-memory-v1',      // CNS — learned tendencies / course memory
  'player-profile-v2',     // profile, handicap index, differentials
  'custom-courses-v1',     // scorecard-photo custom courses
  'course-captures-v1',    // captured course metadata (not the media files)
  // ── Practice / points / progression ───────────────────────────
  'practice-store',
  'practice-session-v1',
  'practice-points',
  'points-store-v1',
  'points-baseline',
  'workout-store-v1',      // imported SmartPump golf-workout history (third rail)
  'coach-knowledge-v1',
  // ── Goals / social / relationships ────────────────────────────
  'tee-goals-v1',
  'tournament-v1',
  'family-store-v1',
  'guest-profiles-v1',
  'relationship-store-v1',
  'team-intelligence-store-v1',
  // ── Learned CNS-adjacent signals (hard to recreate) ───────────
  'vocabulary-profile-v1',   // learned phrase → meaning map (voice)
  'trust-level-store-v1',    // earned trust spectrum level
  'watch-store-v1',          // on-watch swing-metric history (numbers, no media)
  // ── Green reads / finder / calibration ────────────────────────
  'green-rolls-v1',
  'smartfinder-store-v1',
  'club-selection-v1',
  'acoustic-calibration-v1',
  'cage-overlay-calibration-v1',
  // ── Preferences / progress flags ──────────────────────────────
  'settings-store-v2',
  'tutorial-store-v1',
  'voice-hints-v1',
  // ── Diagnostics that are cheap + useful to carry forward ───────
  'agent-brain-stats',
];

/**
 * Keys deliberately NOT backed up in v1 (documented so the exclusion is a
 * decision, not an oversight):
 *   - cage-store-v1          → swing sessions reference local clip media (phase-2 media sync)
 *   - custom-caddie-media-v1 → base64 portrait images (phase-2 media sync)
 *   - issue-log-v1, conversation-log → ephemeral diagnostics
 *   - gps-health-v1, undo-mark-v1, capture-engine-v1 → in-flight / ephemeral state
 */

export type Snapshot = Record<string, string>;

/** Read the current on-device values for every backed-up store. */
export async function gatherSnapshot(): Promise<Snapshot> {
  const pairs = await AsyncStorage.multiGet(BACKED_UP_STORE_KEYS);
  const out: Snapshot = {};
  for (const [k, v] of pairs) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

/**
 * Write a restored snapshot back into AsyncStorage. Only keys on the allowlist
 * are applied (defends against a tampered/foreign payload writing arbitrary
 * keys). The stores DON'T pick this up until they re-hydrate, so the caller
 * MUST reload the app after applying (both the Settings restore and the local
 * file import do exactly this via Updates.reloadAsync()).
 */
export async function applySnapshot(snapshot: Snapshot): Promise<number> {
  const entries = Object.entries(snapshot).filter(
    ([k, v]) => BACKED_UP_STORE_KEYS.includes(k) && typeof v === 'string' && v.length > 0,
  );
  if (entries.length === 0) return 0;
  // 2026-07-10 (audit D2) — restore must UNION round history with what's already on the
  // device, never blind-overwrite it. A round played offline (not yet backed up) would
  // otherwise be permanently replaced by the older cloud copy. Merge by id; the newer /
  // shot-fuller record wins, and local-only rounds are preserved.
  //
  // 2026-07-21 (QA audit) — the SAME data-loss protection the UPLOAD path already applies
  // to every grow-mostly learned store (unionSnapshots, GROW_MOSTLY_KEYS) was missing on
  // the RESTORE side, so a Restore blind-overwrote offline-accumulated CNS / club-stats /
  // practice / family data with an older, emptier cloud copy. Bring restore to parity:
  // for each grow-mostly key, if the on-device blob is meaningfully richer (longer) than
  // the incoming cloud blob, keep the local copy rather than clobbering it.
  for (let i = 0; i < entries.length; i++) {
    const key = entries[i][0];
    if (key === 'round-store-v1') {
      try {
        const local = await AsyncStorage.getItem('round-store-v1');
        const merged = mergeRoundBlobs(local, entries[i][1]);
        if (merged) entries[i] = ['round-store-v1', merged];
      } catch { /* fall back to the incoming blob as-is */ }
      continue;
    }
    if (GROW_MOSTLY_KEYS.includes(key)) {
      try {
        const local = await AsyncStorage.getItem(key);
        const localLen = typeof local === 'string' ? local.length : 0;
        const incomingLen = entries[i][1].length;
        // Incoming cloud copy is near-empty relative to the richer local copy → keep local.
        // Mirrors unionSnapshots' upload-side guard (nl < pl * 0.6).
        if (localLen > 0 && incomingLen < localLen * 0.6) {
          entries[i] = [key, local as string];
        }
      } catch { /* fall back to the incoming blob as-is */ }
    }
  }
  await AsyncStorage.multiSet(entries as [string, string][]);
  return entries.length;
}

// Learned/earned stores that only grow — never let an emptier device clobber the cloud's
// richer copy. Mirrors api/backup.ts GROW_MOSTLY_KEYS.
const GROW_MOSTLY_KEYS = [
  'caddie-memory-v1', 'club-stats-v1', 'club-bag-v1', 'player-profile-v2', 'practice-points',
  'points-store-v1', 'workout-store-v1', 'family-store-v1', 'vocabulary-profile-v1',
  'practice-session-v1', 'custom-courses-v1', 'course-captures-v1', 'watch-store-v1',
  'guest-profiles-v1', 'green-rolls-v1', 'tee-goals-v1', 'tournament-v1',
  // 2026-07-20 (bug-hunt fix) — these four accumulate irreplaceable learned data
  // (coaching knowledge FIFO, relationship observations/hero-moments, team-intelligence
  // handoffs, practice counters) but were missing here, so an emptier second device
  // clobbered the cloud's rich copy last-write-wins. Same class as the D1/D3/D4 fixes.
  'coach-knowledge-v1', 'relationship-store-v1', 'team-intelligence-store-v1', 'practice-store',
];

/**
 * 2026-07-10 (audit D5) — non-destructive UPLOAD merge for the client-direct cloud path.
 * Base is the local (`next`) snapshot, but round history is UNIONED with the cloud (`prev`)
 * and grow-mostly stores keep the cloud's copy unless the local one is a legit edit (not a
 * near-empty fresh device). Prevents a second/emptier device from wiping the cloud.
 */
export function unionSnapshots(prev: Snapshot, next: Snapshot): Snapshot {
  const merged: Snapshot = { ...prev, ...next };
  try {
    if (prev['round-store-v1'] && next['round-store-v1']) {
      const m = mergeRoundBlobs(prev['round-store-v1'], next['round-store-v1']); // base = local (next)
      if (m) merged['round-store-v1'] = m;
    } else if (prev['round-store-v1'] && !next['round-store-v1']) {
      merged['round-store-v1'] = prev['round-store-v1'];
    }
    for (const k of GROW_MOSTLY_KEYS) {
      const p = prev[k], n = next[k];
      const pl = typeof p === 'string' ? p.length : 0, nl = typeof n === 'string' ? n.length : 0;
      if (pl > 0 && nl < pl * 0.6) merged[k] = p; // incoming is near-empty → keep the cloud's copy
    }
  } catch { /* keep the last-write-wins merge */ }
  return merged;
}

/** Union the local + incoming round-store blobs on restore so no local round is lost.
 *  Base is the incoming (2nd arg) blob; only roundHistory is merged by id. */
function mergeRoundBlobs(localStr: string | null, incomingStr: string): string | null {
  try {
    type Rec = { id?: unknown; endedAt?: unknown; shots?: unknown[] };
    const inc = JSON.parse(incomingStr);
    const incHist: Rec[] = Array.isArray(inc?.state?.roundHistory) ? inc.state.roundHistory : [];
    const loc = localStr ? JSON.parse(localStr) : null;
    const locHist: Rec[] = Array.isArray(loc?.state?.roundHistory) ? loc.state.roundHistory : [];
    if (locHist.length === 0) return incomingStr; // nothing local to preserve
    const byId = new Map<string, Rec>();
    const add = (r: Rec) => {
      const id = r?.id == null ? null : String(r.id); if (id == null) return;
      const cur = byId.get(id);
      if (!cur) { byId.set(id, r); return; }
      const re = Number(r.endedAt ?? 0), ce = Number(cur.endedAt ?? 0);
      if (re > ce) { byId.set(id, r); return; }
      if (re === ce) {
        const rs = Array.isArray(r.shots) ? r.shots.length : 0, cs = Array.isArray(cur.shots) ? cur.shots.length : 0;
        if (rs > cs) byId.set(id, r);
      }
    };
    incHist.forEach(add); locHist.forEach(add); // local last → its shot-fuller copy survives a tie
    inc.state = { ...(inc.state ?? {}), roundHistory: Array.from(byId.values()) };
    return JSON.stringify(inc);
  } catch { return null; }
}

/**
 * A cheap, stable fingerprint of a snapshot so auto-backup can skip a no-op
 * upload when nothing changed. Not cryptographic — a length + rolling-sum hash
 * over the sorted key/value pairs is enough to detect "did anything change."
 */
export function snapshotFingerprint(snapshot: Snapshot): string {
  const keys = Object.keys(snapshot).sort();
  let h = 5381;
  let totalLen = 0;
  for (const k of keys) {
    const s = k + ' ' + snapshot[k];
    totalLen += s.length;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0; // djb2, wrapped to int32
    }
  }
  return `${keys.length}.${totalLen}.${(h >>> 0).toString(36)}`;
}
