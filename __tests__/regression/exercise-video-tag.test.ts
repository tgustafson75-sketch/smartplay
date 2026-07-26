/**
 * Exercise video tags (Tim, 2026-07-26) — a recommended fault-exercise can carry a curated instructor
 * video that plays in-app (/drill-video) and awards a one-time +5 via awardVideoWatch. Guards:
 *  - tagged videos are REAL https links with an extractable YouTube id (never fabricated/broken), and
 *  - the +5 watch reward is one-time (anti-farm), matching the /drill-video → practicePointsStore path.
 */
import { exercisesForFault, type Exercise } from '../../services/swing/faultWorkouts';
import { usePracticePointsStore } from '../../store/practicePointsStore';

// Same extractor /drill-video uses to turn a tagged url into a playable YouTube id.
function extractVideoId(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// The stable per-exercise key the dashboard routes into /drill-video with (mirrors dashboard.tsx).
const keyFor = (e: Exercise) => `exvid:${e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;

describe('exercise video tags', () => {
  it('the reverse-pivot weight-shift drill carries a real, playable YouTube link', () => {
    const withVideo = exercisesForFault('reverse_pivot').find((e) => e.video);
    expect(withVideo).toBeTruthy();
    expect(withVideo!.video!.url).toMatch(/^https:\/\//);
    expect(extractVideoId(withVideo!.video!.url)).toBeTruthy();
    expect(withVideo!.video!.title.trim().length).toBeGreaterThan(0);
  });

  it('every tagged video across all faults is a real https link with a valid id (no fabricated stubs)', () => {
    const faults = ['early_extension', 'sway', 'reverse_pivot', 'over_the_top', 'under_coil', 'casting',
      'chicken_wing', 'head_movement', 'plane_too_steep', 'plane_too_flat', 'quick_tempo'];
    for (const f of faults) {
      for (const e of exercisesForFault(f)) {
        if (!e.video) continue;
        expect(e.video.url).toMatch(/^https:\/\//);
        expect(extractVideoId(e.video.url)).toBeTruthy();
      }
    }
  });

  it('awards the +5 watch reward exactly once per exercise key (anti-farm)', () => {
    usePracticePointsStore.getState().reset();
    const e = exercisesForFault('reverse_pivot').find((x) => x.video)!;
    const key = keyFor(e);
    const first = usePracticePointsStore.getState().awardVideoWatch(key, e.name, 1000);
    const second = usePracticePointsStore.getState().awardVideoWatch(key, e.name, 2000);
    expect(first).toBe(5);
    expect(second).toBe(0); // re-watch cannot farm points
    expect(usePracticePointsStore.getState().total).toBe(5);
  });
});
