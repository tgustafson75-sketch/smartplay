/**
 * 2026-10-27 (Phase SB4x — review finding "review #1").
 *
 * Before audit R1, Save / New Set wrote the session's one shot-map snapshot from WHICHEVER swing was on
 * screen. A map saved by such a build carries no record of its swing, so on a multi-swing set it may be
 * swing 3's. The library still showed it as swing 1's tempo, launch and BODY tiles, and the caddie was told
 * it was swing 1's MEASURED tempo. A map saved now is stamped with its swing (swingIndex); an unstamped one
 * on a set of more than one swing is shown and told as unknown. A single-swing set has only one swing it
 * can belong to.
 *
 * Through the real owners: smartMotionShotMap (writer + library reader), swingOnScreen and
 * caddieRequestBody (the payload line).
 */
import { useCaptureEngineStore } from '../../store/captureEngineStore';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { shotMapToPersist, shotMapForShot, type ShotMapSource } from '../../services/swing/smartMotionShotMap';
import { swingOnScreenFromShotMap } from '../../services/swing/swingOnScreen';
import type { SmartMotionShotMap } from '../../store/swingSessionStore';

const src: ShotMapSource = {
  estCarry: 151, effortPct: null, ballTrace: { side: 'right', divergenceDeg: 6 },
  practiceCanvasFeet: null, cameraBehindFeet: null, isPractice: false, angle: 'down_the_line', club: '7I',
  tempo: { ratio: 2.9, backswingMs: 870, downswingMs: 300, sequencingScore: 70 },
  hasBiomech: true, bodyItems: [{ key: 'sway', label: 'Sway', tone: 'warn' }],
};
/** What an older build stored: the same snapshot, with no swing recorded. */
const OLD: SmartMotionShotMap = (() => { const m = { ...shotMapToPersist(src, 0)! } as Record<string, unknown>; delete m.swingIndex; return m as SmartMotionShotMap; })();
const line = () => buildCaddieRequestBody({ message: 'how was my tempo?', language: 'en' }).swing_on_screen as string | null;

afterEach(() => useCaptureEngineStore.getState().setSwingOnScreen(null));

describe('a shot map records the swing it was read from', () => {
  it('a map saved now is stamped swing 1 (index 0)', () => {
    expect(shotMapToPersist(src, 0)!.swingIndex).toBe(0);
  });
});

describe('an unstamped (older) map on a multi-swing set is nobody\'s measured numbers', () => {
  it('THE REPORT: the caddie is not told an old map\'s tempo as swing 1\'s measured tempo', () => {
    useCaptureEngineStore.getState().setSwingOnScreen(swingOnScreenFromShotMap(OLD, 0, 3));
    const l = line()!;
    expect(l).toContain('Swing 1 of 3 is on their screen');
    expect(l).not.toContain('2.9:1');
    expect(l).not.toContain('measured tempo');
    expect(l).toContain('older version');
  });

  it('THE REPORT: the library does not draw it as swing 1\'s', () => {
    expect(shotMapForShot(OLD, 0, 3)).toBeNull();
    expect(shotMapForShot(OLD, 1, 3)).toBeNull();
  });

  it('a stamped map is still swing 1\'s, on screen and to the caddie', () => {
    const now = shotMapToPersist(src, 0)!;
    expect(shotMapForShot(now, 0, 3)).toBe(now);
    useCaptureEngineStore.getState().setSwingOnScreen(swingOnScreenFromShotMap(now, 0, 3));
    expect(line()).toContain('measured tempo 2.9:1');
  });

  it('a single-swing set: the old map can only be that swing\'s', () => {
    expect(shotMapForShot(OLD, 0, 1)).toBe(OLD);
    useCaptureEngineStore.getState().setSwingOnScreen(swingOnScreenFromShotMap(OLD, 0, 1));
    expect(line()).toContain('measured tempo 2.9:1');
  });
});
