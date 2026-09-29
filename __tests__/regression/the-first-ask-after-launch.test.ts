/**
 * 2026-09-28 (Tim — "check first load warmup logic extremely deeply. I am getting a first ask of the
 * caddie delay and have seen some racing or missing voice").
 *
 * Every assertion here drives the real module — fetch, clocks, the speak queue — rather than reading
 * source text, because each defect below survived months of source-text guards that were all green.
 *
 * DELAY
 *   1. The boot '__ping__' marked /api/kevin warm. kevin answers the ping before the brain or TTS are
 *      touched, and voiceWarmup skipped anything marked — so the real brain + voice warmup never ran.
 *   2. Warmth never expired. The 240s heartbeat and the foreground re-warm skipped every endpoint that
 *      had EVER answered, so after the app sat idle the first ask hit cold Lambdas on warm budgets.
 *   3. An abort that arrived before settings hydrated found no controller, and the batch started
 *      afterwards anyway, competing with the turn that aborted it.
 * RACING / MISSING VOICE
 *   4. The app-open opener (and every proactive line) was not re-checked after its ~12s brain await,
 *      so it landed on the player's first turn, and the opener REPLACED the shared history — wiping
 *      the exchange the player had while it generated.
 *   5. primeMicPipeline's bail-outs returned inside its try, so its finally flipped the audio session
 *      to speech mode on exactly the paths that bail because a capture is live.
 *   6. speak() played a custom-caddie clip by calling the QUEUED playLocalFile from inside its own
 *      queue body: the job waited on a job queued behind itself, and every later line went silent.
 *   7. The cold-start OTA reload asked only the listening store whether voice was active; the avatar
 *      mic never writes it, so the app could reload under the first ask.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────── */
/*  1-3. Warmth                                                                                   */
/* ────────────────────────────────────────────────────────────────────────────────────────────── */

describe('warmth is per function AND per moment', () => {
  const realFetch = global.fetch;
  let calls: string[] = [];
  let nowSpy: jest.SpyInstance<number, []>;
  let now = 1_000_000;

  const loadFresh = () => {
    let api!: typeof import('../../services/apiBase');
    let warm!: typeof import('../../services/voiceWarmup');
    let settings!: typeof import('../../store/settingsStore');
    jest.isolateModules(() => {
      api = require('../../services/apiBase');
      warm = require('../../services/voiceWarmup');
      settings = require('../../store/settingsStore');
    });
    return { api, warm, settings };
  };
  /** Let every queued warmup fetch settle. */
  const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

  beforeEach(() => {
    calls = [];
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    global.fetch = jest.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(new URL(url).pathname);
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    nowSpy.mockRestore();
    global.fetch = realFetch;
  });

  it('THE BUG (1): a successful boot ping does not claim the brain is warm', async () => {
    const { api } = loadFresh();
    await api.warmBackendConnection();
    expect(calls).toContain('/api/kevin');       // the ping did reach kevin…
    expect(api.isConnectionWarmed()).toBe(true); // …it proves the connection…
    expect(api.isEndpointWarmed('/api/kevin')).toBe(false); // …and nothing about the brain
  });

  it('so the real kevin warmup still runs after the ping landed', async () => {
    const { api, warm, settings } = loadFresh();
    settings.useSettingsStore.setState({ hasHydrated: true, aiProvider: 'openai' } as never);
    await api.warmBackendConnection();
    calls = [];
    warm.prewarmVoice();
    await drain();
    expect(calls).toContain('/api/kevin');
    warm.__resetVoiceWarmupForTest();
  });

  it('kevin is in the FIRST pair — the tail is what a real turn drops', async () => {
    const { warm, settings } = loadFresh();
    settings.useSettingsStore.setState({ hasHydrated: true, aiProvider: 'openai' } as never);
    warm.prewarmVoice();
    await drain();
    expect(calls.slice(0, 2).sort()).toEqual(['/api/kevin', '/api/transcribe']);
    warm.__resetVoiceWarmupForTest();
  });

  it('THE BUG (2): warmth expires — a function idle past the TTL is cold again', () => {
    const { api } = loadFresh();
    api.markEndpointWarmed('/api/transcribe');
    expect(api.isEndpointWarmed('/api/transcribe')).toBe(true);
    now += api.ENDPOINT_WARM_TTL_MS - 1;
    expect(api.isEndpointWarmed('/api/transcribe')).toBe(true);
    now += 2;
    expect(api.isEndpointWarmed('/api/transcribe')).toBe(false);
  });

  it('the heartbeat re-pings functions it has already warmed', async () => {
    const { warm, settings } = loadFresh();
    settings.useSettingsStore.setState({ hasHydrated: true, aiProvider: 'openai' } as never);
    warm.prewarmVoice();
    await drain();
    expect(calls.length).toBe(4);
    calls = [];
    now += 240_000; // the heartbeat interval
    warm.prewarmVoice();
    await drain();
    expect(calls.sort()).toEqual(['/api/kevin', '/api/transcribe', '/api/voice', '/api/voice-intent']);
    warm.__resetVoiceWarmupForTest();
  });

  it('but skips a function a real call proved awake moments ago', async () => {
    const { api, warm, settings } = loadFresh();
    settings.useSettingsStore.setState({ hasHydrated: true, aiProvider: 'openai' } as never);
    api.markEndpointWarmed('/api/kevin');
    warm.prewarmVoice();
    await drain();
    expect(calls).not.toContain('/api/kevin');
    warm.__resetVoiceWarmupForTest();
  });

  it('THE BUG (3): an abort that arrives before hydration stops the batch that follows', async () => {
    const { warm, settings } = loadFresh();
    settings.useSettingsStore.setState({ hasHydrated: false } as never);
    warm.prewarmVoice();
    warm.abortVoiceWarmup();
    settings.useSettingsStore.setState({ hasHydrated: true, aiProvider: 'openai' } as never);
    await drain();
    expect(calls).toEqual([]);
    warm.__resetVoiceWarmupForTest();
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────── */
/*  4. Proactive lines never land on the player's turn, and never wipe it from history             */
/* ────────────────────────────────────────────────────────────────────────────────────────────── */

describe('a proactive line whose moment passed stays silent and leaves the thread alone', () => {
  const setup = (duringAsk: () => void) => {
    let brain!: typeof import('../../services/conversationalBrain');
    let hist!: typeof import('../../services/voice/conversationHistory');
    let clock!: typeof import('../../services/userTurnClock');
    jest.isolateModules(() => {
      hist = require('../../services/voice/conversationHistory');
      clock = require('../../services/userTurnClock');
      jest.doMock('../../services/caddieBrain', () => ({
        // The real askCaddie appends the directive exchange; mimic that, and let the test decide
        // what the player does while the brain is thinking.
        askCaddie: async (o: { message: string }) => {
          duringAsk();
          const text = 'Morning. Whenever you are ready, I am here.';
          hist.appendConversationTurn(o.message, text);
          return { text, audioBase64: 'AAAA', toolActions: [] };
        },
      }));
      brain = require('../../services/conversationalBrain');
    });
    return { brain, hist, clock };
  };
  afterEach(() => jest.dontMock('../../services/caddieBrain'));

  it('THE BUG: the player spoke while the opener generated → stale, and their exchange survives', async () => {
    let env!: ReturnType<typeof setup>;
    env = setup(() => {
      env.clock.noteUserTurn();
      env.hist.appendConversationTurn('what club from 150', 'Smooth 8-iron.');
    });
    const r = await env.brain.generateProactiveOpener();
    expect(r.stale).toBe(true);
    expect(r.text).toBeNull();
    expect(env.hist.getConversationHistory()).toEqual([
      { role: 'user', content: 'what club from 150' },
      { role: 'assistant', content: 'Smooth 8-iron.' },
    ]);
  });

  it('nobody spoke → the opener is kept as the caddie\'s last word, directive removed', async () => {
    const env = setup(() => undefined);
    const r = await env.brain.generateProactiveOpener();
    expect(r.stale).toBeFalsy();
    expect(r.text).toBe('Morning. Whenever you are ready, I am here.');
    expect(env.hist.getConversationHistory()).toEqual([
      { role: 'assistant', content: 'Morning. Whenever you are ready, I am here.' },
    ]);
  });

  it('an aside that does not seed history leaves no trace in it', async () => {
    const env = setup(() => undefined);
    env.hist.appendConversationTurn('earlier', 'earlier answer');
    await env.brain.generateProactiveLine('Say something about hole 3.');
    expect(env.hist.getConversationHistory()).toEqual([
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'earlier answer' },
    ]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────── */
/*  5-6. Audio: the prime never flips the session under a capture; the queue cannot deadlock       */
/* ────────────────────────────────────────────────────────────────────────────────────────────── */

/** expo-av with the calls these tests observe made real; everything else stays a harmless stub. */
function expoAvWith(overrides: { createSoundRejects?: boolean }) {
  const deep = (): object => new Proxy(function stub() {}, {
    get: (_t, prop) => (prop === 'then' ? undefined : deep()),
    apply: () => deep(),
    construct: () => deep(),
  });
  const setAudioModeAsync = jest.fn(async () => undefined);
  const createRecording = jest.fn(async () => ({ recording: { stopAndUnloadAsync: async () => undefined } }));
  const Audio = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'getPermissionsAsync') return async () => ({ granted: true });
      if (prop === 'setAudioModeAsync') return setAudioModeAsync;
      if (prop === 'Recording') return new Proxy({}, { get: (_r, p) => (p === 'createAsync' ? createRecording : deep()) });
      if (prop === 'Sound') {
        return new Proxy({}, {
          get: (_s, p) => (p === 'createAsync'
            ? async () => { if (overrides.createSoundRejects) throw new Error('no native player in tests'); return { sound: deep() }; }
            : deep()),
        });
      }
      return deep();
    },
  });
  const mod = new Proxy({ Audio }, { get: (t, prop) => (prop === '__esModule' ? true : prop in t ? (t as Record<string | symbol, unknown>)[prop] : deep()) });
  return { mod, setAudioModeAsync, createRecording };
}

describe('the mic warm-up never touches the audio session it was told to leave alone', () => {
  // A fresh registry per test, WITHOUT isolateModules: voiceService requires its collaborators lazily
  // at call time, and a lazy require made after an isolateModules callback returns resolves in the
  // OUTER registry — so the mocks and the turn clock the test set up were not the ones it consulted.
  beforeEach(() => jest.resetModules());
  afterEach(() => { jest.dontMock('../../services/listeningSession'); });

  it('THE BUG: a session in flight → bail with NO audio-mode change (the finally used to flip it)', async () => {
    const av = expoAvWith({});
    jest.doMock('expo-av', () => av.mod);
    jest.doMock('../../services/listeningSession', () => ({ isSessionInFlight: () => true }));
    const vs = require('../../services/voiceService') as typeof import('../../services/voiceService');
    await vs.primeMicPipeline();
    expect(av.createRecording).not.toHaveBeenCalled();
    expect(av.setAudioModeAsync).not.toHaveBeenCalled();
  });

  it('a tap-path recording holds the mic → bail, no audio-mode change', async () => {
    const av = expoAvWith({});
    jest.doMock('expo-av', () => av.mod);
    jest.doMock('../../services/listeningSession', () => ({ isSessionInFlight: () => false }));
    const vs = require('../../services/voiceService') as typeof import('../../services/voiceService');
    const unregister = vs.registerExternalMicCheck(() => true);
    await vs.primeMicPipeline();
    unregister();
    expect(av.createRecording).not.toHaveBeenCalled();
    expect(av.setAudioModeAsync).not.toHaveBeenCalled();
  });

  it('a turn that just started (tap still arming its recorder) → bail', async () => {
    const av = expoAvWith({});
    jest.doMock('expo-av', () => av.mod);
    jest.doMock('../../services/listeningSession', () => ({ isSessionInFlight: () => false }));
    require('../../services/userTurnClock').noteUserTurn();
    const vs = require('../../services/voiceService') as typeof import('../../services/voiceService');
    await vs.primeMicPipeline();
    expect(av.createRecording).not.toHaveBeenCalled();
  });

  it('the idle case still primes, and still restores speech mode afterwards', async () => {
    const av = expoAvWith({});
    jest.doMock('expo-av', () => av.mod);
    jest.doMock('../../services/listeningSession', () => ({ isSessionInFlight: () => false }));
    const vs = require('../../services/voiceService') as typeof import('../../services/voiceService');
    await vs.primeMicPipeline();
    expect(av.createRecording).toHaveBeenCalledTimes(1);
    expect(av.setAudioModeAsync.mock.calls.length).toBeGreaterThanOrEqual(2); // record, then speech
  });
});

describe('a custom-caddie clip cannot wedge the speak queue', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => {
    jest.dontMock('../../store/playerProfileStore');
    jest.dontMock('../../services/customCaddieClips');
  });

  it('THE BUG: speak() over a recorded clip resolves, and the NEXT line still gets its turn', async () => {
    const av = expoAvWith({ createSoundRejects: true });
    jest.doMock('expo-av', () => av.mod);
    jest.doMock('../../store/playerProfileStore', () => {
      const state = { useCustomCaddie: true, customCaddieClips: {}, email: null };
      return { usePlayerProfileStore: { getState: () => state }, isOwnerEmail: () => false };
    });
    // A non-file:// URI is trusted without a disk probe.
    jest.doMock('../../services/customCaddieClips', () => ({ lookupClipUri: () => 'asset://my-line.m4a' }));
    require('../../store/settingsStore').useSettingsStore.setState({ voiceEnabled: true, localMode: false } as never);
    const vs = require('../../services/voiceService') as typeof import('../../services/voiceService');
    const settled = (p: Promise<unknown>) =>
      Promise.race([p.then(() => 'done', () => 'done'), new Promise((r) => setTimeout(() => r('wedged'), 1500))]);
    expect(await settled(vs.speak('Nice swing.', 'male', 'en', 'http://localhost', { userInitiated: true }))).toBe('done');
    expect(await settled(vs.playLocalFile('asset://next.m4a', 1, { userInitiated: true }))).toBe('done');
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────── */
/*  7. The cold-start OTA reload never lands on a conversation                                     */
/* ────────────────────────────────────────────────────────────────────────────────────────────── */

describe('the launch-time update reload waits for a quiet app', () => {
  const { mayAutoApplyUpdate } = require('../../services/updateApplyGate') as typeof import('../../services/updateApplyGate');
  const base = { ready: true, inRound: false, sessionActive: false, audioBusy: false, msSinceUserTurn: null, sinceLaunchMs: 3_000 };

  it('applies on a quiet launch — the June behaviour Tim asked for survives', () => {
    expect(mayAutoApplyUpdate(base)).toBe(true);
  });

  it('THE BUG: the avatar mic is recording (listening store idle) → no reload', () => {
    expect(mayAutoApplyUpdate({ ...base, audioBusy: true })).toBe(false);
  });

  it('the player already started a turn this launch → no reload', () => {
    expect(mayAutoApplyUpdate({ ...base, msSinceUserTurn: 400 })).toBe(false);
  });

  it('keeps the older gates', () => {
    expect(mayAutoApplyUpdate({ ...base, inRound: true })).toBe(false);
    expect(mayAutoApplyUpdate({ ...base, sessionActive: true })).toBe(false);
    expect(mayAutoApplyUpdate({ ...base, sinceLaunchMs: 25_000 })).toBe(false);
    expect(mayAutoApplyUpdate({ ...base, ready: false })).toBe(false);
  });

  it('the banner asks the gate again at the moment of reload, not only when the update lands', () => {
    // Behavioural coverage of the second ask needs a renderer; this pins that the timer consults it.
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../components/UpdateAvailableBanner.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const timer = src.slice(src.indexOf('applyTimerRef.current = setTimeout('));
    expect(timer.slice(0, 300)).toMatch(/if \(!gate\(\)\)/);
  });
});

describe('a proactive line that FALLS BACK still yields to the player', () => {
  const setup = (ask: () => Promise<unknown>) => {
    let brain!: typeof import('../../services/conversationalBrain');
    let clock!: typeof import('../../services/userTurnClock');
    jest.isolateModules(() => {
      clock = require('../../services/userTurnClock');
      jest.doMock('../../services/caddieBrain', () => ({ askCaddie: ask }));
      brain = require('../../services/conversationalBrain');
    });
    return { brain, clock };
  };
  afterEach(() => jest.dontMock('../../services/caddieBrain'));

  it('THE BUG: the brain times out after the player started talking → silence, not the canned line', async () => {
    let env!: ReturnType<typeof setup>;
    env = setup(async () => { env.clock.noteUserTurn(); return null; });
    expect(await env.brain.proactiveLineOrFallback('Say hi.', 'Fixed line.')).toBeNull();
  });
  it('the brain throws after the player started talking → silence', async () => {
    let env!: ReturnType<typeof setup>;
    env = setup(async () => { env.clock.noteUserTurn(); throw new Error('network'); });
    expect(await env.brain.proactiveLineOrFallback('Say hi.', 'Fixed line.')).toBeNull();
  });
  it('the brain fails and nobody spoke → the fallback, so the moment is never silent', async () => {
    const env = setup(async () => null);
    expect(await env.brain.proactiveLineOrFallback('Say hi.', 'Fixed line.')).toBe('Fixed line.');
  });
});

describe('the Caddie tab cannot start a proactive line on a turn it cannot see', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const code = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const tab = code('app/(tabs)/caddie.tsx');

  it('VAD hearing speech is a player turn', () => {
    expect(tab).toMatch(/onSpeechStart: \(\) => \{\s*noteUserTurn\(\);/);
  });
  it('a turn still being answered (session in flight, or the tab thinking/listening) blocks the line', () => {
    expect(tab).toMatch(/function voiceChannelBusy\(\): boolean \{\s*return [^;]*isSessionInFlight\(\)/);
    expect(tab).toMatch(/voiceChannelBusy\(\) \|\| tabState === 'thinking' \|\| tabState === 'listening' \|\| tabState === 'arming'/);
  });
  it('no mic holder unregisters by clearing everyone else (register(null) wipes the whole set)', () => {
    for (const rel of ['hooks/useVoiceCaddie.ts', 'services/acousticImpactDetector.ts', 'services/swing/audioMetering.ts']) {
      expect(code(rel)).not.toMatch(/registerExternalMicCheck\(null\)/);
    }
  });
});
