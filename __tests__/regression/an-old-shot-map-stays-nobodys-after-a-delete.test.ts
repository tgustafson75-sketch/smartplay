/**
 * 2026-10-27 (Phase SB8, recheck E-R11-1).
 *
 * AN OLDER BUILD'S SHOT MAP CAME BACK AS SWING 1'S AFTER A DELETE. A SmartMotion snapshot saved before SB4x has no
 * swingIndex, and that build's Save was not guarded, so on a set of more than one swing it may be swing 2's or 3's
 * (isUnknownSwingMap). That was decided from the swing count at read time. Deleting swings 2 and 3 left one swing,
 * so the map read as swing 1's again: its tempo, start line, carry and BODY tiles on screen, and the caddie told
 * "measured tempo ... backswing to downswing" for the one swing left — numbers that may be a deleted swing's.
 *
 * The delete now stamps what the count said onto the map (swingUnknown). Driven through the real store's deleteShot
 * and the real readers both screens and the caddie use.
 */
import { useSwingSessionStore, type SwingSession } from '../../store/swingSessionStore';
import { isUnknownSwingMap, shotMapForShot } from '../../services/swing/smartMotionShotMap';
import { swingOnScreenForCaddie, swingOnScreenFromShotMap } from '../../services/swing/swingOnScreen';

const SID = 'old_set';
const OLD_MAP = {
  estCarry: 152, effortPct: 80, trace: { side: 'right', divergenceDeg: 4 }, angle: 'down_the_line' as const, club: '7i',
  tempo: { ratio: 3.1, backswingMs: 840, downswingMs: 270, sequencingScore: 70 },
  bodyItems: [{ key: 'sway', label: 'Sway', tone: 'warn' as const }],
};

function seed(shotCount: number, map: Record<string, unknown>): void {
  const shots = Array.from({ length: shotCount }, (_, i) => ({
    id: `${SID}_shot_${i}`, clipUri: 'file:///clip.mp4', clipStartSeconds: i * 5, clipEndSeconds: i * 5 + 4, detectionMethod: 'audio_transient',
  }));
  useSwingSessionStore.setState({
    activeSession: null,
    sessionHistory: [{ id: SID, source: 'live_capture', date: 1, club: '7i', shots, analysis_status: 'ok', smart_motion_shot_map: map } as unknown as SwingSession],
  });
}
const session = () => useSwingSessionStore.getState().sessionHistory[0];
const del = (i: number) => useSwingSessionStore.getState().deleteShot(SID, `${SID}_shot_${i}`);
/** What the library swing page shows on swing 1, and what it tells the caddie. */
function swingOne() {
  const s = session();
  const n = s.shots.length;
  return {
    map: shotMapForShot(s.smart_motion_shot_map, 0, n),
    unknown: isUnknownSwingMap(s.smart_motion_shot_map, n),
    caddie: swingOnScreenForCaddie(swingOnScreenFromShotMap(s.smart_motion_shot_map, 0, n)),
  };
}

describe('an older build\'s shot map stays nobody\'s when swings are deleted', () => {
  it('THE REPORT: an unstamped map on a 3-swing set — delete swings 2 and 3, and swing 1 shows none of it', () => {
    seed(3, OLD_MAP);
    expect(swingOne().map).toBeNull();
    del(1);
    del(2);
    expect(session().shots).toHaveLength(1);
    const one = swingOne();
    expect(one.map).toBeNull();
    expect(one.unknown).toBe(true);            // the library's "saved by an older version" line stays
    expect(one.caddie).not.toMatch(/tempo 3\.1|backswing to downswing|152/i);
  });

  it('deleting one swing of a 2-swing set: the same', () => {
    seed(2, OLD_MAP);
    del(1);
    expect(swingOne().map).toBeNull();
    expect(swingOne().caddie).not.toMatch(/3\.1/);
  });

  it('guard: an old map on a set that was always one swing is that swing\'s', () => {
    seed(1, OLD_MAP);
    expect(swingOne().map).toEqual(OLD_MAP);
  });

  it('guard: a stamped map (swing 1\'s) survives deleting swing 2 and stays swing 1\'s', () => {
    seed(3, { ...OLD_MAP, swingIndex: 0 });
    del(1);
    del(2);
    expect(swingOne().map).toEqual({ ...OLD_MAP, swingIndex: 0 });
    expect(swingOne().caddie).toMatch(/3\.1/);
  });

  it('guard: deleting swing 1 still takes the map with it', () => {
    seed(3, OLD_MAP);
    del(0);
    expect(session().smart_motion_shot_map).toBeNull();
  });
});
