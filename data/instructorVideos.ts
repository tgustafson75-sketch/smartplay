/**
 * Phase v3-port (step 3/5) — curated instructor video links per fault category.
 *
 * Every URL is a real YouTube video by the attributed instructor (Hank Haney, Sean Foley,
 * Mike Malaska, Mike Bender) plus Tank's + Randy's clips.
 *
 * 2026-07-19 — all 14 URLs VERIFIED live + public via the YouTube oEmbed API (HTTP 200 + the
 * returned title matches the attributed instructor), so `verified: true` is now accurate — no
 * dead/removed clips ship to beta. Re-run the oEmbed check if any are swapped:
 *   curl -s "https://www.youtube.com/oembed?url=<watch_url>&format=json"   → 200 = live & public.
 * The drill-video screen still degrades gracefully ("Couldn't load this video") if one is pulled.
 *
 * Sources: Hank Haney / Sean Foley via Golf Digest; Mike Malaska via Malaska Golf; Mike Bender via
 * MikeBenderGolf.
 */

export type IssueCategory =
  | 'swing_path'
  | 'weight_transfer'
  | 'tempo'
  | 'ball_position'
  | 'grip'
  | 'posture'
  // 2026-05-26 — Short-game category added so Randy Chang's "Chang chip"
  // content has a natural slot. URL verified by Tim direct from Randy.
  // Randy's YouTube content is well-known under-3-minute instructional
  // format — exact match for SmartPlay's video length target.
  | 'chipping'
  // 2026-05-26 — Reserved slot for Tank-narrated content under the
  // SmartPlayCaddie branding + logo overlay. Tim's drill cards render
  // in pairs (2-up grid) on his phone; six prior categories + chipping
  // = seven, leaving the second column of row 4 empty. This 8th slot
  // fills the pair so the grid reads clean. URL empty until Tank
  // recording lands. Consumers should render the SmartPlay logo when
  // url === '' (vs the youtube thumbnail other categories use).
  | 'tank_caddie';

export interface InstructorVideoLink {
  title: string;
  instructor: string;
  url: string;
  approxRuntimeSec: number;
  verified: boolean;
  // 2026-05-26 — Optional placeholder thumbnail for slots whose video
  // isn't recorded yet (notably tank_caddie). When set, the drill-card
  // UI should render this asset instead of trying to derive a YouTube
  // thumbnail from the (empty) url. require()-style ImageSourcePropType.
  placeholderThumbnail?: number;
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
      verified: true,
    },
    fallback: {
      title: 'How to Start Your Downswing and Stop Losing Shots Right',
      instructor: 'Hank Haney · Golf Digest',
      url: 'https://www.youtube.com/watch?v=DsGez_e8O6g',
      approxRuntimeSec: 240,
      verified: true,
    },
  },
  weight_transfer: {
    primary: {
      title: 'How to Shift Your Weight to Increase Swing Speed',
      instructor: 'Sean Foley · Golf Digest',
      url: 'https://www.youtube.com/watch?v=4ARmrHB3qSU',
      approxRuntimeSec: 240,
      verified: true,
    },
    fallback: {
      title: 'Weight Shift Made Really Easy',
      instructor: 'Golf Lesson channel',
      url: 'https://www.youtube.com/watch?v=foOHoj9HiEQ',
      approxRuntimeSec: 360,
      verified: true,
    },
  },
  tempo: {
    primary: {
      title: 'Finding Your Tempo · Maintaining Tempo',
      instructor: 'Mike Malaska · Malaska Golf',
      url: 'https://www.youtube.com/watch?v=5HhC1xvFwyQ',
      approxRuntimeSec: 360,
      verified: true,
    },
    fallback: {
      title: 'Golf Swing — Motion — Tempo · From Garage to the Course',
      instructor: 'Mike Malaska · Malaska Golf',
      url: 'https://www.youtube.com/watch?v=IkJsjqJzPTs',
      approxRuntimeSec: 360,
      verified: true,
    },
  },
  ball_position: {
    primary: {
      title: 'Impact (covers ball position + setup fundamentals)',
      instructor: 'Mike Bender · MikeBenderGolf',
      url: 'https://www.youtube.com/watch?v=IRuo6FY0tDs',
      approxRuntimeSec: 360,
      verified: true,
    },
    fallback: {
      title: 'Swing Plane',
      instructor: 'Mike Bender · MikeBenderGolf',
      url: 'https://www.youtube.com/watch?v=N2SQ5rfwvV0',
      approxRuntimeSec: 360,
      verified: true,
    },
  },
  grip: {
    primary: {
      title: 'How To Do the Correct Grip on a Golf Club',
      instructor: 'Hank Haney · Golf Digest',
      url: 'https://www.youtube.com/watch?v=WpPPewbRnos',
      approxRuntimeSec: 240,
      verified: true,
    },
    fallback: {
      title: 'Correct Grip (Golf Tip)',
      instructor: 'Hank Haney',
      url: 'https://www.youtube.com/watch?v=UcvA8tcuH2o',
      approxRuntimeSec: 180,
      verified: true,
    },
  },
  posture: {
    primary: {
      title: 'Balance · Posture · Setup · Consistency · Trust Your Toes',
      instructor: 'Mike Malaska · Malaska Golf',
      url: 'https://www.youtube.com/watch?v=KVdtrI3ZcOM',
      approxRuntimeSec: 360,
      verified: true,
    },
    fallback: {
      title: 'Mobility, Stability and Golf Posture · Static Back Stretch',
      instructor: 'Mike Malaska · Malaska Golf',
      url: 'https://www.youtube.com/watch?v=l6E-uyQDfqU',
      approxRuntimeSec: 360,
      verified: true,
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
      // 2026-05-26 — Verified URL provided by Tim direct from Randy.
      url: 'https://www.youtube.com/watch?v=_iWzD-gSoa8',
      approxRuntimeSec: 180,
      verified: true,
    },
  },
  // 2026-05-26 — 8th slot reserved for Tank-narrated SmartPlay-branded
  // drill content.
  // 2026-05-27 — Tim provided the FIRST Tank video: "Tank's Take on
  // Early Extension." This unlocks the tank_caddie slot — Tank's
  // card on the Drills surface now opens the real video instead of
  // showing a placeholder thumbnail. Verified=false pending Tim's
  // playback check on the Galaxy Z Fold per the standing verify rule.
  tank_caddie: {
    primary: {
      title: "Tank's Take on Early Extension",
      instructor: 'Tank · SmartPlay Caddie',
      url: 'https://www.youtube.com/watch?v=c_ePVepaAp4',
      approxRuntimeSec: 180,
      verified: true,
    },
  },
};

/** Convenience: get the best (primary) video for a category. */
export function getInstructorVideo(category: IssueCategory): InstructorVideoLink {
  return INSTRUCTOR_VIDEOS[category].primary;
}
