/**
 * 2026-09-29 — "how far was that?" (query_status:shot_distance) read recordedShots(), which drops
 * rows that carry no fact YET. A cart-mode auto-logged drive (conversationalLoggingOrchestrator) has
 * no club / direction / distance until the NEXT shot back-fills it, so asking right after it answered
 * with the PREVIOUS shot's distance — a real number about the wrong swing.
 *
 * shot_distance skips only quick-score placeholders and penalty strokes; the newest real swing is the
 * one answered, and with no distance it says so. BEHAVIOURAL: the real handler, the real round store.
 */
import { queryStatusHandler } from '../../services/intents/queryStatusHandler';
import { useRoundStore, type ShotResult } from '../../store/roundStore';
import type { AppContext, VoiceIntent } from '../../types/voiceIntent';

jest.mock('../../services/gpsManager', () => ({ bumpToActive: jest.fn(), getOneShotFix: jest.fn(async () => null) }));

const ask = async (shots: Partial<ShotResult>[]) => {
  useRoundStore.setState({ isRoundActive: true, currentHole: 1, shots: shots as ShotResult[] });
  const intent = { intent_type: 'query_status', parameters: { query_topic: 'shot_distance' }, confidence: 'high', raw_text: 'how far was that' } as unknown as VoiceIntent;
  const r = await queryStatusHandler.execute(intent, { current_hole: 1 } as unknown as AppContext);
  return r.voice_response;
};

const previous = { id: 's1', hole: 1, club: 'driver', distance_yards: 245, direction: 'straight' } as Partial<ShotResult>;
// Auto-logged, nothing known yet: no club, no direction, no distance, no end location.
const justLogged = { id: 's2', hole: 1, start_location: { lat: 33.7, lng: -117.2 } } as unknown as Partial<ShotResult>;

describe('"how far was that" answers about the newest swing', () => {
  it('a silently auto-logged shot is the one answered — not the previous shot\'s 245', async () => {
    const said = await ask([previous, justLogged]);
    expect(said).not.toMatch(/245/);
    expect(said).toMatch(/don't have GPS for that shot/);
  });

  it('a quick-score placeholder or penalty stroke after the swing is still skipped', async () => {
    expect(await ask([previous, { id: 'qs-1-2', hole: 1 }])).toMatch(/245/);
    expect(await ask([previous, { id: 'p1', hole: 1, outcome: 'manual_penalty' } as Partial<ShotResult>])).toMatch(/245/);
  });

  it('no real shot at all is still "no shots logged"', async () => {
    expect(await ask([{ id: 'qs-1-1', hole: 1 }])).toMatch(/No shots logged/);
  });
});
