/**
 * 2026-09-29 (review) — THE PRIVACY ROW SAYS "never your name, email, scores, or location".
 *
 * Usage telemetry is on by default for new installs (1.0.2). Callers were sending log_score_voice
 * {hole, strokes, par}, log_putts_voice {putts}, and the player's raw words in `phrase`. The promise is
 * now kept at the one seam (usageTelemetry.sanitizeUsageProps, applied inside track()), and the voice
 * handlers stop passing those fields to their own track() (services/analytics → Sentry breadcrumbs).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettingsStore } from '../../store/settingsStore';
import { useRoundStore } from '../../store/roundStore';
import { track, flushUsage, teardownUsageTelemetry } from '../../services/usageTelemetry';
import { logScoreHandler } from '../../services/intents/logScoreHandler';
import { logPuttsHandler } from '../../services/intents/logPuttsHandler';
import { logShotHandler } from '../../services/intents/logShotHandler';

const mockAnalyticsCalls: { event: string; props?: Record<string, unknown> }[] = [];
jest.mock('../../services/analytics', () => {
  const actual = jest.requireActual('../../services/analytics');
  return { ...actual, track: (event: string, props?: Record<string, unknown>) => { mockAnalyticsCalls.push({ event, props }); } };
});


const BLOCKED = ['strokes', 'par', 'putts', 'score', 'phrase', 'text', 'transcript', 'utterance', 'query', 'email', 'lat', 'lng'];
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

const sent: { events: { event: string; props?: Record<string, unknown> }[] }[] = [];
const realFetch = global.fetch;
beforeEach(async () => {
  sent.length = 0;
  mockAnalyticsCalls.length = 0;
  await AsyncStorage.clear();
  teardownUsageTelemetry();
  useSettingsStore.setState({ hasHydrated: true, analyticsOptIn: true } as never);
  global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
    sent.push(JSON.parse(String(init?.body ?? '{}')));
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
  }) as unknown as typeof fetch;
});
afterEach(() => { global.fetch = realFetch; teardownUsageTelemetry(); });

const deepKeys = (o: unknown): string[] =>
  o && typeof o === 'object' ? Object.entries(o as object).flatMap(([k, v]) => [k, ...deepKeys(v)]) : [];

describe('usageTelemetry.track — the seam', () => {
  it('sends none of the score, free-text or location fields, whoever passes them', async () => {
    track('log_score_voice', {
      hole: 4, strokes: 5, par: 4, putts: 2, score: 5, Phrase: 'my own words', text: 'typed', transcript: 't',
      utterance: 'u', query: 'q', email: 'tim@example.com', lat: 42.1, lng: -71.2,
      nested: { strokes: 6, phrase: 'deep words', ok: 1 },
    });
    await flush(); await flushUsage(); await flush();
    const events = sent.flatMap((b) => b.events);
    expect(events).toHaveLength(1);
    const keys = deepKeys(events[0].props).map((k) => k.toLowerCase());
    for (const k of BLOCKED) expect(keys).not.toContain(k);
    expect(JSON.stringify(sent)).not.toMatch(/my own words|deep words|typed|tim@example/);
    // Harmless fields survive — the strip is a blocklist of names, not a wipe.
    expect(events[0].props).toEqual({ hole: 4, nested: { ok: 1 } });
  });

  it('a count of utterances or characters is not text and is kept', async () => {
    track('swing_commentary_multi_ok', { swings: 3, utterances: 2, chars: 40 });
    await flush(); await flushUsage(); await flush();
    expect(sent.flatMap((b) => b.events)[0].props).toEqual({ swings: 3, utterances: 2, chars: 40 });
  });
});

describe('the voice handlers do not hand scores or words to track() at all', () => {
  const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, distance: 380 }));
  beforeEach(() => {
    useRoundStore.setState({ roundHistory: [] } as never);
    useRoundStore.getState().startRound('Privacy GC', card as never, {
      nineHole: false, startHole: 1, isCompetition: false, notes: '', goal: null, courseId: 'privacy',
    } as never);
  });

  it('log_score / log_putts / an ambiguous club phrase', async () => {
    await logScoreHandler.execute({ intent_type: 'log_score', parameters: {}, raw_text: 'I made a five with two putts', confidence: 'high' } as never, {} as never);
    await logPuttsHandler.execute({ intent_type: 'log_putts', parameters: { num_putts: 2, hole_number: 2 }, raw_text: 'two putts', confidence: 'high' } as never, {} as never);
    await logShotHandler.execute({ intent_type: 'log_shot', parameters: { club_phrase: 'my private banana words' }, raw_text: 'my private banana words', confidence: 'high' } as never, {} as never);
    const names = mockAnalyticsCalls.map((c) => c.event);
    expect(names).toEqual(expect.arrayContaining(['log_score_voice', 'log_putts_voice', 'log_shot_ambiguous_club']));
    for (const c of mockAnalyticsCalls) {
      const keys = deepKeys(c.props).map((k) => k.toLowerCase());
      for (const k of BLOCKED) expect(keys).not.toContain(k);
    }
    expect(JSON.stringify(mockAnalyticsCalls)).not.toMatch(/banana/);
  });
});
