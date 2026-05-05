/**
 * Phase 111 — Primary Issue Ranker (personalization).
 *
 * Reads the user's per-shot Phase K analyses from cageStore and re-orders
 * the PRIMARY_ISSUE_CATALOG so the most-frequently-detected fault rises
 * to first position. Falls back to the static default order when there's
 * no analysis history yet.
 *
 * Conservative: requires at least N matched detections across recent N
 * sessions before it personalizes. New users see the static order.
 */

import { useCageStore } from '../store/cageStore';
import { PRIMARY_ISSUE_CATALOG, type PrimaryIssueEntry } from '../constants/primaryIssueCatalog';

const MIN_DETECTIONS_FOR_PERSONALIZATION = 3;
const RECENT_SESSIONS_WINDOW = 10;

/**
 * Returns the catalog re-ordered by the user's most-frequent detected
 * issues. If insufficient analysis history exists, returns the static
 * default order.
 */
export function getRankedPrimaryIssues(): readonly PrimaryIssueEntry[] {
  const cage = useCageStore.getState();
  const recentSessions = cage.sessionHistory ? cage.sessionHistory.slice(-RECENT_SESSIONS_WINDOW) : [];

  // Collect all per-shot detected_issue strings across the recent window.
  const detected: string[] = [];
  for (const session of recentSessions) {
    for (const shot of (session.shots ?? [])) {
      const issue = shot.perShotAnalysis?.detected_issue;
      if (typeof issue === 'string' && issue.length > 0) detected.push(issue);
    }
  }

  if (detected.length < MIN_DETECTIONS_FOR_PERSONALIZATION) {
    return PRIMARY_ISSUE_CATALOG;
  }

  // Count how many detected issues map to each catalog category.
  const categoryCounts = new Map<string, number>();
  for (const issue of detected) {
    for (const entry of PRIMARY_ISSUE_CATALOG) {
      if (entry.matchesDetectedIssues.includes(issue)) {
        categoryCounts.set(entry.category, (categoryCounts.get(entry.category) ?? 0) + 1);
        break; // each detected issue maps to at most one category
      }
    }
  }

  if (categoryCounts.size === 0) return PRIMARY_ISSUE_CATALOG;

  // Stable sort by count descending; categories with no count keep their
  // original relative position at the bottom.
  const withCounts = PRIMARY_ISSUE_CATALOG.map((entry, idx) => ({
    entry,
    idx,
    count: categoryCounts.get(entry.category) ?? 0,
  }));
  withCounts.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.idx - b.idx;
  });
  return withCounts.map((x) => x.entry);
}
