/**
 * 2026-05-22 — Swing Intelligence Database.
 *
 * Reference library of swings the user (or future server) wants
 * SmartMotion to compare current swings against. Three source kinds:
 *
 *   - 'self_upload'   — user uploaded one of their own swings + tagged
 *                       it as a reference ("my best swing this year",
 *                       "my pre-injury swing")
 *   - 'pro_clip'      — short clip uploaded by user OR YouTube link
 *                       (we store the URL + metadata; download is
 *                       opt-in via a separate step)
 *   - 'archetype'     — built-in ideal-model swings the app ships with
 *                       (no upload; coords from a curated pose dataset)
 *
 * Stored LOCALLY in AsyncStorage. Privacy-first — no server sync until
 * the user explicitly opts in (future). Capped at 50 entries to keep
 * the device cache tight; oldest non-archetype entries evicted first.
 *
 * Search:
 *   - searchSimilarSwings(currentEstimate) → ranked list with similarity
 *     scores driven by SwingComparisonEngine.compareSwings (composes
 *     against each candidate; sorts by overall_match desc).
 *   - getArchetypeMatches(profile) → seed archetypes filtered to the
 *     player's body type / skill / age band (no analysis required).
 *
 * Add:
 *   - addReferenceSwing(input) — single entry point. Defers to the
 *     calling UI to confirm the upload (privacy gate).
 *
 * What this is NOT:
 *   - Doesn't download YouTube videos. We store the URL + extracted
 *     metadata; downstream comparison either samples the YouTube
 *     player URL via a thumbnail service (limited fidelity) OR the
 *     user manually downloads + uploads the clip via Phase 2.5.
 *   - Doesn't run pose detection itself. Stores PoseEstimate
 *     biomechanics + sample keyframes when supplied; comparison
 *     happens through SwingComparisonEngine.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { devLog } from './devLog';
import type { PoseEstimate, SwingBiomechanics, PoseFrame } from './poseEstimator';

// ─── Public types ────────────────────────────────────────────────────────

export type ReferenceSource = 'self_upload' | 'pro_clip' | 'archetype';

export type FaultTag =
  | 'over_the_top'
  | 'early_extension'
  | 'casting'
  | 'sway'
  | 'hanging_back'
  | 'flip_release'
  | 'reverse_pivot'
  | 'sliding_hips'
  | 'lifting_head'
  | 'across_the_line'
  | 'laid_off'
  | 'chicken_wing'
  | 'none';

export type PlayerArchetype =
  | 'tour_pro'
  | 'amateur_single_digit'
  | 'amateur_mid'
  | 'amateur_high'
  | 'junior_developing'
  | 'senior_smooth';

export interface ReferenceSwing {
  /** Stable id. Generated at add-time. */
  id: string;
  /** Human-readable label ("My Best 7i — June 2026", "Rory 2023 driver"). */
  label: string;
  /** Where this came from. */
  source: ReferenceSource;

  /** Optional video URI (local file://) when the user uploaded a clip. */
  videoUri?: string | null;
  /** Optional YouTube URL when the reference is a public clip. We store
   *  the link; we don't download. */
  youtubeUrl?: string | null;
  /** Thumbnail URI for the swing-library list. Falls back to
   *  YouTube's auto thumbnail when youtubeUrl is set + no upload. */
  thumbnailUri?: string | null;

  /** Pro name when source = 'pro_clip'. Used in the
   *  comparison voice summary ("vs Rory 2023"). */
  proName?: string | null;
  /** Club bracket the reference covers. Drives search filter. */
  club?: string | null;
  /** Archetype tier — drives getArchetypeMatches filtering. */
  archetype?: PlayerArchetype | null;
  /** Body metrics from the player who recorded the swing — informs
   *  matching when comparing a 5'2" junior against an adult reference. */
  body?: {
    handedness?: 'right' | 'left' | 'unknown';
    height_inches?: number | null;
    age_band?: 'tiny' | 'junior' | 'teen' | 'adult';
  };
  /** Fault tags the player wants to AVOID matching (or to specifically
   *  match against as a "do not do this" reference). */
  fault_tags?: FaultTag[];
  /** Biomechanics snapshot from poseEstimator when available — the
   *  SwingComparisonEngine reads this for metric deltas. */
  biomechanics?: SwingBiomechanics | null;
  /** Sample keyframes from pose detection. Empty when the source is
   *  a URL-only YouTube reference. */
  frames?: PoseFrame[];

  /** Free-text notes from the user. */
  notes?: string | null;
  /** Created at (ms epoch). */
  created_at: number;
  /** Last used in a comparison (ms epoch); drives "recently referenced"
   *  list ordering. */
  last_used_at: number | null;
}

export interface SimilarMatch {
  reference: ReferenceSwing;
  /** 0..100 — overall match (forwarded from SwingComparisonEngine). */
  similarity: number;
  /** 1-3 takeaways the UI / coach voice can lead with. */
  takeaways: string[];
}

export interface AddReferenceInput {
  label: string;
  source: ReferenceSource;
  videoUri?: string | null;
  youtubeUrl?: string | null;
  proName?: string | null;
  club?: string | null;
  archetype?: PlayerArchetype | null;
  body?: ReferenceSwing['body'];
  fault_tags?: FaultTag[];
  biomechanics?: SwingBiomechanics | null;
  frames?: PoseFrame[];
  notes?: string | null;
}

// ─── Storage + cache ────────────────────────────────────────────────────

const STORE_KEY = 'swing-database-v1';
const MAX_ENTRIES = 50;

let memoCache: ReferenceSwing[] | null = null;

async function readAll(): Promise<ReferenceSwing[]> {
  if (memoCache) return memoCache;
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as ReferenceSwing[]) : [];
    // Always include the seed archetypes at the top of the list so
    // first-launch users have something to compare against immediately.
    const merged = mergeSeeds(parsed);
    memoCache = merged;
    return merged;
  } catch (e) {
    devLog('[swingDB] readAll failed (non-fatal): ' + String(e));
    memoCache = mergeSeeds([]);
    return memoCache;
  }
}

async function writeAll(entries: ReferenceSwing[]): Promise<void> {
  // Strip archetypes from the persisted set — they're seeded at read.
  const persistable = entries.filter((e) => e.source !== 'archetype');
  const capped = enforceCap(persistable);
  memoCache = mergeSeeds(capped);
  try {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(capped));
  } catch (e) {
    devLog('[swingDB] writeAll failed (non-fatal): ' + String(e));
  }
}

function enforceCap(entries: ReferenceSwing[]): ReferenceSwing[] {
  if (entries.length <= MAX_ENTRIES) return entries;
  // Sort by last_used_at desc, then created_at desc, then keep MAX_ENTRIES.
  const sorted = [...entries].sort((a, b) => {
    const aTime = (a.last_used_at ?? 0) || a.created_at;
    const bTime = (b.last_used_at ?? 0) || b.created_at;
    return bTime - aTime;
  });
  return sorted.slice(0, MAX_ENTRIES);
}

// ─── Public API ──────────────────────────────────────────────────────────

/** Add a reference swing. UI MUST confirm with the user before calling
 *  this — privacy gate. Returns the assigned id. */
export async function addReferenceSwing(input: AddReferenceInput): Promise<string> {
  const id = 'ref_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  const entry: ReferenceSwing = {
    id,
    label: input.label.trim() || 'Untitled reference',
    source: input.source,
    videoUri: input.videoUri ?? null,
    youtubeUrl: input.youtubeUrl ?? null,
    thumbnailUri: deriveThumbnail(input),
    proName: input.proName ?? null,
    club: input.club ?? null,
    archetype: input.archetype ?? null,
    body: input.body,
    fault_tags: input.fault_tags ?? [],
    biomechanics: input.biomechanics ?? null,
    frames: input.frames ?? [],
    notes: input.notes ?? null,
    created_at: Date.now(),
    last_used_at: null,
  };
  const all = await readAll();
  await writeAll([...all, entry]);
  devLog(`[swingDB] added ${entry.label} source=${entry.source} club=${entry.club ?? '?'} arch=${entry.archetype ?? '?'}`);
  return id;
}

/** Remove a reference by id. Archetypes can't be removed (returns false
 *  silently). */
export async function removeReferenceSwing(id: string): Promise<boolean> {
  const all = await readAll();
  const before = all.length;
  const next = all.filter((e) => e.id !== id || e.source === 'archetype');
  if (next.length === before) return false;
  await writeAll(next);
  devLog(`[swingDB] removed ${id}`);
  return true;
}

/** List references, optionally filtered. */
export async function listReferences(opts?: {
  source?: ReferenceSource;
  club?: string;
  archetype?: PlayerArchetype;
}): Promise<ReferenceSwing[]> {
  const all = await readAll();
  return all.filter((e) => {
    if (opts?.source && e.source !== opts.source) return false;
    if (opts?.club && e.club && e.club !== opts.club) return false;
    if (opts?.archetype && e.archetype !== opts.archetype) return false;
    return true;
  });
}

/** Pick archetypes that match the player's profile. Pure filter — no
 *  comparison required. Useful for first-launch UI ("we picked a few
 *  models that fit your body type"). */
export async function getArchetypeMatches(profile: {
  age_band?: 'tiny' | 'junior' | 'teen' | 'adult';
  skill?: 'first_swings' | 'learning' | 'developing' | 'competitive';
}): Promise<ReferenceSwing[]> {
  const all = await readAll();
  const archetypes = all.filter((e) => e.source === 'archetype');
  return archetypes.filter((a) => {
    if (profile.age_band && a.body?.age_band) {
      if (profile.age_band !== a.body.age_band) {
        // Adults can also see junior/teen for context, but kids
        // shouldn't see tour-pro archetypes as their default.
        if (profile.age_band !== 'adult') return false;
      }
    }
    if (profile.skill === 'first_swings' && a.archetype === 'tour_pro') return false;
    return true;
  });
}

/**
 * Rank reference swings by similarity to the current swing's
 * biomechanics. Calls SwingComparisonEngine internally so consumers
 * get a uniform overall_match score per reference + the takeaways.
 *
 * Returns the top `limit` (default 5) most-similar references. Empty
 * when no references have biomechanics available to compare.
 */
export async function searchSimilarSwings(
  current: PoseEstimate,
  limit = 5,
  filter?: { club?: string; minMatch?: number },
): Promise<SimilarMatch[]> {
  if (!current.biomechanics) {
    devLog('[swingDB] searchSimilarSwings: current has no biomechanics; cannot compare');
    return [];
  }
  const all = await readAll();
  // Lazy import to avoid module load cycle (compareEngine imports nothing
  // from this file today; defensive in case it does later).
  const compareMod = await import('./swingComparisonEngine');
  const matches: SimilarMatch[] = [];
  for (const ref of all) {
    if (!ref.biomechanics) continue;
    if (filter?.club && ref.club && ref.club !== filter.club) continue;
    const refEstimate: PoseEstimate = {
      source: 'video',
      confidence: 80,
      frames: ref.frames ?? [],
      biomechanics: ref.biomechanics,
      swingVerdict: null,
      reason: `reference: ${ref.label}`,
      age_band: ref.body?.age_band ?? 'adult',
      mirrored: ref.body?.handedness === 'left',
      joint_confidence: { hip: 0.9, shoulder: 0.9, knee: 0.7, wrist: 0.7, ankle: 0.7, head: 0.7 },
      partial_view: false,
    };
    const cmp = compareMod.compareSwings({
      current,
      reference: refEstimate,
      kind:
        ref.source === 'self_upload' ? 'self_vs_self' :
        ref.source === 'archetype' ? 'self_vs_avatar' : 'self_vs_pro',
    });
    if (filter?.minMatch != null && cmp.overall_match < filter.minMatch) continue;
    matches.push({
      reference: ref,
      similarity: cmp.overall_match,
      takeaways: cmp.takeaways,
    });
  }
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, limit);
}

/** Mark a reference as just-used. Updates last_used_at so the UI's
 *  recently-referenced list stays fresh. */
export async function touchReference(id: string): Promise<void> {
  const all = await readAll();
  const idx = all.findIndex((e) => e.id === id);
  if (idx < 0 || all[idx].source === 'archetype') return;
  all[idx] = { ...all[idx], last_used_at: Date.now() };
  await writeAll(all);
}

// ─── Seed archetypes ────────────────────────────────────────────────────
//
// Curated biomechanics anchors that ship with the app. Numbers
// calibrated against publicly documented coaching standards. Frames
// arrays are intentionally empty — the engine compares on biomech
// metrics alone for archetypes.

const SEED_ARCHETYPES: ReferenceSwing[] = [
  {
    id: 'arch_tour_driver',
    label: 'Tour-median driver',
    source: 'archetype',
    proName: null,
    club: 'Driver',
    archetype: 'tour_pro',
    body: { handedness: 'right', age_band: 'adult' },
    fault_tags: [],
    biomechanics: {
      hipTurnDeg: 45, shoulderTurnDeg: 95, weightShiftPct: 80,
      spineAngleDeltaDeg: 4, headDriftPxNorm: 0.02, hipSlideRatio: 0.6,
      frames: [],
      verdicts: { hipTurn: null, shoulderTurn: null, weightShift: null, posture: null },
    },
    notes: 'PGA Tour median driver swing — anchor for adult comparisons.',
    created_at: 0, last_used_at: null,
  },
  {
    id: 'arch_amateur_good_7i',
    label: 'Single-digit 7-iron',
    source: 'archetype',
    proName: null,
    club: '7i',
    archetype: 'amateur_single_digit',
    body: { handedness: 'right', age_band: 'adult' },
    fault_tags: [],
    biomechanics: {
      hipTurnDeg: 38, shoulderTurnDeg: 88, weightShiftPct: 72,
      spineAngleDeltaDeg: 6, headDriftPxNorm: 0.035, hipSlideRatio: 0.7,
      frames: [],
      verdicts: { hipTurn: null, shoulderTurn: null, weightShift: null, posture: null },
    },
    notes: 'Well-struck 7-iron for a single-digit handicap.',
    created_at: 0, last_used_at: null,
  },
  {
    id: 'arch_junior_developing',
    label: 'Junior developing — full swing',
    source: 'archetype',
    proName: null,
    club: '7i',
    archetype: 'junior_developing',
    body: { handedness: 'right', age_band: 'junior' },
    fault_tags: [],
    biomechanics: {
      hipTurnDeg: 32, shoulderTurnDeg: 75, weightShiftPct: 60,
      spineAngleDeltaDeg: 8, headDriftPxNorm: 0.05, hipSlideRatio: 0.85,
      frames: [],
      verdicts: { hipTurn: null, shoulderTurn: null, weightShift: null, posture: null },
    },
    notes: 'Healthy developing-junior pattern; less rotation, more freedom.',
    created_at: 0, last_used_at: null,
  },
];

function mergeSeeds(stored: ReferenceSwing[]): ReferenceSwing[] {
  // Seeds take precedence at their id slot; stored entries (which
  // exclude archetypes since writeAll filters them out) come after.
  return [...SEED_ARCHETYPES, ...stored];
}

// ─── YouTube helpers ────────────────────────────────────────────────────

function deriveThumbnail(input: AddReferenceInput): string | null {
  if (!input.youtubeUrl) return null;
  const id = parseYouTubeId(input.youtubeUrl);
  if (!id) return null;
  // hqdefault is the most-reliable size; YouTube serves it for every
  // video without needing API key.
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Strict YouTube id parser. Returns null if not a valid URL form. */
export function parseYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/^\/(embed|shorts)\/([A-Za-z0-9_-]{6,15})/);
      if (m) return m[2];
    }
    return null;
  } catch {
    return null;
  }
}

/** 2026-05-23 — Two-phase YouTube ingestion: preview first, confirm
 *  second. Phase 1 (this function) parses the URL, derives the
 *  thumbnail, and returns a preview object the UI shows in a confirm
 *  sheet — never adds anything to the database without explicit user
 *  approval (per Phase 2 safety requirement). Phase 2 is the caller
 *  invoking `addReferenceSwing` with the preview's confirmed values.
 *
 *  Example UI flow:
 *    const preview = previewYouTubeReference(url, { label, proName, club });
 *    if (preview.kind === 'invalid') showError(preview.reason);
 *    else {
 *      const ok = await confirmDialog(preview.thumbnailUri, preview.label);
 *      if (ok) await addReferenceSwing(preview.addInput);
 *    }
 *
 *  Returns:
 *    { kind: 'invalid', reason } — URL didn't parse / unsupported.
 *    { kind: 'ok', videoId, thumbnailUri, addInput, alreadyExists } —
 *      ready for the confirm dialog. `alreadyExists` lets the UI
 *      surface "already in your library" without a separate query.
 */
export interface YouTubePreviewInvalid { kind: 'invalid'; reason: string }
export interface YouTubePreviewOK {
  kind: 'ok';
  videoId: string;
  thumbnailUri: string;
  /** Pre-built AddReferenceInput — caller passes directly to
   *  addReferenceSwing on user confirmation. */
  addInput: AddReferenceInput;
  /** True when a reference with this exact youtubeUrl is already
   *  in the database. UI shows "already in library" badge. */
  alreadyExists: boolean;
}
export type YouTubePreview = YouTubePreviewInvalid | YouTubePreviewOK;

export async function previewYouTubeReference(
  url: string,
  metadata?: {
    label?: string;
    proName?: string | null;
    club?: string | null;
    archetype?: PlayerArchetype | null;
    body?: ReferenceSwing['body'];
    notes?: string | null;
    fault_tags?: FaultTag[];
  },
): Promise<YouTubePreview> {
  if (!url || typeof url !== 'string') {
    return { kind: 'invalid', reason: 'Empty or invalid URL.' };
  }
  const videoId = parseYouTubeId(url);
  if (!videoId) {
    return { kind: 'invalid', reason: 'Not a recognized YouTube URL (must be youtube.com/watch?v=... or youtu.be/...).' };
  }
  const thumbnailUri = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const all = await readAll();
  const alreadyExists = all.some((r) => {
    if (!r.youtubeUrl) return false;
    const existingId = parseYouTubeId(r.youtubeUrl);
    return existingId === videoId;
  });
  const label = metadata?.label?.trim() ||
    (metadata?.proName ? `${metadata.proName} — YouTube reference` : `YouTube reference (${videoId})`);
  return {
    kind: 'ok',
    videoId,
    thumbnailUri,
    alreadyExists,
    addInput: {
      label,
      source: 'pro_clip',
      youtubeUrl: url,
      proName: metadata?.proName ?? null,
      club: metadata?.club ?? null,
      archetype: metadata?.archetype ?? null,
      body: metadata?.body,
      notes: metadata?.notes ?? null,
      fault_tags: metadata?.fault_tags ?? [],
      // biomechanics + frames intentionally absent — YouTube clips
      // don't carry pose data unless a future transcode pass runs.
      biomechanics: null,
      frames: [],
    },
  };
}

/** Convenience: skip the preview step and go straight to add. UI
 *  shells that DO show a confirm step still call `previewYouTubeReference`
 *  first to surface the thumbnail + alreadyExists hint. Use this
 *  helper only when the UI already collected explicit user consent
 *  via its own confirm dialog. Returns the new reference id, or null
 *  on invalid URL. */
export async function addYouTubeReference(
  url: string,
  metadata?: {
    label?: string;
    proName?: string | null;
    club?: string | null;
    archetype?: PlayerArchetype | null;
    body?: ReferenceSwing['body'];
    notes?: string | null;
    fault_tags?: FaultTag[];
  },
): Promise<string | null> {
  const preview = await previewYouTubeReference(url, metadata);
  if (preview.kind === 'invalid') {
    devLog(`[swingDB] addYouTubeReference invalid: ${preview.reason}`);
    return null;
  }
  return addReferenceSwing(preview.addInput);
}

// ─── Convenience: golferModel-aware match summary ───────────────────────
//
// Returns a one-line "this is similar to your typical X" string by
// finding the closest reference in the user's own_uploads + tagging
// matching fault patterns from buildGolferModel().miss_type. Used by
// SmartMotion's "what does this remind me of" UI surface.

export async function describeFamiliarPattern(current: PoseEstimate): Promise<string | null> {
  try {
    const matches = await searchSimilarSwings(current, 3);
    if (matches.length === 0) return null;
    const top = matches[0];
    if (top.similarity < 55) return null;
    return `This is similar to your ${top.reference.label.toLowerCase()} (${top.similarity}% match).`;
  } catch (e) {
    devLog('[swingDB] describeFamiliarPattern failed: ' + String(e));
    return null;
  }
}

// ─── Cache clear (testing / dev) ─────────────────────────────────────────

export function _clearMemoCache(): void {
  memoCache = null;
}
