/**
 * 2026-08-09 (verification-wave speed #3) — ONE private copy per clip, shared by every extraction
 * consumer (pose frames, tempo, club path, ball departure).
 *
 * WHY THE COPY EXISTS (unchanged invariant — see the SIGSEGV history in clubPath.ts): a native
 * MediaMetadataRetriever decoding the SAME file ExoPlayer is playing crashes to the launcher.
 * Every extractor therefore works from a private copy and hard-refuses to run without one.
 *
 * WHY SHARED: each consumer used to make its OWN full byte-copy of the same clip — a 60-120s 4K
 * clip is hundreds of MB, copied 3-4× per review, serially, before any real work started. One
 * refcounted copy removes ~2-6s + the disk churn per review with zero change to the crash-safety
 * story: consumers only read the copy through the globally-mutexed thumbnail retriever, ExoPlayer
 * never touches cache files, and the file is deleted only when NO consumer holds it (plus an 8s
 * linger so back-to-back consumers in the same review reuse it instead of re-copying).
 *
 * Failure honesty: copy failure → null → the consumer skips its work (missing metric beats a
 * crash), exactly as each inline copy did before.
 */

import * as FileSystem from 'expo-file-system/legacy';

interface Entry {
  ready: Promise<string | null>;
  refs: number;
  copyUri: string | null;
  linger: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, Entry>();
/** Keep the copy this long after the last release — review consumers fire back-to-back. */
const LINGER_MS = 8_000;

export async function acquireClipCopy(
  videoUri: string,
): Promise<{ uri: string; release: () => void } | null> {
  let e = entries.get(videoUri);
  if (!e) {
    const entry: Entry = { refs: 0, copyUri: null, linger: null, ready: Promise.resolve(null) };
    entry.ready = (async () => {
      let dest: string | null = null;
      try {
        const dir = FileSystem.cacheDirectory;
        if (!dir) return null;
        dest = `${dir}shared-clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
        await FileSystem.copyAsync({ from: videoUri, to: dest });
        const info = await FileSystem.getInfoAsync(dest);
        if (!info.exists || (info.size ?? 0) <= 0) {
          // zero-byte copy: never adopt it (S5 class) — and don't leave it on disk.
          await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
          return null;
        }
        entry.copyUri = dest;
        return dest;
      } catch {
        // S5 class (ported from the old inline clubPath copy): copyAsync may have landed the file (or
        // a partial one) before getInfoAsync threw — a multi-hundred-MB orphan nothing references.
        // Best-effort delete so repeated failures can't accumulate.
        if (dest) void FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
        return null;
      }
    })();
    e = entry;
    entries.set(videoUri, e);
  }
  if (e.linger) { clearTimeout(e.linger); e.linger = null; }
  e.refs++;
  const uri = await e.ready;
  if (!uri) {
    e.refs--;
    if (e.refs <= 0) entries.delete(videoUri);
    return null;
  }
  const held = e;
  let released = false;
  return {
    uri,
    release: () => {
      if (released) return;
      released = true;
      held.refs--;
      if (held.refs <= 0) {
        held.linger = setTimeout(() => {
          // Only reap if no one re-acquired during the linger.
          if (held.refs <= 0) {
            entries.delete(videoUri);
            if (held.copyUri) {
              void FileSystem.deleteAsync(held.copyUri, { idempotent: true }).catch(() => undefined);
            }
          }
        }, LINGER_MS);
      }
    },
  };
}
