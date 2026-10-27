/**
 * 2026-10-27 (Phase SB5 — recheck R2 of the SB3/SB4 work).
 *
 * A SmartMotion swing saved before 10-26 opened in the library: SB4x makes its body read unread (an older
 * build stored it), so the body tiles fell back to the saved shot map's snapshot — the OLD read's
 * Sway/Tilt/Posture/Weight verdicts, good/warn/bad — right under "This swing's body read is from an older
 * version, so it isn't shown." And Re-analyze cleared the body read but not those tiles: they stood until
 * swing 1's new read landed, and for good when that read failed or found no one.
 *
 * Now the snapshot's tiles are shown only for a swing that has NO body read stored by any build (a legacy
 * save with a report and no biomechanics), and a re-analysis clears them with the read they came from.
 */
import fs from 'fs';
import path from 'path';
import { useSwingSessionStore } from '../../store/swingSessionStore';
import { shownShotBiomech, shownSwingHoldsOlderRead } from '../../services/swing/orchestrator/shotDetail';
import { olderBodyReadNote } from '../../services/swing/faultSpotlight';
import { shotMapForShot } from '../../services/swing/smartMotionShotMap';

const code = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

const oldRead = { frames: [{ timestampMs: 1, keypoints: [] }, { timestampMs: 2, keypoints: [] }], angle: 'down_the_line' };
const tiles = [
  { key: 'sway', label: 'Sway', tone: 'bad' as const },
  { key: 'tilt', label: 'Tilt', tone: 'warn' as const },
];
const map = { estCarry: 152, effortPct: 80, tempo: { ratio: 3, backswingMs: 900, downswingMs: 300, sequencingScore: null }, bodyItems: tiles, swingIndex: 0 };
/** A single-swing SmartMotion capture from before 10-26: its body read has no analysis_version. */
const seed = (biomechanics: unknown) => useSwingSessionStore.setState({
  activeSession: null,
  sessionHistory: [{
    id: 'old', source: 'live_capture', analysis_status: 'ok', club: '7i', biomechanics, smart_motion_shot_map: map,
    shots: [{ id: 'old_shot_0', club: '7i', clipUri: 'file:///c.mp4', clipStartSeconds: 1, clipEndSeconds: 3, ...(biomechanics !== undefined ? { biomechanics } : {}) }],
  }] as never,
});
const sess = () => useSwingSessionStore.getState().sessionHistory[0];

/** The library screen's BODY tiles when no body read is drawn: the snapshot, or nothing. */
function snapshotTilesShown(): unknown[] {
  const s = sess();
  const detail = code('app/swinglab/swing/[swing_id].tsx');
  // The screen's own rule, read off the screen (the tile row is inline JSX).
  const m = /const items: BodyItem\[\] = activeBiomech\s*\?\s*deriveBodyItems\(bodyAnalysis, activeBiomech\)\s*:\s*([\s\S]*?);\n/.exec(detail);
  expect(m).not.toBeNull();
  const fallback = m![1].trim().replace(/\s+as\s+BodyItem\[\]\s*\|\s*undefined/g, '');   // TS casts, for JS
  expect(shownShotBiomech(s, 0)).toBeNull();
  const shotMap = shotMapForShot(s.smart_motion_shot_map, 0, s.shots.length);
  const shotDetail = require('../../services/swing/orchestrator/shotDetail');
  // eslint-disable-next-line no-new-func
  return new Function('shotMap', 'shownSwingNeverRead', 'session', 'selectedShotIdx', `return ${fallback};`)(
    shotMap, shotDetail.shownSwingNeverRead ?? (() => true), s, 0,
  ) as unknown[];
}

describe('an older build\'s body tiles never stand under the "older version" note', () => {
  it('THE REPORT: an old swing says its read is not shown — and shows none of that read\'s tiles', () => {
    seed(oldRead);
    expect(olderBodyReadNote({ shown: false, olderRead: shownSwingHoldsOlderRead(sess(), 0), pending: false }))
      .toBe('older_read');
    expect(snapshotTilesShown()).toEqual([]);
  });

  it('Re-analyze clears the snapshot\'s body tiles with the read they came from (and keeps carry, effort, tempo)', () => {
    seed(oldRead);
    useSwingSessionStore.getState().resetDerivedAnalysis('old');
    const m = sess().smart_motion_shot_map!;
    expect(m.bodyItems ?? null).toBeNull();
    expect(m.estCarry).toBe(152);
    expect(m.effortPct).toBe(80);
    expect(m.tempo?.ratio).toBe(3);
    expect(snapshotTilesShown()).toEqual([]);   // also after a body read that fails or finds no one
  });

  it('a legacy save with a report and NO body read at all still shows its saved tiles', () => {
    seed(undefined);
    expect(snapshotTilesShown()).toEqual(tiles);
  });

  it('an older build\'s empty read (null) shows no old verdicts either', () => {
    seed(null);
    expect(snapshotTilesShown()).toEqual([]);
  });
});
