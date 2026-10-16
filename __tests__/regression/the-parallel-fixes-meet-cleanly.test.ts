/**
 * 2026-10-16 — seam review of the parallel fixes merged onto swing-review-2026-10-10. Each fixer
 * verified its own change; these are the places where two of them met.
 */
import * as fs from 'fs';
import * as path from 'path';
import { useRoundStore, roundHoleForSpoken } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { dispatchConversationalToolActions } from '../../services/voice/conversationalToolDispatch';
import { recapRoundFromRecord } from '../../services/recapGenerator';

const code = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('round / score / GPS seams', () => {
  it('a scored round with a blank course name, kept by the boot guard, still resumes GPS', () => {
    const l = code('app/_layout.tsx');
    expect(l).toMatch(/if \(!s\.isRoundActive \|\| s\.isSimRound \|\| !s\.currentRoundId\) return;/);
    expect(code('app/(tabs)/caddie.tsx')).toMatch(/courseName = card\.name \|\| courseName;/);
  });

  it('twice-around: just onto the second loop, "five on nine" is the hole he walked off — not 18', () => {
    expect(roundHoleForSpoken({ twiceAround: true, currentHole: 10 }, 9)).toBe(9);
    expect(roundHoleForSpoken({ twiceAround: true, currentHole: 10 }, 1)).toBe(10);
    expect(roundHoleForSpoken({ twiceAround: true, currentHole: 12 }, 3)).toBe(12);
    expect(roundHoleForSpoken({ twiceAround: true, currentHole: 13 }, 5)).toBe(14); // the next hole is fine
    expect(roundHoleForSpoken({ twiceAround: false, currentHole: 12 }, 3)).toBe(3);
  });

  it('the shot sheet logs and lists the hole its card opened on, like its score stepper', () => {
    const c = code('app/(tabs)/caddie.tsx');
    expect(c).toMatch(/hole: scoreCardHole \?\? currentHole,/);
    expect(c).toMatch(/shots\.filter\(s => s\.hole === \(scoreCardHole \?\? currentHole\)\)/);
  });

  it('GPS start is single-flight (two callers cannot leak a second native watch)', () => {
    const g = code('services/gpsManager.ts');
    expect(g).toMatch(/if \(startInFlight\) return startInFlight;/);
  });

  it('the Start Round lock has a failsafe past the slowest legitimate start', () => {
    expect(code('app/(tabs)/caddie.tsx')).toMatch(/startRoundLockAtRef\.current === lockAt\)[\s\S]{0,200}startRoundInFlightRef\.current = false;[\s\S]{0,40}\}, 60_000\);/);
  });

  it('undoing a score that auto-advanced reopens the shot the advance closed at the green', () => {
    useRoundStore.setState({
      isRoundActive: true, activeCourseId: 'c', currentHole: 1, roundStartHole: 1, nineHoleMode: false, scores: {},
      lastMutation: null,
      courseHoles: [
        { hole: 1, par: 4, distance: 380, middleLat: 37.72, middleLng: -122.52 },
        { hole: 2, par: 4, distance: 400, middleLat: 37.7, middleLng: -122.5 },
      ] as never,
      shots: [{ id: 's1', hole: 1, shot_in_hole_index: 1, start_location: { lat: 37.71, lng: -122.51 } }] as never,
    } as never);
    useSettingsStore.setState({ autoHoleAdvance: true } as never);
    useRoundStore.getState().logScore(1, 4);
    const closed = useRoundStore.getState().shots.find((s) => s.id === 's1') as { end_location?: unknown };
    useRoundStore.getState().undoLastMutation();
    const after = useRoundStore.getState().shots.find((s) => s.id === 's1') as { end_location?: unknown };
    expect(closed.end_location).toBeTruthy(); // the advance really closed it
    expect(after.end_location ?? null).toBeNull();
    expect(useRoundStore.getState().currentHole).toBe(1);
  });

  it('a metres player\'s "I\'m 142" through the brain tool is stored as 142 m, not 142 yards', () => {
    useRoundStore.setState({ isRoundActive: true, currentHole: 3, userStatedYardage: null } as never);
    useSettingsStore.getState().setDistanceUnit('meters');
    dispatchConversationalToolActions([{ type: 'state_yardage', yards: 142 }]);
    expect(useRoundStore.getState().userStatedYardage?.value).toBe(155);
    useSettingsStore.getState().setDistanceUnit('yards');
  });

  it('pattern insights never see quick-score placeholder shots', () => {
    const r = recapRoundFromRecord({
      id: 'r', courseName: 'X', courseId: null, scores: {}, shots: [{ id: 'qs-3-1', hole: 3 }, { id: 'real', hole: 3 }],
    } as never, { courseHoles: [] });
    expect((r as { shots: { id: string }[] }).shots.map((s) => s.id)).toEqual(['real']);
  });
});
