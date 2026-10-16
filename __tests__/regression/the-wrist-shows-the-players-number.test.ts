/**
 * 2026-10-15 (review #5, #6) — what the wrist is sent.
 *
 *  #5 The watch apps display the integers they receive, with no unit (wear-os-app MainActivity
 *     .handleCaddie, targets/watch SmartPlayWatchApp.apply). Yards went out raw, so a metres player
 *     read yards on the watch and metres on the phone.
 *  #6 No source flag — a STATIC card number or a tee estimate went out as the same hero number as a
 *     live read — and when the resolver had nothing, NOTHING was sent, so a new hole kept the previous
 *     hole's number on the wrist.
 *
 * Drives the real pushYardageToWatch against a mocked native module and asserts the payload.
 */
const mockSent: Array<Record<string, unknown>> = [];
const mockResolved: { current: Record<string, unknown> } = { current: {} };

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    NativeModules: {
      ...actual.NativeModules,
      WearSwingBridge: {
        sendToWatch: async (_p: string, data: string) => { mockSent.push(JSON.parse(data)); return true; },
        addListener: () => undefined,
        removeListeners: () => undefined,
      },
    },
  };
});
jest.mock('../../services/yardageResolver', () => {
  const actual = jest.requireActual('../../services/yardageResolver');
  return { ...actual, resolveYardage: () => mockResolved.current };
});

import { pushYardageToWatch } from '../../services/watchCaddieBridge';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';

const resolved = (over: Record<string, unknown>) => ({
  value: 160, front: 150, back: 170, source: 'gps_live', confidence: 'high', reason: 'GPS clean.',
  asOf: Date.now(), is_fallback: false, live: true, ...over,
});

beforeEach(() => {
  mockSent.length = 0;
  useRoundStore.setState({ isRoundActive: true, currentHole: 4 } as never);
  useSettingsStore.setState({ distance_unit: 'yards' } as never);
});

describe('#5 the wrist number is in the player\'s unit', () => {
  it('a metres player is sent metres, with the unit named', async () => {
    useSettingsStore.setState({ distance_unit: 'meters' } as never);
    mockResolved.current = resolved({});
    await pushYardageToWatch();
    const p = mockSent[mockSent.length - 1];
    expect(p.middle).toBe(146);   // 160 yd
    expect(p.front).toBe(137);
    expect(p.back).toBe(155);
    expect(p.unit).toBe('meters');
  });

  it('a yards player is unchanged', async () => {
    mockResolved.current = resolved({});
    await pushYardageToWatch();
    const p = mockSent[mockSent.length - 1];
    expect(p.middle).toBe(160);
    expect(p.unit).toBe('yards');
  });
});

describe('#6 the wrist is told where the number came from, and told when there is none', () => {
  it('a live read says live', async () => {
    mockResolved.current = resolved({});
    await pushYardageToWatch();
    expect(mockSent[mockSent.length - 1].live).toBe(true);
  });

  it('the static card is not live and names its source', async () => {
    mockResolved.current = resolved({ source: 'static_card', live: undefined, is_fallback: true, confidence: 'low', value: 410, front: null, back: null });
    await pushYardageToWatch();
    const p = mockSent[mockSent.length - 1];
    expect(p.live).toBe(false);
    expect(p.source).toBe('static_card');
  });

  it('nothing to show → an explicit clear for THIS hole, not silence', async () => {
    mockResolved.current = resolved({ value: null, front: null, back: null, source: 'none', live: undefined, is_fallback: true });
    await pushYardageToWatch();
    expect(mockSent.length).toBe(1);
    const p = mockSent[0];
    expect(p.kind).toBe('yardage');
    expect(p.hole).toBe(4);
    expect(p.middle).toBeNull();
    expect(p.front).toBeNull();
    expect(p.back).toBeNull();
    expect(p.live).toBe(false);
  });
});
