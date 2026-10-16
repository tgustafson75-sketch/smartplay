/**
 * 2026-10-15 (review #5) — "I'm 142" from a METRES player was stored as 142 YARDS (shown back as
 * 130 m, and as a fresh stated number at high confidence it overrode GPS for five minutes). The same
 * with "7 iron from 140". And the local "N to the front/back" reply spoke a bare yard number to him.
 *
 * Drives the real handlers. The store is yards; entry and speech convert, per services/distanceUnits.
 */
jest.mock('../../services/gpsManager', () => ({ bumpToActive: jest.fn(), getOneShotFix: jest.fn(async () => null), getLastFix: () => null }));
// analytics.track arms a flush interval that keeps jest alive; nothing here is about analytics.
jest.mock('../../services/analytics', () => {
  const actual = jest.requireActual('../../services/analytics');
  return { ...actual, track: jest.fn() };
});
jest.mock('../../services/yardageResolver', () => {
  const actual = jest.requireActual('../../services/yardageResolver');
  return {
    ...actual,
    resolveYardage: () => ({
      value: 160, front: 150, back: 170, source: 'gps_live', confidence: 'high', reason: 'GPS clean.',
      asOf: Date.now(), is_fallback: false, live: true,
    }),
  };
});

import { stateYardageHandler, spokenDistanceToYards } from '../../services/intents/stateYardageHandler';
import { clubChangeHandler as clubHandler } from '../../services/intents/clubHandler';
import { queryStatusHandler } from '../../services/intents/queryStatusHandler';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { AppContext, VoiceIntent } from '../../types/voiceIntent';

const intent = (type: string, raw: string, parameters: Record<string, unknown> = {}) =>
  ({ intent_type: type, raw_text: raw, parameters, confidence: 'high' } as unknown as VoiceIntent);
const ctx = { current_hole: 3 } as unknown as AppContext;

beforeEach(() => {
  useRoundStore.setState({ isRoundActive: true, currentHole: 3, userStatedYardage: null } as never);
  useSettingsStore.setState({ distance_unit: 'meters' } as never);
});

describe('a stated distance is stored in yards whatever unit he speaks', () => {
  it('THE BUG: "I\'m 142" from a metres player is 142 m, stored as 155 yd', async () => {
    await stateYardageHandler.execute(intent('state_yardage', "I'm 142"), ctx);
    expect(useRoundStore.getState().userStatedYardage?.value).toBe(155);
  });

  it('an explicit "yards" in the words wins over the setting', async () => {
    await stateYardageHandler.execute(intent('state_yardage', "I'm 142 yards"), ctx);
    expect(useRoundStore.getState().userStatedYardage?.value).toBe(142);
  });

  it('a yards player is unchanged', async () => {
    useSettingsStore.setState({ distance_unit: 'yards' } as never);
    await stateYardageHandler.execute(intent('state_yardage', "I'm 142"), ctx);
    expect(useRoundStore.getState().userStatedYardage?.value).toBe(142);
  });

  it('"7 iron from 140" from a metres player stores 153 yd', async () => {
    await clubHandler.execute(intent('club_change', '7 iron from 140', { club_phrase: '7 iron from 140' }), ctx);
    expect(useRoundStore.getState().userStatedYardage?.value).toBe(153);
  });

  it('the conversion helper — metres words, yards words, setting', () => {
    useSettingsStore.setState({ distance_unit: 'yards' } as never);
    expect(spokenDistanceToYards(100, '100 metres')).toBe(109);
    expect(spokenDistanceToYards(100, 'call it 100')).toBe(100);
  });
});

describe('the local front/back reply speaks his unit', () => {
  it('"how far to the front" for a metres player is metres', async () => {
    const r = await queryStatusHandler.execute(intent('query_status', 'how far to the front', { query_topic: 'green_front' }), ctx);
    expect(r.voice_response).toBe('137 metres to the front.');
  });

  it('a yards player still hears the bare number', async () => {
    useSettingsStore.setState({ distance_unit: 'yards' } as never);
    const r = await queryStatusHandler.execute(intent('query_status', 'how far to the back', { query_topic: 'green_back' }), ctx);
    expect(r.voice_response).toBe('170 to the back.');
  });
});
