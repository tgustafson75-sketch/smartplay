/**
 * Phase 111 → Phase 111-followup — curated instructor video links per fault category.
 *
 * URLs upgraded from search-query placeholders to specific videos found
 * via web search of the named instructors. Every URL is a real YouTube
 * video by the attributed instructor (verified to exist, title matches
 * category). `verified: false` remains on each entry because the
 * empirical check still requires Tim:
 *   1. Open URL on Galaxy Z Fold → video plays (not removed / private)
 *   2. Length confirmed under 10 minutes (attention span during practice)
 *   3. Content addresses the named fault category as expected
 *   4. Video isn't dated by outdated technique (some Hank Haney pieces
 *      are 10-15 years old — fundamentals like grip don't really change,
 *      but check anyway)
 *
 * Each entry has primary + fallback. If primary fails Tim's check, swap
 * with fallback or substitute. The card UI uses primary only.
 *
 * Sources for specific video selection (all via WebSearch on instructor name + topic):
 * - Hank Haney via Golf Digest YouTube channel (slice fix, downswing, grip)
 * - Sean Foley via Golf Digest YouTube channel (weight shift)
 * - Mike Malaska via Malaska Golf YouTube channel (tempo, posture)
 * - Mike Bender via MikeBenderGolf YouTube channel (impact / setup)
 *
 * Ball Position note: a specific Mike-Bender ball-position video did not
 * surface in search; using his Impact video as primary (covers setup
 * including ball position relative to clubface) and his Swing Plane
 * video as fallback. Tim may want to source a more category-specific
 * video for v1.2.
 */

export type IssueCategory =
  | 'swing_path'
  | 'weight_transfer'
  | 'tempo'
  | 'ball_position'
  | 'grip'
  | 'posture';

export interface InstructorVideoLink {
  /** Display title shown to the user near the Watch button. */
  title: string;
  /** Channel / instructor attribution (shown in small text). */
  instructor: string;
  /** YouTube URL — full video link. */
  url: string;
  /** Approximate runtime in seconds. Cap is 10 min (600s). Where the
   *  video length wasn't surfaced by search, value is a conservative
   *  guess and Tim refines on verification. */
  approxRuntimeSec: number;
  /** Tim flips to true after empirically verifying the URL resolves
   *  to a relevant playable video on Galaxy Z Fold. */
  verified: boolean;
}

interface CategoryVideos {
  primary: InstructorVideoLink;
  fallback?: InstructorVideoLink;
}

export const INSTRUCTOR_VIDEOS: Record<IssueCategory, CategoryVideos> = {
  swing_path: {
    primary: {
      title: "Hank Haney's Simple Slice Fix",
      instructor: 'Hank Haney · Golf Digest',
      url: 'https://www.youtube.com/watch?v=ziKwS6Dve0M',
      approxRuntimeSec: 240,
      verified: false,
    },
    fallback: {
      title: 'How to Start Your Downswing and Stop Losing Shots Right',
      instructor: 'Hank Haney · Golf Digest',
      url: 'https://www.youtube.com/watch?v=DsGez_e8O6g',
      approxRuntimeSec: 240,
      verified: false,
    },
  },
  weight_transfer: {
    primary: {
      title: 'How to Shift Your Weight to Increase Swing Speed',
      instructor: 'Sean Foley · Golf Digest',
      url: 'https://www.youtube.com/watch?v=4ARmrHB3qSU',
      approxRuntimeSec: 240,
      verified: false,
    },
    fallback: {
      title: 'Weight Shift Made Really Easy',
      instructor: 'Golf Lesson channel',
      url: 'https://www.youtube.com/watch?v=foOHoj9HiEQ',
      approxRuntimeSec: 360,
      verified: false,
    },
  },
  tempo: {
    primary: {
      title: 'Finding Your Tempo · Maintaining Tempo',
      instructor: 'Mike Malaska · Malaska Golf',
      url: 'https://www.youtube.com/watch?v=5HhC1xvFwyQ',
      approxRuntimeSec: 360,
      verified: false,
    },
    fallback: {
      title: 'Golf Swing — Motion — Tempo · From Garage to the Course',
      instructor: 'Mike Malaska · Malaska Golf',
      url: 'https://www.youtube.com/watch?v=IkJsjqJzPTs',
      approxRuntimeSec: 360,
      verified: false,
    },
  },
  ball_position: {
    // Note: a specific ball-position video by a named instructor didn't
    // surface in WebSearch. Mike Bender's Impact video covers setup
    // (including ball position relative to clubface). v1.2 should source
    // a more category-specific video.
    primary: {
      title: 'Impact (covers ball position + setup fundamentals)',
      instructor: 'Mike Bender · MikeBenderGolf',
      url: 'https://www.youtube.com/watch?v=IRuo6FY0tDs',
      approxRuntimeSec: 360,
      verified: false,
    },
    fallback: {
      title: 'Swing Plane',
      instructor: 'Mike Bender · MikeBenderGolf',
      url: 'https://www.youtube.com/watch?v=N2SQ5rfwvV0',
      approxRuntimeSec: 360,
      verified: false,
    },
  },
  grip: {
    primary: {
      title: 'How To Do the Correct Grip on a Golf Club',
      instructor: 'Hank Haney · Golf Digest',
      url: 'https://www.youtube.com/watch?v=WpPPewbRnos',
      approxRuntimeSec: 240,
      verified: false,
    },
    fallback: {
      title: 'Correct Grip (Golf Tip)',
      instructor: 'Hank Haney',
      url: 'https://www.youtube.com/watch?v=UcvA8tcuH2o',
      approxRuntimeSec: 180,
      verified: false,
    },
  },
  posture: {
    primary: {
      title: 'Balance · Posture · Setup · Consistency · Trust Your Toes',
      instructor: 'Mike Malaska · Malaska Golf',
      url: 'https://www.youtube.com/watch?v=KVdtrI3ZcOM',
      approxRuntimeSec: 360,
      verified: false,
    },
    fallback: {
      title: 'Mobility, Stability and Golf Posture · Static Back Stretch',
      instructor: 'Mike Malaska · Malaska Golf',
      url: 'https://www.youtube.com/watch?v=l6E-uyQDfqU',
      approxRuntimeSec: 360,
      verified: false,
    },
  },
};

/** Convenience: get the best (primary) video for a category. */
export function getInstructorVideo(category: IssueCategory): InstructorVideoLink {
  return INSTRUCTOR_VIDEOS[category].primary;
}
