/**
 * Phase 111 — Curated reputable-instructor YouTube links per fault category.
 *
 * Every entry is tagged `verified: false` until Tim manually confirms:
 *   1. The URL still resolves (channel + video both live)
 *   2. The video addresses the named fault category
 *   3. The video is under 10 minutes (attention span during practice)
 *   4. The channel is established and still active
 *
 * Empirical verification protocol: open each URL on Galaxy Z Fold's
 * dev-client → YouTube app or browser opens → video plays → confirm
 * Length, Title, and Channel match expectations. Flip `verified: true`
 * for any entry that passes. Replace primary with fallback (or drop
 * the category from the live deck) for any that fail.
 *
 * Notes on selection:
 *   - Names listed in Phase 111 spec: Mike Malaska, Sean Foley, Hank
 *     Haney, Pete Cowen, Mike Bender, Cameron Champ, Top 100 GolfDigest
 *     teaching pros, LPGA Hall of Fame teachers.
 *   - This file ships placeholder URLs that look right per channel
 *     name — they are NOT empirically verified to point at a video that
 *     specifically addresses the category. Tim's verification pass is
 *     a real step, not a formality.
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
  /** YouTube URL — full video link, NOT a search query. */
  url: string;
  /** Approximate runtime in seconds. Cap is 10 min (600s). */
  approxRuntimeSec: number;
  /** Tim flips to true after empirically verifying the URL resolves
   *  to a relevant video on Galaxy Z Fold. */
  verified: boolean;
}

interface CategoryVideos {
  primary: InstructorVideoLink;
  fallback?: InstructorVideoLink;
}

// ─── PLACEHOLDER URLS ────────────────────────────────────────────────────────
// These point at known instructor channels' search results so the link
// at least resolves to a relevant page even before Tim's verification.
// Replace each `url:` with the specific video URL once curated.

export const INSTRUCTOR_VIDEOS: Record<IssueCategory, CategoryVideos> = {
  swing_path: {
    primary: {
      title: 'Stop Coming Over the Top',
      instructor: 'Mike Malaska',
      url: 'https://www.youtube.com/results?search_query=mike+malaska+over+the+top+fix',
      approxRuntimeSec: 480,
      verified: false,
    },
    fallback: {
      title: 'Swing Path Made Simple',
      instructor: 'Mike Bender',
      url: 'https://www.youtube.com/results?search_query=mike+bender+swing+path',
      approxRuntimeSec: 360,
      verified: false,
    },
  },
  weight_transfer: {
    primary: {
      title: 'Pressure & Weight Shift Drill',
      instructor: 'Sean Foley',
      url: 'https://www.youtube.com/results?search_query=sean+foley+pressure+shift+drill',
      approxRuntimeSec: 420,
      verified: false,
    },
    fallback: {
      title: 'Get Off Your Back Foot',
      instructor: 'Hank Haney',
      url: 'https://www.youtube.com/results?search_query=hank+haney+weight+shift',
      approxRuntimeSec: 360,
      verified: false,
    },
  },
  tempo: {
    primary: {
      title: '3-to-1 Tempo Drill',
      instructor: 'Pete Cowen',
      url: 'https://www.youtube.com/results?search_query=pete+cowen+tempo+drill',
      approxRuntimeSec: 420,
      verified: false,
    },
    fallback: {
      title: 'Smooth Tempo Practice',
      instructor: 'Mike Malaska',
      url: 'https://www.youtube.com/results?search_query=mike+malaska+tempo',
      approxRuntimeSec: 360,
      verified: false,
    },
  },
  ball_position: {
    primary: {
      title: 'Ball Position by Club',
      instructor: 'Mike Bender',
      url: 'https://www.youtube.com/results?search_query=mike+bender+ball+position+per+club',
      approxRuntimeSec: 360,
      verified: false,
    },
  },
  grip: {
    primary: {
      title: 'The Neutral Grip Explained',
      instructor: 'Hank Haney',
      url: 'https://www.youtube.com/results?search_query=hank+haney+neutral+grip',
      approxRuntimeSec: 480,
      verified: false,
    },
    fallback: {
      title: 'Grip Pressure Fix',
      instructor: 'Sean Foley',
      url: 'https://www.youtube.com/results?search_query=sean+foley+grip+pressure',
      approxRuntimeSec: 300,
      verified: false,
    },
  },
  posture: {
    primary: {
      title: 'Athletic Setup Posture',
      instructor: 'Mike Malaska',
      url: 'https://www.youtube.com/results?search_query=mike+malaska+athletic+posture+golf+setup',
      approxRuntimeSec: 420,
      verified: false,
    },
    fallback: {
      title: 'Spine Angle & Tilt',
      instructor: 'Pete Cowen',
      url: 'https://www.youtube.com/results?search_query=pete+cowen+spine+angle+golf',
      approxRuntimeSec: 360,
      verified: false,
    },
  },
};

/** Convenience: get the best (primary) video for a category. */
export function getInstructorVideo(category: IssueCategory): InstructorVideoLink {
  return INSTRUCTOR_VIDEOS[category].primary;
}
