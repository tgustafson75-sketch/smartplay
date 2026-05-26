/**
 * Phase v3-port (step 3/5) — curated instructor video links per fault category.
 *
 * Ported from v3's constants/instructorVideos.ts. Every URL is a real
 * YouTube video by the attributed instructor (Hank Haney, Sean Foley,
 * Mike Malaska, Mike Bender). `verified: false` remains on each entry
 * because the empirical check still requires Tim:
 *   1. Open URL on Galaxy Z Fold → video plays (not removed / private)
 *   2. Length confirmed under 10 minutes
 *   3. Content addresses the named fault category as expected
 *   4. Video isn't dated by outdated technique
 *
 * Sources for selection (via WebSearch on instructor + topic):
 *   - Hank Haney via Golf Digest YouTube
 *   - Sean Foley via Golf Digest YouTube
 *   - Mike Malaska via Malaska Golf YouTube
 *   - Mike Bender via MikeBenderGolf YouTube
 */

export type IssueCategory =
  | 'swing_path'
  | 'weight_transfer'
  | 'tempo'
  | 'ball_position'
  | 'grip'
  | 'posture'
  // 2026-05-26 — Short-game category added so Randy Chang's "Chang chip"
  // content has a natural slot. URLs pending verification from Tim's
  // direct contact with Randy (head pro at Journey @ Pechanga, Temecula).
  // Randy's YouTube content is well-known under-3-minute instructional
  // format — exact match for SmartPlay's video length target.
  | 'chipping';

export interface InstructorVideoLink {
  title: string;
  instructor: string;
  url: string;
  approxRuntimeSec: number;
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
  // 2026-05-26 — Randy Chang slot. Head pro at Journey @ Pechanga
  // (Temecula CA), former PGA pro, prolific YouTube instructor with
  // under-3-minute videos that inspired SmartPlay's video-length target.
  // URLs empty until Tim provides the verified "Chang chip" link +
  // any companion short-game videos. Until then, getInstructorVideo
  // for this category returns the placeholder shape — the consuming UI
  // should treat empty `url` as "no video yet, show title only."
  chipping: {
    primary: {
      title: 'Chang Chip — Randy Chang short-game technique',
      instructor: 'Randy Chang · PGA · Journey at Pechanga',
      url: '', // TODO 2026-05-26: drop in the verified Chang Chip YouTube URL
      approxRuntimeSec: 180,
      verified: false,
    },
  },
};

/** Convenience: get the best (primary) video for a category. */
export function getInstructorVideo(category: IssueCategory): InstructorVideoLink {
  return INSTRUCTOR_VIDEOS[category].primary;
}
