/**
 * Clip-storage garbage collection (Open Thread #2).
 *
 * Persisted swing clips + diagnostic fault frames are copied into
 * documentDirectory so replay / re-analyze survive OS cache eviction
 * (services/videoUpload.ts persistClipToDocuments, services/poseDetection.ts
 * fault-frame persist). But sessions age out of cageStore's 50-session window
 * via `slice(-50)` with NO file cleanup, so the on-disk files leak forever and
 * storage grows unbounded.
 *
 * This is a mark-and-sweep run ONCE on cold boot (mirrors the purgeStaleAnalyses
 * boot-guard): collect every basename any still-persisted root references, then
 * delete files in our clip dirs that nothing references.
 *
 * SAFETY (this deletes user video — three load-bearing guarantees):
 *   1. HYDRATION GATE — refuses to sweep unless BOTH the cage store and the
 *      relationship store report hydrated. Zustand persist rehydrates async; a
 *      sweep against pre-hydration empty state would delete every live clip.
 *   2. BASENAME MATCH — references are matched by filename, not absolute path.
 *      documentDirectory's container prefix can drift across OS updates /
 *      reinstalls; comparing stored absolute URIs against the live dir listing
 *      would mark everything orphaned. Filenames are unique per clip/frame.
 *   3. ALL ROOTS — sessionHistory (clip + per-shot/session fault frames),
 *      the in-flight activeSession, AND relationshipStore.heroMoments. Missing
 *      a root would delete a still-referenced file.
 * Never throws; best-effort like the rest of the clip-persistence layer.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { useCageStore } from '../store/cageStore';
import { useRelationshipStore } from '../store/relationshipStore';

/** Subdirectories under documentDirectory that hold GC-managed clip files. */
const CLIP_DIRS = ['swing_clips/', 'smartmotion/'];

function basename(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const tail = uri.split('/').pop() ?? '';
  return tail.length > 0 ? tail : null;
}

export async function gcOrphanClips(): Promise<number> {
  try {
    const dir = FileSystem.documentDirectory;
    if (!dir) return 0;

    // Guard 1 — never sweep against an unhydrated (empty) store. cageStore
    // exposes an explicit flag flipped by onRehydrateStorage; relationshipStore
    // uses the standard persist hydration API.
    const cageHydrated = useCageStore.getState().hasHydrated === true;
    const relHydrated = useRelationshipStore.persist?.hasHydrated?.() ?? false;
    if (!cageHydrated || !relHydrated) return 0;

    // ── Mark: every basename a still-persisted root references ──
    const referenced = new Set<string>();
    const add = (uri?: string | null) => {
      const b = basename(uri);
      if (b) referenced.add(b);
    };

    const cage = useCageStore.getState();
    const sessions = [...cage.sessionHistory];
    if (cage.activeSession) sessions.push(cage.activeSession); // in-flight, not yet in history
    for (const s of sessions) {
      add(s.fault_frame_uri);
      add(s.primary_issue?.visual_reference_path);
      for (const shot of s.shots ?? []) {
        add(shot.clipUri);
        add(shot.perShotAnalysis?.visual_reference_path);
      }
    }
    for (const m of useRelationshipStore.getState().heroMoments) add(m.clipUri);

    // ── Sweep: delete files in our dirs that nothing references ──
    let deleted = 0;
    for (const sub of CLIP_DIRS) {
      const path = `${dir}${sub}`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists || !info.isDirectory) continue;
      const files = await FileSystem.readDirectoryAsync(path).catch(() => [] as string[]);
      for (const name of files) {
        if (referenced.has(name)) continue;
        await FileSystem.deleteAsync(`${path}${name}`, { idempotent: true }).catch(() => {});
        deleted++;
      }
    }
    return deleted;
  } catch {
    return 0;
  }
}
