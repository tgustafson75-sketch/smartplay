/**
 * 2026-10-14 (Tim: "it should tell the user that a function only works with that setting").
 * Location below "Always" (iOS) or notifications denied (Android) silently turned pocket tracking off.
 * Pre-fix there was no message at all: these fail on a tree without services/featureNeedsSetting and
 * the two call sites.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  tellFeatureNeedsSetting,
  _setNeededSettingPresenter,
  _resetNeededSettingSession,
} from '../../services/featureNeedsSetting';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

describe('a setting that turns a feature off says which feature', () => {
  let shown: { title: string; body: string }[];
  beforeEach(() => {
    shown = [];
    _resetNeededSettingSession();
    _setNeededSettingPresenter((title, body) => shown.push({ title, body }));
  });
  afterAll(() => _setNeededSettingPresenter(null));

  it('names the feature and the setting it needs, for each setting', () => {
    tellFeatureNeedsSetting('location_always');
    tellFeatureNeedsSetting('notifications');
    expect(shown).toHaveLength(2);
    expect(shown[0].body).toMatch(/pocket/i);
    expect(shown[0].body).toMatch(/Always/);
    expect(shown[1].body).toMatch(/pocket/i);
    expect(shown[1].body).toMatch(/notifications/i);
  });

  it('tells once per session, not every round start', () => {
    tellFeatureNeedsSetting('location_always');
    tellFeatureNeedsSetting('location_always');
    expect(shown).toHaveLength(1);
  });

  it('a presenter failure never throws into the round', () => {
    _setNeededSettingPresenter(() => { throw new Error('boom'); });
    expect(() => tellFeatureNeedsSetting('notifications')).not.toThrow();
  });

  it('both owners call it: round start (Always) and the skipped foreground service (notifications)', () => {
    expect(read('store/roundStore.ts')).toMatch(/getBackgroundPermissionsAsync[\s\S]{0,300}tellFeatureNeedsSetting\('location_always'\)/);
    expect(read('services/backgroundLocationTask.ts')).toMatch(/POST_NOTIFICATIONS not granted[\s\S]{0,1200}tellFeatureNeedsSetting\('notifications'\)/);
  });
});
