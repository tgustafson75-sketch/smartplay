/**
 * 2026-07-06 (elite audit) — render-time healing for persisted file:// IMAGE
 * uris. iOS regenerates the app-container UUID on every native build /
 * reinstall, so a stored ABSOLUTE path (fault frame, thumbnail) silently
 * points at the OLD container even though the file survived under the new
 * Documents prefix — the tile renders blank. Wraps the canonical re-anchor
 * (resolveImageUri in services/videoUpload.ts) in a hook for the raw-render
 * sites that can't run the swing-library-style async probe inline.
 *
 * Behavior: returns the stored uri immediately (common case — same install,
 * zero flicker), then swaps in the re-anchored path once the async probe
 * lands. Never "loses" a uri: when the file is genuinely gone (resolver
 * returns null) the stored value is kept, so the caller's existing
 * placeholder/onError path fires exactly as it does today.
 */

import { useEffect, useState } from 'react';
import { resolveImageUri } from '../services/videoUpload';

export function useResolvedImageUri(stored: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(stored ?? null);

  useEffect(() => {
    let cancelled = false;
    setResolved(stored ?? null);
    // Remote / content:// / ph:// uris don't suffer the container reshuffle.
    if (!stored || !stored.startsWith('file://')) return;
    void (async () => {
      try {
        const healed = await resolveImageUri(stored);
        if (!cancelled && healed && healed !== stored) setResolved(healed);
      } catch { /* keep the stored uri — no regression */ }
    })();
    return () => { cancelled = true; };
  }, [stored]);

  return resolved;
}
