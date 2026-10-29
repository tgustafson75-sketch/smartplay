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

  it('re-review: twice-around maps from the round FRONTIER, not a lagging current hole', () => {
    const scores: Record<number, number> = { 1: 4, 2: 4, 3: 3, 4: 5, 5: 4, 6: 4, 7: 3, 8: 4, 9: 5, 11: 4 };
    // currentHole stuck at 10 while hole 11 is already scored: "three on three" is the second pass (12).
    expect(roundHoleForSpoken({ twiceAround: true, currentHole: 10, scores }, 3)).toBe(12);
    // just onto the second loop with nothing scored past 9: "five on nine" is still hole 9.
    expect(roundHoleForSpoken({ twiceAround: true, currentHole: 10, scores: { 1: 4, 2: 4 } }, 9)).toBe(9);
  });

  it('re-review: the plan toast shows the CONVERTED distance in the player\'s unit', () => {
    const toastMod = require('../../store/toastStore') as typeof import('../../store/toastStore');
    useRoundStore.setState({ isRoundActive: true, currentHole: 3, userStatedYardage: null } as never);
    useSettingsStore.getState().setDistanceUnit('meters');
    dispatchConversationalToolActions([{ type: 'plan_shot', club: '7 iron', distance_yards: 150 }]);
    const msg = toastMod.useToastStore.getState().message ?? '';
    useSettingsStore.getState().setDistanceUnit('yards');
    expect(msg).toMatch(/150\s?m/);
    expect(msg).not.toMatch(/150y/);
    expect(useRoundStore.getState().userStatedYardage?.value).toBe(164);
  });

  it('re-review: "let\'s play 9" can match (normalisation turns the apostrophe into a space)', () => {
    // 2026-10-28 (Brain review r5) — the shortcut moved out of hooks/useVoiceCaddie.
    const v = code('services/tabPreRoundShortcut.ts');
    expect(v).toMatch(/'let s play 9'/);
    expect(v).toMatch(/\\blet s play 9\\b/);
  });

  it('re-review: a GPS stop that lands while a start is setting up releases the watch it armed', () => {
    const g = code('services/gpsManager.ts');
    expect(g).toMatch(/await startWatchInternal\(\);\s*if \(epoch !== stopEpoch\) \{/);
    expect(g).toMatch(/export function stopGpsManager\(\): void \{\s*stopEpoch \+= 1;/);
  });

  it('pattern insights never see quick-score placeholder shots', () => {
    const r = recapRoundFromRecord({
      id: 'r', courseName: 'X', courseId: null, scores: {}, shots: [{ id: 'qs-3-1', hole: 3 }, { id: 'real', hole: 3 }],
    } as never, { courseHoles: [] });
    expect((r as { shots: { id: string }[] }).shots.map((s) => s.id)).toEqual(['real']);
  });
});
