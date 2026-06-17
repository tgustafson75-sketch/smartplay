/**
 * 2026-05-24 — Meta glasses voice-exchange ingest (v1 — JSON import).
 *
 * Workflow:
 *   1. User exports a Meta View JSON of their voice exchanges with the
 *      Ray-Ban Meta glasses (Meta AI / "Hey Meta" conversations).
 *   2. App reads the JSON, filters to the active round window
 *      (roundStartTime..now), attributes each entry to a hole via
 *      GPS-nearest-green bucketing (300yd radius), and writes into
 *      roundStore.externalContext.
 *   3. The caddie brain reads externalContext to answer questions like
 *      "what did Meta say on hole 7?".
 *
 * v1 scope (per spec):
 *   - JSON file import only (no real-time bridge).
 *   - Active round only — completed-round ingest is a follow-up that
 *     also needs endRound() to set roundEndTime.
 *   - Hole attribution: GPS distance to courseHoles green centroid.
 *     300yd is generous; tighter than that and tee-box and mid-fairway
 *     entries would drop. Falls back to currentHole when GPS is absent.
 *
 * Expected Meta JSON shape (per Meta View export):
 *   [
 *     {
 *       "timestamp": "2026-05-24T18:42:11.000Z",
 *       "transcript_user": "what's that hazard",
 *       "transcript_assistant": "looks like a fairway bunker, about 230 to clear",
 *       "location": { "lat": 33.7045, "lng": -117.1234 }
 *     },
 *     ...
 *   ]
 *
 * Failure modes:
 *   - File missing / unreadable        → throw (caller surfaces)
 *   - JSON parse fails                 → throw
 *   - No active round                  → return { ingested: 0 } silently
 *   - No entries in round window       → return { ingested: 0 }
 */

import { z } from 'zod';
import { useRoundStore } from '../store/roundStore';
import { haversineYards } from '../utils/geoDistance';
import { safeLatLng } from '../utils/coordGuard';

// System boundary: the Meta View export is third-party JSON we don't
// control. Validate each entry here (mirrors the RequestSchema pattern
// in api/meta-voice.ts) so malformed rows are dropped + counted rather
// than written into roundStore.externalContext as garbage. Per CLAUDE.md
// "validate at system boundaries" — the store method downstream is
// internal and trusted.
const MetaVoiceEntrySchema = z.object({
  // Must parse to a finite epoch; the round-window filter below relies on it.
  timestamp: z.string().refine((s) => Number.isFinite(new Date(s).getTime()), {
    message: 'unparseable timestamp',
  }),
  transcript_user: z.string().min(1).max(4000),
  transcript_assistant: z.string().min(1).max(4000),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
});

type MetaVoiceEntry = z.infer<typeof MetaVoiceEntrySchema>;

export type IngestResult = {
  ingested: number;
  totalParsed?: number;
  outsideWindow?: number;
  /** Entries dropped because they failed boundary validation. */
  rejected?: number;
};

/**
 * Read a Meta View JSON file and append each in-window entry to
 * roundStore.externalContext. Uses expo-file-system/legacy to match
 * the rest of the codebase's file-read convention
 * (mediaPipePoseService, glassesVisionInput, acousticDetectApi).
 */
export async function ingestMetaGlassesJson(jsonPath: string): Promise<IngestResult> {
  const FS = await import('expo-file-system/legacy');
  const raw = await FS.readAsStringAsync(jsonPath);
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('[metaIngest] expected a JSON array of voice entries');
  }

  // Boundary validation: drop malformed rows individually so one bad
  // entry can't poison the whole import. Count them for telemetry.
  const entries: MetaVoiceEntry[] = [];
  let rejected = 0;
  for (const row of parsed) {
    const result = MetaVoiceEntrySchema.safeParse(row);
    if (result.success) entries.push(result.data);
    else rejected++;
  }
  if (rejected > 0) {
    console.warn(`[metaIngest] dropped ${rejected} invalid entr${rejected === 1 ? 'y' : 'ies'}`);
  }

  const round = useRoundStore.getState();

  if (!round.roundStartTime) {
    console.log('[metaIngest] No active round — skipping');
    return { ingested: 0 };
  }

  const roundStart = round.roundStartTime;
  // roundEndTime stays null during an active round; Date.now() is the
  // operative upper bound. When historical-round ingest lands,
  // endRound() will set roundEndTime and this branch resolves to it.
  const roundEnd = round.roundEndTime ?? Date.now();

  const relevant = entries.filter((e) => {
    const t = new Date(e.timestamp).getTime();
    return Number.isFinite(t) && t >= roundStart && t <= roundEnd;
  });

  for (const entry of relevant) {
    // GPS-nearest-green hole attribution. 300yd radius is generous so
    // a tee-box or mid-fairway entry still buckets to the right hole.
    let hole: number | null = null;
    if (entry.location && round.courseHoles.length) {
      let bestHole: number | null = null;
      let bestDist = Infinity;
      for (const h of round.courseHoles) {
        // 2026-06-02 — Fix GM: guard against placeholder/garbage coords
        // (Westlake NJ, Sunnyvale, San Jose Muni, Mariners ship with
        // {0,0} or near-zero values for some F/M/B fields). Without
        // this guard, haversine(real-fix, placeholder) returns ~10M
        // yards finite, fails the 300y radius silently, hole stays
        // null, glasses commentary attribution drifts to currentHole.
        const mid = safeLatLng(h.middleLat, h.middleLng);
        if (!mid) continue;
        const d = haversineYards(entry.location, mid);
        if (d < bestDist) { bestDist = d; bestHole = h.hole; }
      }
      if (bestDist < 300) hole = bestHole;
    }

    round.appendExternalContext({
      source: 'meta_glasses',
      timestamp: new Date(entry.timestamp).getTime(),
      hole: hole ?? round.currentHole,
      user_prompt: entry.transcript_user,
      ai_response: entry.transcript_assistant,
      gps: entry.location ?? null,
    });
  }

  return {
    ingested: relevant.length,
    totalParsed: entries.length,
    outsideWindow: entries.length - relevant.length,
    rejected,
  };
}
