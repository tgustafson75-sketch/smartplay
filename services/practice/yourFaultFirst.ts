/**
 * 2026-08-25 (pre-submission Swing Lab audit) — THE DRILLS GRID DID NOT KNOW THE PLAYER.
 *
 * Drills is the second card in Swing Lab and it rendered the same "Common Faults" grid for
 * everybody — while SmartMotion had been recording this player's actual faults after every analysed
 * swing, and `caddieMemoryStore.tendencies.dominantMiss` already held the most frequent one.
 * Classic shape for this codebase: the app knew, and the screen was never told.
 *
 * NO MAPPING IS INVENTED. SmartMotion records `rolled.issue_id`, a CanonicalIssue — the exact id
 * space the drill catalog is keyed by. So the player's dominant fault IS a drill id; this only has
 * to find it. That matters: the alternative (mapping ball-flight direction onto swing faults) would
 * have been a guess dressed as a diagnosis, and this app does not fabricate data points.
 *
 * Honest when it does not know: under MIN_FAULTS it returns null and the grid renders exactly as it
 * did before, with no claim made.
 */

/** Below this many recorded faults, one bad session would pick the drill. Not enough to lead with. */
export const MIN_FAULTS = 3;

export interface YourFault {
  /** CanonicalIssue id — matches a drill catalog entry id. */
  id: string;
  /** How many of the recent recorded faults were this one. */
  count: number;
  total: number;
  /** One line for the player, naming the drill's own title. */
  line: string;
}

export function yourFaultFirst(
  tendencies: { dominantMiss?: string | null; recentFaults?: string[] } | null | undefined,
  catalogIds: readonly string[],
  titleFor: (id: string) => string | null,
): YourFault | null {
  const faults = tendencies?.recentFaults ?? [];
  const dominant = (tendencies?.dominantMiss ?? '').trim();
  if (faults.length < MIN_FAULTS || !dominant) return null;

  // The dominant fault must be a real drill, or there is nothing to point at. A fault SmartMotion
  // can name but the catalog has no card for is a gap to fix in the catalog, not to paper over here.
  if (!catalogIds.includes(dominant)) return null;

  const count = faults.filter((f) => f === dominant).length;
  const title = titleFor(dominant);
  if (!title) return null;

  return {
    id: dominant,
    count,
    total: faults.length,
    line: `${count} of your last ${faults.length} reads came back ${title.toLowerCase()}. Start here.`,
  };
}
