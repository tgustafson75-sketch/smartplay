/**
 * Phase 111 — Primary Issue Catalog.
 *
 * The static catalog of fault categories surfaced as Primary Issue Cards
 * on the SwingLab tab. Each entry pairs an illustration component with
 * a description, an instructor video category key, and an optional
 * related drill ID.
 *
 * Default order is the static fallback when the user has no swing
 * analysis history. services/primaryIssueRanker.ts re-orders this
 * catalog based on the user's per-shot Phase K analyses so the
 * most-frequent detected issue rises to the top.
 */

import type { ComponentType } from 'react';
import SwingPathIllustration from '../components/illustrations/SwingPathIllustration';
import WeightTransferIllustration from '../components/illustrations/WeightTransferIllustration';
import TempoIllustration from '../components/illustrations/TempoIllustration';
import BallPositionIllustration from '../components/illustrations/BallPositionIllustration';
import GripIllustration from '../components/illustrations/GripIllustration';
import PostureIllustration from '../components/illustrations/PostureIllustration';
import type { IssueCategory } from './instructorVideos';

export interface PrimaryIssueEntry {
  category: IssueCategory;
  title: string;
  description: string;
  Illustration: ComponentType<{ size?: number; okColor?: string; warnColor?: string }>;
  /** Optional related drill ID — links to the Drill Library if the user
   *  wants to practice the fault. Set to null when no curated drill maps. */
  relatedDrillId?: string | null;
  /** Detected-issue strings (from Phase K perShotAnalysis.detected_issue)
   *  that map to this category. Used by primaryIssueRanker to count the
   *  user's most-frequent issue and re-order the catalog. */
  matchesDetectedIssues: readonly string[];
}

// Default catalog. Order = the order shown when the user has no
// personalization signal yet. Swing path is first per Phase 111 spec.
export const PRIMARY_ISSUE_CATALOG: readonly PrimaryIssueEntry[] = [
  {
    category: 'swing_path',
    title: 'Swing Path',
    description: 'How the club moves through the ball — inside-out, on-plane, or outside-in. Path determines start direction and curve.',
    Illustration: SwingPathIllustration,
    relatedDrillId: null,
    // Strings the Phase K classifier emits for path-related issues. Add
    // more synonyms as the classifier vocabulary settles.
    matchesDetectedIssues: ['over_the_top', 'outside_in', 'inside_out_extreme', 'swing_path', 'path_steep'] as const,
  },
  {
    category: 'weight_transfer',
    title: 'Weight Transfer',
    description: 'Pressure shift from trail foot to lead foot through impact. Hanging back costs compression and consistency.',
    Illustration: WeightTransferIllustration,
    relatedDrillId: null,
    matchesDetectedIssues: ['weight_back', 'hanging_back', 'reverse_pivot', 'weight_transfer'] as const,
  },
  {
    category: 'tempo',
    title: 'Tempo',
    description: 'A 3-to-1 backswing-to-downswing ratio is the tour-pro standard. Rushed transitions cost timing and contact.',
    Illustration: TempoIllustration,
    relatedDrillId: null,
    matchesDetectedIssues: ['tempo_rushed', 'rushed_transition', 'tempo'] as const,
  },
  {
    category: 'ball_position',
    title: 'Ball Position',
    description: 'Forward for driver, centre for mid-irons, slightly back for wedges. Position shifts angle of attack.',
    Illustration: BallPositionIllustration,
    relatedDrillId: null,
    matchesDetectedIssues: ['ball_position', 'ball_too_far_back', 'ball_too_far_forward'] as const,
  },
  {
    category: 'grip',
    title: 'Grip',
    description: 'Neutral V-shape pointing toward the trail shoulder is the foundation. Strong or weak grips bias face control.',
    Illustration: GripIllustration,
    relatedDrillId: null,
    matchesDetectedIssues: ['grip_strong', 'grip_weak', 'grip'] as const,
  },
  {
    category: 'posture',
    title: 'Posture',
    description: 'Athletic forward tilt from the hips, soft knees, head over the ball. Slumped or upright posture limits rotation.',
    Illustration: PostureIllustration,
    relatedDrillId: null,
    matchesDetectedIssues: ['posture_rounded', 'posture_upright', 'posture'] as const,
  },
] as const;
