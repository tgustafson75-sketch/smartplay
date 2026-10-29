/**
 * 2026-10-28 (Brain recheck R9) — R7 NARROWED THE LEARNER, BUT NOT WHAT IT HAD ALREADY LEARNED.
 *
 * Before 7b36c261, "tell me more about that layup" matched the old FULLER list and saved a learned
 * {style:'full'} to @smartplay/caddie_style. The R7 OTA added responseModeSetAt (default 0) with no
 * migration, so his earlier Quiet / Short pick has no timestamp, the stale 'full' stays in force, every
 * route keeps sending 'detailed', and the settings card quotes a phrase that no longer counts.
 *
 * BEHAVIOURAL: the bytes an upgraded install has on disk, the real boot hydrate (primeStyleCache), the
 * real settingsStore and the real payload builder every route goes through.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useSettingsStore } from '../../store/settingsStore';
import * as cs from '../../services/caddieStyle';

const KEY = '@smartplay/caddie_style';
const sent = () => buildCaddieRequestBody({ message: 'what club here?', language: 'en' }).responseMode;

/** An upgraded install: the store as the old app left it, then a cold boot. */
async function boot(onDisk: cs.LearnedStyle, picked: 'short' | 'neutral' | 'detailed') {
  await AsyncStorage.setItem(KEY, JSON.stringify(onDisk));
  useSettingsStore.setState({ responseMode: picked, responseModeSetAt: 0 } as never);
  await cs.primeStyleCache();
}

beforeEach(async () => { await cs.saveLearnedStyle(null); });

describe('a style the old lists learned is dropped on upgrade', () => {
  it('THE BUG: stale "tell me more about that layup" full + Short picked before the stamp → short', async () => {
    await boot({ style: 'full', at: 1_790_000_000_000, heard: 'tell me more about that layup' }, 'short');
    expect(sent()).toBe('short');                                             // pre-fix: 'detailed'
    const st = useSettingsStore.getState();
    expect(cs.describeLearnedStyle(await cs.loadLearnedStyle(), st.responseModeSetAt)).toBeNull();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();                       // forgotten on disk too
  });

  it('a balanced the old lists stepped to from brief is dropped as well', async () => {
    await boot({ style: 'balanced', at: 1_790_000_000_000, heard: 'walk me through this putt' }, 'short');
    expect(sent()).toBe('short');
  });

  it('a style its own words still earn survives the upgrade', async () => {
    await boot({ style: 'brief', at: 1_790_000_000_000, heard: "you're talking too much" }, 'detailed');
    expect(sent()).toBe('short');
    await boot({ style: 'full', at: 1_790_000_000_000, heard: 'give me longer answers' }, 'short');
    expect(sent()).toBe('detailed');
  });

  it('words that now signal the OTHER way do not keep the style', async () => {
    await boot({ style: 'full', at: 1_790_000_000_000, heard: 'keep it short' }, 'neutral');
    expect(sent()).toBe('neutral');
  });

  it('a quote cut at 80 characters cannot be judged, so it is kept', async () => {
    const heard = 'so on this next hole I really want you to think about the whole plan, and also '.repeat(2).slice(0, 80);
    expect(heard).toHaveLength(80);
    await boot({ style: 'full', at: 1_790_000_000_000, heard }, 'short');
    expect(sent()).toBe('detailed');
  });
});
