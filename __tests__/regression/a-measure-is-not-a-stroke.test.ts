/**
 * 2026-10-13 (SmartVision/GPS audit #6) — tapping SmartVision's cart logs a shot at that spot (the tap
 * means "I'm here"), and the sheet's only exit confirmed it: a lay-up "what if I'm here" became a stroke.
 * The sheet now offers "Not a shot", which removes the shot the tap logged.
 */
import { useRoundStore } from '../../store/roundStore';
import { verifyShotAtLocation } from '../../services/shotTracking';

describe('a measure is not a stroke', () => {
  beforeEach(() => {
    useRoundStore.setState({ isRoundActive: true, currentHole: 3, shots: [] } as never);
  });

  it('the tap logs a shot, and "Not a shot" takes it back off the card', () => {
    const r = verifyShotAtLocation({ lat: 33.75, lng: -117.05 });
    expect(r.ok).toBe(true);
    expect(useRoundStore.getState().shots.filter((s) => s.hole === 3)).toHaveLength(1);
    useRoundStore.getState().deleteShot(r.shotId!);
    expect(useRoundStore.getState().shots.filter((s) => s.hole === 3)).toHaveLength(0);
  });

  it('SmartVision wires the sheet\'s Not-a-shot to deleting that shot', () => {
    const fs = require('fs'), path = require('path');
    const sv = fs.readFileSync(path.join(__dirname, '../../app/smartvision.tsx'), 'utf8');
    expect(sv).toMatch(/onNotAShot=\{\(\) => \{[\s\S]{0,200}useRoundStore\.getState\(\)\.deleteShot\(trackedShot\.shotId\)/);
    const sheet = fs.readFileSync(path.join(__dirname, '../../components/round/ShotTrackedSheet.tsx'), 'utf8');
    expect(sheet).toMatch(/\{onNotAShot \? \(\s*<Pressable onPress=\{onNotAShot\}/);
    for (const lang of ['en', 'es', 'zh']) {
      const d = JSON.parse(fs.readFileSync(path.join(__dirname, `../../i18n/locales/${lang}.json`), 'utf8'));
      expect(d.round_shot_tracked_sheet.shot_tracked_sheet.not_a_shot).toBeTruthy();
    }
  });
});
