/**
 * Relationship engine — single entry point for converting interactions
 * (swings analyzed, holes scored, drills completed) into observations
 * Kevin can use silently in his brain prompt.
 *
 * Tonight's MVP wiring (Phase V.7+): swing analyses feed observations
 * with dedupe + repeat-pattern escalation. Other event types are
 * stubbed with the same shape so future call sites can plug in without
 * touching the call signature.
 */

import { useRelationshipStore } from '../store/relationshipStore';
import type { PrimaryIssue } from '../store/cageStore';

const DEDUPE_WINDOW_MS = 60 * 60 * 1000;             // 1h
const REPEAT_THRESHOLD = 3;                          // 3rd occurrence escalates copy

const ISSUE_PHRASES: Record<string, string> = {
  club_face_open: 'open face at impact',
  club_face_closed: 'closed face at impact',
  swing_path_outside_in: 'outside-in path',
  swing_path_inside_out: 'inside-out path',
  attack_angle_steep: 'steep attack angle',
  attack_angle_shallow: 'shallow attack angle',
  early_extension: 'early extension through impact',
  over_the_top: 'over-the-top move',
  chicken_wing: 'chicken-wing release',
  reverse_pivot: 'reverse pivot',
};

const phraseFor = (issueId: string): string =>
  ISSUE_PHRASES[issueId] ?? issueId.replace(/_/g, ' ');

/** Count recent observations whose content includes the given fragment. */
function countRecent(fragment: string): number {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // last 7 days
  return useRelationshipStore.getState().observations.filter(
    o => o.timestamp >= cutoff && o.content.includes(fragment),
  ).length;
}

/**
 * Record an observation from a completed swing analysis. Dedupes within
 * a 1h window (so re-analyzing the same swing doesn't spam observations)
 * and escalates copy on repeat occurrences ("3rd time" → tendency tag).
 */
export function processSwingAnalysis(args: {
  club: string | null;
  primary_issue: PrimaryIssue | null;
}): void {
  const issue = args.primary_issue;
  if (!issue || !issue.issue_id) return;
  const club = args.club ?? 'swing';
  const phrase = phraseFor(issue.issue_id);
  const tag = `${club}: ${phrase}`;

  const store = useRelationshipStore.getState();

  // Dedupe within 1h — re-analyses or back-to-back swings on same fault
  // shouldn't create N copies.
  const recentDup = store.observations.find(
    o => o.content.includes(tag) && Date.now() - o.timestamp < DEDUPE_WINDOW_MS,
  );
  if (recentDup) return;

  const occurrenceCount = countRecent(tag) + 1;
  const content = occurrenceCount >= REPEAT_THRESHOLD
    ? `tendency on ${tag} (${occurrenceCount}× this week)`
    : tag;

  store.addObservation({ type: 'technical', content });
}

// 2026-05-17 — Legacy `relationshipEngine` no-op stubs removed.
// No callers existed; the live API is `processSwingAnalysis` above.
