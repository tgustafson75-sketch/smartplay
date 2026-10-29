/**
 * 2026-10-28 (Brain review r5) — THE FOLLOW-UP LOOP'S TURN IS A CADDIE TURN.
 *
 * The Caddie-tab avatar's follow-up listen loop (hooks/useVoiceCaddie → processFollowUp) reached
 * /api/kevin through the hook's own fetch, not askCaddie, so nothing askCaddie does after a turn ran:
 *
 *   caddie (follow-up reply): "Nice par. How many putts on that one?"
 *   player:                    "one"
 *
 * noteCaddieAskedForPutts never marked the question open, so the bare "one" was not claimed as a putt
 * count and went on to the score parser — a 1 on a par 4. caddieStyle.noteUtterance never heard the
 * follow-up either, and the exchange never reached the shared conversation history.
 *
 * BEHAVIOURAL: services/voice/followUpBrainTurn (what the hook's sendToBrain now is — the hook itself
 * cannot load under jest) against a mocked fetch, then the real open-question intercept the loop runs
 * on the next utterance. Plus the guard: only services/caddieBrain posts a player's turn to /api/kevin.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../../services/unifiedVisionContext', () => ({ getUnifiedVisionContext: async () => ({ promptBlock: null }) }));

type Reply = { ok: boolean; status: number; body: unknown };

describe('a follow-up reply that asks for putts opens the question', () => {
  const realFetch = global.fetch;
  let replies: Reply[] = [];
  let posts: Record<string, unknown>[] = [];

  beforeEach(() => {
    jest.resetModules();
    // The plan gate is not under test; closed, every turn would be null for the wrong reason.
    jest.doMock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));
    posts = [];
    global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).endsWith('/api/kevin')) posts.push(JSON.parse(init?.body ?? '{}'));
      const r = replies.shift() ?? { ok: true, status: 200, body: { text: 'Sure.', audioBase64: null } };
      return { ok: r.ok, status: r.status, json: async () => r.body };
    }) as unknown as typeof fetch;
  });
  afterEach(() => { global.fetch = realFetch; jest.dontMock('../../services/featureAccess'); });

  const load = () => {
    const { useRoundStore } = require('../../store/roundStore') as typeof import('../../store/roundStore');
    useRoundStore.setState({
      isRoundActive: true,
      currentHole: 4,
      scores: { 4: 4 },
      putts: {},
      lastMutation: null,
      courseHoles: [{ hole: 4, par: 4, distance: 400, front: 400, back: 400, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false }],
    } as never);
    const putt = require('../../services/pendingPuttAsk') as typeof import('../../services/pendingPuttAsk');
    putt.clearAwaitingPutts();
    const hist = require('../../services/voice/conversationHistory') as typeof import('../../services/voice/conversationHistory');
    hist.setConversationHistory([]);
    const style = require('../../services/caddieStyle') as typeof import('../../services/caddieStyle');
    const noteUtterance = jest.spyOn(style, 'noteUtterance').mockResolvedValue(null);
    const { followUpBrainTurn } = require('../../services/voice/followUpBrainTurn') as typeof import('../../services/voice/followUpBrainTurn');
    return { useRoundStore, putt, hist, noteUtterance, followUpBrainTurn };
  };

  it('"how many putts?" → "one" logs ONE PUTT and leaves the par alone', async () => {
    const { useRoundStore, putt, followUpBrainTurn } = load();
    replies = [{ ok: true, status: 200, body: { text: 'Nice par. How many putts on that one?', audioBase64: null } }];

    const reply = await followUpBrainTurn('I made par', { language: 'en' });
    expect(reply.text).toBe('Nice par. How many putts on that one?');
    expect(reply.fallback).toBe(false);

    // The loop's next utterance: the open-question intercept claims it before any score parser.
    const answered = putt.tryAnswerOpenQuestion('one');
    expect(answered?.line).toBe('Got it — 1 putt.');
    expect(useRoundStore.getState().putts[4]).toBe(1);
    expect(useRoundStore.getState().scores[4]).toBe(4);
  });

  it('the exchange joins the shared history and the style learner hears the player', async () => {
    const { hist, noteUtterance, followUpBrainTurn } = load();
    replies = [{ ok: true, status: 200, body: { text: 'Got it, I will keep it short.', audioBase64: null } }];
    await followUpBrainTurn("you're talking too much", { language: 'en' });
    expect(hist.getConversationHistory().map((m) => m.content)).toEqual(["you're talking too much", 'Got it, I will keep it short.']);
    // With where he stands now, so a newer pick outranks an older hint (the-newest-length-choice-wins).
    expect(noteUtterance).toHaveBeenCalledWith("you're talking too much", expect.objectContaining({ mode: expect.any(String) }));
  });

  it('the turn reaches kevin once, with the one payload', async () => {
    const { followUpBrainTurn } = load();
    replies = [{ ok: true, status: 200, body: { text: 'Smooth 8.', audioBase64: 'AAA' } }];
    const reply = await followUpBrainTurn('what club from 150', { language: 'en', responseMode: 'short' });
    expect(posts).toHaveLength(1);
    expect(posts[0].message).toBe('what club from 150');
    expect(posts[0].responseMode).toBe('short');
    expect(reply.audioBase64).toBe('AAA');
  });

  it('a fast failure is asked once more; a refusal (200 with error) is not', async () => {
    const { followUpBrainTurn } = load();
    replies = [
      { ok: false, status: 502, body: {} },
      { ok: true, status: 200, body: { text: 'Smooth 8.', audioBase64: null } },
    ];
    expect((await followUpBrainTurn('what club from 150', { language: 'en' })).text).toBe('Smooth 8.');
    expect(posts).toHaveLength(2);

    posts = [];
    replies = [{ ok: true, status: 200, body: { text: "I'm having trouble connecting — try that again.", error: 'x', errorType: 'Error' } }];
    const failed = await followUpBrainTurn('what club from 150', { language: 'en' });
    expect(posts).toHaveLength(1);
    expect(failed.text).not.toMatch(/trouble connecting/);
  });
});

describe('only services/caddieBrain posts a player turn to /api/kevin', () => {
  const root = path.join(__dirname, '..', '..');
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');
  const walk = (dir: string): string[] => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return walk(rel);
      return /\.tsx?$/.test(e.name) ? [rel] : [];
    });
  };
  /**
   * Not a player's turn, each for a stated reason. Adding a file here is a deliberate act.
   */
  const NOT_A_PLAYER_TURN: Record<string, string> = {
    'services/presenceCaddie.ts': 'a proactive presence beat (is_proactive) — the caddie speaking first; it must not enter the history or the style notes',
    'app/ghost-debug.tsx': 'owner-only debug screen (useDebugRouteGate)',
  };
  /** Every fetch whose URL is /api/kevin (not /api/kevin-read), with what it sends. */
  const posts = () => ['hooks', 'services', 'app', 'components', 'store', 'contexts'].flatMap(walk).flatMap((f) => {
    const src = strip(fs.readFileSync(path.join(root, f), 'utf8'));
    const out: { f: string; ping: boolean }[] = [];
    const re = /fetch\((?:[^()]|\([^()]*\)){0,160}?\/api\/kevin(?![-\w])/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      out.push({ f, ping: /message: '__ping__'/.test(src.slice(m.index, m.index + 600)) });
    }
    return out;
  });

  it('the scan sees the real senders (it cannot pass by finding nothing)', () => {
    const all = posts();
    expect(all.some((p) => p.f === 'services/caddieBrain.ts')).toBe(true);
    expect(all.some((p) => p.f === 'services/apiBase.ts' && p.ping)).toBe(true);
  });

  it('every other POST to the brain is a ping or a stated non-turn', () => {
    const offenders = posts()
      .filter((p) => p.f !== 'services/caddieBrain.ts' && !p.ping && !NOT_A_PLAYER_TURN[p.f])
      .map((p) => p.f);
    expect(offenders).toEqual([]);
  });
});
