/**
 * 2026-10-15 — offline report, decisions 2 + 5. Tim: "after this many months, I'm dead ass afraid to
 * get some kind of local mode glitches back."
 *
 * Local Mode broke the main path the same way every time: a path decided "offline" from ONE failed
 * call, without knowing why it failed, and then acted as a lesser caddie — or a flag got stuck on.
 *   06-10  breaker tripped on cold starts over good Wi-Fi and saved Local Mode permanently
 *   07-24  a cold-boot blip dropped every player into the "Say that again for me?" re-listen loop
 *   08-21  "Want me to switch on Local Mode?" / "Good moment to sharpen your tempo" after a failure
 *   08-23  local answers BEFORE the brain
 *
 * Now one owner (services/caddieFailureReply) decides what a failed turn says, on evidence from
 * services/reachability. These tests replay those failures and pin that none can come back.
 */
import * as fs from 'fs';
import * as path from 'path';

const mockAnswer = { fn: (_q: string): { text: string; source: string } | null => null };
jest.mock('../../services/offlineCaddie', () => ({ answerOffline: (q: string) => mockAnswer.fn(q) }));
const mockEvents: { stage: string; details: Record<string, unknown> }[] = [];
jest.mock('../../store/issueLogStore', () => ({
  useIssueLogStore: { getState: () => ({ addAppEvent: (stage: string, details: Record<string, unknown>) => mockEvents.push({ stage, details }) }) },
}));

import { caddieFailureReply, failureNoticeSync } from '../../services/caddieFailureReply';
import { _resetReachabilityForTests } from '../../services/reachability';
import { CADDIE_NOTICE_CONNECTION, CADDIE_NOTICE_OFFLINE, CADDIE_NOTICE_ON_US } from '../../services/caddieAckLines';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';

const code = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

type Internet = 'up' | 'down' | 'slow';
let clock = 1_000_000;
function world(internet: Internet) {
  global.fetch = jest.fn(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith('https://captive.apple.com/')) {
      if (internet === 'down') throw new TypeError('Network request failed');
      if (internet === 'slow') clock += 3000;
      return new Response('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>', { status: 200 });
    }
    if (url.startsWith('https://www.gstatic.com/generate_204')) {
      if (internet !== 'up') throw new TypeError('Network request failed');
      return new Response(null, { status: 204 });
    }
    throw new TypeError('Network request failed'); // our backend is down in every scenario here
  }) as unknown as typeof fetch;
}

let nowSpy: jest.SpyInstance<number, []>;
beforeEach(() => {
  clock = 1_000_000;
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
  _resetReachabilityForTests();
  mockAnswer.fn = () => null;
  mockEvents.length = 0;
  useRoundStore.setState({ isRoundActive: false });
});
afterEach(() => nowSpy.mockRestore());

const RETIRED = /sharpen your tempo|switch on Local Mode|Local Mode in Settings/i;

describe('what a failed turn says', () => {
  it('06-10 replay — good Wi-Fi, our server cold: the failure is OWNED, not blamed on signal', async () => {
    world('up');
    const r = await caddieFailureReply({ heard: null, language: 'en' });
    expect(r).toMatchObject({ source: 'on_us', verdict: 'internet_ok', text: CADDIE_NOTICE_ON_US.en });
  });

  it('measured-slow connection says so', async () => {
    world('slow');
    expect((await caddieFailureReply({ heard: null })).text).toBe(CADDIE_NOTICE_CONNECTION.en);
  });

  it('PROVEN offline, off a round: the truth plus what still works', async () => {
    world('down');
    const r = await caddieFailureReply({ heard: null, language: 'es' });
    expect(r).toMatchObject({ source: 'offline', text: CADDIE_NOTICE_OFFLINE.es });
  });

  it('PROVEN offline, on a round: the shot in front of them', async () => {
    world('down');
    useRoundStore.setState({ isRoundActive: true, currentHole: 7 });
    const r = await caddieFailureReply({ heard: null });
    expect(r.source).toBe('round_read');
    expect(r.text.length).toBeGreaterThan(0);
  });

  it('a question the phone can answer from real data is answered — before any network question', async () => {
    world('down');
    mockAnswer.fn = (q) => (/how far/.test(q) ? { text: '152 yards to the middle of the green.', source: 'round_state' } : null);
    const r = await caddieFailureReply({ heard: 'how far to the green', language: 'en' });
    expect(r).toMatchObject({ source: 'local_answer', verdict: null, text: '152 yards to the middle of the green.' });
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('a ROUND READ is never given on good signal — a failure that was ours gets owned, not a lesser caddie', async () => {
    world('up');
    useRoundStore.setState({ isRoundActive: true, currentHole: 7 });
    expect((await caddieFailureReply({ heard: 'what do you think of my swing' })).source).toBe('on_us');
  });

  it('08-21 replay — no verdict, language or round state can produce a retired line', async () => {
    for (const internet of ['up', 'down', 'slow'] as Internet[]) {
      for (const lang of ['en', 'es', 'zh']) {
        for (const onRound of [false, true]) {
          _resetReachabilityForTests();
          world(internet);
          useRoundStore.setState({ isRoundActive: onRound, currentHole: onRound ? 3 : 1 });
          expect((await caddieFailureReply({ heard: 'anything', language: lang })).text).not.toMatch(RETIRED);
        }
      }
    }
  }, 30_000); // each proven-offline case includes the reachability re-ask (1s)

  it('the caption-only path never blames the connection without a fresh verdict', () => {
    expect(failureNoticeSync('en')).toBe(CADDIE_NOTICE_ON_US.en);
  });

  it('every reply is logged with its verdict, so a field report says why', async () => {
    world('down');
    await caddieFailureReply({ heard: null });
    expect(mockEvents.find((e) => e.stage === 'caddie_failure_reply')?.details).toMatchObject({ source: 'offline', verdict: 'offline' });
  });
});

describe('review fixes (10-15)', () => {
  it('offline on a round with no GPS read: the truth, not "No GPS lock yet" (which blames the GPS)', async () => {
    world('down');
    useRoundStore.setState({ isRoundActive: true, currentHole: 7 });
    const r = await caddieFailureReply({ heard: null, language: 'en' });
    expect(r.text).not.toMatch(/No GPS lock/);
  });

  it('the templated "no <club> shot logged" reply counts as no data too', () => {
    const { isNoDataReply } = require('../../services/localStatusResponder');
    expect(isNoDataReply("I don't have a driver shot logged this round yet.", 'en')).toBe(true);
    expect(isNoDataReply('152 yards to the middle of the green.', 'en')).toBe(false);
  });

  it('a "no data" local reply does not stand in for an answer on good signal', async () => {
    world('up');
    mockAnswer.fn = () => ({ text: "I don't have a wind reading right now.", source: 'round_state' });
    expect((await caddieFailureReply({ heard: "what's the wind", language: 'en' })).source).toBe('on_us');
  });

  it('the tap mic decides on the fresh verdict, started alongside its own probes (no added wait)', () => {
    const tap = code('hooks/useVoiceCaddie.ts');
    const fn = tap.slice(tap.indexOf('const failTranscribeOffline = async'), tap.indexOf('const failTranscribeOffline = async') + 4000);
    // Third review: our own probes can be ~15s stale at the retry-failed exit — they must not decide.
    expect(fn).not.toMatch(/if \(pingOk \|\| getOk/);
    expect(fn).toMatch(/const net = \(await probeReachability\(\)\)\.verdict;\s*if \(isProvenOffline\(net\)\)/);
    expect(tap).toMatch(/void probeReachability\(\);\s*const \[ping, get, cdn\] = await Promise\.all/);
  });

  it('every failure path that answers locally drops "no data" replies (third review: 3 of 5 did not)', () => {
    const sites = [
      ...(code('hooks/useVoiceCaddie.ts').match(/answerOffline\(message, langSafe\);\s*if \(local[^)]*\)/g) ?? []),
    ];
    expect(sites).toHaveLength(2);
    for (const s of sites) expect(s).toMatch(/!isNoDataLocalReply\(local\.text, langSafe\)/);
    expect(code('services/listeningSession.ts')).not.toMatch(/answerOffline\(/);
    expect(code('services/listeningSession.ts')).toMatch(/\.localAnswer\(utterance, lang\)/);
  });

  it('a late failure line never lands on a newer turn', () => {
    // Only a turn that is REALLY there (live mic) — a VAD false start must not swallow the notice.
    expect(code('services/listeningSession.ts')).toMatch(/const epoch = getUserTurnEpoch\(\);[\s\S]{0,200}failureNotice\(language\);\s*if \(getUserTurnEpoch\(\) !== epoch && \(isCapturing\(\) \|\| isExternalMicActive\(\)\)\)/);
    expect(code('services/listeningSession.ts')).toMatch(/delivered = await speakHonestFailure\(/);
    expect(code('hooks/useCaddieTabMic.ts')).toMatch(/const superseded = getUserTurnEpoch\(\) !== epoch\s*&& \(turnInFlightRef\.current \|\|/);
  });
});

describe('Local Mode cannot come back', () => {
  it('07-24 replay — Quiet presence (which sets the flag) no longer changes ANY failure behaviour', async () => {
    world('up');
    useSettingsStore.setState({ localMode: true } as never);
    expect((await caddieFailureReply({ heard: null })).source).toBe('on_us');
    expect(code('services/caddieFailureReply.ts')).not.toMatch(/localMode/);
    const tap = code('hooks/useVoiceCaddie.ts');
    const fn = tap.slice(tap.indexOf('const failTranscribeOffline = async'), tap.indexOf('const failTranscribeOffline = async') + 4000);
    expect(fn).not.toMatch(/localMode/);
    expect(fn).toMatch(/if \(isProvenOffline\(net\)\) \{[\s\S]{0,200}?stt\.isOnDeviceSTTReady\(\)/);
  });

  it('no failure path reads the flag or offers the mode', () => {
    for (const f of ['hooks/useVoiceCaddie.ts', 'hooks/useCaddieTabMic.ts', 'services/listeningSession.ts', 'services/caddieFailureReply.ts', 'services/localStatusResponder.ts']) {
      const src = code(f);
      expect(src).not.toMatch(/Local Mode in Settings|switch on Local Mode|localModeOn/);
      expect(src).not.toMatch(/deadEndLine\(|cloudFailureLine\(|DEAD_END_PRACTICE|CLOUD_UNREACHABLE_OFFER/);
    }
  });

  it('06-10 replay — nothing saves an offline state: only Quiet presence writes the flag, and nothing persists a verdict', () => {
    const writers = ['services', 'hooks', 'app', 'store', 'components'].flatMap((dir) => walk(path.resolve(__dirname, '../../', dir)))
      .filter((f) => /setLocalMode\(|localMode:\s*true/.test(code(path.relative(path.resolve(__dirname, '../..'), f))))
      .map((f) => path.relative(path.resolve(__dirname, '../..'), f));
    expect(writers).toEqual(['services/caddiePresence.ts']);
    const reach = code('services/reachability.ts');
    expect(reach).not.toMatch(/AsyncStorage|setItem|persist/);
    expect(code('store/connectivityStore.ts')).not.toMatch(/persist\(/);
  });

  it('08-23 rule holds — the failure owner runs only AFTER a failed turn, never before the brain', () => {
    // Every caller sits in a failure branch: a failed transcribe, an aborted upload, or a null brain turn.
    const tab = code('hooks/useCaddieTabMic.ts');
    const at = tab.indexOf('failure.localAnswer(transcript');
    expect(at).toBeGreaterThan(tab.indexOf('if (!turn) {'));
    expect(at).toBeGreaterThan(tab.indexOf('const turn = await askCaddie('));
  });
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
